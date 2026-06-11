import { useState, useCallback, useRef } from 'react';
import { HalftoneParams, DEFAULT_PARAMS, ExportFormat } from './types';
import ControlSidebar from './components/ControlSidebar';
import HalftoneCanvas from './components/HalftoneCanvas';

export default function App() {
  const [params, setParams] = useState<HalftoneParams>(DEFAULT_PARAMS);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
        />
      </aside>
      <main className="canvas-area">
        <HalftoneCanvas
          params={params}
          imageUrl={imageUrl}
          registerExport={registerExport}
        />
      </main>
    </div>
  );
}
