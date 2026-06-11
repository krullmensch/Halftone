export type GridType = 'regular' | 'benday';

export interface HalftoneParams {
  /** Working resolution: length of the longest canvas side in px (600–4000).
   *  The canvas always matches the aspect ratio of the loaded image. */
  canvasSize: number;
  /** Grid spacing in px (3–20) */
  stepSize: number;
  gridType: GridType;
  /** Grid rotation in degrees (-45 to 45) */
  gridAngle: number;
  /** Perlin-noise displacement factor in px (0–20) */
  noiseAmount: number;
  /** Luminance threshold 0–255; dots are only drawn where luminance < threshold */
  halftoneThreshold: number;
  /** Minimum dot size in px */
  minDotSize: number;
  /** Maximum dot size in px */
  maxDotSize: number;
  /** Corner radius as percentage of dot size (0 = squares, 50 = circles) */
  cornerRadiusPct: number;
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
  canvasSize: 800,
  stepSize: 8,
  gridType: 'regular',
  gridAngle: 0,
  noiseAmount: 0,
  halftoneThreshold: 220,
  minDotSize: 1,
  maxDotSize: 10,
  cornerRadiusPct: 50,
  inkBleed: 3,
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
  /** PNG keeps transparency; JPG flattens transparent bg onto bgColor;
   *  SVG traces the post-processed bitmap (including ink-bleed merging) via
   *  potrace, producing a clean vector path. */
  exportImage(format: ExportFormat): void | Promise<void>;
  destroy(): void;
}
