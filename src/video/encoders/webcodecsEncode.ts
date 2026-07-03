import type { VideoCodec } from '../../types';
import { codecStringsFor } from './webcodecs';

export interface EncodeSession {
  /** Encode one frame; timestamp/duration are computed from frameIndex and fps. */
  addFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void>;
  /** Flush the encoder, finalize the muxer, and return the file blob. */
  finish(): Promise<Blob>;
  /** Abort and release resources without producing output. */
  cancel(): void;
}

/** Maximum number of frames allowed to queue inside the VideoEncoder before
 *  `addFrame` starts applying backpressure by awaiting a dequeue event. */
const MAX_QUEUE_SIZE = 4;

const MP4_CODEC_NAME: Record<VideoCodec, 'avc' | 'hevc' | 'av1' | null> = {
  h264: 'avc',
  h265: 'hevc',
  vp8: null,
  vp9: null,
  av1: 'av1',
};

const WEBM_CODEC_ID: Record<VideoCodec, string | null> = {
  h264: null,
  h265: null,
  vp8: 'V_VP8',
  vp9: 'V_VP9',
  av1: 'V_AV01',
};

/**
 * Create a WebCodecs `VideoEncoder` + muxer (mp4-muxer or webm-muxer)
 * session. Caller is responsible for routing here only when
 * `detectEncodePath` reports `'webcodecs'` for this codec/container pair.
 */
export async function createWebCodecsSession(opts: {
  codec: VideoCodec;
  container: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}): Promise<EncodeSession> {
  const { codec, container, width, height, fps, bitrate } = opts;
  const w = Math.max(2, Math.floor(width / 2) * 2);
  const h = Math.max(2, Math.floor(height / 2) * 2);

  let muxer: { addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void; finalize(): void };
  let getBuffer: () => ArrayBuffer;
  let mimeType: string;

  if (container === 'mp4') {
    const mp4CodecName = MP4_CODEC_NAME[codec];
    if (!mp4CodecName) throw new Error(`mp4-muxer does not support codec "${codec}"`);
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    const target = new ArrayBufferTarget();
    muxer = new Muxer({
      target,
      video: { codec: mp4CodecName, width: w, height: h, frameRate: fps },
      fastStart: 'in-memory',
    });
    getBuffer = () => target.buffer;
    mimeType = 'video/mp4';
  } else {
    const webmCodecId = WEBM_CODEC_ID[codec];
    if (!webmCodecId) throw new Error(`webm-muxer does not support codec "${codec}"`);
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
    const target = new ArrayBufferTarget();
    muxer = new Muxer({
      target,
      video: { codec: webmCodecId, width: w, height: h, frameRate: fps },
    });
    getBuffer = () => target.buffer;
    mimeType = 'video/webm';
  }

  const codecString = codecStringsFor(codec, w, h)[0];
  let cancelled = false;
  let encodeError: unknown = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      encodeError = e;
    },
  });

  encoder.configure({
    codec: codecString,
    width: w,
    height: h,
    framerate: fps,
    bitrate,
  });

  const keyframeInterval = Math.max(1, Math.round(fps * 2));

  async function addFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void> {
    if (cancelled) return;
    if (encodeError) throw encodeError;

    if (encoder.encodeQueueSize > MAX_QUEUE_SIZE) {
      await new Promise<void>((resolve) => {
        const onDequeue = () => {
          encoder.removeEventListener('dequeue', onDequeue);
          resolve();
        };
        encoder.addEventListener('dequeue', onDequeue);
      });
    }
    if (cancelled) return;

    const timestamp = Math.round((frameIndex * 1e6) / fps);
    const duration = Math.round(1e6 / fps);
    const frame = new VideoFrame(canvas, { timestamp, duration });
    try {
      encoder.encode(frame, { keyFrame: frameIndex % keyframeInterval === 0 });
    } finally {
      frame.close();
    }
  }

  async function finish(): Promise<Blob> {
    await encoder.flush();
    if (encodeError) throw encodeError;
    encoder.close();
    muxer.finalize();
    return new Blob([getBuffer()], { type: mimeType });
  }

  function cancel(): void {
    cancelled = true;
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // Already closed/errored; nothing to do.
    }
  }

  return { addFrame, finish, cancel };
}
