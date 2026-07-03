import type { VideoClip } from '../types';

export interface FrameResult {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface ClipFrameSource {
  readonly clip: VideoClip;
  /** The underlying video element (video clips only) — used by the playback
   *  engine for requestVideoFrameCallback-driven rendering and direct draws. */
  readonly videoEl?: HTMLVideoElement;
  /** Seek-accurate frame at `time` (seconds in SOURCE media). For video clips:
   *  set currentTime, await the 'seeked' event (with a safety timeout ~2s),
   *  resolve with the video element itself as source. If already within ~1/120s
   *  of the target, resolve immediately without seeking. For stills: resolve
   *  the cached ImageBitmap immediately, ignore `time`. */
  getFrameAt(time: number): Promise<FrameResult>;
  dispose(): void;
}

/** Tolerance (seconds) below which a seek is skipped as a no-op. */
const SEEK_EPSILON = 1 / 120;
/** Safety timeout for a stalled 'seeked' event. */
const SEEK_TIMEOUT_MS = 2000;

class VideoFrameSource implements ClipFrameSource {
  readonly videoEl: HTMLVideoElement;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly clip: VideoClip, videoEl: HTMLVideoElement) {
    this.videoEl = videoEl;
  }

  getFrameAt(time: number): Promise<FrameResult> {
    // Serialize: a seek in flight must complete before the next begins.
    const next = this.queue.then(() => this.seekTo(time), () => this.seekTo(time));
    this.queue = next;
    return next;
  }

  private seekTo(time: number): Promise<FrameResult> {
    const video = this.videoEl;
    const target = Math.max(0, time);
    const result = (): FrameResult => ({
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
    });

    if (Math.abs(video.currentTime - target) <= SEEK_EPSILON) {
      return Promise.resolve(result());
    }

    return new Promise<FrameResult>((resolve) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timer);
      };
      const onSeeked = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result());
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result());
      }, SEEK_TIMEOUT_MS);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = target;
    });
  }

  dispose(): void {
    this.videoEl.pause();
    this.videoEl.removeAttribute('src');
    this.videoEl.load();
  }
}

class StillFrameSource implements ClipFrameSource {
  readonly videoEl: HTMLVideoElement | undefined = undefined;

  constructor(readonly clip: VideoClip, private bitmap: ImageBitmap) {}

  getFrameAt(_time: number): Promise<FrameResult> {
    return Promise.resolve({
      source: this.bitmap,
      width: this.bitmap.width,
      height: this.bitmap.height,
    });
  }

  dispose(): void {
    this.bitmap.close();
  }
}

/** Create a frame source. Video clips: create a muted, playsInline, preload
 *  'auto' HTMLVideoElement with src = clip.src, await 'loadeddata'. Stills:
 *  fetch clip.src → createImageBitmap. Rejects on media error. */
export function createFrameSource(clip: VideoClip): Promise<ClipFrameSource> {
  if (clip.type === 'video') {
    return new Promise<ClipFrameSource>((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      const onLoaded = () => {
        cleanup();
        resolve(new VideoFrameSource(clip, video));
      };
      const onError = () => {
        cleanup();
        reject(new Error(`Video konnte nicht geladen werden: ${clip.fileName}`));
      };
      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('error', onError);
      video.src = clip.src;
    });
  }

  return fetch(clip.src)
    .then((res) => res.blob())
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => new StillFrameSource(clip, bitmap) as ClipFrameSource)
    .catch((err) => {
      throw new Error(`Bild konnte nicht geladen werden: ${clip.fileName} (${err})`);
    });
}

/** Cache keyed by clip.id so playback and export reuse decoded sources. */
const cache = new Map<string, Promise<ClipFrameSource>>();

/** Returns an existing live source for clip.id or creates one. */
export function getOrCreateFrameSource(clip: VideoClip): Promise<ClipFrameSource> {
  const existing = cache.get(clip.id);
  if (existing) return existing;
  const created = createFrameSource(clip);
  cache.set(clip.id, created);
  created.catch(() => cache.delete(clip.id));
  return created;
}

export function disposeFrameSource(clipId: string): void {
  const entry = cache.get(clipId);
  if (!entry) return;
  cache.delete(clipId);
  entry.then((source) => source.dispose()).catch(() => {});
}

export function disposeAllFrameSources(): void {
  for (const id of Array.from(cache.keys())) disposeFrameSource(id);
}
