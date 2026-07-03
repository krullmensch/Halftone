import { useEffect, useRef, useState } from 'react';
import type { ClipTransition, TransitionType, VideoTimelineData, WipeDirection } from '../types';

interface Props {
  timeline: VideoTimelineData;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
  onReorder: (from: number, to: number) => void;
  onTrim: (clipId: string, inPoint: number, outPoint: number) => void;
  onRemoveClip: (clipId: string) => void;
  onSetTransition: (index: number, def: ClipTransition) => void;
  onSetStillDuration: (clipId: string, seconds: number) => void;
}

const MIN_CLIP_WIDTH = 56;
const PX_PER_SEC = 40;
const MIN_TRIM_SPAN = 0.2;

function clipWidth(clip: VideoTimelineData['clips'][number]) {
  const span = Math.max(0, clip.outPoint - clip.inPoint);
  return Math.max(MIN_CLIP_WIDTH, span * PX_PER_SEC);
}

const TRANSITION_TYPES: { type: TransitionType; label: string }[] = [
  { type: 'none', label: 'Ohne' },
  { type: 'crossfade', label: 'Blende' },
  { type: 'dip-to-color', label: 'Farbe' },
  { type: 'wipe', label: 'Wisch' },
];

const WIPE_DIRECTIONS: { dir: WipeDirection; label: string }[] = [
  { dir: 'left', label: '←' },
  { dir: 'right', label: '→' },
  { dir: 'up', label: '↑' },
  { dir: 'down', label: '↓' },
];

/** Inline editor for a still clip's display duration. Hoisted to module scope
 *  so parent re-renders (e.g. playhead updates) don't remount the input. */
function StillDurationEditor({
  clipId,
  duration,
  editing,
  onStartEdit,
  onCommit,
  onCancelEdit,
}: {
  clipId: string;
  duration: number;
  editing: boolean;
  onStartEdit: (clipId: string) => void;
  onCommit: (clipId: string, seconds: number) => void;
  onCancelEdit: () => void;
}) {
  const [value, setValue] = useState(duration.toFixed(1));

  // Re-sync the draft when the editor opens
  useEffect(() => {
    if (editing) setValue(duration.toFixed(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="vtl-still-duration"
        onClick={e => {
          e.stopPropagation();
          onStartEdit(clipId);
        }}
      >
        {duration.toFixed(1)}s
      </button>
    );
  }

  function commit() {
    const num = Math.max(0.5, Math.min(60, Number(value) || duration));
    onCommit(clipId, num);
  }

  return (
    <input
      type="number"
      className="vtl-still-duration-input"
      min={0.5}
      max={60}
      step={0.1}
      autoFocus
      value={value}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancelEdit();
      }}
    />
  );
}

