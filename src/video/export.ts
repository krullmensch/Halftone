import type {
  VideoCodec,
  VideoClip,
  VideoTimelineData,
  VideoExportSettings,
  SketchHandle,
} from '../types';
import { timelineDuration, clipEnd } from './timeline';
import { drawTimelineFrame, type CompositorSources } from './compositor';
import { probeCodecSupport } from './encoders/webcodecs';
import { createMediabunnySession } from './encoders/mediabunnyEncode';

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  framesDone: number;
  totalFrames: number;
  /** true when mediabunny falls back to a software WebCodecs encoder */
  software: boolean;
}

/** Minimum/maximum output bitrate, in bits per second, regardless of
 *  resolution/fps/codec (keeps tiny or absurd exports sane). */
const MIN_BITRATE = 1_000_000;
const MAX_BITRATE = 50_000_000;

/** Codecs with materially better compression efficiency than H.264 at the
 *  same perceptual quality get a lower target bitrate. */
const EFFICIENCY_FACTOR: Record<VideoCodec, number> = {
  h264: 1,
  h265: 0.7,
  vp8: 1,
  vp9: 0.7,
  av1: 0.7,
};

/**
 * Derive a reasonable default bitrate from output resolution, frame rate,
 * and codec: ~0.1 bits per pixel per frame at a 16:9-equivalent pixel
 * count, clamped to [1, 50] Mbps and scaled down for more efficient codecs.
 */
export function defaultBitrate(resolution: number, fps: number, codec: VideoCodec): number {
  const pixelCount = resolution * resolution * (9 / 16);
  const raw = pixelCount * fps * 0.1 * EFFICIENCY_FACTOR[codec];
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

/** Trigger a browser download of `blob` under `fileName` and revoke the
 *  object URL once the click has had a chance to start the download. */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function abortError(): DOMException {
  return new DOMException('Export aborted', 'AbortError');
}

/** Preload a still's image element (decode() up front so drawImage never blocks). */
function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  if (img.decode) {
    return img.decode().then(() => img, () => img);
  }
  return new Promise<HTMLImageElement>(resolve => {
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
  });
}

/** The media time (in the source video's own timeline, seconds) a video clip
 *  shows at timeline time `t`. Clamped to the clip's trimmed [inPoint, outPoint]
 *  so trailing frames hold the last visible frame rather than running past it. */
function clipMediaTime(clip: VideoClip, t: number): number {
  return Math.min(clip.outPoint, Math.max(clip.inPoint, clip.inPoint + (t - clip.startTime)));
}

/** Per-clip sequential decoder: a mediabunny CanvasSink pulled in lockstep with
 *  the export frame loop. `next()` yields the decoded canvas for the clip's next
 *  active frame; because the timestamps are monotonic the sink decodes each
 *  packet at most once (no per-frame seeking, which is what made export crawl). */
interface ClipDecoder {
  input: import('mediabunny').Input;
  next(): Promise<CanvasImageSource | null>;
  /** Release the decode iterator (closing any in-flight VideoSamples) and the
   *  input. Safe to call whether the export finished or was aborted midway. */
  dispose(): Promise<void>;
}

/** Build a decoder for one video clip. `frameTimes` are the media timestamps
 *  (ascending) for exactly the frames where the clip is active, in loop order.
 *  Returns null if the clip's blob has no decodable video track. */
