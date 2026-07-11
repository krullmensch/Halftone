import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Player } from '@remotion/player';
import type { PlayerRef } from '@remotion/player';
import type { VideoTimelineData } from '../types';
import { timelineDuration } from '../video/timeline';
import TimelineComposition, { TIMELINE_FPS, previewCanvasSize } from '../video/remotion/TimelineComposition';

export interface RemotionPreviewHandle {
  play(): void;
  pause(): void;
  seekTo(t: number): void;
  readonly isPlaying: boolean;
}

interface Props {
  timeline: VideoTimelineData;
  /** Pushed every rendered frame with the composited canvas. */
  onFrame: (canvas: HTMLCanvasElement, w: number, h: number) => void;
  onTime: (t: number) => void;
  onEnded: () => void;
}

/**
 * Mounts a Remotion <Player> that drives frame-synced <video> playback for
 * the timeline; the Player's own DOM output is hidden — TimelineComposition
 * composites each frame to an offscreen canvas and hands it to the halftone
 * sketch via onFrame, which is the actual visible output.
 *
 * Exposes an imperative play/pause/seekTo/isPlaying handle mirroring the
 * old EtroPlaybackController's interface, but synchronous: Remotion's
 * Player is already mounted whenever this component renders (no async
 * engine build step needed — timeline edits are just prop updates).
 */
const RemotionPreview = forwardRef<RemotionPreviewHandle, Props>(function RemotionPreview(
  { timeline, onFrame, onTime, onEnded },
  ref,
) {
  const playerRef = useRef<PlayerRef>(null);
  const playingRef = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        playerRef.current?.play();
      },
      pause: () => {
        playerRef.current?.pause();
      },
      seekTo: (t: number) => {
        playerRef.current?.seekTo(Math.max(0, Math.round(t * TIMELINE_FPS)));
      },
      get isPlaying() {
        return playingRef.current;
      },
    }),
    [],
  );

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const handleFrameUpdate = (e: { detail: { frame: number } }) => {
      onTime(e.detail.frame / TIMELINE_FPS);
    };
    const handlePlay = () => {
      playingRef.current = true;
    };
    const handlePause = () => {
      playingRef.current = false;
    };
    const handleEnded = () => {
      playingRef.current = false;
      onEnded();
    };
    player.addEventListener('frameupdate', handleFrameUpdate);
    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);
    return () => {
      player.removeEventListener('frameupdate', handleFrameUpdate);
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
    };
  }, [onTime, onEnded]);

  const durationInFrames = Math.max(1, Math.ceil(timelineDuration(timeline) * TIMELINE_FPS));
  const size = useMemo(
    () => previewCanvasSize(timeline),
    [timeline.aspect.w, timeline.aspect.h],
  );
  const inputProps = useMemo(() => ({ timeline, onFrame }), [timeline, onFrame]);

  if (timeline.clips.length === 0) return null;

  return (
    <Player
      ref={playerRef}
      component={TimelineComposition}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={size.w}
      compositionHeight={size.h}
      fps={TIMELINE_FPS}
      controls={false}
      clickToPlay={false}
      spaceKeyToPlayOrPause={false}
      acknowledgeRemotionLicense
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
});

export default RemotionPreview;
