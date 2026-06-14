import { useEffect, useRef, useState, useCallback } from 'react';
import { TextBox } from '../types';

interface Props {
  /** The sketch container element the canvas lives in (positioning reference) */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The canvas-wrapper element (offset parent for the overlay) */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  textBox: TextBox;
  onChange: (box: TextBox) => void;
}

type Rect = { left: number; top: number; width: number; height: number };

/** Corner handles for resizing. */
const HANDLES = ['nw', 'ne', 'se', 'sw'] as const;
type Handle = (typeof HANDLES)[number];

type Drag =
  | { kind: 'move'; startX: number; startY: number; box: TextBox }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; box: TextBox };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export default function TextBoxEditor({ containerRef, wrapperRef, textBox, onChange }: Props) {
  const [rect, setRect] = useState<Rect | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // Track the on-screen rect of the canvas container relative to the wrapper.
  useEffect(() => {
    const container = containerRef.current;
    const wrapper = wrapperRef.current;
    if (!container || !wrapper) return;

    const measure = () => {
      const c = container.getBoundingClientRect();
      const w = wrapper.getBoundingClientRect();
      setRect({ left: c.left - w.left, top: c.top - w.top, width: c.width, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(wrapper);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, wrapperRef]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !rect) return;
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      const b = drag.box;

      if (drag.kind === 'move') {
        const x = clamp01(b.x + dx > 1 - b.w ? 1 - b.w : Math.max(0, b.x + dx));
        const y = clamp01(b.y + dy > 1 - b.h ? 1 - b.h : Math.max(0, b.y + dy));
        onChange({ ...b, x, y });
        return;
      }

      // resize — keep the opposite edge fixed, min size 0.05
      let { x, y, w, h } = b;
      const MIN = 0.05;
      const right = b.x + b.w;
      const bottom = b.y + b.h;
      if (drag.handle === 'nw' || drag.handle === 'sw') {
        x = clamp01(Math.min(b.x + dx, right - MIN));
        w = right - x;
      }
      if (drag.handle === 'ne' || drag.handle === 'se') {
        w = Math.max(MIN, Math.min(b.w + dx, 1 - b.x));
      }
      if (drag.handle === 'nw' || drag.handle === 'ne') {
        y = clamp01(Math.min(b.y + dy, bottom - MIN));
        h = bottom - y;
      }
      if (drag.handle === 'sw' || drag.handle === 'se') {
        h = Math.max(MIN, Math.min(b.h + dy, 1 - b.y));
      }
      onChange({ x, y, w, h });
    },
    [rect, onChange],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { kind: 'move', startX: e.clientX, startY: e.clientY, box: textBox };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  const startResize = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: 'resize', handle, startX: e.clientX, startY: e.clientY, box: textBox };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  if (!rect) return null;

  return (
    <div
      className="textbox-overlay"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div
        className="textbox-frame"
        style={{
          left: `${textBox.x * 100}%`,
          top: `${textBox.y * 100}%`,
          width: `${textBox.w * 100}%`,
          height: `${textBox.h * 100}%`,
        }}
        onPointerDown={startMove}
      >
        {HANDLES.map(h => (
          <span
            key={h}
            className={`textbox-handle textbox-handle--${h}`}
            onPointerDown={startResize(h)}
          />
        ))}
      </div>
    </div>
  );
}
