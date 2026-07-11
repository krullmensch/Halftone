import { useEffect, useRef } from 'react';

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onStepClip: (dir: 1 | -1) => void;
  /** Un-throttled current-time ref (App's videoTimeRef), read every animation
   *  frame to drive the time label at 60fps without re-renders. */
  currentTimeRef?: React.RefObject<number>;
}

function formatTime(t: number): string {
  const clamped = Math.max(0, t);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  const secStr = seconds.toFixed(1).padStart(4, '0');
  return `${minutes}:${secStr}`;
}

export default function VideoPlaybackControls({
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onStepClip,
  currentTimeRef,
}: Props) {
  const timeRef = useRef<HTMLSpanElement>(null);
  const currentTimeFallbackRef = useRef(currentTime);
  currentTimeFallbackRef.current = currentTime;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  // Drive the time label straight from the un-throttled ref every animation
  // frame — no React state, no re-render per tick.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = currentTimeRef?.current ?? currentTimeFallbackRef.current;
      if (timeRef.current) {
        timeRef.current.textContent = `${formatTime(t)} / ${formatTime(durationRef.current)}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vpc-row">
      <span className="vpc-time" ref={timeRef}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <div className="vpc-controls">
        <button
          type="button"
          className="vpc-step-btn"
          onClick={() => onStepClip(-1)}
          aria-label="Vorheriger Clip"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 5h2v14H6zM19 5v14l-10-7z" />
          </svg>
        </button>

        <button
          type="button"
          className="vpc-play-btn"
          onClick={onPlayPause}
          aria-label={isPlaying ? 'Pause' : 'Abspielen'}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4v16" />
              <path d="M17 4v16" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 4l14 8-14 8V4z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="vpc-step-btn"
          onClick={() => onStepClip(1)}
          aria-label="Nächster Clip"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16 5h2v14h-2zM5 5v14l10-7z" />
          </svg>
        </button>
      </div>

      <span className="vpc-time-spacer" aria-hidden="true" />
    </div>
  );
}
