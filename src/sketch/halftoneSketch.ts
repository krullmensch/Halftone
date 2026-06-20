import p5 from 'p5';
import type { HalftoneParams, ExportFormat, SketchHandle } from '../types';
import { DEFAULT_PARAMS } from '../types';

/** Longest canvas side while preview mode is active. */
const PREVIEW_MAX = 1000;

type Pt = { x: number; y: number };

/**
 * iOS Safari (and some older browsers) ignore CanvasRenderingContext2D.filter,
 * so `ctx.filter = "blur(...)"` silently no-ops. Functionally probe it once:
 * draw a black pixel with a blur and check that it bled into a neighbor.
 */
let _canvasBlurOK: boolean | null = null;
function canvasBlurSupported(): boolean {
  if (_canvasBlurOK !== null) return _canvasBlurOK;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 3;
    const cx = c.getContext('2d')!;
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, 3, 3);
    cx.filter = 'blur(1px)';
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, 1, 1);
    cx.filter = 'none';
    const neighbor = cx.getImageData(1, 0, 1, 1).data;
    _canvasBlurOK = neighbor[0] < 250; // black bled in → filter honored
  } catch {
    _canvasBlurOK = false;
  }
  return _canvasBlurOK;
}

/** Normalized 1D Gaussian kernel for a given standard deviation. */
function gaussianKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const size = 2 * r + 1;
  const k = new Float32Array(size);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

/** One separable Gaussian convolution pass (RGB only; alpha copied through). */
function gaussianPass(
  inp: Uint8ClampedArray, out: Uint8ClampedArray,
  w: number, h: number, kernel: Float32Array, horizontal: boolean,
): void {
  const r = (kernel.length - 1) / 2;
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc0 = 0, acc1 = 0, acc2 = 0;
      for (let k = -r; k <= r; k++) {
        const base = horizontal
          ? (y * w + clamp(x + k, w - 1)) * 4
          : (clamp(y + k, h - 1) * w + x) * 4;
        const wk = kernel[k + r];
        acc0 += inp[base] * wk;
        acc1 += inp[base + 1] * wk;
        acc2 += inp[base + 2] * wk;
      }
      const o = (y * w + x) * 4;
      out[o] = acc0;
      out[o + 1] = acc1;
      out[o + 2] = acc2;
      out[o + 3] = inp[o + 3];
    }
  }
}

/**
 * True separable Gaussian blur on RGBA pixel data, mutating it in place.
 * `sigma` matches the CSS/canvas `blur(sigma px)` standard deviation so the
 * fallback (iOS Safari) looks identical to the native filter path on desktop.
 */
function gaussianBlur(data: Uint8ClampedArray, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return;
  const kernel = gaussianKernel(sigma);
  const tmp = new Uint8ClampedArray(data.length);
  gaussianPass(data, tmp, w, h, kernel, true);
  gaussianPass(tmp, data, w, h, kernel, false);
}

/**
 * Marching-squares contour extraction on a continuous W×H ink-intensity field.
 * Edge crossings are linearly interpolated (sub-pixel), so anti-aliased dot
 * rims and ink-bleed gradients become smooth boundaries instead of the raster
 * staircase. The resulting segments are stitched into closed loops, simplified
 * with Ramer–Douglas–Peucker, and emitted as Catmull-Rom cubic Bézier path
 * data — smooth curves with few anchors (fill-rule evenodd
 * carves the holes, so loop winding does not matter).
 */