async function createClipDecoder(
  clip: VideoClip,
  frameTimes: number[],
): Promise<ClipDecoder | null> {
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  // clip.src is an object URL for the imported File; fetch it back to a Blob.
  const blob = await fetch(clip.src).then(r => r.blob());
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) {
    input.dispose();
    return null;
  }
  const sink = new CanvasSink(track);
  const iter = sink.canvasesAtTimestamps(frameTimes);
  return {
    input,
    async next() {
      const { value, done } = await iter.next();
      return done || !value ? null : value.canvas;
    },
    async dispose() {
      // Returning the generator runs its cleanup, closing any VideoSamples the
      // sink still holds (otherwise they leak and warn on GC — notably when the
      // export is aborted before the iterator is fully drained).
      try {
        await iter.return(undefined);
      } catch {
        // ignore
      }
      try {
        await input.dispose();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Render the full timeline frame-by-frame through the sketch's full-res
 * export path and encode it to a downloadable video file. Uses mediabunny
 * for both hardware and software-accelerated encoding/muxing. Compositing
 * (clips + transitions) runs through the same drawTimelineFrame() used by
 * the preview, driven here by hidden <video> elements seeked per frame
 * instead of Remotion's Player.
 */
export async function exportVideo(opts: {
  timeline: VideoTimelineData;
  settings: VideoExportSettings;
  sketch: Pick<SketchHandle, 'beginVideoExport' | 'endVideoExport' | 'renderVideoFrame'>;
  onProgress: (p: ExportProgress) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { timeline, settings, sketch, onProgress, signal } = opts;

  if (signal.aborted) throw abortError();

  const { fps, resolution, container, codec } = settings;
  const bitrate = settings.bitrate ?? defaultBitrate(resolution, fps, codec);
  const duration = timelineDuration(timeline);
  const totalFrames = Math.max(0, Math.ceil(duration * fps));

  // Resolution is expressed as the longest output side; derive width/height
  // from the timeline's chosen output aspect ratio.
  const aspect = timeline.aspect.w / timeline.aspect.h;
  const width = aspect >= 1 ? resolution : Math.round(resolution * aspect);
  const height = aspect >= 1 ? Math.round(resolution / aspect) : resolution;

  const support = await probeCodecSupport(codec, container, width, height, fps, bitrate);
  if (support === 'unsupported') {
    throw new Error(`Codec ${codec} in ${container} not supported`);
  }
  const software = support === 'software';

  onProgress({ phase: 'preparing', framesDone: 0, totalFrames, software });

  const session = await createMediabunnySession({
    codec,
    container,
    width,
    height,
    fps,
    bitrate,
  });

  // Compositing canvas at the exact output size; each frame is composited
  // here, then run through the halftone renderer.
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  const compositeCtx = compositeCanvas.getContext('2d')!;

  const videoClips = timeline.clips.filter((c): c is VideoClip => c.type === 'video');
  const stillClips = timeline.clips.filter(c => c.type === 'still');

  // For each video clip, the media timestamps (ascending) of exactly the frames
  // where it is active, in loop order — the sequence fed to its CanvasSink.
  const clipFrameTimes = new Map<string, number[]>();
  for (const c of videoClips) {
    const times: number[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const t = i / fps;
      if (t >= c.startTime && t < clipEnd(c)) times.push(clipMediaTime(c, t));
    }
    clipFrameTimes.set(c.id, times);
  }

  const images = new Map<string, HTMLImageElement>();
  const decoders = new Map<string, ClipDecoder>();
  // The decoded canvas each active video clip is currently showing (advanced in
  // lockstep with the frame loop); the compositor pulls from here.
  const currentFrame = new Map<string, CanvasImageSource | null>();

  await Promise.all([
    ...videoClips.map(async c => {
      const times = clipFrameTimes.get(c.id)!;
      if (times.length === 0) return;
      const dec = await createClipDecoder(c, times);
      if (dec) decoders.set(c.id, dec);
    }),
    ...stillClips.map(async c => images.set(c.id, await loadImage(c.src))),
  ]);

  const sources: CompositorSources = {
    getVideoEl: id => currentFrame.get(id) ?? null,
    getImage: id => images.get(id) ?? null,
  };

  sketch.beginVideoExport();

  // The sketch renders at its own full canvas resolution,
  // which generally differs from the requested output resolution — so
  // normalize every frame to the exact output size here, through one reused
  // scaling canvas, before handing it to the mediabunny CanvasSource.
  const scaleCanvas = document.createElement('canvas');
  scaleCanvas.width = width;
  scaleCanvas.height = height;
  const scaleCtx = scaleCanvas.getContext('2d')!;

  const toOutputSize = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    if (canvas.width === width && canvas.height === height) return canvas;
    scaleCtx.drawImage(canvas, 0, 0, width, height);
    return scaleCanvas;
  };

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) {
        session.cancel();
        throw abortError();
      }

      const t = i / fps;

      // Advance each active clip's sequential decoder to this frame. Because the
      // requested timestamps are monotonic, mediabunny decodes forward without
      // re-seeking — the whole point of this path over per-frame <video> seeks.
      await Promise.all(
        videoClips
          .filter(c => t >= c.startTime && t < clipEnd(c))
          .map(async c => {
            const dec = decoders.get(c.id);
            currentFrame.set(c.id, dec ? await dec.next() : null);
          }),
      );

      drawTimelineFrame(compositeCtx, timeline, t, sources);

      onProgress({ phase: 'rendering', framesDone: i, totalFrames, software });

      const canvas = sketch.renderVideoFrame(
        compositeCanvas,
        compositeCanvas.width,
        compositeCanvas.height,
      );

      if (signal.aborted) {
        session.cancel();
        throw abortError();
      }

      onProgress({ phase: 'encoding', framesDone: i, totalFrames, software });
      await session.addFrame(toOutputSize(canvas), i);
    }

    if (signal.aborted) {
      session.cancel();
      throw abortError();
    }

    onProgress({ phase: 'finalizing', framesDone: totalFrames, totalFrames, software });
    const blob = await session.finish();
    downloadBlob(blob, `halftone.${container}`);
  } finally {
    sketch.endVideoExport();
    await Promise.all(
      [...decoders.values()].map(dec => dec.dispose()),
    );
    decoders.clear();
    currentFrame.clear();
    images.clear();
  }
}
