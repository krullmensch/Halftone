import { useRef, useState } from 'react';
import {
  HalftoneParams, GridType, ExportFormat, FontInfo, TextAlign,
  VideoClip, ClipTransform, TimelineAspect,
} from '../types';
import ColorField from './ColorField';
import VideoCanvasControls from './VideoCanvasControls';

interface Props {
  params: HalftoneParams;
  onChange: (params: HalftoneParams) => void;
  onExport: (format: ExportFormat) => void;
  onOpenCrop: () => void;
  onOpenVideoExport: () => void;
  hasVideoClips: boolean;
  hasImage: boolean;
  maskLoading: boolean;
  maskProgress: number | null;
  fontInfo: FontInfo | null;
  loadFont: (file: File) => void;
  selectedClip: VideoClip | null;
  onSetClipTransform: (id: string, transform: ClipTransform) => void;
  onCenterClip: (id: string, axis: 'x' | 'y' | 'both') => void;
  timelineAspect: TimelineAspect;
  timelineResolution: number;
  onSetTimelineAspect: (a: TimelineAspect) => void;
  onSetTimelineResolution: (r: number) => void;
}

export default function ControlSidebar({
  params, onChange, onExport, onOpenCrop, onOpenVideoExport, hasVideoClips,
  hasImage, maskLoading, maskProgress, fontInfo, loadFont,
  selectedClip, onSetClipTransform, onCenterClip,
  timelineAspect, timelineResolution, onSetTimelineAspect, onSetTimelineResolution,
}: Props) {
  const fontInputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof HalftoneParams>(key: K, value: HalftoneParams[K]) {
    onChange({ ...params, [key]: value });
  }

  const isText = params.mode === 'text';
  const isImage = params.mode === 'image';
  const isVideo = params.mode === 'video';

  return (
    <div className="sidebar-inner">
      <h2 className="sidebar-title">Halftone Ink Bleed</h2>

      <div className="tab-group">
        <button
          className={`tab-btn${isImage ? ' active' : ''}`}
          onClick={() => set('mode', 'image')}
        >
          Bild
        </button>
        <button
          className={`tab-btn${isText ? ' active' : ''}`}
          onClick={() => set('mode', 'text')}
        >
          Text
        </button>
        <button
          className={`tab-btn${isVideo ? ' active' : ''}`}
          onClick={() => set('mode', 'video')}
        >
          Video<span className="tab-beta">Beta</span>
        </button>
      </div>

      {isImage && (
        <div className="control-group">
          <label className="control-label">Format &amp; Zuschnitt</label>
          <button className="position-btn" onClick={onOpenCrop} disabled={!hasImage}>
            {params.cropRect ? 'Format bearbeiten…' : 'Format & Zuschnitt festlegen…'}
          </button>
        </div>
      )}

      {isText && (
        <>
          <SliderControl
            label="Canvas Width"
            value={params.canvasWidth}
            min={100}
            max={6000}
            step={10}
            onChange={v => set('canvasWidth', v)}
            unit="px"
          />
          <SliderControl
            label="Canvas Height"
            value={params.canvasHeight}
            min={100}
            max={6000}
            step={10}
            onChange={v => set('canvasHeight', v)}
            unit="px"
          />

          <div className="control-group">
            <label className="control-label">Font</label>
            <button className="position-btn" onClick={() => fontInputRef.current?.click()}>
              {fontInfo ? `${fontInfo.name} — ersetzen…` : 'Font hochladen…'}
            </button>
            <input
              ref={fontInputRef}
              type="file"
              accept=".woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) loadFont(f);
                e.target.value = '';
              }}
            />
          </div>

          <div className="control-group">
            <label className="control-label">Text</label>
            <textarea
              className="text-input"
              value={params.text}
              rows={3}
              onChange={e => set('text', e.target.value)}
            />
          </div>

          <SliderControl
            label="Font Size"
            value={params.fontSize}
            min={8}
            max={1000}
            step={1}
            onChange={v => set('fontSize', v)}
            unit="px"
          />
          <SliderControl
            label="Line Height"
            value={params.lineHeight}
            min={0.6}
            max={3}
            step={0.05}
            onChange={v => set('lineHeight', v)}
            decimals={2}
          />
          <SliderControl
            label="Letter Spacing"
            value={params.letterSpacing}
            min={-20}
            max={100}
            step={1}
            onChange={v => set('letterSpacing', v)}
            unit="px"
          />

          <div className="control-group">
            <label className="control-label">Align</label>
            <div className="toggle-group">
              {(['left', 'center', 'right'] as TextAlign[]).map(a => (
                <button
                  key={a}
                  className={`toggle-btn${params.textAlign === a ? ' active' : ''}`}
                  onClick={() => set('textAlign', a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {fontInfo && fontInfo.axes.length > 0 && (
            <>
              <div className="control-section-label">Variable Axes</div>
              {fontInfo.axes.map(axis => (
                <SliderControl
                  key={axis.tag}
                  label={`${axis.name} (${axis.tag})`}
                  value={params.fontAxes[axis.tag] ?? axis.default}
                  min={axis.min}
                  max={axis.max}
                  step={(axis.max - axis.min) / 200 || 1}
                  onChange={v => set('fontAxes', { ...params.fontAxes, [axis.tag]: v })}
                  decimals={1}
                />
              ))}
            </>
          )}
        </>
      )}

      <div className="control-group">
        <div className="checkbox-row">
          <input
            type="checkbox"
            id="preview-mode"
            checked={params.preview}
            onChange={e => set('preview', e.target.checked)}
            className="checkbox-input"
          />
          <label htmlFor="preview-mode" className="control-label checkbox-label">
            Preview (fast, reduced resolution)
          </label>
        </div>
      </div>

      <SliderControl
        label="Step Size"
        value={params.stepSize}
        min={15}
        max={30}
        step={1}
        onChange={v => set('stepSize', v)}
        unit="px"
      />

      <div className="control-group">
        <label className="control-label">Grid Type</label>
        <div className="toggle-group">
          {(['regular', 'benday'] as GridType[]).map(type => (
            <button
              key={type}
              className={`toggle-btn${params.gridType === type ? ' active' : ''}`}
              onClick={() => set('gridType', type)}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <SliderControl
        label="Grid Angle"
        value={params.gridAngle}
        min={-45}
        max={45}
        step={1}
        onChange={v => set('gridAngle', v)}
        unit="°"
      />

      {/* Pre-Blur and Noise are image-only filters — hidden in text mode */}
      {!isText && (
        <>
          <SliderControl
            label="Pre-Blur"
            value={params.preBlur}
            min={0}
            max={20}
            step={0.5}
            onChange={v => set('preBlur', v)}
            unit="px"
            decimals={1}
          />

          <SliderControl
            label="Noise Amount"
            value={params.noiseAmount}
            min={0}
            max={100}
            step={1}
            onChange={v => set('noiseAmount', v)}
          />
        </>
      )}

      {/* AI background removal needs a single loaded image — image mode only */}
      {isImage && (
        <>
          <div className="control-group">
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="remove-bg"
                checked={params.removeBackground}
                onChange={e => set('removeBackground', e.target.checked)}
                className="checkbox-input"
              />
              <label htmlFor="remove-bg" className="control-label checkbox-label">
                Hintergrund entfernen (KI)
              </label>
            </div>
            {maskLoading && (
              <div className="mask-progress">
                <div className="mask-progress__bar">
                  <div
                    className="mask-progress__fill"
                    style={{ width: `${Math.round((maskProgress ?? 0) * 100)}%` }}
                  />
                </div>
                <span className="mask-progress__label">
                  {maskProgress === null
                    ? 'Modell wird geladen…'
                    : `${Math.round(maskProgress * 100)}%`}
                </span>
              </div>
            )}
          </div>

          {params.removeBackground && (
            <SliderControl
              label="HG-Schwelle"
              value={params.bgThreshold}
              min={0}
              max={255}
              step={1}
              onChange={v => set('bgThreshold', v)}
            />
          )}
        </>
      )}

      <SliderControl
        label="Halftone Threshold"
        value={params.halftoneThreshold}
        min={0}
        max={255}
        step={1}
        onChange={v => set('halftoneThreshold', v)}
      />

      <SliderControl
        label="Min Dot Size"
        value={params.minDotSize}
        min={0}
        max={10}
        step={1}
        onChange={v => set('minDotSize', v)}
        unit="px"
      />

      <SliderControl
        label="Max Dot Size"
        value={params.maxDotSize}
        min={1}
        max={30}
        step={1}
        onChange={v => set('maxDotSize', v)}
        unit="px"
      />

      <SliderControl
        label="Ink Bleed"
        value={params.inkBleed}
        min={0}
        max={10}
        step={0.5}
        onChange={v => set('inkBleed', v)}
        decimals={1}
      />

      {/* Image-mask mode — image only */}
      {isImage && (
        <>
          <div className="control-group">
            <div className="checkbox-row">
              <input
                type="checkbox"
                id="image-mask"
                checked={params.imageMask}
                onChange={e => set('imageMask', e.target.checked)}
                className="checkbox-input"
              />
              <label htmlFor="image-mask" className="control-label checkbox-label">
                Punkte als Maske über Bild
              </label>
            </div>
          </div>

          {params.imageMask && (
            <SliderControl
              label="Hintergrund-Blur"
              value={params.bgBlur}
              min={0}
              max={50}
              step={1}
              onChange={v => set('bgBlur', v)}
              unit="px"
            />
          )}
        </>
      )}

      {/* Colors section */}
      <div className="control-section-label">Colors</div>

      <div className="control-group">
        <ColorField
          label="Dot Color"
          value={params.dotColor}
          onChange={c => set('dotColor', c)}
        />
        <ColorField
          label="Background"
          value={params.bgColor}
          onChange={c => set('bgColor', c)}
          disabled={params.transparentBg}
        />
        <div className="checkbox-row">
          <input
            type="checkbox"
            id="transparent-bg"
            checked={params.transparentBg}
            onChange={e => set('transparentBg', e.target.checked)}
            className="checkbox-input"
          />
          <label htmlFor="transparent-bg" className="control-label checkbox-label">
            Transparent Background
          </label>
        </div>
      </div>

      {/* Video: format + per-clip position controls */}
      {isVideo && (
        <VideoCanvasControls
          selectedClip={selectedClip}
          onSetTransform={onSetClipTransform}
          onCenter={onCenterClip}
          aspect={timelineAspect}
          resolution={timelineResolution}
          onSetAspect={onSetTimelineAspect}
          onSetResolution={onSetTimelineResolution}
        />
      )}

      {/* Export buttons */}
      {isVideo ? (
        <div className="export-row">
          <button
            className="export-btn"
            onClick={onOpenVideoExport}
            disabled={!hasVideoClips}
          >
            Video exportieren…
          </button>
        </div>
      ) : (
        <div className="export-row">
          <button className="export-btn" onClick={() => onExport('png')}>PNG</button>
          <button className="export-btn" onClick={() => onExport('jpg')}>JPG</button>
          <button className="export-btn" onClick={() => onExport('svg')}>SVG</button>
        </div>
      )}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
  decimals?: number;
}

function SliderControl({ label, value, min, max, step, onChange, unit = '', decimals = 0 }: SliderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);

  function startEdit() {
    setDraft(String(value));
    setEditing(true);
  }

  function commit() {
    const n = parseFloat(draft);
    if (!isNaN(n)) {
      // Typed values are free — the slider stays clamped, but manual entry
      // can exceed min/max so the user can push effects beyond the UI range.
      onChange(n);
    }
    setEditing(false);
  }

  return (
    <div className="control-group">
      <div className="control-label-row">
        <span className="control-label">{label}</span>
        {editing ? (
          <input
            type="number"
            className="control-value-input"
            value={draft}
            step={step}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span
            className="control-value control-value--editable"
            onClick={startEdit}
            title="Klicken zum Eingeben"
          >
            {display}{unit}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="slider"
      />
    </div>
  );
}
