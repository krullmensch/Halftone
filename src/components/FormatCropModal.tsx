import { useEffect, useRef, useState } from 'react';
import type { CropRect } from '../types';

interface Props {
  imageUrl: string;
  canvasWidth: number;   // current canvas px (may be defaults if never set)
  canvasHeight: number;
  cropRect: CropRect | null;
  onApply: (canvasWidth: number, canvasHeight: number, cropRect: CropRect | null) => void;
  onClose: () => void;
}

type FormatCategory = 'auto' | 'din' | 'ratio' | 'free';

// DIN sizes in cm
type DinSize = 'A6' | 'A5' | 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
const DIN_SIZES: Record<DinSize, { short: number; long: number }> = {
  A6: { short: 10.5, long: 14.8 },
  A5: { short: 14.8, long: 21.0 },
  A4: { short: 21.0, long: 29.7 },
  A3: { short: 29.7, long: 42.0 },
  A2: { short: 42.0, long: 59.4 },
  A1: { short: 59.4, long: 84.1 },
  A0: { short: 84.1, long: 118.9 },
};

const RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '3:2', '2:3', '21:9', '9:21'];

export default function FormatCropModal({
  imageUrl,
  canvasWidth,
  canvasHeight,
  cropRect,
  onApply,
  onClose,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);

  // Natural image dimensions
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  // Displayed image dimensions (for screen rendering)
  const [dispW, setDispW] = useState(0);
  const [dispH, setDispH] = useState(0);

  // 1) Format-Kategorie
  const [category, setCategory] = useState<FormatCategory>(() => {
    return cropRect ? 'free' : 'auto';
  });

  // Crop State (normalized 0..1)
  const [crop, setCrop] = useState<CropRect>(() => {
    return cropRect || { x: 0, y: 0, w: 1, h: 1 };
  });

  // 2a) DIN State
  const [dinSize, setDinSize] = useState<DinSize>('A4');
  const [dinOrientation, setDinOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [dinDpi, setDinDpi] = useState<number>(300);

  // 2b) Ratio State
  const [ratioSelected, setRatioSelected] = useState<string>('16:9');
  const [ratioLongSidePx, setRatioLongSidePx] = useState<number>(() => {
    return Math.max(canvasWidth, canvasHeight) > 0 ? Math.max(canvasWidth, canvasHeight) : 2400;
  });

  // 2c) Free State
  const [freeUnit, setFreeUnit] = useState<'px' | 'cm'>('px');
  const [freeWidthPx, setFreeWidthPx] = useState<number>(() => {
    return canvasWidth > 0 ? canvasWidth : 2400;
  });
  const [freeHeightPx, setFreeHeightPx] = useState<number>(() => {
    return canvasHeight > 0 ? canvasHeight : 1350;
  });
  const [freeWidthCm, setFreeWidthCm] = useState<number>(29.7);
  const [freeHeightCm, setFreeHeightCm] = useState<number>(21.0);
  const [freeDpi, setFreeDpi] = useState<number>(300);

  // 2d) Auto State
  const [autoLongSidePx, setAutoLongSidePx] = useState<number>(() => {
    return Math.max(canvasWidth, canvasHeight) > 0 ? Math.max(canvasWidth, canvasHeight) : 2400;
  });

  // Measure displayed image sizes
  function measureImage() {
    const img = imgRef.current;
    if (!img) return;
    setNaturalW(img.naturalWidth);
    setNaturalH(img.naturalHeight);
    setDispW(img.clientWidth);
    setDispH(img.clientHeight);
  }

  // Observe resizing of the image element
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

  // Compute centered CropRect for a specific aspect ratio
  function getCenteredCropForAspect(targetAspect: number, imgW: number, imgH: number): CropRect {
    const imgAspect = imgW / imgH;
    let w = 1;
    let h = 1;
    if (imgAspect > targetAspect) {
      // Wider image than target aspect
      w = targetAspect / imgAspect;
    } else {
      // Taller image than target aspect
      h = imgAspect / targetAspect;
    }
    const x = (1 - w) / 2;
    const y = (1 - h) / 2;
    return { x, y, w, h };
  }

  // Compute current target dimensions (canvas pixel size)
  let calcWidth = 2400;
  let calcHeight = 1350;

  if (category === 'auto') {
    const cropAspect = (crop.w * naturalW) / (crop.h * naturalH || 1);
    if (cropAspect >= 1) {
      calcWidth = autoLongSidePx;
      calcHeight = Math.round(autoLongSidePx / cropAspect);
    } else {
      calcHeight = autoLongSidePx;
      calcWidth = Math.round(autoLongSidePx * cropAspect);
    }
  } else if (category === 'din') {
    const size = DIN_SIZES[dinSize];
    const shortPx = Math.round((size.short / 2.54) * dinDpi);
    const longPx = Math.round((size.long / 2.54) * dinDpi);
    if (dinOrientation === 'portrait') {
      calcWidth = shortPx;
      calcHeight = longPx;
    } else {
      calcWidth = longPx;
      calcHeight = shortPx;
    }
  } else if (category === 'ratio') {
    const [rw, rh] = ratioSelected.split(':').map(Number);
    const ratio = rw / rh;
    if (ratio >= 1) {
      calcWidth = ratioLongSidePx;
      calcHeight = Math.round(ratioLongSidePx / ratio);
    } else {
      calcHeight = ratioLongSidePx;
      calcWidth = Math.round(ratioLongSidePx * ratio);
    }
  } else if (category === 'free') {
    if (freeUnit === 'px') {
      calcWidth = freeWidthPx;
      calcHeight = freeHeightPx;
    } else {
      calcWidth = Math.round((freeWidthCm / 2.54) * freeDpi);
      calcHeight = Math.round((freeHeightCm / 2.54) * freeDpi);
    }
  }

  // Refits the crop rectangle to match the computed target aspect ratio
  function refitCropForCategory(
    cat: FormatCategory,
    override?: {
      dinSize?: DinSize;
      dinOrientation?: 'portrait' | 'landscape';
      dinDpi?: number;
      ratioSelected?: string;
      ratioLongSidePx?: number;
      freeUnit?: 'px' | 'cm';
      freeWidthPx?: number;
      freeHeightPx?: number;
      freeWidthCm?: number;
      freeHeightCm?: number;
      freeDpi?: number;
    }
  ) {
    if (naturalW === 0 || naturalH === 0) return;
    if (cat === 'auto') return;

    const dSize = override?.dinSize ?? dinSize;
    const dOrient = override?.dinOrientation ?? dinOrientation;
    const dDpi = override?.dinDpi ?? dinDpi;
    const rSelected = override?.ratioSelected ?? ratioSelected;
    const rLongPx = override?.ratioLongSidePx ?? ratioLongSidePx;
    const fUnit = override?.freeUnit ?? freeUnit;
    const fWpx = override?.freeWidthPx ?? freeWidthPx;
    const fHpx = override?.freeHeightPx ?? freeHeightPx;
    const fWcm = override?.freeWidthCm ?? freeWidthCm;
    const fHcm = override?.freeHeightCm ?? freeHeightCm;
    const fDpi = override?.freeDpi ?? freeDpi;

    let targetW = 2400;
    let targetH = 1350;

    if (cat === 'din') {
      const size = DIN_SIZES[dSize];
      const shortPx = Math.round((size.short / 2.54) * dDpi);
      const longPx = Math.round((size.long / 2.54) * dDpi);
      if (dOrient === 'portrait') {
        targetW = shortPx;
        targetH = longPx;
      } else {
        targetW = longPx;
        targetH = shortPx;
      }
    } else if (cat === 'ratio') {
      const [rw, rh] = rSelected.split(':').map(Number);
      const ratio = rw / rh;
      if (ratio >= 1) {
        targetW = rLongPx;
        targetH = Math.round(rLongPx / ratio);
      } else {
        targetH = rLongPx;
        targetW = Math.round(rLongPx * ratio);
      }
    } else if (cat === 'free') {
      if (fUnit === 'px') {
        targetW = fWpx;
        targetH = fHpx;
      } else {
        targetW = Math.round((fWcm / 2.54) * fDpi);
        targetH = Math.round((fHcm / 2.54) * fDpi);
      }
    }

    const targetAspect = targetW / targetH;
    setCrop(getCenteredCropForAspect(targetAspect, naturalW, naturalH));
  }

  // Handle format category changes
  function handleCategoryChange(cat: FormatCategory) {
    setCategory(cat);
    if (cat !== 'auto') {
      refitCropForCategory(cat);
    }
  }

  // Drag and resize handlers
  type DragAction = 'drag' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

  interface DragState {
    action: DragAction;
    startX: number;
    startY: number;
    startCrop: CropRect;
  }

  const dragRef = useRef<DragState | null>(null);

  function handlePointerDown(action: DragAction, e: React.PointerEvent) {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      action,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !imgRef.current) return;
    const { action, startX, startY, startCrop } = dragRef.current;
    const rect = imgRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const ndx = dx / rect.width;
    const ndy = dy / rect.height;

    const newCrop = { ...startCrop };
    const targetAspect = calcWidth / calcHeight;
    const normAspect = targetAspect * (naturalH / (naturalW || 1));

    const isAspectLocked = category !== 'auto';

    if (action === 'drag') {
      newCrop.x = startCrop.x + ndx;
      newCrop.y = startCrop.y + ndy;

      // Clamp to image bounds
      if (newCrop.x < 0) newCrop.x = 0;
      if (newCrop.y < 0) newCrop.y = 0;
      if (newCrop.x + newCrop.w > 1) newCrop.x = 1 - newCrop.w;
      if (newCrop.y + newCrop.h > 1) newCrop.y = 1 - newCrop.h;
    } else {
      if (!isAspectLocked) {
        // Unconstrained resizing
        if (action.includes('w')) {
          const right = startCrop.x + startCrop.w;
          newCrop.x = Math.max(0, Math.min(right - 0.02, startCrop.x + ndx));
          newCrop.w = right - newCrop.x;
        }
        if (action.includes('e')) {
          newCrop.w = Math.max(0.02, Math.min(1 - startCrop.x, startCrop.w + ndx));
        }
        if (action.includes('n')) {
          const bottom = startCrop.y + startCrop.h;
          newCrop.y = Math.max(0, Math.min(bottom - 0.02, startCrop.y + ndy));
          newCrop.h = bottom - newCrop.y;
        }
        if (action.includes('s')) {
          newCrop.h = Math.max(0.02, Math.min(1 - startCrop.y, startCrop.h + ndy));
        }
      } else {
        // Aspect-locked resizing
        if (action === 'se') {
          const maxW = 1 - startCrop.x;
          const maxH = 1 - startCrop.y;
          let w = startCrop.w + ndx;
          let h = w / normAspect;

          if (w < 0.02) { w = 0.02; h = w / normAspect; }
          if (h < 0.02) { h = 0.02; w = h * normAspect; }
          if (w > maxW) { w = maxW; h = w / normAspect; }
          if (h > maxH) { h = maxH; w = h * normAspect; }

          newCrop.w = w;
          newCrop.h = h;
        } else if (action === 'nw') {
          const right = startCrop.x + startCrop.w;
          const bottom = startCrop.y + startCrop.h;
          let w = startCrop.w - ndx;
          let h = w / normAspect;

          if (w < 0.02) { w = 0.02; h = w / normAspect; }
          if (h < 0.02) { h = 0.02; w = h * normAspect; }
          if (right - w < 0) { w = right; h = w / normAspect; }
          if (bottom - h < 0) { h = bottom; w = h * normAspect; }

          newCrop.x = right - w;
          newCrop.y = bottom - h;
          newCrop.w = w;
          newCrop.h = h;
        } else if (action === 'ne') {
          const maxW = 1 - startCrop.x;
          const bottom = startCrop.y + startCrop.h;
          let w = startCrop.w + ndx;
          let h = w / normAspect;

          if (w < 0.02) { w = 0.02; h = w / normAspect; }
          if (h < 0.02) { h = 0.02; w = h * normAspect; }
          if (w > maxW) { w = maxW; h = w / normAspect; }
          if (bottom - h < 0) { h = bottom; w = h * normAspect; }

          newCrop.y = bottom - h;
          newCrop.w = w;
          newCrop.h = h;
        } else if (action === 'sw') {
          const right = startCrop.x + startCrop.w;
          const maxH = 1 - startCrop.y;
          let w = startCrop.w - ndx;
          let h = w / normAspect;

          if (w < 0.02) { w = 0.02; h = w / normAspect; }
          if (h < 0.02) { h = 0.02; w = h * normAspect; }
          if (right - w < 0) { w = right; h = w / normAspect; }
          if (h > maxH) { h = maxH; w = h * normAspect; }

          newCrop.x = right - w;
          newCrop.w = w;
          newCrop.h = h;
        } else {
          // Edges in aspect-locked mode (scale around center of opposite axis)
          if (action === 'e' || action === 'w') {
            const isLeft = action === 'w';
            const anchorX = isLeft ? startCrop.x + startCrop.w : startCrop.x;
            const maxW = isLeft ? anchorX : 1 - anchorX;

            let w = startCrop.w + (isLeft ? -ndx : ndx);
            let h = w / normAspect;

            if (w < 0.02) { w = 0.02; h = w / normAspect; }
            if (h < 0.02) { h = 0.02; w = h * normAspect; }
            if (w > maxW) { w = maxW; h = w / normAspect; }

            const midY = startCrop.y + startCrop.h / 2;
            let y = midY - h / 2;
            if (y < 0) {
              y = 0;
              if (y + h > 1) {
                h = 1;
                w = h * normAspect;
                if (w > maxW) { w = maxW; h = w / normAspect; }
                y = 0.5 - h / 2;
              }
            } else if (y + h > 1) {
              y = 1 - h;
            }

            newCrop.w = w;
            newCrop.h = h;
            newCrop.x = isLeft ? anchorX - w : anchorX;
            newCrop.y = y;
          } else if (action === 'n' || action === 's') {
            const isTop = action === 'n';
            const anchorY = isTop ? startCrop.y + startCrop.h : startCrop.y;
            const maxH = isTop ? anchorY : 1 - anchorY;

            let h = startCrop.h + (isTop ? -ndy : ndy);
            let w = h * normAspect;

            if (h < 0.02) { h = 0.02; w = h * normAspect; }
            if (w < 0.02) { w = 0.02; h = w / normAspect; }
            if (h > maxH) { h = maxH; w = h * normAspect; }

            const midX = startCrop.x + startCrop.w / 2;
            let x = midX - w / 2;
            if (x < 0) {
              x = 0;
              if (x + w > 1) {
                w = 1;
                h = w / normAspect;
                if (h > maxH) { h = maxH; w = h * normAspect; }
                x = 0.5 - w / 2;
              }
            } else if (x + w > 1) {
              x = 1 - w;
            }

            newCrop.w = w;
            newCrop.h = h;
            newCrop.y = isTop ? anchorY - h : anchorY;
            newCrop.x = x;
          }
        }
      }
    }

    // Double clamp for safety
    newCrop.w = Math.max(0.02, Math.min(1, newCrop.w));
    newCrop.h = Math.max(0.02, Math.min(1, newCrop.h));
    newCrop.x = Math.max(0, Math.min(1 - newCrop.w, newCrop.x));
    newCrop.y = Math.max(0, Math.min(1 - newCrop.h, newCrop.y));

    setCrop(newCrop);
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragRef.current) {
      const el = e.currentTarget as HTMLElement;
      el.releasePointerCapture(e.pointerId);
      dragRef.current = null;
    }
  }

  // Handle Apply click
  function handleApply() {
    onApply(calcWidth, calcHeight, crop);
    onClose();
  }

  return (
    <div
      className="crop-overlay"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fmt-panel" onClick={e => e.stopPropagation()}>
        <h3 className="crop-title">Format &amp; Zuschnitt</h3>

        <div className="fmt-content-split">
          {/* Main Visual Editor Workspace */}
          <div className="fmt-editor-column">
            <div
              className="fmt-crop-area"
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Zuschnitt Vorschau"
                className="fmt-crop-img"
                onLoad={measureImage}
                draggable={false}
              />

              {naturalW > 0 && dispW > 0 && dispH > 0 && (
                <>
                  {/* Dimming Mask outside crop area */}
                  <div
                    className="fmt-crop-dim"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: '100%',
                      height: `${crop.y * 100}%`,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    className="fmt-crop-dim"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: `${(crop.y + crop.h) * 100}%`,
                      width: '100%',
                      height: `${(1 - crop.y - crop.h) * 100}%`,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    className="fmt-crop-dim"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: `${crop.y * 100}%`,
                      width: `${crop.x * 100}%`,
                      height: `${crop.h * 100}%`,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    className="fmt-crop-dim"
                    style={{
                      position: 'absolute',
                      left: `${(crop.x + crop.w) * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${(1 - crop.x - crop.w) * 100}%`,
                      height: `${crop.h * 100}%`,
                      backgroundColor: 'rgba(0, 0, 0, 0.5)',
                      pointerEvents: 'none',
                    }}
                  />

                  {/* Resizable and draggable Crop Window */}
                  <div
                    className="fmt-crop-rect"
                    style={{
                      position: 'absolute',
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.w * 100}%`,
                      height: `${crop.h * 100}%`,
                      cursor: 'move',
                    }}
                    onPointerDown={e => handlePointerDown('drag', e)}
                  >
                    {/* Corner Handles */}
                    <div
                      className="fmt-crop-handle fmt-crop-handle--nw"
                      onPointerDown={e => handlePointerDown('nw', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--ne"
                      onPointerDown={e => handlePointerDown('ne', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--se"
                      onPointerDown={e => handlePointerDown('se', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--sw"
                      onPointerDown={e => handlePointerDown('sw', e)}
                    />

                    {/* Edge Handles */}
                    <div
                      className="fmt-crop-handle fmt-crop-handle--n"
                      onPointerDown={e => handlePointerDown('n', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--e"
                      onPointerDown={e => handlePointerDown('e', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--s"
                      onPointerDown={e => handlePointerDown('s', e)}
                    />
                    <div
                      className="fmt-crop-handle fmt-crop-handle--w"
                      onPointerDown={e => handlePointerDown('w', e)}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right sidebar with settings */}
          <div className="fmt-sidebar-column">
            {/* 1) Category row */}
            <div className="control-group">
              <label className="control-label">Kategorie</label>
              <div className="fmt-cat-group toggle-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px' }}>
                <button
                  type="button"
                  className={`toggle-btn ${category === 'auto' ? 'active' : ''}`}
                  onClick={() => handleCategoryChange('auto')}
                >
                  An Bild anpassen
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${category === 'din' ? 'active' : ''}`}
                  onClick={() => handleCategoryChange('din')}
                >
                  DIN (A-Serie)
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${category === 'ratio' ? 'active' : ''}`}
                  onClick={() => handleCategoryChange('ratio')}
                >
                  Seitenverhältnis
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${category === 'free' ? 'active' : ''}`}
                  onClick={() => handleCategoryChange('free')}
                >
                  Frei
                </button>
              </div>
            </div>

            {/* 2) Category-specific controls */}
            {category === 'din' && (
              <div className="fmt-category-controls">
                <div className="control-group">
                  <label className="control-label">Größe</label>
                  <select
                    value={dinSize}
                    onChange={e => {
                      const newSize = e.target.value as DinSize;
                      setDinSize(newSize);
                      refitCropForCategory('din', { dinSize: newSize });
                    }}
                    style={{ width: '100%', padding: '6px', borderRadius: '4px', backgroundColor: 'var(--bg-select)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                  >
                    {Object.keys(DIN_SIZES).map(size => (
                      <option key={size} value={size}>
                        {size} ({DIN_SIZES[size as DinSize].short} × {DIN_SIZES[size as DinSize].long} cm)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="control-group">
                  <label className="control-label">Ausrichtung</label>
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle-btn ${dinOrientation === 'portrait' ? 'active' : ''}`}
                      onClick={() => {
                        setDinOrientation('portrait');
                        refitCropForCategory('din', { dinOrientation: 'portrait' });
                      }}
                    >
                      Hoch
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${dinOrientation === 'landscape' ? 'active' : ''}`}
                      onClick={() => {
                        setDinOrientation('landscape');
                        refitCropForCategory('din', { dinOrientation: 'landscape' });
                      }}
                    >
                      Quer
                    </button>
                  </div>
                </div>

                <div className="control-group">
                  <label className="control-label">DPI</label>
                  <input
                    type="number"
                    className="fmt-num-input"
                    value={dinDpi}
                    onChange={e => {
                      const val = Math.max(1, Number(e.target.value));
                      setDinDpi(val);
                      refitCropForCategory('din', { dinDpi: val });
                    }}
                    min={1}
                  />
                </div>
              </div>
            )}

            {category === 'ratio' && (
              <div className="fmt-category-controls">
                <div className="control-group">
                  <label className="control-label">Verhältnis</label>
                  <div className="toggle-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                    {RATIOS.map(ratio => (
                      <button
                        key={ratio}
                        type="button"
                        className={`toggle-btn ${ratioSelected === ratio ? 'active' : ''}`}
                        onClick={() => {
                          setRatioSelected(ratio);
                          refitCropForCategory('ratio', { ratioSelected: ratio });
                        }}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="control-group">
                  <label className="control-label">Lange Seite (px)</label>
                  <input
                    type="number"
                    className="fmt-num-input"
                    value={ratioLongSidePx}
                    onChange={e => {
                      const val = Math.max(1, Number(e.target.value));
                      setRatioLongSidePx(val);
                      refitCropForCategory('ratio', { ratioLongSidePx: val });
                    }}
                    min={1}
                  />
                </div>
              </div>
            )}

            {category === 'free' && (
              <div className="fmt-category-controls">
                <div className="control-group">
                  <label className="control-label">Einheit</label>
                  <div className="toggle-group">
                    <button
                      type="button"
                      className={`toggle-btn ${freeUnit === 'px' ? 'active' : ''}`}
                      onClick={() => {
                        setFreeUnit('px');
                        refitCropForCategory('free', { freeUnit: 'px' });
                      }}
                    >
                      Pixel (px)
                    </button>
                    <button
                      type="button"
                      className={`toggle-btn ${freeUnit === 'cm' ? 'active' : ''}`}
                      onClick={() => {
                        setFreeUnit('cm');
                        refitCropForCategory('free', { freeUnit: 'cm' });
                      }}
                    >
                      Zentimeter (cm)
                    </button>
                  </div>
                </div>

                {freeUnit === 'px' ? (
                  <>
                    <div className="control-group">
                      <label className="control-label">Breite (px)</label>
                      <input
                        type="number"
                        className="fmt-num-input"
                        value={freeWidthPx}
                        onChange={e => {
                          const val = Math.max(1, Number(e.target.value));
                          setFreeWidthPx(val);
                          refitCropForCategory('free', { freeWidthPx: val });
                        }}
                        min={1}
                      />
                    </div>
                    <div className="control-group">
                      <label className="control-label">Höhe (px)</label>
                      <input
                        type="number"
                        className="fmt-num-input"
                        value={freeHeightPx}
                        onChange={e => {
                          const val = Math.max(1, Number(e.target.value));
                          setFreeHeightPx(val);
                          refitCropForCategory('free', { freeHeightPx: val });
                        }}
                        min={1}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="control-group">
                      <label className="control-label">Breite (cm)</label>
                      <input
                        type="number"
                        className="fmt-num-input"
                        value={freeWidthCm}
                        onChange={e => {
                          const val = Math.max(0.1, Number(e.target.value));
                          setFreeWidthCm(val);
                          refitCropForCategory('free', { freeWidthCm: val });
                        }}
                        min={0.1}
                        step={0.1}
                      />
                    </div>
                    <div className="control-group">
                      <label className="control-label">Höhe (cm)</label>
                      <input
                        type="number"
                        className="fmt-num-input"
                        value={freeHeightCm}
                        onChange={e => {
                          const val = Math.max(0.1, Number(e.target.value));
                          setFreeHeightCm(val);
                          refitCropForCategory('free', { freeHeightCm: val });
                        }}
                        min={0.1}
                        step={0.1}
                      />
                    </div>
                    <div className="control-group">
                      <label className="control-label">DPI</label>
                      <input
                        type="number"
                        className="fmt-num-input"
                        value={freeDpi}
                        onChange={e => {
                          const val = Math.max(1, Number(e.target.value));
                          setFreeDpi(val);
                          refitCropForCategory('free', { freeDpi: val });
                        }}
                        min={1}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {category === 'auto' && (
              <div className="fmt-category-controls">
                <div className="control-group">
                  <label className="control-label">Lange Seite (px)</label>
                  <input
                    type="number"
                    className="fmt-num-input"
                    value={autoLongSidePx}
                    onChange={e => {
                      setAutoLongSidePx(Math.max(1, Number(e.target.value)));
                    }}
                    min={1}
                  />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.4' }}>
                  Das Seitenverhältnis wird direkt durch das Ziehen des Auswahlrahmens über dem Bild bestimmt.
                </div>
              </div>
            )}

            {/* Canvas size readout */}
            <div className="fmt-size-readout-container" style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <span className="control-label">Resultierende Canvas-Größe:</span>
              <div className="fmt-size-readout" style={{ fontSize: '18px', fontWeight: 'bold', margin: '6px 0' }}>
                {calcWidth} × {calcHeight} px
              </div>
              {category === 'din' && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Entspricht {DIN_SIZES[dinSize].short} × {DIN_SIZES[dinSize].long} cm bei {dinDpi} DPI.
                </div>
              )}
              {category === 'free' && freeUnit === 'cm' && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Entspricht {freeWidthCm} × {freeHeightCm} cm bei {freeDpi} DPI.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="export-row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
          <button className="export-btn vex-cancel-btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="export-btn" onClick={handleApply}>
            Anwenden
          </button>
        </div>
      </div>
    </div>
  );
}