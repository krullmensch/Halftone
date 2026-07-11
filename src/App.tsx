import { useState, useCallback, useRef, useEffect } from 'react';
import {
  HalftoneParams, DEFAULT_PARAMS, ExportFormat, FontInfo, FontAxis,
  SketchHandle, VideoTimelineData, VideoExportSettings, VideoCodec,
  VideoContainer, TimelineTransition, TimelineAspect, ClipTransform,
  DEFAULT_TIMELINE,
} from './types';
import { timelineDuration } from './video/timeline';
import ControlSidebar from './components/ControlSidebar';
import HalftoneCanvas from './components/HalftoneCanvas';
import FormatCropModal from './components/FormatCropModal';
import DropEffect, { DropEffectHandle } from './components/DropEffect';
import VideoTimeline from './components/VideoTimeline';
import ClipCanvasOverlay from './components/ClipCanvasOverlay';
import VideoPlaybackControls from './components/VideoPlaybackControls';
import VideoExportDialog from './components/VideoExportDialog';
import RemotionPreview, { RemotionPreviewHandle } from './components/RemotionPreview';

/** Minimum interval (ms) between videoTime state updates while playing —
 *  the Remotion Player emits a frameupdate ~30x/s, but ~4Hz is plenty for
 *  the on-screen time label and keeps that from rippling through App. */
