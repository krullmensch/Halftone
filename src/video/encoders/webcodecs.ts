import type { VideoCodec, VideoContainer } from '../../types';
import type { OutputFormat, VideoCodec as MbVideoCodec } from 'mediabunny';

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

export async function probeCodecSupport(
  codec: VideoCodec,
  container: VideoContainer,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<'hardware' | 'software' | 'unsupported'> {
  try {
    const mbCodec = mapCodec(codec);
    const { Mp4OutputFormat, MovOutputFormat, WebMOutputFormat, canEncodeVideo } = await import('mediabunny');

    let format: OutputFormat;
    switch (container) {
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
        return 'unsupported';
    }

    if (!format.getSupportedVideoCodecs().includes(mbCodec)) {
      return 'unsupported';
    }

    if (!(await canEncodeVideo(mbCodec, { width, height, bitrate }))) {
      return 'unsupported';
    }

    const pick = await pickEncoderConfig(codec, width, height, fps, bitrate);
    return pick && pick.hardware ? 'hardware' : 'software';
  } catch {
    return 'unsupported';
  }
}
