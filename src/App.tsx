import { useState, useCallback, useRef } from 'react';
import { HalftoneParams, DEFAULT_PARAMS, ExportFormat } from './types';
import ControlSidebar from './components/ControlSidebar';
import HalftoneCanvas from './components/HalftoneCanvas';
import CropModal from './components/CropModal';

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
  const exportRef = useRef<((format: ExportFormat) => void) | null>(null);

  const handleExport = useCallback((format: ExportFormat) => {
    exportRef.current?.(format);
  }, []);

  const registerExport = useCallback((fn: (format: ExportFormat) => void) => {
    exportRef.current = fn;
  }, []);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <ControlSidebar
          params={params}
          onChange={setParams}
          onImageLoad={setImageUrl}
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
        />
      </main>
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