function traceContours(field: Float32Array, W: number, H: number): string {
  const T = 128;
  const interp = (va: number, vb: number) => {
    const d = vb - va;
    return Math.abs(d) < 1e-6 ? 0.5 : (T - va) / d;
  };
  const at = (x: number, y: number) => field[y * W + x];

  // Collect undirected segments from each 2×2 cell.
  const segs: [Pt, Pt][] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = at(x, y), tr = at(x + 1, y);
      const br = at(x + 1, y + 1), bl = at(x, y + 1);
      let c = 0;
      if (tl >= T) c |= 8;
      if (tr >= T) c |= 4;
      if (br >= T) c |= 2;
      if (bl >= T) c |= 1;
      if (c === 0 || c === 15) continue;
      // Edge crossing points (top, right, bottom, left of the cell).
      const top: Pt = { x: x + interp(tl, tr), y };
      const right: Pt = { x: x + 1, y: y + interp(tr, br) };
      const bottom: Pt = { x: x + interp(bl, br), y: y + 1 };
      const left: Pt = { x, y: y + interp(tl, bl) };
      const push = (a: Pt, b: Pt) => segs.push([a, b]);
      switch (c) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 5: push(left, top); push(bottom, right); break;
        case 6: case 9: push(top, bottom); break;
        case 7: case 8: push(left, top); break;
        case 10: push(top, right); push(left, bottom); break;
      }
    }
  }

  // Stitch segments into loops by consuming edges between quantized endpoints.
  const key = (p: Pt) => `${Math.round(p.x * 16)},${Math.round(p.y * 16)}`;
  const ends = new Map<string, { si: number; other: Pt }[]>();
  const addEnd = (k: string, si: number, other: Pt) =>
    (ends.get(k) ?? ends.set(k, []).get(k)!).push({ si, other });
  segs.forEach(([a, b], i) => {
    addEnd(key(a), i, b);
    addEnd(key(b), i, a);
  });
  const used = new Uint8Array(segs.length);

  // Ramer–Douglas–Peucker: drop near-collinear staircase points so the curve
  // is described by few anchors instead of one per marching-squares crossing.
  const EPS = 1.0; // simplification tolerance in buffer pixels
  const rdp = (pts: Pt[], eps: number): Pt[] => {
    if (pts.length < 3) return pts;
    const sqEps = eps * eps;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const ax = pts[a].x, ay = pts[a].y;
      const dx = pts[b].x - ax, dy = pts[b].y - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      let maxD = -1, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const t = ((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2;
        const px = ax + t * dx, py = ay + t * dy;
        const ddx = pts[i].x - px, ddy = pts[i].y - py;
        const sq = ddx * ddx + ddy * ddy;
        if (sq > maxD) { maxD = sq; idx = i; }
      }
      if (maxD > sqEps && idx > a) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  };

  // Closed Catmull-Rom spline → one cubic Bézier per anchor. Smooth
  // interpolation through every anchor with no extra emitted points.
  const f = (n: number) => Math.round(n * 100) / 100;
  const splinePath = (pts: Pt[]): string => {
    const n = pts.length;
    let s = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    if (n < 3) {
      for (let i = 1; i < n; i++) s += `L${f(pts[i].x)} ${f(pts[i].y)}`;
      return s + 'Z';
    }
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i];
      const p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      s += `C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2.x)} ${f(p2.y)}`;
    }
    return s + 'Z';
  };

  let d = '';
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const startK = key(segs[s][0]);
    const loop: Pt[] = [segs[s][0]];
    let cur = segs[s][1];
    let guard = 0;
    while (key(cur) !== startK && guard++ < segs.length + 4) {
      loop.push(cur);
      const cand = ends.get(key(cur));
      let nxt: Pt | null = null;
      if (cand) {
        for (const e of cand) {
          if (!used[e.si]) { used[e.si] = 1; nxt = e.other; break; }
        }
      }
      if (!nxt) break;
      cur = nxt;
    }
    if (loop.length < 3) continue;
    const sm = rdp(loop, EPS);
    if (sm.length < 3) continue;
    d += splinePath(sm);
  }
  return d;
}

