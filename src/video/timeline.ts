import type { VideoClip, VideoTimelineData, ClipTransition } from '../types';

/** Playable seconds of a clip after trimming (never negative). */
export function clipPlayableDuration(clip: VideoClip): number {
  return Math.max(0, clip.outPoint - clip.inPoint);
}

/**
 * Effective transition duration between clips[i] and clips[i+1], clamped to
 * half of each neighbor's playable duration so a transition can never eat
 * more than a clip has to offer. Always 0 for type 'none' or out-of-range i.
 */
export function effectiveTransitionDuration(tl: VideoTimelineData, i: number): number {
  const def = tl.transitions[i];
  const a = tl.clips[i];
  const b = tl.clips[i + 1];
  if (!def || !a || !b || def.type === 'none') return 0;
  const maxA = clipPlayableDuration(a) / 2;
  const maxB = clipPlayableDuration(b) / 2;
  return Math.max(0, Math.min(def.duration, maxA, maxB));
}

/**
 * Total timeline duration. Transitions OVERLAP: each transition of duration d
 * makes clip B start d seconds before clip A ends (standard NLE semantics),
 * so duration = sum(playable) - sum(effective transition durations).
 */
export function timelineDuration(tl: VideoTimelineData): number {
  let total = 0;
  for (const clip of tl.clips) total += clipPlayableDuration(clip);
  for (let i = 0; i < tl.clips.length - 1; i++) total -= effectiveTransitionDuration(tl, i);
  return Math.max(0, total);
}

/** Start time of clip i on the global timeline (accounting for overlaps). */
export function clipStartTime(tl: VideoTimelineData, i: number): number {
  let t = 0;
  for (let k = 0; k < i; k++) {
    t += clipPlayableDuration(tl.clips[k]) - effectiveTransitionDuration(tl, k);
  }
  return t;
}

export interface TimelineSample {
  clipIndex: number;
  clip: VideoClip;
  /** Time within the clip's SOURCE media (inPoint already added) */
  clipTime: number;
  /** Present while inside a transition window into the NEXT clip */
  transition?: {
    otherIndex: number;
    other: VideoClip;
    otherTime: number; // source time within the next clip
    t: number; // 0..1 progress through the transition
    def: ClipTransition;
  };
}

/**
 * Which clip(s) are visible at global time t. Returns null for an empty
 * timeline; clamps t into [0, duration]. During a transition the sample's
 * `clip` is the OUTGOING clip and `transition.other` the incoming one.
 */
export function evaluateTimeline(tl: VideoTimelineData, t: number): TimelineSample | null {
  if (tl.clips.length === 0) return null;
  const duration = timelineDuration(tl);
  const clamped = Math.max(0, Math.min(t, duration));

  for (let i = 0; i < tl.clips.length; i++) {
    const clip = tl.clips[i];
    const start = clipStartTime(tl, i);
    const playable = clipPlayableDuration(clip);
    const end = start + playable;
    if (clamped < start || clamped > end) continue;
    // Not the last clip: check whether we're inside its outgoing transition window.
    const transDur = i < tl.clips.length - 1 ? effectiveTransitionDuration(tl, i) : 0;
    if (transDur > 0 && clamped >= end - transDur) {
      const other = tl.clips[i + 1];
      const def = tl.transitions[i];
      const localT = (clamped - (end - transDur)) / transDur;
      const otherTime = other.inPoint + localT * transDur;
      return {
        clipIndex: i,
        clip,
        clipTime: clip.inPoint + (clamped - start),
        transition: {
          otherIndex: i + 1,
          other,
          otherTime,
          t: Math.max(0, Math.min(1, localT)),
          def,
        },
      };
    }
    return {
      clipIndex: i,
      clip,
      clipTime: clip.inPoint + (clamped - start),
    };
  }

  // Fallback: clamped time landed exactly on the end of the last clip.
  const lastIndex = tl.clips.length - 1;
  const lastClip = tl.clips[lastIndex];
  return {
    clipIndex: lastIndex,
    clip: lastClip,
    clipTime: lastClip.outPoint,
  };
}
