import type { VideoCodec, VideoContainer } from '../../types';

/** Ordered candidate codec strings for `VideoEncoder.isConfigSupported`,
 *  best profile/level first. Level suffixes are conservative defaults;
 *  actual level headroom isn't checked against width/height here since
 *  `isConfigSupported` validates the combination for us. */
export function codecStringsFor(codec: VideoCodec, _width: number, _height: number): string[] {
  switch (codec) {
    case 'h264':
      return ['avc1.640028', 'avc1.4d0028', 'avc1.42001f'];
    case 'h265':
      return ['hvc1.1.6.L120.00', 'hev1.1.6.L120.00'];
    case 'vp8':
      return ['vp8'];
    case 'vp9':
      return ['vp09.00.10.08'];
    case 'av1':
      return ['av01.0.04M.08'];
  }
}

export interface EncoderPick {
  config: VideoEncoderConfig;
  codecString: string;
  hardware: boolean;
}

/** Round a dimension down to the nearest even number (required by most
 *  hardware H.264/H.265 encoders for 4:2:0 chroma subsampling). */
function evenFloor(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

/**
 * Probe `VideoEncoder.isConfigSupported` for each candidate codec string,
 * returning the first supported configuration. Returns null when the
 * `VideoEncoder` global is unavailable (no WebCodecs support) or when none
 * of the candidate codec strings are supported.
 */
export async function pickEncoderConfig(
  codec: VideoCodec,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<EncoderPick | null> {
  if (typeof window === 'undefined' || !('VideoEncoder' in window)) return null;

  const w = evenFloor(width);
  const h = evenFloor(height);
  const codecStrings = codecStringsFor(codec, w, h);

  for (const codecString of codecStrings) {
    const config: VideoEncoderConfig = {
      codec: codecString,
      width: w,
      height: h,
      framerate: fps,
      bitrate,
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        const supportedConfig = support.config ?? config;
        const hardware =
          typeof supportedConfig.hardwareAcceleration === 'string'
            ? supportedConfig.hardwareAcceleration !== 'prefer-software'
            : true;
        return { config: supportedConfig, codecString, hardware };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export type EncodePath = 'webcodecs' | 'ffmpeg' | 'unsupported';

/**
 * Choose the encode path for a given codec/container combination.
 * - `.mov` always routes through ffmpeg (no browser muxer targets QuickTime).
 * - mp4 + vp8 routes through ffmpeg (mp4-muxer supports 'avc'|'hevc'|'vp9'|'av1' only).
 * - webm + h264/h265 routes through ffmpeg (webm-muxer has no AVC/HEVC codec id).
 * - Otherwise, use WebCodecs if a supported hardware/software config is found,
 *   falling back to ffmpeg (always available, wasm-based) otherwise.
 */
export async function detectEncodePath(
  codec: VideoCodec,
  container: VideoContainer,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<EncodePath> {
  if (container === 'mov') return 'ffmpeg';
  if (container === 'mp4' && codec === 'vp8') return 'ffmpeg';
  if (container === 'webm' && (codec === 'h264' || codec === 'h265')) return 'ffmpeg';

  const pick = await pickEncoderConfig(codec, width, height, fps, bitrate);
  return pick ? 'webcodecs' : 'ffmpeg';
}
