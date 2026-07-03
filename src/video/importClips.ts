import type { VideoClip } from '../types';

/** Default display duration for still-image clips, in seconds. */
export const DEFAULT_STILL_DURATION = 3;

const THUMB_HEIGHT = 64;

function makeId(): string {
  return `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function thumbnailFrom(source: CanvasImageSource, w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.height = THUMB_HEIGHT;
  canvas.width = Math.max(1, Math.round((w / h) * THUMB_HEIGHT));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.6);
}

function isTiff(file: File): boolean {
  return file.type === 'image/tiff' || /\.tiff?$/i.test(file.name);
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || isTiff(file);
}

/** File types the video timeline accepts. */
export function isClipFile(file: File): boolean {
  return isVideoFile(file) || isImageFile(file);
}

async function videoFileToClip(file: File): Promise<VideoClip> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error(`Video konnte nicht geladen werden: ${file.name}`));
  });

  // Seek slightly in so the thumbnail isn't a black first frame.
  const thumbTime = Math.min(0.1, video.duration / 2);
  await new Promise<void>(resolve => {
    const done = () => resolve();
    video.onseeked = done;
    // Some containers never fire seeked for tiny seeks — safety timeout.
    window.setTimeout(done, 1500);
    video.currentTime = thumbTime;
  });

  const clip: VideoClip = {
    id: makeId(),
    type: 'video',
    src: url,
    fileName: file.name,
    duration: video.duration,
    inPoint: 0,
    outPoint: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    thumbnail: thumbnailFrom(video, video.videoWidth, video.videoHeight),
  };
  video.removeAttribute('src');
  video.load();
  return clip;
}

async function stillFileToClip(file: File): Promise<VideoClip> {
  let url: string;
  let width: number;
  let height: number;

  if (isTiff(file)) {
    const { decodeTiff } = await import('./tiffDecode');
    const decoded = await decodeTiff(file);
    url = decoded.url;
    width = decoded.width;
    height = decoded.height;
  } else {
    url = URL.createObjectURL(file);
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    bmp.close();
  }

  const img = new Image();
  img.src = url;
  await img.decode();

  return {
    id: makeId(),
    type: 'still',
    src: url,
    fileName: file.name,
    duration: DEFAULT_STILL_DURATION,
    inPoint: 0,
    outPoint: DEFAULT_STILL_DURATION,
    width,
    height,
    thumbnail: thumbnailFrom(img, width, height),
  };
}

/**
 * Convert an imported file into a timeline clip. Videos keep their natural
 * duration; stills get DEFAULT_STILL_DURATION. Throws on undecodable media
 * (including unsupported TIFF variants).
 */
export async function fileToClip(file: File): Promise<VideoClip> {
  if (isVideoFile(file)) return videoFileToClip(file);
  if (isImageFile(file)) return stillFileToClip(file);
  throw new Error(`Nicht unterstütztes Format: ${file.name}`);
}
