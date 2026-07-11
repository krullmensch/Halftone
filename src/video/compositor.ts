import type { VideoTimelineData, VideoClip, TimelineTransition, WipeDirection } from '../types';
import { clipEnd, clipDestRect } from './timeline';

/** Frame sources the compositor pulls from. The caller is responsible for
 *  seeking video elements to the correct media time before calling
 *  drawTimelineFrame (preview: Remotion's <Video> keeps them frame-synced;
 *  export: the export loop sets .currentTime and awaits 'seeked'). */
export interface CompositorSources {
  getVideoEl(clipId: string): HTMLVideoElement | null;
  getImage(clipId: string): HTMLImageElement | ImageBitmap | null;
}

/** Clamp `x` to [0, 1]. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Linear 0→1 progress of `t` across [start, start+duration]; clamped. */
function progressOf(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / duration);
}

/** Rectangle (in canvas px) revealed by a directional wipe at `progress` (0→1). */
function wipeRevealRect(
  direction: WipeDirection,
  progress: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  switch (direction) {
    case 'left':
      return { x: 0, y: 0, w: progress * w, h };
    case 'right':
      return { x: (1 - progress) * w, y: 0, w: progress * w, h };
    case 'up':
      return { x: 0, y: 0, w, h: progress * h };
    case 'down':
      return { x: 0, y: (1 - progress) * h, w, h: progress * h };
  }
}

/** Resolve the CanvasImageSource (video el or still image) for a clip. */
function sourceFor(clip: VideoClip, sources: CompositorSources): CanvasImageSource | null {
  return clip.type === 'video' ? sources.getVideoEl(clip.id) : sources.getImage(clip.id);
}

/** The overlap transition (crossfade/wipe) whose incoming clip is `clip` and
 *  whose block window contains `t`, if any. */
function incomingTransitionFor(
  clip: VideoClip,
  tl: VideoTimelineData,
  t: number,
): TimelineTransition | null {
  for (const tr of tl.transitions) {
    if (tr.type === 'dip-to-color') continue;
    if (tr.toClipId !== clip.id) continue;
    if (t < tr.startTime || t >= tr.startTime + tr.duration) continue;
    return tr;
  }
  return null;
}

/**
 * Pure, frame-deterministic 2D-canvas compositor: black background, clips
 * drawn in start-time order
 * (later start on top) at their transform rect, crossfade/wipe applied to
 * the incoming clip of an overlap transition, dip-to-color overlays drawn
 * last with a triangular opacity ramp peaking at the block's midpoint.
 */
export function drawTimelineFrame(
  ctx: CanvasRenderingContext2D,
  tl: VideoTimelineData,
  t: number,
  sources: CompositorSources,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);

  const active = tl.clips
    .filter(c => t >= c.startTime && t < clipEnd(c))
    .sort((a, b) => a.startTime - b.startTime);

  for (const clip of active) {
    const source = sourceFor(clip, sources);
    if (!source) continue;
    const r = clipDestRect(clip, w, h);
    const tr = incomingTransitionFor(clip, tl, t);

    ctx.save();
    if (tr?.type === 'wipe') {
      const progress = progressOf(t, tr.startTime, tr.duration);
      const rect = wipeRevealRect(tr.direction ?? 'left', progress, w, h);
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
    } else if (tr?.type === 'crossfade') {
      ctx.globalAlpha = progressOf(t, tr.startTime, tr.duration);
    }
    ctx.drawImage(source, r.destX, r.destY, r.destWidth, r.destHeight);
    ctx.restore();
  }

  for (const tr of tl.transitions) {
    if (tr.type !== 'dip-to-color' || tr.duration <= 0) continue;
    if (t < tr.startTime || t > tr.startTime + tr.duration) continue;
    const local = (t - tr.startTime) / tr.duration;
    const opacity = local <= 0.5 ? local / 0.5 : (1 - local) / 0.5;
    if (opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = clamp01(opacity);
    ctx.fillStyle = tr.color ?? '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  ctx.globalAlpha = 1;
}
