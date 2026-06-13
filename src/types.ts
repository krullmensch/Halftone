export type GridType = 'regular' | 'benday';

/** Canvas aspect-ratio mode: 'auto' follows the source image,
 *  DIN formats use the A-series 1:√2 ratio, 'square' is 1:1. */
export type CanvasFormat = 'auto' | 'din-portrait' | 'din-landscape' | 'square';

export interface HalftoneParams {
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
}

export const DEFAULT_PARAMS: HalftoneParams = {
  canvasSize: 2400,
  canvasFormat: 'auto',
  imageOffsetX: 0.5,
  imageOffsetY: 0.5,
  stepSize: 20,
  gridType: 'regular',
  gridAngle: 0,
  preBlur: 0,
  noiseAmount: 0,
  halftoneThreshold: 159,
  minDotSize: 0,
  maxDotSize: 20,
  preview: true,
  inkBleed: 4,
  dotColor: '#000000',
  bgColor: '#ffffff',
  transparentBg: false,
};

export type ExportFormat = 'png' | 'jpg' | 'svg';

/** Handle returned by createSketch — the React layer talks to p5 only through this. */
export interface SketchHandle {
  setParams(params: HalftoneParams): void;
  /** Object URL or regular URL of the source image */
  setImage(url: string): void;
  /** Drop the loaded image and return the canvas to its empty state */
  clearImage(): void;
  /** PNG keeps transparency; JPG flattens transparent bg onto bgColor;
   *  SVG traces the ink/background pixel boundary of the post-processed bitmap
   *  (including ink-bleed merging) into vector paths. */
  exportImage(format: ExportFormat): void | Promise<void>;
  destroy(): void;
}
