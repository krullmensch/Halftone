import {
  Output,
  Mp4OutputFormat,
  MovOutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource
} from 'mediabunny';
import type { VideoCodec as MbVideoCodec } from 'mediabunny';
import { VideoCodec, VideoContainer } from '../../types';

export interface EncodeSession {
  addFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void>;
  finish(): Promise<Blob>;
  cancel(): void;
}

const evenFloor = (n: number): number => Math.max(2, n - (n % 2));

/**
 * Maps our app's video codec values to mediabunny's naming conventions.
 */
function mapCodec(codec: VideoCodec): MbVideoCodec {
  switch (codec) {
    case 'h264':
      return 'avc';
    case 'h265':
      return 'hevc';
    default:
      return codec;
  }
}

export async function createMediabunnySession(opts: {
  codec: VideoCodec;
  container: VideoContainer;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}): Promise<EncodeSession> {
  const mbCodec = mapCodec(opts.codec);
  const w = evenFloor(opts.width);
  const h = evenFloor(opts.height);

  let format: Mp4OutputFormat | MovOutputFormat | WebMOutputFormat;
  switch (opts.container) {
    case 'mp4':
      format = new Mp4OutputFormat({ fastStart: 'in-memory' });
      break;
    case 'mov':
      format = new MovOutputFormat({ fastStart: 'in-memory' });
      break;
    case 'webm':
      format = new WebMOutputFormat();
      break;
    default:
      throw new Error(`Unsupported container type: ${opts.container}`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D rendering context for encoding canvas');
  }

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec: mbCodec,
    bitrate: opts.bitrate,
    keyFrameInterval: 2
  });

  output.addVideoTrack(source, { frameRate: opts.fps });
  await output.start();

  let cancelled = false;

  return {
    async addFrame(inputCanvas: HTMLCanvasElement, frameIndex: number): Promise<void> {
      if (cancelled) return;
      ctx.drawImage(inputCanvas, 0, 0, w, h);
      await source.add(frameIndex / opts.fps, 1 / opts.fps);
    },

    async finish(): Promise<Blob> {
      await output.finalize();
      const buf = target.buffer;
      if (!buf) {
        throw new Error('mediabunny produced no output');
      }

      let mime: string;
      switch (opts.container) {
        case 'mp4':
          mime = 'video/mp4';
          break;
        case 'mov':
          mime = 'video/quicktime';
          break;
        case 'webm':
          mime = 'video/webm';
          break;
        default:
          mime = 'video/mp4';
      }

      return new Blob([buf], { type: mime });
    },

    cancel(): void {
      cancelled = true;
      void output.cancel().catch(() => {});
    }
  };
}
