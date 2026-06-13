import { useState, useCallback, useRef } from 'react';
import { HalftoneParams, DEFAULT_PARAMS, ExportFormat } from './types';
import ControlSidebar from './components/ControlSidebar';
import HalftoneCanvas from './components/HalftoneCanvas';
import CropModal from './components/CropModal';
import DropEffect, { DropEffectHandle } from './components/DropEffect';

function canvasAspect(format: HalftoneParams['canvasFormat']): number {
  switch (format) {
    case 'din-portrait': return 1 / Math.SQRT2;
    case 'din-landscape': return Math.SQRT2;
    case 'square': return 1;
    default: return 1; // 'auto' — modal never opens for this
  }
}

export default function App() {
  const [params, setParams] = useState<HalftoneParams>(DEFAULT_PARAMS);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [absorbing, setAbsorbing] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const exportRef = useRef<((format: ExportFormat) => void) | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const effectRef = useRef<DropEffectHandle>(null);

  const handleExport = useCallback((format: ExportFormat) => {
    exportRef.current?.(format);
  }, []);

  const registerExport = useCallback((fn: (format: ExportFormat) => void) => {
    exportRef.current = fn;
  }, []);

  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files');

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImageUrl(url);
  }, []);

  const handleRemoveImage = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setImageUrl(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    loadFile(file);
    setAbsorbing(true);
    window.setTimeout(() => setAbsorbing(false), 480);
  }, [loadFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    effectRef.current?.setPos(e.clientX, e.clientY);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    dragDepth.current += 1;
    effectRef.current?.setPos(e.clientX, e.clientY);
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }, []);

  return (
    <div
      className={`app-layout${settingsCollapsed ? ' app-layout--collapsed' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      <aside className="sidebar">
        <button
          type="button"
          className="settings-toggle"
          onClick={() => setSettingsCollapsed(c => !c)}
          aria-label={settingsCollapsed ? 'Einstellungen einblenden' : 'Einstellungen ausblenden'}
        >
          <svg
            className="settings-toggle__icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <ControlSidebar
          params={params}
          onChange={setParams}
          onExport={handleExport}
          onOpenCrop={() => setCropOpen(true)}
          hasImage={!!imageUrl}
        />
      </aside>
      <main className="canvas-area">
        <HalftoneCanvas
          params={params}
          imageUrl={imageUrl}
          registerExport={registerExport}
          loadFile={loadFile}
          onRemove={handleRemoveImage}
        />
      </main>
      {(dragging || absorbing) && (
        <div className={`drop-overlay${absorbing ? ' drop-overlay--absorb' : ''}`}>
          <DropEffect ref={effectRef} />
        </div>
      )}
      {cropOpen && imageUrl && (
        <CropModal
          imageUrl={imageUrl}
          aspect={canvasAspect(params.canvasFormat)}
          offsetX={params.imageOffsetX}
          offsetY={params.imageOffsetY}
          onChange={(x, y) => setParams(p => ({ ...p, imageOffsetX: x, imageOffsetY: y }))}
          onClose={() => setCropOpen(false)}
        />
      )}
    </div>
  );
}
