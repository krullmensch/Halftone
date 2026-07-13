export type GridType = 'regular' | 'benday';

/** Source mode: halftone an uploaded image, rendered text, or video frames. */
export type CanvasMode = 'image' | 'text' | 'video';

/** Normalized crop rectangle inside the source image (all fields 0–1). Defines
 *  which region of the image is stretched to fill the canvas. Its aspect ratio
 *  matches the canvas (canvasWidth/canvasHeight). When null, the image is
 *  cover-fitted to the canvas (auto: canvas follows the image aspect). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TextAlign = 'left' | 'center' | 'right';

/** A single variable-font axis (from the font's fvar table). */
export interface FontAxis {
  /** 4-char axis tag, e.g. "wght", "wdth", "slnt" */
  tag: string;
  /** Human-readable axis name, e.g. "Weight" */
  name: string;
  min: number;
  max: number;
  default: number;
}

/** Metadata for a loaded font (kept in React state, alongside the registered FontFace). */
export interface FontInfo {
  /** Generated unique CSS family name the FontFace was registered under */
  family: string;
  /** Original file name, shown in the UI */
  name: string;
  /** Variable-font axes (empty for static fonts) */
  axes: FontAxis[];
}

/** Normalized 0–1 rectangle inside the canvas (InDesign/Figma-style text box). */
export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Video mode ─────────────────────────────────────────────────────────────

/** Clip source kind: a video file, or a still image shown for a set duration. */
export type ClipSourceType = 'video' | 'still';

/** Per-clip spatial placement inside the canvas frame.
 *  x,y are the normalized position of the clip's CENTER in the canvas
 *  (0..1, 0.5 = centered on that axis). scale is a multiplier on the clip's
 *  contain-fit size (1 = the clip is contain-fitted to the canvas; >1 zooms in,
 *  <1 shrinks). Area not covered by any clip renders black. */
export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
}

/** Identity transform: contain-fitted and centered on both axes. */
export const DEFAULT_CLIP_TRANSFORM: ClipTransform = { x: 0.5, y: 0.5, scale: 1 };

/** One clip on the free-placement video timeline. */
export interface VideoClip {
  id: string;
  type: ClipSourceType;
  /** Object URL of the original file (video) or decoded image (still; TIFF is
   *  pre-decoded to a canvas-derived URL on import). */
  src: string;
  /** Original file name, shown in the timeline UI */
  fileName: string;
  /** Natural duration in seconds (video) or user-set display duration (still) */
  duration: number;
  /** Trim in-point in seconds (0 for stills) */
  inPoint: number;
  /** Trim out-point in seconds (=== duration for untrimmed clips) */
  outPoint: number;
  /** Natural pixel dimensions of the source */
  width: number;
  height: number;
  /** Thumbnail data URL for the timeline strip */
  thumbnail?: string;
  /** Absolute start position on the timeline, in seconds. Clips may be freely
   *  placed; a gap between clips renders as a black canvas. */
  startTime: number;
  /** Spatial placement of the clip inside the canvas frame. */
  transform: ClipTransform;
}

export type TransitionType = 'crossfade' | 'dip-to-color' | 'wipe';

export type WipeDirection = 'left' | 'right' | 'up' | 'down';

/** A free-placed transition block on the timeline's transition track. Occupies
 *  an absolute [startTime, startTime+duration] window; its edges are draggable.
 *  crossfade/wipe blend `fromClipId` (outgoing) into `toClipId` (incoming) over
 *  the window; dip-to-color overlays a solid color (fade to/through a color). */
export interface TimelineTransition {
  id: string;
  type: TransitionType;
  /** Absolute start on the timeline, in seconds. */
  startTime: number;
  /** Length of the transition, in seconds. */
  duration: number;
  /** 'dip-to-color' only */
  color?: string;
  /** 'wipe' only */
  direction?: WipeDirection;
  /** crossfade/wipe: outgoing clip whose tail is left behind. */
  fromClipId?: string;
  /** crossfade/wipe: incoming clip revealed over the window. */
  toClipId?: string;
}

