import type { VideoCodec, VideoContainer } from '../../types';
import type { EncodeSession } from './webcodecsEncode';

export interface FfmpegSession extends EncodeSession {}

/** Version-pinned jsDelivr source for the ffmpeg.wasm single-thread core.
 *  @ffmpeg/core's package exports don't expose dist/esm paths, so Vite cannot
 *  bundle the core assets from node_modules — the pinned CDN (matching the
 *  installed package version) is the load path. */
const FFMPEG_CORE_VERSION = '0.12.10';
const CDN_CORE_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/esm`;

const VIDEO_ENCODER: Record<VideoCodec, string> = {
  h264: 'libx264',
  h265: 'libx265',
  vp8: 'libvpx',
  vp9: 'libvpx-vp9',
  av1: 'libaom-av1',
};

const CONTAINER_EXT: Record<VideoContainer, string> = {
  mp4: 'mp4',
  mov: 'mov',
  webm: 'webm',
};

const CONTAINER_MIME: Record<VideoContainer, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/**
 * Create a software-encode session backed by ffmpeg.wasm. Frames are
 * written as individual PNGs to the in-memory FS and stitched into a
 * video with a single `ffmpeg.exec` call in `finish()`. This is the
 * universal fallback path: slower than WebCodecs, but covers every
 * codec/container combination (including .mov and mp4-in-vp8, which the
 * browser muxers can't produce).
 */
export async function createFfmpegSession(opts: {
  codec: VideoCodec;
  container: VideoContainer;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  onLoadProgress?: (ratio: number) => void;
}): Promise<FfmpegSession> {
  const { codec, container, fps, bitrate, onLoadProgress } = opts;

  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);

  const ffmpeg = new FFmpeg();
  if (onLoadProgress) {
    ffmpeg.on('progress', ({ progress }) => onLoadProgress(Math.max(0, Math.min(1, progress))));
  }

  const coreURL = await toBlobURL(`${CDN_CORE_BASE}/ffmpeg-core.js`, 'text/javascript');
  const wasmURL = await toBlobURL(`${CDN_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm');

  await ffmpeg.load({ coreURL, wasmURL });

  let cancelled = false;
  let frameCount = 0;

  async function addFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void> {
    if (cancelled) return;
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode canvas frame to PNG');
    if (cancelled) return;
    const { fetchFile } = await import('@ffmpeg/util');
    const fileName = `f${String(frameIndex).padStart(6, '0')}.png`;
    await ffmpeg.writeFile(fileName, await fetchFile(blob));
    frameCount++;
  }

  async function finish(): Promise<Blob> {
    const ext = CONTAINER_EXT[container];
    const outName = `out.${ext}`;
    const encoder = VIDEO_ENCODER[codec];

    const args = [
      '-framerate', String(fps),
      '-i', 'f%06d.png',
      '-c:v', encoder,
      '-pix_fmt', 'yuv420p',
      '-b:v', String(bitrate),
    ];
    if (codec === 'h265' && (container === 'mp4' || container === 'mov')) {
      args.push('-tag:v', 'hvc1');
    }
    if (codec === 'av1') {
      args.push('-cpu-used', '8');
    }
    args.push(outName);

    const rc = await ffmpeg.exec(args);
    if (rc !== 0) throw new Error(`ffmpeg exec failed with code ${rc}`);

    const data = await ffmpeg.readFile(outName);
    // ffmpeg.wasm's FileData union includes string (text mode); binary reads
    // always yield a Uint8Array. Copy into a fresh ArrayBuffer-backed view so
    // it satisfies BlobPart regardless of the underlying buffer type.
    const bytes = new Uint8Array(data as Uint8Array);

    // Clean up frame files and output so a subsequent export starts fresh.
    for (let i = 0; i < frameCount; i++) {
      const fileName = `f${String(i).padStart(6, '0')}.png`;
      await ffmpeg.deleteFile(fileName).catch(() => {});
    }
    await ffmpeg.deleteFile(outName).catch(() => {});

    return new Blob([bytes], { type: CONTAINER_MIME[container] });
  }

  function cancel(): void {
    cancelled = true;
    ffmpeg.terminate();
  }

  return { addFrame, finish, cancel };
}
