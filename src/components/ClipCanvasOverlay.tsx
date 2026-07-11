import { useEffect, useRef, useState } from 'react';
import type { VideoClip, ClipTransform, TimelineAspect } from '../types';
import { clipDestRect } from '../video/timeline';

interface Props {
  selectedClip: VideoClip | null;
  aspect: TimelineAspect;
  onSetTransform: (id: string, transform: ClipTransform) => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

/**
 * Interactive overlay for spatially placing the selected clip inside the canvas
 * frame. Rendered as a fixed-position layer aligned to the on-screen p5 canvas
 * (found via `.canvas-wrapper canvas`). Drag the box to move (transform.x/y),
 * drag a corner to resize (transform.scale). HalftoneCanvas itself is not
 * touched — we only measure its element.
 */
export default function ClipCanvasOverlay({ selectedClip, onSetTransform }: Props) {
  const [canvasBox, setCanvasBox] = useState<Box | null>(null);
  const drag = useRef<
    | {
        kind: 'move' | 'resize';
        startX: number;
        startY: number;
        transform: ClipTransform;
        // contain-fit size (display px) captured at drag start
        fitW: number;
        fitH: number;
      }
    | null
  >(null);

  // Track the on-screen canvas rectangle (position + size) live.
  useEffect(() => {
    if (!selectedClip) return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector('.canvas-wrapper canvas') as HTMLCanvasElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setCanvasBox(prev => {
          if (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height) {
            return prev;
          }
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [selectedClip]);

  if (!selectedClip || !canvasBox) return null;

  const { width: bw, height: bh } = canvasBox;
  // Clip's destination rect in display pixels (clipDestRect scales linearly).
  const dest = clipDestRect(selectedClip, bw, bh);

  function onPointerDown(e: React.PointerEvent, kind: 'move' | 'resize') {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = selectedClip!.transform;
    drag.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      transform: { ...t },
      fitW: dest.destWidth / t.scale,
      fitH: dest.destHeight / t.scale,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !selectedClip) return;
    if (d.kind === 'move') {
      const dxN = (e.clientX - d.startX) / bw;
      const dyN = (e.clientY - d.startY) / bh;
      onSetTransform(selectedClip.id, {
        ...d.transform,
        x: Math.max(0, Math.min(1, d.transform.x + dxN)),
        y: Math.max(0, Math.min(1, d.transform.y + dyN)),
      });
    } else {
      // Resize: keep center fixed, scale so the dragged corner follows the pointer.
      const centerX = canvasBox!.left + d.transform.x * bw;
      const centerY = canvasBox!.top + d.transform.y * bh;
      const ratioX = Math.abs(e.clientX - centerX) / (d.fitW / 2);
      const ratioY = Math.abs(e.clientY - centerY) / (d.fitH / 2);
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.max(ratioX, ratioY)));
      onSetTransform(selectedClip.id, { ...d.transform, scale });
    }
  }

  function onPointerUp() {
    drag.current = null;
  }

  const boxStyle: React.CSSProperties = {
    left: canvasBox.left + dest.destX,
    top: canvasBox.top + dest.destY,
    width: dest.destWidth,
    height: dest.destHeight,
  };

  return (
    <div
      className="clip-overlay-box"
      style={boxStyle}
      onPointerDown={e => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
        <div
          key={corner}
          className={`clip-overlay-handle clip-overlay-handle--${corner}`}
          onPointerDown={e => onPointerDown(e, 'resize')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}
    </div>
  );
}