/** Output aspect ratio of the timeline canvas (e.g. 16:9 → {w:16,h:9}). */
export interface TimelineAspect {
  w: number;
  h: number;
}

/** Free-placement timeline: clips carry explicit start times, transitions are
 *  independent draggable blocks, and the canvas has an explicit aspect + res. */
export interface VideoTimelineData {
  clips: VideoClip[];
  transitions: TimelineTransition[];
  /** Output aspect ratio of the canvas. */
  aspect: TimelineAspect;
  /** Longest canvas side in px (drives canvas dimensions with `aspect`). */
  resolution: number;
}

/** Default empty timeline: 16:9 at 1080px longest side. */
export const DEFAULT_TIMELINE: VideoTimelineData = {
  clips: [],
  transitions: [],
  aspect: { w: 16, h: 9 },
  resolution: 1080,
};

export type VideoContainer = 'mp4' | 'mov' | 'webm';
export type VideoCodec = 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1';

export interface VideoExportSettings {
  container: VideoContainer;
  codec: VideoCodec;
  fps: number;
  /** Longest output side in px */
  resolution: number;
  /** Target bitrate in bps (optional override; a default is derived from resolution/fps) */
  bitrate?: number;
}

export interface HalftoneParams {
  /** Source mode: image upload or rendered text */
  mode: CanvasMode;
  /** Crop/format of the source image (image mode). When set, the canvas uses
   *  the explicit canvasWidth × canvasHeight (in px) chosen in the format modal
   *  and the image is sampled from this normalized sub-rectangle. When null,
   *  the canvas auto-follows the image aspect at a default working resolution. */
  cropRect: CropRect | null;
  /** Normalized horizontal pan of the cover-fitted source image inside the
   *  canvas (0–1, 0.5 = centered). Only effective when the image and canvas
   *  aspect ratios differ. */
  imageOffsetX: number;
  /** Normalized vertical pan (0–1, 0.5 = centered), see imageOffsetX. */
  imageOffsetY: number;
  /** Grid spacing in px (3–20) */
  stepSize: number;
  gridType: GridType;
  /** Grid rotation in degrees (-45 to 45) */
  gridAngle: number;
  /** Gaussian blur applied to the source image before sampling, in px (0–20) */
  preBlur: number;
  /** Luminance grain added to the source image (0–100, amplitude in luminance units) */
  noiseAmount: number;
  /** If true, dots whose pixel falls in the AI-segmented background are dropped */
  removeBackground: boolean;
  /** Foreground-mask alpha cutoff 0–255; dots are kept only where mask alpha ≥ this */
  bgThreshold: number;
  /** If true, halftone dots act as a mask revealing the real image instead of
   *  being filled with dotColor. Outside the dots shows the (optionally blurred)
   *  underlying image. Image mode only. */
  imageMask: boolean;
  /** Gaussian blur (px) applied to the underlying background image shown
   *  outside the dots when imageMask is on (0–50). */
  bgBlur: number;
  /** Luminance threshold 0–255; dots are only drawn where luminance < threshold */
  halftoneThreshold: number;
  /** Minimum dot size in px */
  minDotSize: number;
  /** Maximum dot size in px */
  maxDotSize: number;
  /** If true, render at a reduced preview resolution for fast interaction;
   *  exports always render at full resolution. */
  preview: boolean;
  /** Ink bleed strength (0–10): Gaussian blur radius before a fixed
   *  smoothstep threshold at 0.5 — dots melt cleanly into each other. */
  inkBleed: number;
  /** Dot fill color as hex string, e.g. "#000000" */
  dotColor: string;
  /** Canvas background color as hex string, e.g. "#ffffff" */
  bgColor: string;
  /** If true, the background is fully transparent (PNG/SVG export keeps alpha;
   *  JPG export flattens onto bgColor) */
  transparentBg: boolean;

