import type {
  VideoCodec,
  VideoTimelineData,
  VideoExportSettings,
  SketchHandle,
  FrameMix,
} from '../types';
import { timelineDuration, evaluateTimeline } from './timeline';
import { getOrCreateFrameSource } from './frameSource';
import { detectEncodePath } from './encoders/webcodecs';
import { createWebCodecsSession, type EncodeSession } from './encoders/webcodecsEncode';
import { createFfmpegSession } from './encoders/ffmpegFallback';

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing';
  framesDone: number;
  totalFrames: number;
  /** true when going through the ffmpeg software path */
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

/**
 * Render the full timeline frame-by-frame through the sketch's full-res
 * export path and encode it to a downloadable video file. Prefers a
 * WebCodecs + browser muxer session (fast, hardware-accelerated where
 * available); falls back to an ffmpeg.wasm software session when the
 * codec/container combination isn't supported by the browser encoder/muxer.
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
  // from the first clip's aspect ratio (falls back to 16:9).
  const aspect = timeline.clips[0] ? timeline.clips[0].width / timeline.clips[0].height : 16 / 9;
  const width = aspect >= 1 ? resolution : Math.round(resolution * aspect);
  const height = aspect >= 1 ? Math.round(resolution / aspect) : resolution;

  onProgress({ phase: 'preparing', framesDone: 0, totalFrames, software: false });

  const path = await detectEncodePath(codec, container, width, height, fps, bitrate);
  const software = path === 'ffmpeg';

  let session: EncodeSession;
  if (path === 'webcodecs') {
    session = await createWebCodecsSession({
      codec,
      container: container as 'mp4' | 'webm',
      width,
      height,
      fps,
      bitrate,
    });
  } else {
    session = await createFfmpegSession({
      codec,
      container,
      width,
      height,
      fps,
      bitrate,
      onLoadProgress: (ratio) => {
        onProgress({ phase: 'preparing', framesDone: 0, totalFrames, software: true });
        void ratio; // loader ratio is folded into the 'preparing' phase; no sub-progress field to report it in.
      },
    });
  }

  await sketch.beginVideoExport();

  // The sketch renders at its own full canvas resolution (params.canvasSize),
  // which generally differs from the requested output resolution. WebCodecs
  // happens to rescale VideoFrames to the encoder config, but the ffmpeg path
  // encodes PNG frames verbatim — so normalize every frame to the exact
  // output size here, through one reused scaling canvas.
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
      const sample = evaluateTimeline(timeline, t);
      if (!sample) continue;

      const source = await getOrCreateFrameSource(sample.clip);
      const frameResult = await source.getFrameAt(sample.clipTime);

      let mix: FrameMix | undefined;
      if (sample.transition) {
        const { other, otherTime, t: mixT, def } = sample.transition;
        const otherSource = await getOrCreateFrameSource(other);
        const otherFrameResult = await otherSource.getFrameAt(otherTime);
        mix = {
          other: otherFrameResult.source,
          otherWidth: otherFrameResult.width,
          otherHeight: otherFrameResult.height,
          t: mixT,
          type: def.type,
          color: def.color,
          direction: def.direction,
        };
      }

      onProgress({ phase: 'rendering', framesDone: i, totalFrames, software });

      const canvas = await sketch.renderVideoFrame(
        frameResult.source,
        frameResult.width,
        frameResult.height,
        mix,
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
  }
}