export default function VideoTimeline({
  timeline,
  currentTime,
  duration,
  onSeek,
  onReorder,
  onTrim,
  onRemoveClip,
  onSetTransition,
  onSetStillDuration,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [dragReorder, setDragReorder] = useState<{ index: number; targetIndex: number } | null>(null);
  const reorderStart = useRef<{ px: number; index: number } | null>(null);

  const [editingStillId, setEditingStillId] = useState<string | null>(null);
  const [openTransitionIndex, setOpenTransitionIndex] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const stripWidth = timeline.clips.reduce((acc, c) => acc + clipWidth(c), 0);

  // Close transition popover on outside click
  useEffect(() => {
    if (openTransitionIndex === null) return;
    function handler(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenTransitionIndex(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openTransitionIndex]);

  // ── Ruler seek/drag ──────────────────────────────────────────
  function timeFromClientX(clientX: number): number {
    const strip = stripRef.current;
    if (!strip) return 0;
    const rect = strip.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    return ratio * duration;
  }

  function onRulerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(timeFromClientX(e.clientX));
  }

  function onRulerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.buttons !== 1) return;
    onSeek(timeFromClientX(e.clientX));
  }

  // ── Trim handles ─────────────────────────────────────────────
  const trimStart = useRef<{
    clipId: string;
    edge: 'in' | 'out';
    px: number;
    inPoint: number;
    outPoint: number;
    sourceDuration: number;
  } | null>(null);

  function onTrimPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    clipId: string,
    edge: 'in' | 'out',
    inPoint: number,
    outPoint: number,
    sourceDuration: number,
  ) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    trimStart.current = { clipId, edge, px: e.clientX, inPoint, outPoint, sourceDuration };
  }

  function onTrimPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const st = trimStart.current;
    if (!st) return;
    const dxSec = (e.clientX - st.px) / PX_PER_SEC;
    if (st.edge === 'in') {
      const newIn = Math.max(0, Math.min(st.outPoint - MIN_TRIM_SPAN, st.inPoint + dxSec));
      onTrim(st.clipId, newIn, st.outPoint);
    } else {
      const newOut = Math.max(st.inPoint + MIN_TRIM_SPAN, Math.min(st.sourceDuration, st.outPoint + dxSec));
      onTrim(st.clipId, st.inPoint, newOut);
    }
  }

  function onTrimPointerUp() {
    trimStart.current = null;
  }

  // ── Reorder drag ─────────────────────────────────────────────
  function computeTargetIndex(clientX: number, draggedIndex: number): number {
    const strip = stripRef.current;
    if (!strip) return draggedIndex;
    for (let i = 0; i < timeline.clips.length; i++) {
      const el = blockRefs.current.get(timeline.clips[i].id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) return i;
      }
    }
    return timeline.clips.length - 1;
  }

  function onClipBodyPointerDown(e: React.PointerEvent<HTMLDivElement>, index: number) {
    // Ignore drags starting on trim handles / remove button / duration editor
    const target = e.target as HTMLElement;
    if (target.closest('.vtl-trim-handle') || target.closest('.vtl-remove-btn') || target.closest('.vtl-still-duration')) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    reorderStart.current = { px: e.clientX, index };
    setDragReorder({ index, targetIndex: index });
  }

  function onClipBodyPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!reorderStart.current) return;
    const target = computeTargetIndex(e.clientX, reorderStart.current.index);
    setDragReorder({ index: reorderStart.current.index, targetIndex: target });
  }

  function onClipBodyPointerUp() {
    if (reorderStart.current && dragReorder) {
      const { index, targetIndex } = dragReorder;
      if (targetIndex !== index) onReorder(index, targetIndex);
    }
    reorderStart.current = null;
    setDragReorder(null);
  }

  function handleStillCommit(clipId: string, seconds: number) {
    onSetStillDuration(clipId, seconds);
    setEditingStillId(null);
  }

  function TransitionPopover({ index, transition }: { index: number; transition: ClipTransition }) {
    return (
      <div className="vtl-transition-popover" ref={popoverRef}>
        <div className="toggle-group">
          {TRANSITION_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              className={`toggle-btn${transition.type === type ? ' active' : ''}`}
              onClick={() => onSetTransition(index, { ...transition, type })}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="control-group">
          <div className="control-label-row">
            <span className="control-label">Dauer</span>
            <span className="control-value">{transition.duration.toFixed(1)}s</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0.1}
            max={3}
            step={0.1}
            value={transition.duration}
            onChange={e => onSetTransition(index, { ...transition, duration: Number(e.target.value) })}
          />
        </div>

        {transition.type === 'dip-to-color' && (
          <div className="color-row">
            <label className="control-label color-label">Farbe</label>
            <input
              type="color"
              className="color-input"
              value={transition.color ?? '#000000'}
              onChange={e => onSetTransition(index, { ...transition, color: e.target.value })}
            />
          </div>
        )}

        {transition.type === 'wipe' && (
          <div className="toggle-group">
            {WIPE_DIRECTIONS.map(({ dir, label }) => (
              <button
                key={dir}
                type="button"
                className={`toggle-btn${transition.direction === dir ? ' active' : ''}`}
                onClick={() => onSetTransition(index, { ...transition, direction: dir })}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const playheadRatio = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="vtl-root">
      <div
        className="vtl-ruler"
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
        style={{ width: stripWidth > 0 ? stripWidth : '100%' }}
      >
        <div className="vtl-playhead" style={{ left: `${playheadRatio * 100}%` }} />
      </div>

      <div className="vtl-strip" ref={stripRef}>
        {timeline.clips.map((clip, index) => {
          const isStill = clip.type === 'still';
          const width = clipWidth(clip);
          const dropBefore =
            dragReorder && dragReorder.targetIndex === index && dragReorder.index !== index && dragReorder.targetIndex <= dragReorder.index;
          const dropAfter =
            dragReorder &&
            dragReorder.targetIndex === index &&
            dragReorder.index !== index &&
            dragReorder.targetIndex > dragReorder.index;

          return (
            <div className="vtl-clip-wrap" key={clip.id}>
              {dropBefore && <div className="vtl-drop-indicator" />}
              <div
                className="vtl-clip"
                ref={el => {
                  if (el) blockRefs.current.set(clip.id, el);
                  else blockRefs.current.delete(clip.id);
                }}
                style={{
                  width,
                  backgroundImage: clip.thumbnail ? `url(${clip.thumbnail})` : undefined,
                }}
                onPointerDown={e => onClipBodyPointerDown(e, index)}
                onPointerMove={onClipBodyPointerMove}
                onPointerUp={onClipBodyPointerUp}
                onPointerCancel={onClipBodyPointerUp}
              >
                <span className="vtl-clip-name">{clip.fileName}</span>

                <button
                  type="button"
                  className="vtl-remove-btn"
                  onClick={e => {
                    e.stopPropagation();
                    onRemoveClip(clip.id);
                  }}
                  aria-label="Clip entfernen"
                >
                  ×
                </button>

                {isStill ? (
                  <StillDurationEditor
                    clipId={clip.id}
                    duration={clip.duration}
                    editing={editingStillId === clip.id}
                    onStartEdit={setEditingStillId}
                    onCommit={handleStillCommit}
                    onCancelEdit={() => setEditingStillId(null)}
                  />
                ) : (
                  <>
                    <div
                      className="vtl-trim-handle vtl-trim-handle--in"
                      onPointerDown={e => onTrimPointerDown(e, clip.id, 'in', clip.inPoint, clip.outPoint, clip.duration)}
                      onPointerMove={onTrimPointerMove}
                      onPointerUp={onTrimPointerUp}
                      onPointerCancel={onTrimPointerUp}
                    />
                    <div
                      className="vtl-trim-handle vtl-trim-handle--out"
                      onPointerDown={e => onTrimPointerDown(e, clip.id, 'out', clip.inPoint, clip.outPoint, clip.duration)}
                      onPointerMove={onTrimPointerMove}
                      onPointerUp={onTrimPointerUp}
                      onPointerCancel={onTrimPointerUp}
                    />
                  </>
                )}
              </div>
              {dropAfter && <div className="vtl-drop-indicator" />}

              {index < timeline.clips.length - 1 && (
                <div className="vtl-transition-slot">
                  <button
                    type="button"
                    className={`vtl-transition-btn${timeline.transitions[index]?.type !== 'none' ? ' vtl-transition-btn--active' : ''}`}
                    onClick={() => setOpenTransitionIndex(openTransitionIndex === index ? null : index)}
                    aria-label="Übergang bearbeiten"
                  >
                    ⧉
                  </button>
                  {openTransitionIndex === index && timeline.transitions[index] && (
                    <TransitionPopover index={index} transition={timeline.transitions[index]} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
