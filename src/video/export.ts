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

/** Create a muted <video> element preloaded and ready to be seeked. The element
 *  is attached to the DOM off-screen (NOT display:none) — a detached or
 *  display:none <video> gets its decode pipeline suspended by the browser, so
 *  seeks resolve but drawImage yields a stale first frame. Positioning it out of
 *  view keeps the decoder live while staying invisible. */
function createVideoEl(clip: VideoClip): Promise<HTMLVideoElement> {
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.style.position = 'fixed';
  el.style.left = '-10000px';
  el.style.top = '0';
  el.style.width = '2px';
  el.style.height = '2px';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.src = clip.src;
  document.body.appendChild(el);
  return new Promise<HTMLVideoElement>(resolve => {
    const done = () => resolve(el);
    // Wait for enough data that seeking can actually decode frames.
    el.oncanplay = done;
    el.onloadeddata = done;
    el.onerror = done; // best-effort: draw a black frame rather than block export
  });
}

/** Whether the browser can signal a decoded video frame is ready to paint. */
function hasFrameCallback(el: HTMLVideoElement): boolean {
  return typeof (el as unknown as { requestVideoFrameCallback?: unknown })
    .requestVideoFrameCallback === 'function';
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

/** Seek `el` to `time` seconds and resolve once a decoded frame for that time
 *  is actually ready to paint. Relies on requestVideoFrameCallback (fires only
 *  after a frame is available for compositing) when present — the plain
 *  'seeked' event can fire before the frame is decoded, which is what makes
 *  drawImage grab a stale frame and produce an all-identical-frames export.
 *  Falls back to 'seeked' + a guard timeout on browsers without rVFC. */
function seekVideo(el: HTMLVideoElement, time: number): Promise<void> {
  return new Promise<void>(resolve => {
    let settled = false;
    // Already at the target time and a frame is decoded → nothing to wait for.
    if (Math.abs(el.currentTime - time) < 1e-3 && el.readyState >= 2) {
      resolve();
      return;
    }
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      resolve();
    };
    const onSeeked = () => {
      if (hasFrameCallback(el)) {
        // 'seeked' fired, but wait one more decoded-frame tick to be sure the
        // pixels for `time` are actually available to drawImage.
        (el as unknown as {
          requestVideoFrameCallback(cb: () => void): number;
        }).requestVideoFrameCallback(finish);
      } else {
        finish();
      }
    };
    el.addEventListener('seeked', onSeeked);
    // Longer guard than the frame path: a slow decode shouldn't drop the frame.
    const timer = setTimeout(finish, 2000);
    el.currentTime = time;
  });
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

  const videoEls = new Map<string, HTMLVideoElement>();
  const images = new Map<string, HTMLImageElement>();

  await Promise.all([
    ...videoClips.map(async c => videoEls.set(c.id, await createVideoEl(c))),
    ...stillClips.map(async c => images.set(c.id, await loadImage(c.src))),
  ]);

  const sources: CompositorSources = {
    getVideoEl: id => videoEls.get(id) ?? null,
    getImage: id => images.get(id) ?? null,
  };

  await sketch.beginVideoExport();

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

      // Seek every video clip active at this frame to its exact media time.
      await Promise.all(
        videoClips
          .filter(c => t >= c.startTime && t < clipEnd(c))
          .map(c => {
            const el = videoEls.get(c.id);
            if (!el) return Promise.resolve();
            const mediaTime = Math.min(c.outPoint, Math.max(c.inPoint, c.inPoint + (t - c.startTime)));
            return seekVideo(el, mediaTime);
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
    for (const el of videoEls.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      el.remove();
    }
    videoEls.clear();
    images.clear();
  }
}