export function createSketch(container: HTMLElement): SketchHandle {
  let currentParams: HalftoneParams = { ...DEFAULT_PARAMS };
  let loadedImage: p5.Image | null = null;
  // Forces full-resolution rendering during exports even when preview is on
  let exportFullRes = false;

  // Current canvas / buffer dimensions (longest side = canvasSize, aspect-correct)
  let cw = currentParams.canvasSize;
  let ch = currentParams.canvasSize;

  // Offscreen buffer holding the rendered halftone dots (pre-post-processing)
  let pg: p5.Graphics | null = null;
  // Offscreen buffer holding the source image scaled to cw × ch
  let src: p5.Graphics | null = null;
  // AI foreground mask (subject cutout) at native resolution; alpha = foreground
  let foregroundMask: ImageBitmap | null = null;
  // Offscreen buffer holding the mask fitted to cw × ch (same transform as src)
  let maskPg: p5.Graphics | null = null;

  // ---------------------------------------------------------------- helpers

  /**
   * Parse a hex color string like "#rrggbb" into { r, g, b } (0–255 each).
   */
  function parseHex(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  /**
   * Resolution scale factor: < 1 while preview mode is on (and not exporting).
   * All px-based params are multiplied by this so the preview looks identical.
   */
  function renderScale(): number {
    if (exportFullRes || !currentParams.preview) return 1;
    const longest =
      currentParams.mode === 'text'
        ? Math.max(currentParams.canvasWidth, currentParams.canvasHeight)
        : currentParams.canvasSize;
    return Math.min(1, PREVIEW_MAX / longest);
  }

  /** Whether the current mode has something to render. */
  function hasContent(): boolean {
    if (currentParams.mode === 'text') {
      return !!currentParams.fontFamily && currentParams.text.length > 0;
    }
    return !!loadedImage;
  }

  /** Deterministic PRNG so the source grain is stable across re-renders. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Compute w/h so the longest side equals canvasSize and aspect ratio matches
   * the loaded image. If no image is loaded, keeps square canvasSize × canvasSize.
   */
  function computeDims(): { w: number; h: number } {
    const scaleDims = renderScale();
    // Text mode: free width × height
    if (currentParams.mode === 'text') {
      return {
        w: Math.max(1, Math.round(currentParams.canvasWidth * scaleDims)),
        h: Math.max(1, Math.round(currentParams.canvasHeight * scaleDims)),
      };
    }
    const size = Math.round(currentParams.canvasSize * scaleDims);
    const fmt = currentParams.canvasFormat;
    if (fmt === 'din-portrait') {
      return { w: Math.max(1, Math.round(size / Math.SQRT2)), h: size };
    }
    if (fmt === 'din-landscape') {
      return { w: size, h: Math.max(1, Math.round(size / Math.SQRT2)) };
    }
    if (fmt === 'square') {
      return { w: size, h: size };
    }
    // 'auto': follow image aspect, square if no image
    if (!loadedImage) return { w: size, h: size };
    const imgW = loadedImage.width;
    const imgH = loadedImage.height;
    if (imgW >= imgH) {
      const h = Math.max(1, Math.round((imgH / imgW) * size));
      return { w: size, h };
    } else {
      const w = Math.max(1, Math.round((imgW / imgH) * size));
      return { w, h: size };
    }
  }

  /**
   * Resize canvas + recreate pg/src at the computed aspect-correct dimensions.
   * Called on canvasSize change and after an image loads.
   */
  function applyCanvasSize(p5inst: p5): void {
    const { w, h } = computeDims();
    cw = w;
    ch = h;

    p5inst.resizeCanvas(w, h);

    if (pg) pg.remove();
    pg = p5inst.createGraphics(w, h);
    pg.pixelDensity(1);

    if (src) src.remove();
    src = p5inst.createGraphics(w, h);
    src.pixelDensity(1);

    if (maskPg) maskPg.remove();
    maskPg = p5inst.createGraphics(w, h);
    maskPg.pixelDensity(1);
  }

  /**
   * Scale the loaded image into the src buffer (no cropping), apply optional
   * pre-blur and luminance grain, then reload pixels for sampling.
   */
  /**
   * Render the current text into the src buffer (black on white) inside the
   * normalized textBox, with word wrapping, alignment and variable-font axes.
   */
  function renderText(): void {
    if (!src) return;
    const {
      text, fontFamily, fontSize, lineHeight, letterSpacing,
      textAlign, fontAxes, textBox,
    } = currentParams;
    const scale = renderScale();

    src.clear();
    src.background(255);
    if (!fontFamily || text.length === 0) {
      src.loadPixels();
      return;
    }

    const ctx = (src as any).drawingContext as CanvasRenderingContext2D;
    const fs = fontSize * scale;
    const lh = fs * lineHeight;

    // Box in buffer pixels
    const bx = textBox.x * cw;
    const by = textBox.y * ch;
    const bw = textBox.w * cw;
    const bh = textBox.h * ch;

    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, by, bw, bh);
    ctx.clip();

    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';
    ctx.textAlign = textAlign;
    ctx.font = `${fs}px "${fontFamily}"`;
    (ctx as any).letterSpacing = `${letterSpacing * scale}px`;
    const axisStr = Object.entries(fontAxes)
      .map(([tag, v]) => `"${tag}" ${v}`)
      .join(', ');
    (ctx as any).fontVariationSettings = axisStr || 'normal';

    // Word-wrap each explicit line on the box width.
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > bw && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }

    const tx = textAlign === 'left' ? bx : textAlign === 'right' ? bx + bw : bx + bw / 2;
    let ty = by;
    for (const line of lines) {
      if (ty > by + bh) break;
      ctx.fillText(line, tx, ty);
      ty += lh;
    }

    ctx.restore();
    // Reset context state that p5 may rely on elsewhere
    (ctx as any).letterSpacing = '0px';
    (ctx as any).fontVariationSettings = 'normal';
    src.loadPixels();
  }

  /**
   * Cover-fit transform (like CSS background-size: cover) for content of the
   * given native size into the current cw × ch buffer, honoring the image pan
   * offset. Shared by the source image and the AI mask so they stay aligned.
   */
  function coverFit(contentW: number, contentH: number): {
    dx: number; dy: number; dw: number; dh: number;
  } {
    const s = Math.max(cw / contentW, ch / contentH);
    const dw = contentW * s;
    const dh = contentH * s;
    const dx = -(dw - cw) * currentParams.imageOffsetX;
    const dy = -(dh - ch) * currentParams.imageOffsetY;
    return { dx, dy, dw, dh };
  }

  /**
   * Draw the foreground mask into maskPg using the same cover-fit transform as
   * the source image, so mask alpha at (x,y) corresponds to the sampled pixel.
   * Areas outside the mask stay alpha 0 (treated as background).
   */
  function rebuildMask(): void {
    if (!maskPg) return;
    maskPg.clear();
    if (!foregroundMask || currentParams.mode !== 'image') return;
    const { dx, dy, dw, dh } = coverFit(foregroundMask.width, foregroundMask.height);
    const ctx = (maskPg as any).drawingContext as CanvasRenderingContext2D;
    ctx.drawImage(foregroundMask, dx, dy, dw, dh);
    maskPg.loadPixels();
  }

  function rebuildSrc(): void {
    if (currentParams.mode === 'text') {
      renderText();
      return;
    }
    if (!loadedImage || !src) return;
    const { preBlur, noiseAmount } = currentParams;
    const scale = renderScale();

    src.clear();
    src.background(255);

    const ctx = (src as any).drawingContext as CanvasRenderingContext2D;
    const imgW = loadedImage.width;
    const imgH = loadedImage.height;
    const { dx, dy, dw, dh } = coverFit(imgW, imgH);
    const useFilter = canvasBlurSupported();
    if (preBlur > 0 && useFilter) ctx.filter = `blur(${preBlur * scale}px)`;
    src.image(loadedImage, dx, dy, dw, dh);
    if (preBlur > 0 && useFilter) ctx.filter = 'none';

    // Fallback blur for browsers without canvas filter support (e.g. iOS Safari)
    if (preBlur > 0 && !useFilter) {
      const id = ctx.getImageData(0, 0, cw, ch);
      gaussianBlur(id.data, cw, ch, preBlur * scale);
      ctx.putImageData(id, 0, 0);
    }

    if (noiseAmount > 0) {
      const imgData = ctx.getImageData(0, 0, cw, ch);
      const d = imgData.data;
      const rand = mulberry32(1337);
      for (let i = 0; i < d.length; i += 4) {
        const n = (rand() - 0.5) * 2 * noiseAmount;
        d[i]     = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      }
      ctx.putImageData(imgData, 0, 0);
    }

    src.loadPixels();
    rebuildMask();
  }

  /**
   * Combined post-processing pass: optional metaball ink bleed + colorize.
   *
   * Internally pg holds black dots on white (grayscale). This function:
   *   1. If radius > 0: Gaussian blur + smoothstep threshold → t per pixel
   *      (t=1 background, t=0 full ink). If radius === 0: t = v/255 directly.
   *   2. Colorize per pixel using dotColor / bgColor / transparentBg.
   */
  function applyPost(pg: p5.Graphics, params: HalftoneParams): void {
    const { inkBleed, dotColor, bgColor, transparentBg } = params;
    const radius = inkBleed * renderScale();
    const w = pg.width;
    const h = pg.height;

    let imgData: ImageData;

    if (radius > 0) {
      // Blur + smoothstep (existing metaball logic)
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d')!;
      // White base so the blur doesn't darken edges by sampling transparent
      // pixels outside the canvas bounds.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      const useFilter = canvasBlurSupported();
      if (useFilter) ctx.filter = `blur(${radius}px)`;
      ctx.drawImage((pg as any).elt, 0, 0);
      if (useFilter) ctx.filter = 'none';
      imgData = ctx.getImageData(0, 0, w, h);
      // Fallback blur for browsers without canvas filter support (e.g. iOS Safari)
      if (!useFilter) gaussianBlur(imgData.data, w, h, radius);
      const d = imgData.data;
      const soft = 0.08; // smoothstep half-width → anti-aliased edges
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i] / 255;
        let t = (v - (0.5 - soft)) / (2 * soft);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        t = t * t * (3 - 2 * t); // smoothstep
        d[i] = d[i + 1] = d[i + 2] = Math.round(t * 255);
        d[i + 3] = 255;
      }
    } else {
      // No blur: read pg pixels directly (dots are anti-aliased by p5 already)
      const pgCtxRead = (pg as any).drawingContext as CanvasRenderingContext2D;
      imgData = pgCtxRead.getImageData(0, 0, w, h);
    }

    // Colorize pass
    const dot = parseHex(dotColor);
    const bg = parseHex(bgColor);
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      // t = 1 means background, t = 0 means full ink
      const t = d[i] / 255;
      const coverage = 1 - t; // 1 = full ink, 0 = full background

      if (transparentBg) {
        d[i]     = dot.r;
        d[i + 1] = dot.g;
        d[i + 2] = dot.b;
        d[i + 3] = Math.round(coverage * 255);
      } else {
        // lerp bgColor → dotColor by coverage
        d[i]     = Math.round(bg.r + (dot.r - bg.r) * coverage);
        d[i + 1] = Math.round(bg.g + (dot.g - bg.g) * coverage);
        d[i + 2] = Math.round(bg.b + (dot.b - bg.b) * coverage);
        d[i + 3] = 255;
      }
    }

    const pgCtx = (pg as any).drawingContext as CanvasRenderingContext2D;
    pgCtx.putImageData(imgData, 0, 0);
  }

  const sketch = (p: p5) => {
    // ------------------------------------------------------------------ setup
    p.setup = () => {
      p.createCanvas(cw, ch).parent(container);
      p.pixelDensity(1);
      p.noLoop();

      pg = p.createGraphics(cw, ch);
      pg.pixelDensity(1);

      src = p.createGraphics(cw, ch);
      src.pixelDensity(1);

      maskPg = p.createGraphics(cw, ch);
      maskPg.pixelDensity(1);
    };

    // ------------------------------------------------------------------ draw
    p.draw = () => {
      // Always clear so transparent backgrounds show through
      p.clear();

      if (!pg || !src || !hasContent()) {
        p.background(255);
        return;
      }

      const {
        stepSize,
        gridType,
        gridAngle,
        halftoneThreshold,
        minDotSize,
        maxDotSize,
        removeBackground,
        bgThreshold,
      } = currentParams;

      const useMask = removeBackground && !!foregroundMask && maskPg !== null;
      if (useMask) maskPg!.loadPixels();

      const scale = renderScale();
      // Guard against degenerate stepSize
      const step = Math.max(1, stepSize * scale);
      const minDot = minDotSize * scale;
      const maxDot = maxDotSize * scale;

      const angleRad = p.radians(gridAngle);
      const cosA = Math.cos(angleRad);
      const sinA = Math.sin(angleRad);
      const cx = cw / 2;
      const cy = ch / 2;

      // Overscan so rotation leaves no empty corners
      const overscan = Math.ceil(Math.max(cw, ch) * 0.5);

      // Make sure src pixels are loaded
      src.loadPixels();

      // Keep pg internal render as black-on-white (grayscale pipeline)
      pg.background(255);
      pg.fill(0);
      pg.noStroke();

      let rowIndex = 0;
      for (let gy = -overscan; gy < ch + overscan; gy += step) {
        for (let gx = -overscan; gx < cw + overscan; gx += step) {
          // Benday offset: every odd row shifts by half a step
          const bendayOffset =
            gridType === 'benday' && rowIndex % 2 === 1 ? step / 2 : 0;
          const gxOff = gx + bendayOffset;

          // Rotate grid coordinate around canvas center
          const dx = gxOff - cx;
          const dy = gy - cy;
          const rx = cx + dx * cosA - dy * sinA;
          const ry = cy + dx * sinA + dy * cosA;

          // Sample luminance from src buffer
          const sx = Math.floor(rx);
          const sy = Math.floor(ry);
          if (sx < 0 || sx >= cw || sy < 0 || sy >= ch) continue;

          const idx = (sx + sy * cw) * 4;

          // Drop dots that fall in the AI-segmented background
          if (useMask && maskPg!.pixels[idx + 3] < bgThreshold) continue;

          const r = src.pixels[idx];
          const g = src.pixels[idx + 1];
          const b = src.pixels[idx + 2];
          const lum = (r + g + b) / 3;

          if (lum < halftoneThreshold) {
            // Darker pixels → bigger dots
            const dotSize = p.map(lum, 0, halftoneThreshold, maxDot, minDot);
            pg.circle(rx, ry, dotSize);
          }
        }
        rowIndex++;
      }

      // Post-processing: colorize (and optionally ink-bleed merge)
      applyPost(pg, currentParams);

      p.image(pg, 0, 0);
    };
  };

  // Instantiate p5 in instance mode
  const p5Instance = new p5(sketch);

  // ------------------------------------------------------------------ API

  function setParams(params: HalftoneParams): void {
    const prev = currentParams;
    currentParams = { ...params };

    const resolutionChanged =
      params.canvasSize !== prev.canvasSize ||
      params.preview !== prev.preview ||
      params.canvasFormat !== prev.canvasFormat ||
      params.mode !== prev.mode ||
      params.canvasWidth !== prev.canvasWidth ||
      params.canvasHeight !== prev.canvasHeight;
    const srcChanged =
      params.preBlur !== prev.preBlur ||
      params.noiseAmount !== prev.noiseAmount ||
      params.imageOffsetX !== prev.imageOffsetX ||
      params.imageOffsetY !== prev.imageOffsetY ||
      params.text !== prev.text ||
      params.fontFamily !== prev.fontFamily ||
      params.fontSize !== prev.fontSize ||
      params.lineHeight !== prev.lineHeight ||
      params.letterSpacing !== prev.letterSpacing ||
      params.textAlign !== prev.textAlign ||
      params.textBox !== prev.textBox ||
      params.fontAxes !== prev.fontAxes;

    if (resolutionChanged) {
      applyCanvasSize(p5Instance);
      rebuildSrc();
    } else if (srcChanged) {
      rebuildSrc();
    }

    p5Instance.redraw();
  }

  function setImage(url: string): void {
    p5Instance.loadImage(
      url,
      (img: p5.Image) => {
        loadedImage = img;
        applyCanvasSize(p5Instance);
        rebuildSrc();
        p5Instance.redraw();
      },
      () => {
        console.warn('[halftoneSketch] Failed to load image:', url);
      },
    );
  }

  function clearImage(): void {
    loadedImage = null;
    applyCanvasSize(p5Instance);
    rebuildSrc();
    p5Instance.redraw();
  }

  function setMask(bitmap: ImageBitmap | null): void {
    foregroundMask = bitmap;
    rebuildMask();
    p5Instance.redraw();
  }

  async function exportImage(format: ExportFormat): Promise<void> {
    // Exports always run at full resolution: temporarily leave preview mode,
    // re-render, export, then restore the preview-resolution canvas.
    const needFullRes = renderScale() < 1;
    if (needFullRes) {
      exportFullRes = true;
      applyCanvasSize(p5Instance);
      rebuildSrc();
      p5Instance.redraw();
      // p5 2.x does not guarantee the redraw has flushed to the graphics
      // buffers before the next line, so wait one frame before reading pixels.
      await new Promise<void>(r => requestAnimationFrame(() => r()));
    }
    try {
      await doExport(format);
    } finally {
      if (needFullRes) {
        exportFullRes = false;
        applyCanvasSize(p5Instance);
        rebuildSrc();
        p5Instance.redraw();
      }
    }
  }

  async function doExport(format: ExportFormat): Promise<void> {
    const { transparentBg, bgColor } = currentParams;

    if (format === 'png') {
      p5Instance.saveCanvas('halftone', 'png');

    } else if (format === 'jpg') {
      if (transparentBg) {
        // Flatten transparent bg onto bgColor before JPEG encoding
        const mainCanvas = (p5Instance as any).canvas as HTMLCanvasElement;
        const tmp = document.createElement('canvas');
        tmp.width = mainCanvas.width;
        tmp.height = mainCanvas.height;
        const ctx = tmp.getContext('2d')!;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, tmp.width, tmp.height);
        ctx.drawImage(mainCanvas, 0, 0);
        tmp.toBlob(
          (blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'halftone.jpg';
            a.click();
            URL.revokeObjectURL(url);
          },
          'image/jpeg',
          0.92,
        );
      } else {
        p5Instance.saveCanvas('halftone', 'jpg');
      }

    } else if (format === 'svg') {
      // Vectorize the post-processed bitmap (including ink-bleed metaball
      // merging) by tracing the boundary between ink and background pixels.
      const { dotColor, bgColor: bg } = currentParams;

      // Build a continuous ink-intensity field (0–255) from the post-processed
      // pg buffer; marching squares interpolates its sub-pixel boundary.
      const pgCtx = (pg as any).drawingContext as CanvasRenderingContext2D;
      const data = pgCtx.getImageData(0, 0, cw, ch).data;
      const field = new Float32Array(cw * ch);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        if (transparentBg) {
          field[p] = data[i + 3];
        } else {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          field[p] = 255 - lum;
        }
      }

      const d = traceContours(field, cw, ch);

      const bgRect = transparentBg
        ? ''
        : `\n  <rect width="100%" height="100%" fill="${bg}"/>`;
      // evenodd fill-rule carves holes regardless of loop winding.
      const pathEl = d
        ? `\n  <path d="${d}" fill="${dotColor}" fill-rule="evenodd"/>`
        : '';

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${bgRect}${pathEl}
</svg>`;

      downloadSvg(svg);
    }
  }

  function downloadSvg(svgStr: string): void {
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'halftone.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  function destroy(): void {
    pg?.remove();
    src?.remove();
    maskPg?.remove();
    p5Instance.remove();
  }

  return { setParams, setImage, clearImage, setMask, exportImage, destroy };
}
