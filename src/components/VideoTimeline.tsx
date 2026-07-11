import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  TimelineTransition,
  VideoClip,
  VideoTimelineData,
  WipeDirection,
} from '../types';
import { clipPlayableDuration } from '../video/timeline';

interface Props {
  timeline: VideoTimelineData;
  currentTime: number;
  duration: number;
  selectedClipId: string | null;
  /** Un-throttled current-time ref (App's videoTimeRef), read every animation
   *  frame to drive the playhead at 60fps without triggering re-renders. */
  currentTimeRef?: React.RefObject<number>;
  onSeek: (t: number) => void;
  onSelectClip: (id: string | null) => void;
  onSetClipStart: (id: string, startTime: number) => void;
  onTrimClip: (id: string, inPoint: number, outPoint: number, startTime: number) => void;
  onRemoveClip: (id: string) => void;
  onAddTransition: (t: TimelineTransition) => void;
  onUpdateTransition: (id: string, patch: Partial<TimelineTransition>) => void;
  onRemoveTransition: (id: string) => void;
  onPlayPause?: () => void;
}

const DEFAULT_PX_PER_SEC = 44;
const MIN_PX_PER_SEC = 8;
const MAX_PX_PER_SEC = 256;
const MIN_TRIM_SPAN = 0.2;
const MIN_TRANS_DUR = 0.1;
/** Magnet snap radius in pixels (converted to seconds at drag time). */
const SNAP_PX = 7;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Icons (inline, Lucide-style, stroke=currentColor) ───────────────────────

