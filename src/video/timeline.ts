import type { VideoClip, VideoTimelineData, ClipTransform } from '../types';

/** Playable seconds of a clip after trimming (never negative). */
export function clipPlayableDuration(clip: VideoClip): number {
  return Math.max(0, clip.outPoint - clip.inPoint);
}

/** Absolute end time of a clip on the timeline (startTime + playable). */
export function clipEnd(clip: VideoClip): number {
  return clip.startTime + clipPlayableDuration(clip);
}

/**
 * Total timeline duration: the latest end among all clips and transition blocks.
 * Gaps between clips are included (they render as black). 0 for an empty timeline.
 */
export function timelineDuration(tl: VideoTimelineData): number {
  let end = 0;
  for (const clip of tl.clips) end = Math.max(end, clipEnd(clip));
  for (const t of tl.transitions) end = Math.max(end, t.startTime + t.duration);
  return Math.max(0, end);
}

/** Output canvas dimensions from the timeline's aspect + resolution (longest side). */
export function canvasDims(tl: VideoTimelineData): { w: number; h: number } {
  const { w: aw, h: ah } = tl.aspect;
  const res = Math.max(1, Math.round(tl.resolution));
  if (aw >= ah) {
    return { w: res, h: Math.max(1, Math.round((res * ah) / aw)) };
  }
  return { w: Math.max(1, Math.round((res * aw) / ah)), h: res };
}

/** Canvas aspect ratio (w/h) for the halftone renderer's videoAspect param. */
export function canvasAspect(tl: VideoTimelineData): number {
  return tl.aspect.w / tl.aspect.h;
}

export interface DestRect {
  destX: number;
  destY: number;
  destWidth: number;
  destHeight: number;
}

/**
 * Where a clip's video is drawn inside a cw×ch canvas, given its transform.
 * The clip is contain-fitted to the canvas (preserving its native aspect),
 * scaled by transform.scale, then positioned so its center sits at
 * (transform.x*cw, transform.y*ch). Reused by the timeline compositor and by
 * the on-canvas drag hit-test / inverse mapping.
 */
export function clipDestRect(clip: VideoClip, cw: number, ch: number): DestRect {
  const nativeAspect = clip.width && clip.height ? clip.width / clip.height : cw / ch;
  const canvasAspectRatio = cw / ch;

  // Contain-fit: fill the axis that constrains, letterbox the other.
  let fitW: number;
  let fitH: number;
  if (nativeAspect >= canvasAspectRatio) {
    fitW = cw;
    fitH = cw / nativeAspect;
  } else {
    fitH = ch;
    fitW = ch * nativeAspect;
  }

  const destWidth = fitW * clip.transform.scale;
  const destHeight = fitH * clip.transform.scale;
  const destX = clip.transform.x * cw - destWidth / 2;
  const destY = clip.transform.y * ch - destHeight / 2;
  return { destX, destY, destWidth, destHeight };
}

/** A transform re-centered on one or both axes (used by center-H / center-V). */
export function centeredTransform(
  t: ClipTransform,
  axis: 'x' | 'y' | 'both',
): ClipTransform {
  return {
    ...t,
    x: axis === 'x' || axis === 'both' ? 0.5 : t.x,
    y: axis === 'y' || axis === 'both' ? 0.5 : t.y,
  };
}
