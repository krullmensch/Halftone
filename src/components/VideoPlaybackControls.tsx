interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
}

function formatTime(t: number): string {
  const clamped = Math.max(0, t);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  const secStr = seconds.toFixed(1).padStart(4, '0');
  return `${minutes}:${secStr}`;
}

export default function VideoPlaybackControls({ isPlaying, currentTime, duration, onPlayPause, onSeek }: Props) {
  return (
    <div className="vpc-row">
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

      <span className="vpc-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <input
        type="range"
        className="slider vpc-seek"
        min={0}
        max={duration}
        step={0.01}
        value={currentTime}
        onChange={e => onSeek(Number(e.target.value))}
      />
    </div>
  );
}
