import { useEffect, useRef, useState } from 'react';

interface Props {
  imageUrl: string;
  /** Canvas width/height ratio */
  aspect: number;
  offsetX: number;
  offsetY: number;
  onChange: (x: number, y: number) => void;
  onClose: () => void;
}

export default function CropModal({ imageUrl, aspect, offsetX, offsetY, onChange, onClose }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalW, setNaturalW] = useState(0);
  const [dispW, setDispW] = useState(0);
  const [dispH, setDispH] = useState(0);

  // Measure displayed image size after layout
  function measureImage() {
    const img = imgRef.current;
    if (!img) return;
    setNaturalW(img.naturalWidth);
    setDispW(img.clientWidth);
    setDispH(img.clientHeight);
  }

  useEffect(() => {
    const observer = new ResizeObserver(measureImage);
    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compute window geometry
  const winW = dispW > 0 && dispH > 0 ? Math.min(dispW, dispH * aspect) : 0;
  const winH = winW > 0 ? winW / aspect : 0;
  const maxDx = dispW - winW;
  const maxDy = dispH - winH;
  const winX = maxDx * offsetX;
  const winY = maxDy * offsetY;

  // Drag state
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, ox: offsetX, oy: offsetY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    const newX = maxDx > 0 ? Math.max(0, Math.min(1, dragStart.current.ox + dx / maxDx)) : 0.5;
    const newY = maxDy > 0 ? Math.max(0, Math.min(1, dragStart.current.oy + dy / maxDy)) : 0.5;
    onChange(newX, newY);
  }

  function onPointerUp() {
    dragStart.current = null;
  }

  return (
    <div
      className="crop-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="crop-panel" onClick={e => e.stopPropagation()}>
        <h3 className="crop-title">Bild positionieren</h3>

        <div
          ref={containerRef}
          className="crop-image-container"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: maxDx > 0 || maxDy > 0 ? 'grab' : 'default' }}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Source"
            className="crop-source-img"
            onLoad={measureImage}
            draggable={false}
          />
          {naturalW > 0 && winW > 0 && (
            <div
              className="crop-window"
              style={{
                left: winX,
                top: winY,
                width: winW,
                height: winH,
              }}
            />
          )}
        </div>

        <button className="export-btn crop-done-btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </div>
  );
}
