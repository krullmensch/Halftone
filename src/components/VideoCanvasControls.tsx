import type { VideoClip, ClipTransform, TimelineAspect } from '../types';

interface Props {
  selectedClip: VideoClip | null;
  onSetTransform: (id: string, transform: ClipTransform) => void;
  onCenter: (id: string, axis: 'x' | 'y' | 'both') => void;
  aspect: TimelineAspect;
  resolution: number;
  onSetAspect: (a: TimelineAspect) => void;
  onSetResolution: (r: number) => void;
}

const ASPECT_PRESETS: { label: string; a: TimelineAspect }[] = [
  { label: '16:9', a: { w: 16, h: 9 } },
  { label: '9:16', a: { w: 9, h: 16 } },
  { label: '1:1', a: { w: 1, h: 1 } },
  { label: '4:5', a: { w: 4, h: 5 } },
  { label: '21:9', a: { w: 21, h: 9 } },
];

const RES_PRESETS = [720, 1080, 1440, 2160];

function ratio(a: TimelineAspect): number {
  return a.w / a.h;
}

export default function VideoCanvasControls({
  selectedClip,
  onSetTransform,
  onCenter,
  aspect,
  resolution,
  onSetAspect,
  onSetResolution,
}: Props) {
  const t = selectedClip?.transform;
  return (
    <>
      <div className="section-title">Format</div>

      <div className="control-group">
        <span className="control-label">Seitenverhältnis</span>
        <div className="toggle-group">
          {ASPECT_PRESETS.map(({ label, a }) => (
            <button
              key={label}
              type="button"
              className={`toggle-btn${Math.abs(ratio(a) - ratio(aspect)) < 1e-3 ? ' active' : ''}`}
              onClick={() => onSetAspect(a)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <span className="control-label">Auflösung</span>
        <div className="toggle-group">
          {RES_PRESETS.map(r => (
            <button
              key={r}
              type="button"
              className={`toggle-btn${resolution === r ? ' active' : ''}`}
              onClick={() => onSetResolution(r)}
            >
              {r}p
            </button>
          ))}
        </div>
      </div>

      <div className="section-title">Position</div>

      {selectedClip && t ? (
        <>
          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">X</span>
              <span className="control-value">{Math.round(t.x * 100)}%</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={1}
              step={0.01}
              value={t.x}
              onChange={e => onSetTransform(selectedClip.id, { ...t, x: Number(e.target.value) })}
            />
          </div>

          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">Y</span>
              <span className="control-value">{Math.round(t.y * 100)}%</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={1}
              step={0.01}
              value={t.y}
              onChange={e => onSetTransform(selectedClip.id, { ...t, y: Number(e.target.value) })}
            />
          </div>

          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">Größe</span>
              <span className="control-value">{t.scale.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0.2}
              max={3}
              step={0.01}
              value={t.scale}
              onChange={e => onSetTransform(selectedClip.id, { ...t, scale: Number(e.target.value) })}
            />
          </div>

          <div className="control-group">
            <div className="toggle-group">
              <button type="button" className="toggle-btn" onClick={() => onCenter(selectedClip.id, 'x')}>
                Zentr. H
              </button>
              <button type="button" className="toggle-btn" onClick={() => onCenter(selectedClip.id, 'y')}>
                Zentr. V
              </button>
              <button type="button" className="toggle-btn" onClick={() => onCenter(selectedClip.id, 'both')}>
                Beide
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="control-hint">Clip auswählen, um ihn zu positionieren.</p>
      )}
    </>
  );
}
