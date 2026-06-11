import { useEffect, useRef } from 'react';
import { HalftoneParams, ExportFormat } from '../types';
import type { SketchHandle } from '../types';

interface Props {
  params: HalftoneParams;
  imageUrl: string | null;
  registerExport: (fn: (format: ExportFormat) => void) => void;
}

export default function HalftoneCanvas({ params, imageUrl, registerExport }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SketchHandle | null>(null);

  // Mount / unmount sketch
  useEffect(() => {
    if (!containerRef.current) return;

    let handle: SketchHandle | null = null;
    let cancelled = false;

    import('../sketch/halftoneSketch').then(mod => {
      if (cancelled || !containerRef.current) return;
      handle = mod.createSketch(containerRef.current);
      handleRef.current = handle;
      // Apply current params and image immediately after creation
      handle.setParams(params);
      if (imageUrl) handle.setImage(imageUrl);
    });

    return () => {
      cancelled = true;
      handle?.destroy();
      handleRef.current = null;
    };
    // Intentionally only on mount/unmount — params and imageUrl have their own effects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync params changes
  useEffect(() => {
    handleRef.current?.setParams(params);
  }, [params]);

  // Sync image changes
  useEffect(() => {
    if (imageUrl) {
      handleRef.current?.setImage(imageUrl);
    }
  }, [imageUrl]);

  // Register export callback with parent
  useEffect(() => {
    registerExport((format: ExportFormat) => {
      handleRef.current?.exportImage(format);
    });
  }, [registerExport]);

  return (
    <div className="canvas-wrapper">
      <div ref={containerRef} className="sketch-container" />
    </div>
  );
}
