import type { VideoTimelineData, SketchHandle, FrameMix } from '../types';
import { evaluateTimeline, timelineDuration } from './timeline';
import { getOrCreateFrameSource } from './frameSource';
import type { ClipFrameSource } from './frameSource';

export interface PlaybackEngineOptions {
  getTimeline: () => VideoTimelineData; // read live timeline (React state may change)
  sketch: Pick<SketchHandle, 'setVideoFrame'>;
  onTime: (t: number) => void; // fired at most once per rendered frame
  onEnded: () => void;
  /** Max preview render fps (halftone is CPU-bound); default 30 */
  fpsCap?: number;
}

export interface PlaybackEngine {
  play(): void;
  pause(): void;
  /** Seek to global time (seconds) and render that single frame */
  seek(t: number): Promise<void>;
  readonly isPlaying: boolean;
  dispose(): void;
}

/** Allowed drift (seconds) between a playing element's currentTime and the
 *  timeline-derived target before we hard-correct it. */
const DRIFT_TOLERANCE = 0.15;

/** Drives preview playback: a rAF master clock walks the timeline and, for
 *  the currently active clip(s), either lets a video element free-run (fast
 *  path) or shows a still bitmap, compositing transitions via FrameMix. */
export function createPlaybackEngine(opts: PlaybackEngineOptions): PlaybackEngine {
  const { getTimeline, sketch, onTime, onEnded } = opts;
  const fpsCap = opts.fpsCap ?? 30;
  const minFrameInterval = 1000 / fpsCap;

  let playing = false;
  let rafId: number | null = null;
  let lastTickTime: number | null = null;
  let lastRenderTime = 0;
  let playhead = 0;
  let disposed = false;

  /** Elements currently kept playing, keyed by clip id, so we can pause/reset
   *  the ones that leave the active window on the next tick. */
  const activeEls = new Map<string, HTMLVideoElement>();

  function stopUnusedElements(keepIds: Set<string>): void {
    for (const [id, el] of activeEls) {
      if (!keepIds.has(id)) {
        el.pause();
        activeEls.delete(id);
      }
    }
  }

  /** Ensure a clip's video element is playing and close to `time`; no-op for stills. */
  function driveElement(source: ClipFrameSource, time: number): void {
    const el = source.videoEl;
    if (!el) return;
    activeEls.set(source.clip.id, el);
    if (Math.abs(el.currentTime - time) > DRIFT_TOLERANCE) {
      el.currentTime = time;
    }
    if (el.paused) {
      void el.play().catch(() => {});
    }
  }

  async function renderTick(): Promise<void> {
    const tl = getTimeline();
    const duration = timelineDuration(tl);
    if (playhead >= duration) {
      playhead = duration;
      pause();
      onEnded();
      return;
    }

    const sample = evaluateTimeline(tl, playhead);
    if (!sample) {
      pause();
      onEnded();
      return;
    }

    const keepIds = new Set<string>([sample.clip.id]);
    if (sample.transition) keepIds.add(sample.transition.other.id);
    stopUnusedElements(keepIds);

    const mainSource = await getOrCreateFrameSource(sample.clip);
    driveElement(mainSource, sample.clipTime);

    let mix: FrameMix | undefined;
    if (sample.transition) {
      const { other, otherTime, t, def } = sample.transition;
      const otherSource = await getOrCreateFrameSource(other);
      driveElement(otherSource, otherTime);
      const otherEl = otherSource.videoEl;
      const otherMedia = otherEl ?? (await otherSource.getFrameAt(otherTime)).source;
      const otherWidth = otherEl ? otherEl.videoWidth : other.width;
      const otherHeight = otherEl ? otherEl.videoHeight : other.height;
      mix = {
        other: otherMedia,
        otherWidth,
        otherHeight,
        t,
        type: def.type,
        color: def.color,
        direction: def.direction,
      };
    }

    const mainEl = mainSource.videoEl;
    const mainMedia = mainEl ?? (await mainSource.getFrameAt(sample.clipTime)).source;
    const mainWidth = mainEl ? mainEl.videoWidth : sample.clip.width;
    const mainHeight = mainEl ? mainEl.videoHeight : sample.clip.height;

    sketch.setVideoFrame(mainMedia, mainWidth, mainHeight, mix);
    onTime(playhead);
  }

  function loop(now: number): void {
    if (!playing || disposed) return;
    if (lastTickTime === null) lastTickTime = now;
    const delta = now - lastTickTime;
    lastTickTime = now;
    playhead += delta / 1000;

    if (now - lastRenderTime >= minFrameInterval) {
      lastRenderTime = now;
      void renderTick();
    }
    rafId = requestAnimationFrame(loop);
  }

  function play(): void {
    if (playing || disposed) return;
    playing = true;
    lastTickTime = null;
    rafId = requestAnimationFrame(loop);
  }

  function pause(): void {
    playing = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const el of activeEls.values()) el.pause();
  }

  async function seek(t: number): Promise<void> {
    pause();
    const tl = getTimeline();
    const duration = timelineDuration(tl);
    playhead = Math.max(0, Math.min(t, duration));

    const sample = evaluateTimeline(tl, playhead);
    if (!sample) return;

    const mainSource = await getOrCreateFrameSource(sample.clip);
    const mainFrame = await mainSource.getFrameAt(sample.clipTime);

    let mix: FrameMix | undefined;
    if (sample.transition) {
      const { other, otherTime, t: progress, def } = sample.transition;
      const otherSource = await getOrCreateFrameSource(other);
      const otherFrame = await otherSource.getFrameAt(otherTime);
      mix = {
        other: otherFrame.source,
        otherWidth: otherFrame.width,
        otherHeight: otherFrame.height,
        t: progress,
        type: def.type,
        color: def.color,
        direction: def.direction,
      };
    }

    sketch.setVideoFrame(mainFrame.source, mainFrame.width, mainFrame.height, mix);
    onTime(playhead);
  }

  function dispose(): void {
    disposed = true;
    pause();
    activeEls.clear();
  }

  return {
    play,
    pause,
    seek,
    get isPlaying() {
      return playing;
    },
    dispose,
  };
}