function IconMinus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconMaximize() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}
function IconX({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function IconCrossfade() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 18L13 4l8 14H3z" opacity="0.55" />
      <path d="M21 18L11 4 3 18h18z" />
    </svg>
  );
}
function IconDipBlack() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
    </svg>
  );
}
function IconDipWhite() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}
/** Arrow pointing up; rotate via style transform for the four wipe directions. */
function IconArrow({ deg = 0 }: { deg?: number }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${deg}deg)` }} aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

// ── Effect palette ──────────────────────────────────────────────────────────
type ChipKind = 'crossfade' | 'dip-black' | 'dip-white' | 'wipe';

interface Chip {
  kind: ChipKind;
  label: string;
}

const CHIPS: Chip[] = [
  { kind: 'crossfade', label: 'Cross Dissolve' },
  { kind: 'dip-black', label: 'Dip → Black' },
  { kind: 'dip-white', label: 'Dip → White' },
  { kind: 'wipe', label: 'Wipe' },
];

const DND_MIME = 'application/x-halftone-effect';

function chipToTransitionBase(kind: ChipKind): Pick<TimelineTransition, 'type' | 'color' | 'direction'> {
  switch (kind) {
    case 'crossfade':
      return { type: 'crossfade' };
    case 'dip-black':
      return { type: 'dip-to-color', color: '#000000' };
    case 'dip-white':
      return { type: 'dip-to-color', color: '#ffffff' };
    case 'wipe':
      return { type: 'wipe', direction: 'left' };
  }
}

function ChipIcon({ kind }: { kind: ChipKind }) {
  switch (kind) {
    case 'crossfade':
      return <IconCrossfade />;
    case 'dip-black':
      return <IconDipBlack />;
    case 'dip-white':
      return <IconDipWhite />;
    case 'wipe':
      return <IconArrow deg={270} />;
  }
}

const WIPE_DEG: Record<WipeDirection, number> = { up: 0, right: 90, down: 180, left: 270 };

function TransitionIcon({ t }: { t: TimelineTransition }) {
  if (t.type === 'crossfade') return <IconCrossfade />;
  if (t.type === 'wipe') return <IconArrow deg={WIPE_DEG[t.direction ?? 'left']} />;
  return (t.color ?? '#000000') === '#ffffff' ? <IconDipWhite /> : <IconDipBlack />;
}

const WIPE_DIRECTIONS: { dir: WipeDirection; label: string }[] = [
  { dir: 'left', label: 'Links' },
  { dir: 'right', label: 'Rechts' },
  { dir: 'up', label: 'Oben' },
  { dir: 'down', label: 'Unten' },
];

// ── Adaptive ruler ticks ─────────────────────────────────────────────────────
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600];

function pickMajorStep(pxPerSec: number): number {
  for (const step of TICK_STEPS) {
    if (step * pxPerSec >= 64) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1];
}

function formatTick(t: number, majorStep: number): string {
  if (majorStep < 1) return `${t.toFixed(1)}s`;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Drag state (kept in refs — never triggers a re-render mid-drag) ─────────
type ClipDrag = {
  kind: 'move' | 'trim-in' | 'trim-out';
  id: string;
  startX: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  sourceDuration: number;
  isStill: boolean;
  targets: number[];
  pending: { startTime: number; inPoint: number; outPoint: number };
};

type TransDrag = {
  kind: 'move' | 'resize-start' | 'resize-end';
  id: string;
  startX: number;
  startTime: number;
  duration: number;
  targets: number[];
  pending: { startTime: number; duration: number };
};

function snapWithTarget(
  value: number,
  targets: number[],
  pxPerSec: number,
): { value: number; target: number | null } {
  const thresh = SNAP_PX / pxPerSec;
  let best = value;
  let bestD = thresh;
  let target: number | null = null;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d < bestD) {
      bestD = d;
      best = t;
      target = t;
    }
  }
  return { value: best, target };
}

// ── Clip item (memoized so unrelated timeline changes skip its render) ──────
interface ClipItemProps {
  clip: VideoClip;
  pxPerSec: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, clip: VideoClip, kind: ClipDrag['kind']) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onRemove: (id: string) => void;
  registerEl: (id: string, el: HTMLDivElement | null) => void;
}

const ClipItem = memo(function ClipItem({
  clip,
  pxPerSec,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onRemove,
  registerEl,
}: ClipItemProps) {
  const left = clip.startTime * pxPerSec;
  const width = Math.max(28, clipPlayableDuration(clip) * pxPerSec);
  return (
    <div
      ref={el => registerEl(clip.id, el)}
      className={`vtl-clip${selected ? ' vtl-clip--selected' : ''}`}
      style={{
        left,
        width,
        backgroundImage: clip.thumbnail ? `url(${clip.thumbnail})` : undefined,
      }}
      onPointerDown={e => onPointerDown(e, clip, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="vtl-clip-fade" />
      <span className="vtl-clip-name">{clip.fileName}</span>
      <button
        type="button"
        className="vtl-remove-btn"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          onRemove(clip.id);
        }}
        aria-label="Clip entfernen"
      >
        <IconX />
      </button>
      {/* Both videos and stills are timed by dragging the edges. */}
      <div
        className="vtl-trim-handle vtl-trim-handle--in"
        onPointerDown={e => onPointerDown(e, clip, 'trim-in')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className="vtl-trim-handle vtl-trim-handle--out"
        onPointerDown={e => onPointerDown(e, clip, 'trim-out')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
});

// ── Transition block (memoized) ──────────────────────────────────────────────
interface TransItemProps {
  t: TimelineTransition;
  pxPerSec: number;
  open: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, t: TimelineTransition, kind: TransDrag['kind']) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onToggleOpen: (id: string) => void;
  onUpdateTransition: (id: string, patch: Partial<TimelineTransition>) => void;
  onRemoveTransition: (id: string) => void;
  registerEl: (id: string, el: HTMLDivElement | null) => void;
}

const TransItem = memo(function TransItem({
  t,
  pxPerSec,
  open,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onToggleOpen,
  onUpdateTransition,
  onRemoveTransition,
  registerEl,
}: TransItemProps) {
  const left = t.startTime * pxPerSec;
  const width = Math.max(16, t.duration * pxPerSec);
  return (
    <div
      ref={el => registerEl(t.id, el)}
      className={`vtl-trans-block vtl-trans-block--${t.type}${open ? ' vtl-trans-block--open' : ''}`}
      style={{ left, width }}
      onPointerDown={e => onPointerDown(e, t, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={e => {
        e.stopPropagation();
        onToggleOpen(t.id);
      }}
    >
      <span className="vtl-trans-glyph">
        <TransitionIcon t={t} />
      </span>
      <div
        className="vtl-trim-handle vtl-trim-handle--in"
        onPointerDown={e => onPointerDown(e, t, 'resize-start')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className="vtl-trim-handle vtl-trim-handle--out"
        onPointerDown={e => onPointerDown(e, t, 'resize-end')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {open && (
        <div className="vtl-trans-popover" onPointerDown={e => e.stopPropagation()}>
          <div className="control-group">
            <div className="control-label-row">
              <span className="control-label">Dauer</span>
              <span className="control-value">{t.duration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0.1}
              max={3}
              step={0.1}
              value={t.duration}
              onChange={e => onUpdateTransition(t.id, { duration: Number(e.target.value) })}
            />
          </div>
          {t.type === 'dip-to-color' && (
            <div className="toggle-group">
              {(['#000000', '#ffffff'] as const).map(c => (
                <button
                  key={c}
                  type="button"
                  className={`toggle-btn${(t.color ?? '#000000') === c ? ' active' : ''}`}
                  onClick={() => onUpdateTransition(t.id, { color: c })}
                >
                  {c === '#000000' ? 'Schwarz' : 'Weiß'}
                </button>
              ))}
            </div>
          )}
          {t.type === 'wipe' && (
            <div className="toggle-group">
              {WIPE_DIRECTIONS.map(({ dir, label }) => (
                <button
                  key={dir}
                  type="button"
                  className={`toggle-btn vtl-dir-btn${t.direction === dir ? ' active' : ''}`}
                  onClick={() => onUpdateTransition(t.id, { direction: dir })}
                  aria-label={label}
                  title={label}
                >
                  <IconArrow deg={WIPE_DEG[dir]} />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="vtl-transition-clear"
            onClick={() => {
              onRemoveTransition(t.id);
              onToggleOpen(t.id);
            }}
          >
            Übergang entfernen
          </button>
        </div>
      )}
    </div>
  );
});

export default function VideoTimeline({
  timeline,
  currentTime,
  duration,
  selectedClipId,
  currentTimeRef,
  onSeek,
  onSelectClip,
  onSetClipStart,
  onTrimClip,
  onRemoveClip,
  onAddTransition,
  onUpdateTransition,
  onRemoveTransition,
  onPlayPause,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const transLaneRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const snapGuideRef = useRef<HTMLDivElement>(null);
  const clipDrag = useRef<ClipDrag | null>(null);
  const transDrag = useRef<TransDrag | null>(null);
  const clipElsRef = useRef(new Map<string, HTMLDivElement>());
  const transElsRef = useRef(new Map<string, HTMLDivElement>());
  const zoomAnchorRef = useRef<{ time: number; cursorX: number } | null>(null);

  const [draggingKind, setDraggingKind] = useState<ChipKind | null>(null);
  const [openTransId, setOpenTransId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);

  // Refs mirroring the latest render's values, read from event handlers /
  // rAF loops that must not be recreated on every state change.
  const pxPerSecRef = useRef(pxPerSec);
  pxPerSecRef.current = pxPerSec;
  const currentTimeFallbackRef = useRef(currentTime);
  currentTimeFallbackRef.current = currentTime;
  const selectedClipIdRef = useRef(selectedClipId);
  selectedClipIdRef.current = selectedClipId;
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const currentTimeForSnapRef = useRef(currentTime);
  currentTimeForSnapRef.current = currentTime;

  const contentWidth = Math.max(320, duration * pxPerSec + 40);

  // Close transition popover on outside click.
  useEffect(() => {
    if (openTransId === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.vtl-trans-popover')) setOpenTransId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openTransId]);

  // ── Playhead: rAF loop reading the un-throttled ref, zero re-renders ──────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadRef.current;
      if (el) {
        const t = currentTimeRef?.current ?? currentTimeFallbackRef.current;
        el.style.transform = `translateX(${t * pxPerSecRef.current}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally empty deps: all inputs are read via refs so this loop is
    // started once on mount and keeps running at 60fps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Zoom: cmd/ctrl+wheel, anchored at the cursor's time position ─────────
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel = default horizontal scroll
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const time = (cursorX + el!.scrollLeft) / pxPerSecRef.current;
      const factor = Math.pow(1.0015, -e.deltaY);
      const next = clamp(pxPerSecRef.current * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
      zoomAnchorRef.current = { time, cursorX };
      setPxPerSec(next);
    }
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = scrollRef.current;
    if (anchor && el) {
      el.scrollLeft = Math.max(0, anchor.time * pxPerSec - anchor.cursorX);
      zoomAnchorRef.current = null;
    }
  }, [pxPerSec]);

  const zoomBy = useCallback((factor: number) => {
    setPxPerSec(p => clamp(p * factor, MIN_PX_PER_SEC, MAX_PX_PER_SEC));
  }, []);

  const zoomFit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || duration <= 0) return;
    const avail = el.clientWidth - 40;
    if (avail <= 0) return;
    setPxPerSec(clamp(avail / duration, MIN_PX_PER_SEC, MAX_PX_PER_SEC));
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    });
  }, [duration]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    function isTypingTarget(el: Element | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      if (e.code === 'Space') {
        if (onPlayPause) {
          e.preventDefault();
          onPlayPause();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = selectedClipIdRef.current;
        if (id) {
          e.preventDefault();
          onRemoveClip(id);
        }
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const id = selectedClipIdRef.current;
        if (!id) return;
        const clip = timelineRef.current.clips.find(c => c.id === id);
        if (!clip) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        onSetClipStart(id, Math.max(0, clip.startTime + dir * step));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPlayPause, onRemoveClip, onSetClipStart]);

  // ── Element registries (for direct-DOM drag writes) ───────────────────────
  const registerClipEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) clipElsRef.current.set(id, el);
    else clipElsRef.current.delete(id);
  }, []);
  const registerTransEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) transElsRef.current.set(id, el);
    else transElsRef.current.delete(id);
  }, []);

  // ── Ruler seek ───────────────────────────────────────────────
  const seekFromX = useCallback(
    (clientX: number) => {
      const el = rulerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, clientX - rect.left);
      onSeek(Math.max(0, Math.min(duration, x / pxPerSecRef.current)));
    },
    [duration, onSeek],
  );

  // ── Magnet snapping ──────────────────────────────────────────
  /** Snap targets: 0, the playhead, and every OTHER clip's start + end. */
  const buildTargets = useCallback(
    (excludeId: string | null): number[] => {
      const ts: number[] = [0, currentTimeForSnapRef.current];
      for (const c of timelineRef.current.clips) {
        if (c.id === excludeId) continue;
        ts.push(c.startTime, c.startTime + clipPlayableDuration(c));
      }
      return ts;
    },
    [],
  );

  const setSnapGuide = useCallback((t: number | null) => {
    const el = snapGuideRef.current;
    if (!el) return;
    if (t === null) {
      el.style.opacity = '0';
    } else {
      el.style.left = `${t * pxPerSecRef.current}px`;
      el.style.opacity = '0.4';
    }
  }, []);

  // ── Clip drag (move / trim) ──────────────────────────────────
  const onClipPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, clip: VideoClip, kind: ClipDrag['kind']) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      clipDrag.current = {
        kind,
        id: clip.id,
        startX: e.clientX,
        startTime: clip.startTime,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        sourceDuration: clip.duration,
        isStill: clip.type === 'still',
        targets: buildTargets(clip.id),
        pending: { startTime: clip.startTime, inPoint: clip.inPoint, outPoint: clip.outPoint },
      };
      clipElsRef.current.get(clip.id)?.classList.add('vtl-dragging');
      if (kind === 'move') onSelectClip(clip.id);
    },
    [buildTargets, onSelectClip],
  );

  const onClipPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = clipDrag.current;
    if (!d) return;
    const pxPerSecNow = pxPerSecRef.current;
    const dx = (e.clientX - d.startX) / pxPerSecNow;
    // Stills have no source cap; videos are bounded by their source length.
    const maxOut = d.isStill ? 600 : d.sourceDuration;
    const el = clipElsRef.current.get(d.id);
    let snappedTarget: number | null = null;

    if (d.kind === 'move') {
      const playable = d.outPoint - d.inPoint;
      let start = Math.max(0, d.startTime + dx);
      // Snap whichever edge (start or end) is closest to a target.
      const rStart = snapWithTarget(start, d.targets, pxPerSecNow);
      const rEnd = snapWithTarget(start + playable, d.targets, pxPerSecNow);
      if (Math.abs(rStart.value - start) <= Math.abs(rEnd.value - playable - start)) {
        start = rStart.value;
        snappedTarget = rStart.target;
      } else {
        start = rEnd.value - playable;
        snappedTarget = rEnd.target;
      }
      start = Math.max(0, start);
      d.pending = { startTime: start, inPoint: d.inPoint, outPoint: d.outPoint };
      if (el) el.style.left = `${start * pxPerSecNow}px`;
    } else if (d.kind === 'trim-in') {
      let newIn = Math.max(0, Math.min(d.outPoint - MIN_TRIM_SPAN, d.inPoint + dx));
      let newStart = Math.max(0, d.startTime + (newIn - d.inPoint));
      const r = snapWithTarget(newStart, d.targets, pxPerSecNow);
      const delta = r.value - newStart;
      if (delta !== 0) snappedTarget = r.target;
      newIn = Math.max(0, Math.min(d.outPoint - MIN_TRIM_SPAN, newIn + delta));
      newStart = Math.max(0, d.startTime + (newIn - d.inPoint));
      d.pending = { startTime: newStart, inPoint: newIn, outPoint: d.outPoint };
      if (el) {
        el.style.left = `${newStart * pxPerSecNow}px`;
        el.style.width = `${Math.max(28, (d.outPoint - newIn) * pxPerSecNow)}px`;
      }
    } else {
      let newOut = Math.max(d.inPoint + MIN_TRIM_SPAN, Math.min(maxOut, d.outPoint + dx));
      const end = d.startTime + (newOut - d.inPoint);
      const r = snapWithTarget(end, d.targets, pxPerSecNow);
      const snapDelta = r.value - end;
      if (snapDelta !== 0) snappedTarget = r.target;
      newOut = Math.max(d.inPoint + MIN_TRIM_SPAN, Math.min(maxOut, newOut + snapDelta));
      d.pending = { startTime: d.startTime, inPoint: d.inPoint, outPoint: newOut };
      if (el) el.style.width = `${Math.max(28, (newOut - d.inPoint) * pxPerSecNow)}px`;
    }
    setSnapGuide(snappedTarget);
  }, [setSnapGuide]);

  const onClipPointerUp = useCallback(() => {
    const d = clipDrag.current;
    if (!d) return;
    clipElsRef.current.get(d.id)?.classList.remove('vtl-dragging');
    const changed =
      d.pending.startTime !== d.startTime || d.pending.inPoint !== d.inPoint || d.pending.outPoint !== d.outPoint;
    if (changed) {
      if (d.kind === 'move') onSetClipStart(d.id, d.pending.startTime);
      else onTrimClip(d.id, d.pending.inPoint, d.pending.outPoint, d.pending.startTime);
    }
    clipDrag.current = null;
    setSnapGuide(null);
  }, [onSetClipStart, onTrimClip, setSnapGuide]);

  // ── Transition block drag ────────────────────────────────────
  const onTransPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, t: TimelineTransition, kind: TransDrag['kind']) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      transDrag.current = {
        kind,
        id: t.id,
        startX: e.clientX,
        startTime: t.startTime,
        duration: t.duration,
        targets: buildTargets(null),
        pending: { startTime: t.startTime, duration: t.duration },
      };
      transElsRef.current.get(t.id)?.classList.add('vtl-dragging');
    },
    [buildTargets],
  );

  const onTransPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = transDrag.current;
    if (!d) return;
    const pxPerSecNow = pxPerSecRef.current;
    const dx = (e.clientX - d.startX) / pxPerSecNow;
    const el = transElsRef.current.get(d.id);
    let snappedTarget: number | null = null;

    if (d.kind === 'move') {
      let start = Math.max(0, d.startTime + dx);
      const rStart = snapWithTarget(start, d.targets, pxPerSecNow);
      const rEnd = snapWithTarget(start + d.duration, d.targets, pxPerSecNow);
      if (Math.abs(rStart.value - start) <= Math.abs(rEnd.value - d.duration - start)) {
        start = rStart.value;
        snappedTarget = rStart.target;
      } else {
        start = rEnd.value - d.duration;
        snappedTarget = rEnd.target;
      }
      start = Math.max(0, start);
      d.pending = { startTime: start, duration: d.duration };
      if (el) el.style.left = `${start * pxPerSecNow}px`;
    } else if (d.kind === 'resize-start') {
      const end = d.startTime + d.duration;
      const raw = d.startTime + dx;
      const r = snapWithTarget(raw, d.targets, pxPerSecNow);
      if (r.value !== raw) snappedTarget = r.target;
      const newStart = Math.max(0, Math.min(end - MIN_TRANS_DUR, r.value));
      d.pending = { startTime: newStart, duration: end - newStart };
      if (el) {
        el.style.left = `${newStart * pxPerSecNow}px`;
        el.style.width = `${Math.max(16, (end - newStart) * pxPerSecNow)}px`;
      }
    } else {
      const raw = d.startTime + d.duration + dx;
      const r = snapWithTarget(raw, d.targets, pxPerSecNow);
      if (r.value !== raw) snappedTarget = r.target;
      const newDuration = Math.max(MIN_TRANS_DUR, r.value - d.startTime);
      d.pending = { startTime: d.startTime, duration: newDuration };
      if (el) el.style.width = `${Math.max(16, newDuration * pxPerSecNow)}px`;
    }
    setSnapGuide(snappedTarget);
  }, [setSnapGuide]);

  const onTransPointerUp = useCallback(() => {
    const d = transDrag.current;
    if (!d) return;
    transElsRef.current.get(d.id)?.classList.remove('vtl-dragging');
    const changed = d.pending.startTime !== d.startTime || d.pending.duration !== d.duration;
    if (changed) onUpdateTransition(d.id, d.pending);
    transDrag.current = null;
    setSnapGuide(null);
  }, [onUpdateTransition, setSnapGuide]);

  const handleToggleOpen = useCallback((id: string) => {
    setOpenTransId(cur => (cur === id ? null : id));
  }, []);

  // ── Palette chip drop → new transition ───────────────────────
  function onChipDragStart(e: React.DragEvent, kind: ChipKind) {
    e.dataTransfer.setData(DND_MIME, kind);
    e.dataTransfer.setData('text/plain', kind);
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingKind(kind);
  }

  function onTransLaneDrop(e: React.DragEvent) {
    e.preventDefault();
    const raw = (e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData('text/plain') || draggingKind) as ChipKind | '';
    setDraggingKind(null);
    if (!raw) return;
    const lane = transLaneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const dropSec = Math.max(0, (e.clientX - rect.left) / pxPerSecRef.current);

    const base = chipToTransitionBase(raw);
    const block: TimelineTransition = {
      id: crypto.randomUUID(),
      startTime: dropSec,
      duration: 0.5,
      ...base,
    };

    // crossfade/wipe: bind the surrounding clips (from = latest starting ≤ drop, to = next).
    if (base.type === 'crossfade' || base.type === 'wipe') {
      const sorted = [...timeline.clips].sort((a, b) => a.startTime - b.startTime);
      let fromClip: VideoClip | undefined;
      let toClip: VideoClip | undefined;
      for (const c of sorted) {
        if (c.startTime <= dropSec) fromClip = c;
        else {
          toClip = c;
          break;
        }
      }
      block.fromClipId = fromClip?.id;
      block.toClipId = toClip?.id ?? fromClip?.id;
    }
    onAddTransition(block);
  }

  const dragging = draggingKind !== null;

  const { ticks, majorStep } = useMemo(() => {
    const majorStepPx = pickMajorStep(pxPerSec);
    const minorStep = majorStepPx / 5;
    const showMinor = minorStep * pxPerSec >= 8;
    const step = showMinor ? minorStep : majorStepPx;
    const totalSeconds = contentWidth / pxPerSec;
    const count = Math.ceil(totalSeconds / step);
    const out: { t: number; major: boolean }[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i * step;
      const isMajor = Math.abs(t / majorStepPx - Math.round(t / majorStepPx)) < 1e-6;
      out.push({ t, major: isMajor });
    }
    return { ticks: out, majorStep: majorStepPx };
  }, [pxPerSec, contentWidth]);

  return (
    <div className="vtl-root">
      {/* Effect palette */}
      <div className="vtl-palette">
        <span className="vtl-palette-label">Übergänge</span>
        {CHIPS.map(chip => (
          <div
            key={chip.kind}
            className={`vtl-chip vtl-chip--${chip.kind}`}
            draggable
            onDragStart={e => onChipDragStart(e, chip.kind)}
            onDragEnd={() => setDraggingKind(null)}
            title={`${chip.label} — auf die Übergangsspur ziehen`}
          >
            <span className="vtl-chip-icon">
              <ChipIcon kind={chip.kind} />
            </span>
            <span className="vtl-chip-label">{chip.label}</span>
          </div>
        ))}
        <div className="vtl-zoom-controls">
          <button type="button" className="vtl-zoom-btn" onClick={() => zoomBy(1 / 1.4)} aria-label="Verkleinern">
            <IconMinus />
          </button>
          <button type="button" className="vtl-zoom-btn" onClick={zoomFit} aria-label="Einpassen">
            <IconMaximize />
          </button>
          <button type="button" className="vtl-zoom-btn" onClick={() => zoomBy(1.4)} aria-label="Vergrößern">
            <IconPlus />
          </button>
        </div>
      </div>

      <div className="vtl-scroll" ref={scrollRef}>
        <div className="vtl-content" style={{ width: contentWidth }}>
          {/* Ruler */}
          <div
            className="vtl-ruler"
            ref={rulerRef}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromX(e.clientX);
            }}
            onPointerMove={e => {
              if (e.buttons === 1) seekFromX(e.clientX);
            }}
          >
            {ticks.map(({ t, major }) => (
              <div
                key={t}
                className={`vtl-tick${major ? ' vtl-tick--major' : ''}`}
                style={{ left: t * pxPerSec }}
              >
                {major && <span className="vtl-tick-label">{formatTick(t, majorStep)}</span>}
              </div>
            ))}
          </div>

          {/* Clip lane */}
          <div className="vtl-clip-lane" onPointerDown={() => onSelectClip(null)}>
            {timeline.clips.map(clip => (
              <ClipItem
                key={clip.id}
                clip={clip}
                pxPerSec={pxPerSec}
                selected={clip.id === selectedClipId}
                onPointerDown={onClipPointerDown}
                onPointerMove={onClipPointerMove}
                onPointerUp={onClipPointerUp}
                onRemove={onRemoveClip}
                registerEl={registerClipEl}
              />
            ))}
          </div>

          {/* Transition lane */}
          <div
            className={`vtl-trans-lane${dragging ? ' vtl-trans-lane--droppable' : ''}`}
            ref={transLaneRef}
            onDragOver={e => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={onTransLaneDrop}
          >
            {timeline.transitions.length === 0 && (
              <span className="vtl-trans-hint">Übergänge hierher ziehen</span>
            )}
            {timeline.transitions.map(t => (
              <TransItem
                key={t.id}
                t={t}
                pxPerSec={pxPerSec}
                open={openTransId === t.id}
                onPointerDown={onTransPointerDown}
                onPointerMove={onTransPointerMove}
                onPointerUp={onTransPointerUp}
                onToggleOpen={handleToggleOpen}
                onUpdateTransition={onUpdateTransition}
                onRemoveTransition={onRemoveTransition}
                registerEl={registerTransEl}
              />
            ))}
          </div>

          <div className="vtl-snap-guide" ref={snapGuideRef} />
          <div className="vtl-playhead" ref={playheadRef}>
            <div className="vtl-playhead-cap" />
          </div>
        </div>
      </div>
    </div>
  );
}
