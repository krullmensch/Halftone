import { useRef } from 'react';
import { HalftoneParams, GridType, CanvasFormat, ExportFormat } from '../types';

interface Props {
  params: HalftoneParams;
  onChange: (params: HalftoneParams) => void;
  onImageLoad: (url: string) => void;
  onExport: (format: ExportFormat) => void;
  onOpenCrop: () => void;
  hasImage: boolean;
}

export default function ControlSidebar({ params, onChange, onImageLoad, onExport, onOpenCrop, hasImage }: Props) {
  const objectUrlRef = useRef<string | null>(null);

  function set<K extends keyof HalftoneParams>(key: K, value: HalftoneParams[K]) {
    onChange({ ...params, [key]: value });
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    onImageLoad(url);
  }

  return (
    <div className="sidebar-inner">
      <h2 className="sidebar-title">Halftone Ink Bleed</h2>

      <div className="control-group">
        <label className="control-label">Source Image</label>
        <input
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleImageChange}
          className="file-input"
        />
      </div>

      <SliderControl
        label="Canvas Size"
        value={params.canvasSize}
        min={600}
        max={4000}
        step={100}
        onChange={v => set('canvasSize', v)}
        unit="px"
      />

      <div className="control-group">
        <label className="control-label">Format</label>
        <div className="toggle-group toggle-group--wrap">
          {(
            [
              ['auto', 'Fit Image'],
              ['din-portrait', 'DIN Hoch'],
              ['din-landscape', 'DIN Quer'],
              ['square', '1:1'],
            ] as [CanvasFormat, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={`toggle-btn${params.canvasFormat === value ? ' active' : ''}`}
              onClick={() => set('canvasFormat', value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {params.canvasFormat !== 'auto' && hasImage && (
        <button className="position-btn" onClick={onOpenCrop}>
          Bild positionieren…
        </button>
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

      {/* Colors section */}
      <div className="control-section-label">Colors</div>

      <div className="control-group">
        <div className="color-row">
          <label className="control-label color-label">Dot Color</label>
          <input
            type="color"
            value={params.dotColor}
            onChange={e => set('dotColor', e.target.value)}
            className="color-input"
          />
        </div>
        <div className="color-row">
          <label className={`control-label color-label${params.transparentBg ? ' disabled' : ''}`}>
            Background
          </label>
          <input
            type="color"
            value={params.bgColor}
            onChange={e => set('bgColor', e.target.value)}
            className="color-input"
            disabled={params.transparentBg}
          />
        </div>
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

      {/* Export buttons */}
      <div className="export-row">
        <button className="export-btn" onClick={() => onExport('png')}>PNG</button>
        <button className="export-btn" onClick={() => onExport('jpg')}>JPG</button>
        <button className="export-btn" onClick={() => onExport('svg')}>SVG</button>
      </div>
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
  const display = decimals > 0 ? value.toFixed(decimals) : String(value);
  return (
    <div className="control-group">
      <div className="control-label-row">
        <span className="control-label">{label}</span>
        <span className="control-value">{display}{unit}</span>
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
