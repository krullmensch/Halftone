import p5 from 'p5';
import type { HalftoneParams, ExportFormat, SketchHandle } from '../types';
import { DEFAULT_PARAMS } from '../types';

/** Longest canvas side while preview mode is active. */
const PREVIEW_MAX = 1000;

/**
 * Trace the boundary between ink (1) and background (0) pixels of a W×H mask
 * into SVG path data. Each ink/background pixel edge becomes a unit grid edge,
 * directed so ink stays on the left; the edges stitch into closed loops where
 * outer contours wind clockwise and holes counter-clockwise (nonzero fill rule
 * then carves holes out). Axis-aligned, so it reproduces the raster exactly —
 * including ink-bleed-merged blobs.
 */
function traceContours(mask: Uint8Array, W: number, H: number): string {
  const stride = W + 1;
  // Outgoing directed edges per grid vertex (vertex key = y*stride + x).
  const out = new Map<number, number[]>();
  const addEdge = (sx: number, sy: number, ex: number, ey: number) => {
    const sk = sy * stride + sx;
    const ek = ey * stride + ex;
    const arr = out.get(sk);
    if (arr) arr.push(ek);
    else out.set(sk, [ek]);
  };
  const ink = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x] !== 1) continue;
      if (!ink(x, y - 1)) addEdge(x, y, x + 1, y);             // top → right
      if (!ink(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);     // bottom → left
      if (!ink(x - 1, y)) addEdge(x, y + 1, x, y);             // left → up
      if (!ink(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);     // right → down
    }
  }

  let d = '';
  for (const [startKey, arr] of out) {
    while (arr.length > 0) {
      let curKey = startKey;
      const sx = startKey % stride;
      const sy = (startKey - sx) / stride;
      let segs = `M${sx} ${sy}`;
      let prevDx = 0, prevDy = 0;
      let lastX = sx, lastY = sy;
      let count = 0;
      while (true) {
        const outs = out.get(curKey);
        if (!outs || outs.length === 0) break;
        const nextKey = outs.pop()!;
        const nx = nextKey % stride;
        const ny = (nextKey - nx) / stride;
        const dx = Math.sign(nx - lastX);
        const dy = Math.sign(ny - lastY);
        if (count > 0 && dx === prevDx && dy === prevDy) {
          // Collinear: extend the previous segment instead of adding a vertex.
          segs = segs.slice(0, segs.lastIndexOf('L'));
        }
        segs += `L${nx} ${ny}`;
        prevDx = dx; prevDy = dy;
        lastX = nx; lastY = ny;
        curKey = nextKey;
        count++;
        if (curKey === startKey) break;
      }
      if (count >= 2) d += segs + 'Z';
    }
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
    return Math.min(1, PREVIEW_MAX / currentParams.canvasSize);
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
    const size = Math.round(currentParams.canvasSize * renderScale());
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
  }

  /**
   * Scale the loaded image into the src buffer (no cropping), apply optional
   * pre-blur and luminance grain, then reload pixels for sampling.
   */
  function rebuildSrc(): void {
    if (!loadedImage || !src) return;
    const { preBlur, noiseAmount } = currentParams;
    const scale = renderScale();

    src.clear();
    src.background(255);

    const ctx = (src as any).drawingContext as CanvasRenderingContext2D;
    const imgW = loadedImage.width;
    const imgH = loadedImage.height;
    const s = Math.max(cw / imgW, ch / imgH);
    const dw = imgW * s;
    const dh = imgH * s;
    const dx = -(dw - cw) * currentParams.imageOffsetX;
    const dy = -(dh - ch) * currentParams.imageOffsetY;
    if (preBlur > 0) ctx.filter = `blur(${preBlur * scale}px)`;
    src.image(loadedImage, dx, dy, dw, dh);
    if (preBlur > 0) ctx.filter = 'none';

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
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage((pg as any).elt, 0, 0);
      imgData = ctx.getImageData(0, 0, w, h);
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
    };

    // ------------------------------------------------------------------ draw
    p.draw = () => {
      // Always clear so transparent backgrounds show through
      p.clear();

      if (!loadedImage || !pg || !src) {
        p.background(240);
        return;
      }

      const {
        stepSize,
        gridType,
        gridAngle,
        halftoneThreshold,
        minDotSize,
        maxDotSize,
      } = currentParams;

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
      params.canvasFormat !== prev.canvasFormat;
    const srcChanged =
      params.preBlur !== prev.preBlur ||
      params.noiseAmount !== prev.noiseAmount ||
      params.imageOffsetX !== prev.imageOffsetX ||
      params.imageOffsetY !== prev.imageOffsetY;

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

      // Build a binary ink mask (1 = ink) from the post-processed pg buffer.
      const pgCtx = (pg as any).drawingContext as CanvasRenderingContext2D;
      const data = pgCtx.getImageData(0, 0, cw, ch).data;
      const mask = new Uint8Array(cw * ch);
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        let isInk: boolean;
        if (transparentBg) {
          isInk = data[i + 3] > 128;
        } else {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          isInk = lum < 128;
        }
        mask[p] = isInk ? 1 : 0;
      }

      const d = traceContours(mask, cw, ch);

      const bgRect = transparentBg
        ? ''
        : `\n  <rect width="100%" height="100%" fill="${bg}"/>`;
      // Outer boundaries wind clockwise, holes counter-clockwise → the default
      // nonzero fill rule punches holes out automatically.
      const pathEl = d
        ? `\n  <path d="${d}" fill="${dotColor}"/>`
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
    p5Instance.remove();
  }

  return { setParams, setImage, exportImage, destroy };
}