const TIME_LABEL_THROTTLE_MS = 250;

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
  const [videoTimeline, setVideoTimeline] = useState<VideoTimelineData>(DEFAULT_TIMELINE);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [videoExportOpen, setVideoExportOpen] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [videoExportProgress, setVideoExportProgress] = useState<number | null>(null);
  const [videoExportLabel, setVideoExportLabel] = useState('');
  const sketchRef = useRef<SketchHandle | null>(null);
  const previewRef = useRef<RemotionPreviewHandle | null>(null);
  const timelineRef = useRef(videoTimeline);
  const exportAbortRef = useRef<AbortController | null>(null);
  // Latest preview time, updated every rendered frame; videoTime state (which
  // drives re-renders) is only flushed from this at ~4Hz — see handlePreviewTime.
  const videoTimeRef = useRef(0);
  const lastTimeUpdateRef = useRef(0);

  useEffect(() => {
    timelineRef.current = videoTimeline;
    setVideoDuration(timelineDuration(videoTimeline));
  }, [videoTimeline]);

  // Canvas aspect follows the timeline's chosen output aspect ratio.
  useEffect(() => {
    const aspect = videoTimeline.aspect.w / videoTimeline.aspect.h;
    setParams(p => (p.videoAspect === aspect ? p : { ...p, videoAspect: aspect }));
  }, [videoTimeline.aspect]);

  // Leaving video mode stops playback (the <RemotionPreview> itself unmounts
  // via the JSX condition below, which tears down the Remotion Player).
  useEffect(() => {
    if (params.mode === 'video') return;
    setVideoPlaying(false);
  }, [params.mode]);

  const registerSketch = useCallback((handle: SketchHandle | null) => {
    sketchRef.current = handle;
  }, []);

  // Pushed by <RemotionPreview> every rendered frame with the composited canvas.
  const handlePreviewFrame = useCallback((canvas: HTMLCanvasElement, w: number, h: number) => {
    sketchRef.current?.setVideoFrame(canvas, w, h);
  }, []);

  // Throttled to ~4Hz so 30fps frameupdate events don't ripple a setState
  // through the whole App tree; the fast-changing value still lives in
  // videoTimeRef for any consumer that needs the un-throttled time.
  const handlePreviewTime = useCallback((t: number) => {
    videoTimeRef.current = t;
    const now = performance.now();
    if (now - lastTimeUpdateRef.current >= TIME_LABEL_THROTTLE_MS) {
      lastTimeUpdateRef.current = now;
      setVideoTime(t);
    }
  }, []);

  const handlePreviewEnded = useCallback(() => {
    setVideoPlaying(false);
    setVideoTime(videoTimeRef.current);
  }, []);

  const handleVideoPlayPause = useCallback(() => {
    const preview = previewRef.current;
    if (!preview) return;
    if (preview.isPlaying) {
      preview.pause();
      setVideoPlaying(false);
    } else {
      preview.play();
      setVideoPlaying(true);
    }
  }, []);

  const handleVideoSeek = useCallback((t: number) => {
    const preview = previewRef.current;
    if (!preview) return;
    setVideoPlaying(false);
    preview.pause();
    preview.seekTo(t);
    videoTimeRef.current = t;
    lastTimeUpdateRef.current = performance.now();
    setVideoTime(t);
  }, []);

  // Jump to the next/previous clip's start (relative to the current playhead).
  const handleStepClip = useCallback((dir: 1 | -1) => {
    const clips = [...timelineRef.current.clips].sort((a, b) => a.startTime - b.startTime);
    if (clips.length === 0) return;
    const t = videoTimeRef.current;
    if (dir > 0) {
      const next = clips.find(c => c.startTime > t + 0.05);
      if (next) handleVideoSeek(next.startTime);
    } else {
      const prior = clips.filter(c => c.startTime < t - 0.05);
      const prev = prior[prior.length - 1];
      handleVideoSeek(prev ? prev.startTime : 0);
    }
  }, [handleVideoSeek]);

  const addVideoFiles = useCallback(async (files: File[]) => {
    const { fileToClip, isClipFile } = await import('./video/importClips');
    for (const file of files) {
      if (!isClipFile(file)) continue;
      try {
        const clip = await fileToClip(file);
        // Append the new clip at the current end of the timeline.
        setVideoTimeline(tl => ({
          ...tl,
          clips: [...tl.clips, { ...clip, startTime: timelineDuration(tl) }],
        }));
      } catch (e) {
        console.warn('[video] import failed', e);
        window.alert(e instanceof Error ? e.message : `Import fehlgeschlagen: ${file.name}`);
      }
    }
  }, []);

  const handleSetClipStart = useCallback((clipId: string, startTime: number) => {
    setVideoTimeline(tl => ({
      ...tl,
      clips: tl.clips.map(c => (c.id === clipId ? { ...c, startTime: Math.max(0, startTime) } : c)),
    }));
  }, []);

  const handleClipTrim = useCallback(
    (clipId: string, inPoint: number, outPoint: number, startTime: number) => {
      setVideoTimeline(tl => ({
        ...tl,
        clips: tl.clips.map(c =>
          c.id === clipId
            ? {
                ...c,
                inPoint,
                outPoint,
                startTime: Math.max(0, startTime),
                // Stills have no source: their playable length IS their duration.
                ...(c.type === 'still' ? { duration: outPoint } : {}),
              }
            : c,
        ),
      }));
    },
    [],
  );

  const handleClipRemove = useCallback((clipId: string) => {
    setVideoTimeline(tl => {
      const removed = tl.clips.find(c => c.id === clipId);
      if (removed) URL.revokeObjectURL(removed.src);
      return {
        ...tl,
        clips: tl.clips.filter(c => c.id !== clipId),
        // Drop any transition that referenced the removed clip.
        transitions: tl.transitions.filter(t => t.fromClipId !== clipId && t.toClipId !== clipId),
      };
    });
    setSelectedClipId(id => (id === clipId ? null : id));
  }, []);

  const handleSetClipTransform = useCallback((clipId: string, transform: ClipTransform) => {
    setVideoTimeline(tl => ({
      ...tl,
      clips: tl.clips.map(c => (c.id === clipId ? { ...c, transform } : c)),
    }));
  }, []);

  const handleCenterClip = useCallback((clipId: string, axis: 'x' | 'y' | 'both') => {
    setVideoTimeline(tl => ({
      ...tl,
      clips: tl.clips.map(c =>
        c.id === clipId
          ? {
              ...c,
              transform: {
                ...c.transform,
                x: axis === 'x' || axis === 'both' ? 0.5 : c.transform.x,
                y: axis === 'y' || axis === 'both' ? 0.5 : c.transform.y,
              },
            }
          : c,
      ),
    }));
  }, []);

  const handleAddTransition = useCallback((t: TimelineTransition) => {
    setVideoTimeline(tl => ({ ...tl, transitions: [...tl.transitions, t] }));
  }, []);

  const handleUpdateTransition = useCallback((id: string, patch: Partial<TimelineTransition>) => {
    setVideoTimeline(tl => ({
      ...tl,
      transitions: tl.transitions.map(t => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const handleRemoveTransition = useCallback((id: string) => {
    setVideoTimeline(tl => ({ ...tl, transitions: tl.transitions.filter(t => t.id !== id) }));
  }, []);

  const handleSetTimelineAspect = useCallback((aspect: TimelineAspect) => {
    setVideoTimeline(tl => ({ ...tl, aspect }));
  }, []);

  const handleSetTimelineResolution = useCallback((resolution: number) => {
    setVideoTimeline(tl => ({ ...tl, resolution }));
  }, []);

  const probeCodec = useCallback(async (
    codec: VideoCodec, container: VideoContainer,
  ): Promise<'hardware' | 'software' | 'unsupported'> => {
    try {
      const { probeCodecSupport } = await import('./video/encoders/webcodecs');
      return await probeCodecSupport(codec, container, 1920, 1080, 30, 8_000_000);
    } catch {
      return 'unsupported';
    }
  }, []);

  const handleVideoExport = useCallback(async (settings: VideoExportSettings) => {
    const sketch = sketchRef.current;
    if (!sketch || timelineRef.current.clips.length === 0) return;
    previewRef.current?.pause();
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
              : `Frame ${p.framesDone}/${p.totalFrames}${p.software ? ' – Software-Encoding' : ' – Hardware'}`,
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

  const handleTextBoxChange = useCallback((box: HalftoneParams['textBox']) => {
    setParams(p => ({ ...p, textBox: box }));
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
          selectedClip={videoTimeline.clips.find(c => c.id === selectedClipId) ?? null}
          onSetClipTransform={handleSetClipTransform}
          onCenterClip={handleCenterClip}
          timelineAspect={videoTimeline.aspect}
          timelineResolution={videoTimeline.resolution}
          onSetTimelineAspect={handleSetTimelineAspect}
          onSetTimelineResolution={handleSetTimelineResolution}
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
          onTextBoxChange={handleTextBoxChange}
          hasVideoClips={videoTimeline.clips.length > 0}
          onAddVideoFiles={addVideoFiles}
        />
        {params.mode === 'video' && videoTimeline.clips.length > 0 && (
          <RemotionPreview
            ref={previewRef}
            timeline={videoTimeline}
            onFrame={handlePreviewFrame}
            onTime={handlePreviewTime}
            onEnded={handlePreviewEnded}
          />
        )}
        {params.mode === 'video' && (
          <ClipCanvasOverlay
            selectedClip={videoTimeline.clips.find(c => c.id === selectedClipId) ?? null}
            aspect={videoTimeline.aspect}
            onSetTransform={handleSetClipTransform}
          />
        )}
        {params.mode === 'video' && videoTimeline.clips.length > 0 && (
          <>
            <VideoPlaybackControls
              isPlaying={videoPlaying}
              currentTime={videoTime}
              duration={videoDuration}
              onPlayPause={handleVideoPlayPause}
              onStepClip={handleStepClip}
              currentTimeRef={videoTimeRef}
            />
            <VideoTimeline
              timeline={videoTimeline}
              currentTime={videoTime}
              duration={videoDuration}
              selectedClipId={selectedClipId}
              currentTimeRef={videoTimeRef}
              onSeek={handleVideoSeek}
              onSelectClip={setSelectedClipId}
              onSetClipStart={handleSetClipStart}
              onTrimClip={handleClipTrim}
              onRemoveClip={handleClipRemove}
              onAddTransition={handleAddTransition}
              onUpdateTransition={handleUpdateTransition}
              onRemoveTransition={handleRemoveTransition}
              onPlayPause={handleVideoPlayPause}
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
        <FormatCropModal
          imageUrl={imageUrl}
          canvasWidth={params.canvasWidth}
          canvasHeight={params.canvasHeight}
          cropRect={params.cropRect}
          onApply={(canvasWidth, canvasHeight, cropRect) =>
            setParams(p => ({ ...p, canvasWidth, canvasHeight, cropRect }))
          }
          onClose={() => setCropOpen(false)}
        />
      )}
    </div>
  );
}