  // ── Canvas dimensions ────────────────────────────────────────────────────
  /** Explicit canvas width in px. Text mode: free canvas. Image mode: used when
   *  cropRect is set (chosen via the format modal). */
  canvasWidth: number;
  /** Explicit canvas height in px. See canvasWidth. */
  canvasHeight: number;
  /** Text content to render */
  text: string;
  /** CSS family name of the loaded FontFace ('' until a font is uploaded) */
  fontFamily: string;
  /** Font size in px */
  fontSize: number;
  /** Line height as a multiple of fontSize */
  lineHeight: number;
  /** Letter spacing in px */
  letterSpacing: number;
  /** Horizontal text alignment within the text box */
  textAlign: TextAlign;
  /** Variable-font axis values, keyed by axis tag (e.g. { wght: 700 }) */
  fontAxes: Record<string, number>;
  /** Normalized 0–1 text box rect within the canvas */
  textBox: TextBox;

  // ── Video mode ─────────────────────────────────────────────────────────
  /** Aspect ratio (w/h) of the current video clip, drives canvas dims in
   *  'auto' format. Updated by the playback engine when the active clip
   *  changes; 16/9 until a clip is loaded. */
  videoAspect: number;
}

export const DEFAULT_PARAMS: HalftoneParams = {
  mode: 'image',
  cropRect: null,
  imageOffsetX: 0.5,
  imageOffsetY: 0.5,
  stepSize: 20,
  gridType: 'regular',
  gridAngle: 0,
  preBlur: 0,
  noiseAmount: 0,
  removeBackground: false,
  bgThreshold: 128,
  imageMask: false,
  bgBlur: 12,
  halftoneThreshold: 159,
  minDotSize: 0,
  maxDotSize: 20,
  preview: true,
  inkBleed: 4,
  dotColor: '#000000',
  bgColor: '#ffffff',
  transparentBg: false,
  canvasWidth: 1600,
  canvasHeight: 900,
  text: 'Halftone',
  fontFamily: '',
  fontSize: 320,
  lineHeight: 1.1,
  letterSpacing: 0,
  textAlign: 'center',
  fontAxes: {},
  textBox: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 },
  videoAspect: 16 / 9,
};

export type ExportFormat = 'png' | 'jpg' | 'svg';

/** Handle returned by createSketch — the React layer talks to p5 only through this. */
export interface SketchHandle {
  setParams(params: HalftoneParams): void;
  /** Object URL or regular URL of the source image */
  setImage(url: string): void;
  /** Drop the loaded image and return the canvas to its empty state */
  clearImage(): void;
  /** Set the AI foreground mask (subject cutout, alpha = foreground). null clears it. */
  setMask(bitmap: ImageBitmap | null): void;
  /** PNG keeps transparency; JPG flattens transparent bg onto bgColor;
   *  SVG traces the ink/background pixel boundary of the post-processed bitmap
   *  (including ink-bleed merging) into vector paths. */
  exportImage(format: ExportFormat): void | Promise<void>;
  /** Video mode: draw an already-composited source frame (the timeline
   *  compositor's output canvas) into the src buffer and redraw the halftone.
   *  Caller drives the frame cadence. */
  setVideoFrame(
    frame: CanvasImageSource,
    frameW: number,
    frameH: number,
  ): void;
  /** Enter full-resolution rendering for a video export session. Recreates
   *  buffers once; renderVideoFrame calls between begin/end reuse them. */
  beginVideoExport(): void;
  /** Leave full-resolution mode and restore the preview canvas. */
  endVideoExport(): void;
  /** Video export: render one frame (at full res inside a begin/endVideoExport
   *  session) and return the composited canvas for encoding. */
  renderVideoFrame(
    frame: CanvasImageSource,
    frameW: number,
    frameH: number,
  ): HTMLCanvasElement;
  destroy(): void;
}
