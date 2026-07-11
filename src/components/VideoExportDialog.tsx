import { useEffect, useRef, useState } from 'react';
import type { VideoCodec, VideoContainer, VideoExportSettings } from '../types';

interface Props {
  onClose: () => void;
  onExport: (settings: VideoExportSettings) => void;
  onCancel: () => void;
  exporting: boolean;
  progress: number | null;
  progressLabel: string;
  probe: (codec: VideoCodec, container: VideoContainer) => Promise<'hardware' | 'software' | 'unsupported'>;
}

const CONTAINERS: { value: VideoContainer; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'webm', label: 'WebM' },
];

const CODECS_BY_CONTAINER: Record<VideoContainer, VideoCodec[]> = {
  mp4: ['h264', 'h265', 'av1'],
  mov: ['h264', 'h265'],
  webm: ['vp8', 'vp9', 'av1'],
};

const CODEC_LABELS: Record<VideoCodec, string> = {
  h264: 'H.264',
  h265: 'H.265',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
};

const FPS_OPTIONS = [24, 25, 30, 50, 60];

type ProbeResult = 'hardware' | 'software' | 'unsupported' | 'pending';

export default function VideoExportDialog({ onClose, onExport, onCancel, exporting, progress, progressLabel, probe }: Props) {
  const [settings, setSettings] = useState<VideoExportSettings>({
    container: 'mp4',
    codec: 'h264',
    fps: 30,
    resolution: 1920,
  });
  const [probeResults, setProbeResults] = useState<Partial<Record<VideoCodec, ProbeResult>>>({});
  const probeGen = useRef(0);

  // Close on Escape (disabled while exporting)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !exporting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, exporting]);

  // Ensure codec stays valid for the selected container
  useEffect(() => {
    const valid = CODECS_BY_CONTAINER[settings.container];
    if (!valid.includes(settings.codec)) {
      setSettings(s => ({ ...s, codec: valid[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.container]);

  // Probe visible codecs whenever the container changes
  useEffect(() => {
    const gen = ++probeGen.current;
    const codecs = CODECS_BY_CONTAINER[settings.container];
    setProbeResults(prev => {
      const next: Partial<Record<VideoCodec, ProbeResult>> = { ...prev };
      codecs.forEach(c => { next[c] = 'pending'; });
      return next;
    });
    codecs.forEach(codec => {
      probe(codec, settings.container).then(result => {
        if (probeGen.current !== gen) return; // stale, container changed since
        setProbeResults(prev => ({ ...prev, [codec]: result }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.container]);

  function update<K extends keyof VideoExportSettings>(key: K, value: VideoExportSettings[K]) {
    setSettings(s => ({ ...s, [key]: value }));
  }

  const visibleCodecs = CODECS_BY_CONTAINER[settings.container];

  return (
    <div
      className="crop-overlay"
      onClick={e => { if (e.target === e.currentTarget && !exporting) onClose(); }}
    >
      <div className="vex-panel" onClick={e => e.stopPropagation()}>
        <h3 className="crop-title">Video exportieren</h3>

        <div className="control-group">
          <span className="control-label">Container</span>
          <div className="toggle-group">
            {CONTAINERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`toggle-btn${settings.container === value ? ' active' : ''}`}
                disabled={exporting}
                onClick={() => update('container', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">Codec</span>
          <div className="toggle-group vex-codec-group">
            {visibleCodecs.map(codec => {
              const result = probeResults[codec] ?? 'pending';
              return (
                <div className="vex-codec-option" key={codec}>
                  <button
                    type="button"
                    className={`toggle-btn${settings.codec === codec ? ' active' : ''}`}
                    disabled={exporting}
                    onClick={() => update('codec', codec)}
                  >
                    {CODEC_LABELS[codec]}
                  </button>
                  <span
                    className={`vex-badge vex-badge--${result === 'hardware' ? 'hw' : result === 'software' ? 'sw' : 'none'}`}
                  >
                    {result === 'hardware' ? 'Hardware' : result === 'software' ? 'Software' : '–'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">Bildrate</span>
          <div className="toggle-group">
            {FPS_OPTIONS.map(fps => (
              <button
                key={fps}
                type="button"
                className={`toggle-btn${settings.fps === fps ? ' active' : ''}`}
                disabled={exporting}
                onClick={() => update('fps', fps)}
              >
                {fps}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <div className="control-label-row">
            <span className="control-label">Auflösung (lange Seite)</span>
            <span className="control-value">{settings.resolution}px</span>
          </div>
          <input
            type="range"
            className="slider"
            min={480}
            max={3840}
            step={120}
            value={settings.resolution}
            disabled={exporting}
            onChange={e => update('resolution', Number(e.target.value))}
          />
        </div>

        {exporting && (
          <>
            <div className="mask-progress">
              <div className="mask-progress__bar">
                <div
                  className="mask-progress__fill"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="mask-progress__label">
                {progress === null ? 'Wird vorbereitet…' : `${Math.round(progress * 100)}%`}
              </span>
            </div>
            <div className="vex-progress-text">{progressLabel}</div>
          </>
        )}

        <div className="export-row">
          {exporting ? (
            <button className="export-btn vex-cancel-btn" onClick={onCancel}>
              Abbrechen
            </button>
          ) : (
            <button className="export-btn" onClick={() => onExport(settings)}>
              Exportieren
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
