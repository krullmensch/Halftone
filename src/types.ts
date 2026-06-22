export type GridType = 'regular' | 'benday';

/** Canvas aspect-ratio mode: 'auto' follows the source image,
 *  DIN formats use the A-series 1:√2 ratio, 'square' is 1:1. */
export type CanvasFormat = 'auto' | 'din-portrait' | 'din-landscape' | 'square';

/** Source mode: halftone an uploaded image, or rendered text. */
export type CanvasMode = 'image' | 'text';

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

export interface HalftoneParams {
  /** Source mode: image upload or rendered text */
  mode: CanvasMode;
  /** Working resolution: length of the longest canvas side in px (600–4000). */
  canvasSize: number;
  /** Canvas aspect ratio mode (see CanvasFormat) */
  canvasFormat: CanvasFormat;
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

  // ── Text mode ──────────────────────────────────────────────────────────
  /** Free canvas width in px (text mode only) */
  canvasWidth: number;
  /** Free canvas height in px (text mode only) */
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
}

export const DEFAULT_PARAMS: HalftoneParams = {
  mode: 'image',
  canvasSize: 2400,
  canvasFormat: 'auto',
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
  destroy(): void;
}
