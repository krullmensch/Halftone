import React, { useEffect, useMemo, useRef } from 'react';
import { AbsoluteFill, Sequence, Video as Html5Video, useCurrentFrame } from 'remotion';
import type { VideoTimelineData } from '../../types';
import { clipEnd } from '../timeline';
import { drawTimelineFrame, type CompositorSources } from '../compositor';

/** Frame rate the Remotion composition runs at. Preview playback and
 *  timeline-frame math are all expressed in this fps. */
export const TIMELINE_FPS = 30;

/** Longest side (px) of the offscreen compositing canvas used for preview
 *  (mirrors the old etro engine's PREVIEW_MAX_SIDE). */
const PREVIEW_MAX_SIDE = 1280;

export interface TimelineCompositionProps {
  timeline: VideoTimelineData;
  /** Called every rendered frame with the composited canvas — the caller
   *  pushes it through the halftone sketch (sketch.setVideoFrame). */
  onFrame: (canvas: HTMLCanvasElement, w: number, h: number) => void;
}

export function previewCanvasSize(tl: VideoTimelineData): { w: number; h: number } {
  const aspect = tl.aspect.w / tl.aspect.h;
  if (aspect >= 1) {
    return { w: PREVIEW_MAX_SIDE, h: Math.max(1, Math.round(PREVIEW_MAX_SIDE / aspect)) };
  }
  return { w: Math.max(1, Math.round(PREVIEW_MAX_SIDE * aspect)), h: PREVIEW_MAX_SIDE };
}

/** Module-level still-image cache keyed by clip id, shared across renders
 *  (a clip keeps its id across timeline edits, so re-decoding is avoided). */
const stillCache = new Map<string, HTMLImageElement>();

function loadStill(clipId: string, src: string): void {
  const existing = stillCache.get(clipId);
  if (existing && existing.src === src) return;
  const img = new Image();
  img.src = src;
  img.decode?.().catch(() => {});
  stillCache.set(clipId, img);
}

const hiddenVideoStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 1,
  height: 1,
  opacity: 0.0001,
  pointerEvents: 'none',
};

/**
 * Remotion composition: mounts each video clip inside a frame-ranged
 * <Sequence> so Remotion's Player keeps the underlying <video> elements
 * frame-synced and drift-corrected. Those elements stay (near-)invisible —
 * every rendered frame, an offscreen canvas is recomposited from the current
 * clip/transition state via drawTimelineFrame and handed to the halftone
 * sketch. The sketch's own canvas is the actual visible output.
 */
export default function TimelineComposition({ timeline, onFrame }: TimelineCompositionProps) {
  const frame = useCurrentFrame();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement | null>());

  const size = useMemo(
    () => previewCanvasSize(timeline),
    [timeline.aspect.w, timeline.aspect.h],
  );

  // Preload/refresh still images for the current clip set.
  useMemo(() => {
    for (const c of timeline.clips) {
      if (c.type === 'still') loadStill(c.id, c.src);
    }
  }, [timeline.clips]);

  // Recomposite + push to the halftone sketch on every rendered frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== size.w) canvas.width = size.w;
    if (canvas.height !== size.h) canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = frame / TIMELINE_FPS;
    const sources: CompositorSources = {
      getVideoEl: id => videoRefs.current.get(id) ?? null,
      getImage: id => stillCache.get(id) ?? null,
    };
    drawTimelineFrame(ctx, timeline, t, sources);
    onFrame(canvas, canvas.width, canvas.height);
  });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {timeline.clips
        .filter(c => c.type === 'video')
        .map(clip => {
          const from = Math.round(clip.startTime * TIMELINE_FPS);
          const durationInFrames = Math.max(
            1,
            Math.round((clipEnd(clip) - clip.startTime) * TIMELINE_FPS),
          );
          return (
            <Sequence key={clip.id} from={from} durationInFrames={durationInFrames} layout="none">
              <Html5Video
                ref={el => {
                  videoRefs.current.set(clip.id, el);
                }}
                src={clip.src}
                trimBefore={Math.round(clip.inPoint * TIMELINE_FPS)}
                muted
                style={hiddenVideoStyle}
              />
            </Sequence>
          );
        })}
      <AbsoluteFill style={{ opacity: 0.0001, pointerEvents: 'none' }}>
        <canvas ref={canvasRef} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
