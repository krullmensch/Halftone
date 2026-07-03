import { useState, useCallback, useRef, useEffect } from 'react';
import {
  HalftoneParams, DEFAULT_PARAMS, ExportFormat, FontInfo, FontAxis,
  SketchHandle, VideoTimelineData, VideoExportSettings, VideoCodec,
  VideoContainer, ClipTransition,
} from './types';
import ControlSidebar from './components/ControlSidebar';
import HalftoneCanvas from './components/HalftoneCanvas';
import CropModal from './components/CropModal';
import DropEffect, { DropEffectHandle } from './components/DropEffect';
import VideoTimeline from './components/VideoTimeline';
import VideoPlaybackControls from './components/VideoPlaybackControls';
import VideoExportDialog from './components/VideoExportDialog';
import type { PlaybackEngine } from './video/playbackEngine';

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
  const [maskBitmap, setMaskBitmap] = useState<ImageBitmap | null>(null);
  const [maskLoading, setMaskLoading] = useState(false);
  const [maskProgress, setMaskProgress] = useState<number | null>(null);
  const maskCacheUrl = useRef<string | null>(null);
  const [fontInfo, setFontInfo] = useState<FontInfo | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [absorbing, setAbsorbing] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const exportRef = useRef<((format: ExportFormat) => void) | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const effectRef = useRef<DropEffectHandle>(null);

  // ── Video mode state ─────────────────────────────────────────────────
  const [videoTimeline, setVideoTimeline] = useState<VideoTimelineData>({
    clips: [], transitions: [],
  });
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoExportOpen, setVideoExportOpen] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState<number | null>(null);
  const [videoExportLabel, setVideoExportLabel] = useState('');
  const sketchRef = useRef<SketchHandle | null>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const timelineRef = useRef(videoTimeline);
  const exportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    timelineRef.current = videoTimeline;
    let cancelled = false;
    import('./video/timeline').then(m => {
      if (!cancelled) setVideoDuration(m.timelineDuration(videoTimeline));
    });
    return () => { cancelled = true; };
  }, [videoTimeline]);

  // Canvas aspect follows the first clip (constant across the timeline so the
  // canvas doesn't resize mid-playback).
  useEffect(() => {
    const first = videoTimeline.clips[0];
    if (!first || !first.width || !first.height) return;
    const aspect = first.width / first.height;
    setParams(p => (p.videoAspect === aspect ? p : { ...p, videoAspect: aspect }));
  }, [videoTimeline.clips]);

  // Leaving video mode stops playback and releases the engine.
  useEffect(() => {
    if (params.mode === 'video') return;
    engineRef.current?.dispose();
    engineRef.current = null;
    setVideoPlaying(false);
  }, [params.mode]);

  const registerSketch = useCallback((handle: SketchHandle | null) => {
    sketchRef.current = handle;
    if (!handle) {
      engineRef.current?.dispose();
      engineRef.current = null;
    }
  }, []);

  const ensureEngine = useCallback(async (): Promise<PlaybackEngine | null> => {
    if (engineRef.current) return engineRef.current;
    const sketch = sketchRef.current;
    if (!sketch) return null;
    const { createPlaybackEngine } = await import('./video/playbackEngine');
    // A mode switch may have disposed a concurrently created engine
    if (engineRef.current) return engineRef.current;
    const engine = createPlaybackEngine({
      getTimeline: () => timelineRef.current,
      sketch,
      onTime: setVideoTime,
      onEnded: () => setVideoPlaying(false),
    });
    engineRef.current = engine;
    return engine;
  }, []);

  const handleVideoPlayPause = useCallback(async () => {
    const engine = await ensureEngine();
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setVideoPlaying(false);
    } else {
      engine.play();
      setVideoPlaying(true);
    }
  }, [ensureEngine]);

  const handleVideoSeek = useCallback(async (t: number) => {
    const engine = await ensureEngine();
    if (!engine) return;
    setVideoPlaying(false);
    await engine.seek(t);
  }, [ensureEngine]);

  const addVideoFiles = useCallback(async (files: File[]) => {
    const { fileToClip, isClipFile } = await import('./video/importClips');
    for (const file of files) {
      if (!isClipFile(file)) continue;
      try {
        const clip = await fileToClip(file);
        setVideoTimeline(tl => ({
          clips: [...tl.clips, clip],
          transitions: tl.clips.length > 0
            ? [...tl.transitions, { type: 'none', duration: 0.5 }]
            : tl.transitions,
        }));
      } catch (e) {
        console.warn('[video] import failed', e);
        window.alert(e instanceof Error ? e.message : `Import fehlgeschlagen: ${file.name}`);
      }
    }
  }, []);

  const handleClipReorder = useCallback((from: number, to: number) => {
    setVideoTimeline(tl => {
      if (from === to || from < 0 || to < 0 || from >= tl.clips.length || to >= tl.clips.length) {
        return tl;
      }
      const clips = [...tl.clips];
      const [moved] = clips.splice(from, 1);
      clips.splice(to, 0, moved);
      // Transition assignments between pairs change — reset to safe defaults
      // around the moved clip is complex; keep array length consistent.
      const transitions = tl.transitions.slice(0, Math.max(0, clips.length - 1));
      while (transitions.length < clips.length - 1) {
        transitions.push({ type: 'none', duration: 0.5 });
      }
      return { clips, transitions };
    });
  }, []);

  const handleClipTrim = useCallback((clipId: string, inPoint: number, outPoint: number) => {
    setVideoTimeline(tl => ({
      ...tl,
      clips: tl.clips.map(c => (c.id === clipId ? { ...c, inPoint, outPoint } : c)),
    }));
  }, []);

  const handleClipRemove = useCallback((clipId: string) => {
    import('./video/frameSource').then(m => m.disposeFrameSource(clipId));
    setVideoTimeline(tl => {
      const idx = tl.clips.findIndex(c => c.id === clipId);
      if (idx < 0) return tl;
      const removed = tl.clips[idx];
      URL.revokeObjectURL(removed.src);
      const clips = tl.clips.filter(c => c.id !== clipId);
      const transitions = [...tl.transitions];
      // Remove the transition following the clip (or the previous one for the last clip)
      transitions.splice(Math.min(idx, transitions.length - 1), 1);
      return { clips, transitions: transitions.slice(0, Math.max(0, clips.length - 1)) };
    });
  }, []);

  const handleSetTransition = useCallback((index: number, def: ClipTransition) => {
    setVideoTimeline(tl => ({
      ...tl,
      transitions: tl.transitions.map((t, i) => (i === index ? def : t)),
    }));
  }, []);

  const handleSetStillDuration = useCallback((clipId: string, seconds: number) => {
    setVideoTimeline(tl => ({
      ...tl,
      clips: tl.clips.map(c =>
        c.id === clipId && c.type === 'still'
          ? { ...c, duration: seconds, outPoint: seconds, inPoint: 0 }
          : c,
      ),
    }));
  }, []);

  const probeCodec = useCallback(async (
    codec: VideoCodec, container: VideoContainer,
  ): Promise<'hardware' | 'software' | 'unsupported'> => {
    try {
      const { detectEncodePath } = await import('./video/encoders/webcodecs');
      const path = await detectEncodePath(codec, container, 1920, 1080, 30, 8_000_000);
      if (path === 'webcodecs') return 'hardware';
      if (path === 'ffmpeg') return 'software';
      return 'unsupported';
    } catch {
      return 'unsupported';
    }
  }, []);

  const handleVideoExport = useCallback(async (settings: VideoExportSettings) => {
    const sketch = sketchRef.current;
    if (!sketch || timelineRef.current.clips.length === 0) return;
    engineRef.current?.pause();
    setVideoPlaying(false);

    const ac = new AbortController();
    exportAbortRef.current = ac;
    setVideoExporting(true);
    setVideoExportProgress(0);
    setVideoExportLabel('Vorbereiten…');
    try {
      const { exportVideo } = await import('./video/export');
      await exportVideo({
        timeline: timelineRef.current,
        settings,
        sketch,
        signal: ac.signal,
        onProgress: p => {
          setVideoExportProgress(p.totalFrames > 0 ? p.framesDone / p.totalFrames : 0);
          setVideoExportLabel(
            p.phase === 'finalizing'
              ? 'Datei wird erstellt…'
              : `Frame ${p.framesDone}/${p.totalFrames}${p.software ? ' – Software-Encoding (ffmpeg)' : ' – Hardware'}`,
          );
        },
      });
      setVideoExportOpen(false);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') {
        console.error('[video] export failed', e);
        window.alert('Video-Export fehlgeschlagen. Details in der Konsole.');
      }
    } finally {
      setVideoExporting(false);
      setVideoExportProgress(null);
      setVideoExportLabel('');
      exportAbortRef.current = null;
    }
  }, []);

  const handleVideoExportCancel = useCallback(() => {
    exportAbortRef.current?.abort();
  }, []);

  // Compute the AI foreground mask once per image, lazily when background
  // removal is enabled. Cached by imageUrl so toggling/threshold stays cheap.
  useEffect(() => {
    if (!imageUrl) {
      maskCacheUrl.current = null;
      setMaskBitmap(null);
      return;
    }
    // Image changed → drop a mask computed for a previous image
    if (imageUrl !== maskCacheUrl.current && maskBitmap) {
      maskCacheUrl.current = null;
      setMaskBitmap(null);
    }
    if (!params.removeBackground) return;
    if (imageUrl === maskCacheUrl.current) return; // already cached

    let cancelled = false;
    setMaskLoading(true);
    setMaskProgress(0);
    (async () => {
      try {
        const imgly = await import('@imgly/background-removal');
        const blob = await imgly.removeBackground(imageUrl, {
          progress: (_key, current, total) => {
            if (!cancelled && total > 0) setMaskProgress(current / total);
          },
        });
        const bmp = await createImageBitmap(blob);
        if (cancelled) { bmp.close?.(); return; }
        maskCacheUrl.current = imageUrl;
        setMaskBitmap(bmp);
      } catch (e) {
        if (!cancelled) console.warn('[mask] background removal failed', e);
      } finally {
        if (!cancelled) {
          setMaskLoading(false);
          setMaskProgress(null);
        }
      }
    })();
    return () => { cancelled = true; };
    // maskBitmap intentionally omitted: cache is tracked via maskCacheUrl ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, params.removeBackground]);

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

  const loadFont = useCallback(async (file: File) => {
    const buf = await file.arrayBuffer();
    const family = `htf-${Date.now()}`;
    const ff = new FontFace(family, buf);
    await ff.load();
    document.fonts.add(ff);

    // Parse variable-font axes (opentype.js does not support woff2 → skip silently)
    let axes: FontAxis[] = [];
    try {
      const opentype = await import('opentype.js');
      const font = opentype.parse(buf.slice(0));
      const fvar = (font.tables as { fvar?: { axes?: any[] } }).fvar;
      if (fvar?.axes) {
        axes = fvar.axes.map((a: any) => ({
          tag: a.tag,
          name: a.name?.en || a.name?.['en'] || a.tag,
          min: a.minValue,
          max: a.maxValue,
          default: a.defaultValue,
        }));
      }
    } catch {
      // Static font, woff2, or unparsable axes — render still works via FontFace
    }

    setFontInfo({ family, name: file.name, axes });
    setParams(p => ({
      ...p,
      mode: 'text',
      fontFamily: family,
      fontAxes: Object.fromEntries(axes.map(a => [a.tag, a.default])),
    }));
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
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    if (params.mode === 'video') {
      addVideoFiles(files);
    } else {
      loadFile(files[0]);
    }
    setAbsorbing(true);
    window.setTimeout(() => setAbsorbing(false), 480);
  }, [loadFile, addVideoFiles, params.mode]);

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
          onOpenVideoExport={() => setVideoExportOpen(true)}
          hasVideoClips={videoTimeline.clips.length > 0}
          hasImage={!!imageUrl}
          maskLoading={maskLoading}
          maskProgress={maskProgress}
          fontInfo={fontInfo}
          loadFont={loadFont}
        />
      </aside>
      <main
        className={`canvas-area${
          params.mode === 'video' && videoTimeline.clips.length > 0 ? ' canvas-area--video' : ''
        }`}
      >
        <HalftoneCanvas
          params={params}
          imageUrl={imageUrl}
          mask={maskBitmap}
          registerExport={registerExport}
          registerSketch={registerSketch}
          loadFile={loadFile}
          onRemove={handleRemoveImage}
          fontInfo={fontInfo}
          loadFont={loadFont}
          onTextBoxChange={box => setParams(p => ({ ...p, textBox: box }))}
          hasVideoClips={videoTimeline.clips.length > 0}
          onAddVideoFiles={addVideoFiles}
        />
        {params.mode === 'video' && videoTimeline.clips.length > 0 && (
          <>
            <VideoPlaybackControls
              isPlaying={videoPlaying}
              currentTime={videoTime}
              duration={videoDuration}
              onPlayPause={handleVideoPlayPause}
              onSeek={handleVideoSeek}
            />
            <VideoTimeline
              timeline={videoTimeline}
              currentTime={videoTime}
              duration={videoDuration}
              onSeek={handleVideoSeek}
              onReorder={handleClipReorder}
              onTrim={handleClipTrim}
              onRemoveClip={handleClipRemove}
              onSetTransition={handleSetTransition}
              onSetStillDuration={handleSetStillDuration}
            />
          </>
        )}
      </main>
      {(dragging || absorbing) && (
        <div className={`drop-overlay${absorbing ? ' drop-overlay--absorb' : ''}`}>
          <DropEffect ref={effectRef} />
        </div>
      )}
      {videoExportOpen && (
        <VideoExportDialog
          onClose={() => { if (!videoExporting) setVideoExportOpen(false); }}
          onExport={handleVideoExport}
          onCancel={handleVideoExportCancel}
          exporting={videoExporting}
          progress={videoExportProgress}
          progressLabel={videoExportLabel}
          probe={probeCodec}
        />
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
