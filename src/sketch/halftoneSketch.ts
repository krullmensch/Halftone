import p5 from 'p5';
import { potrace } from 'esm-potrace-wasm';
import type { HalftoneParams, ExportFormat, SketchHandle } from '../types';
import { DEFAULT_PARAMS } from '../types';

export function createSketch(container: HTMLElement): SketchHandle {
  let currentParams: HalftoneParams = { ...DEFAULT_PARAMS };
  let loadedImage: p5.Image | null = null;

  // Current canvas / buffer dimensions (longest side = canvasSize, aspect-correct)
  let cw = currentParams.canvasSize;
  let ch = currentParams.canvasSize;

  // Offscreen buffer holding the rendered halftone dots (pre-post-processing)
  let pg: p5.Graphics | null = null;
  // Offscreen buffer holding the source image scaled to cw × ch
  let src: p5.Graphics | null = null;

  // Collected dot geometry for SVG export (cleared at start of each draw)
  // Note: ink bleed merging is raster-only and is not represented in SVG.
  interface DotRecord { x: number; y: number; size: number; r: number }
  let dots: DotRecord[] = [];

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
   * Compute w/h so the longest side equals canvasSize and aspect ratio matches
   * the loaded image. If no image is loaded, keeps square canvasSize × canvasSize.
   */
  function computeDims(): { w: number; h: number } {
    const size = currentParams.canvasSize;
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
   * Scale the loaded image into the src buffer (no cropping), then reload pixels.
   */
  function rebuildSrc(): void {
    if (!loadedImage || !src) return;
    src.clear();
    src.background(255);
    src.image(loadedImage, 0, 0, cw, ch);
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
    const { inkBleed: radius, dotColor, bgColor, transparentBg } = params;
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
        noiseAmount,
        halftoneThreshold,
        minDotSize,
        maxDotSize,
        cornerRadiusPct,
      } = currentParams;

      // Guard against degenerate stepSize
      const step = Math.max(1, stepSize);

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

      // Reset dot collection for SVG export
      dots = [];

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
          let rx = cx + dx * cosA - dy * sinA;
          let ry = cy + dx * sinA + dy * cosA;

          // Perlin noise displacement
          if (noiseAmount > 0) {
            const nx = (p.noise(gxOff * 0.05, gy * 0.05) - 0.5) * 2 * noiseAmount;
            const ny =
              (p.noise(gxOff * 0.05 + 1000, gy * 0.05 + 1000) - 0.5) *
              2 *
              noiseAmount;
            rx += nx;
            ry += ny;
          }

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
            const dotSize = p.map(lum, 0, halftoneThreshold, maxDotSize, minDotSize);
            const radius = (dotSize * cornerRadiusPct) / 100;

            pg.push();
            pg.translate(rx, ry);
            pg.rotate(angleRad);
            pg.rect(-dotSize / 2, -dotSize / 2, dotSize, dotSize, radius);
            pg.pop();

            // Record for SVG export (final world-space position, already transformed)
            dots.push({ x: rx, y: ry, size: dotSize, r: radius });
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
    const prevSize = currentParams.canvasSize;
    currentParams = { ...params };

    if (params.canvasSize !== prevSize) {
      applyCanvasSize(p5Instance);
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
      // Trace the post-processed bitmap (including ink-bleed metaball merging)
      // with potrace to produce a clean vector path.
      const { dotColor, bgColor: bg } = currentParams;

      // ── 1. Build a binary black-on-white mask canvas from the pg buffer ──
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = cw;
      maskCanvas.height = ch;
      const maskCtx = maskCanvas.getContext('2d')!;

      // White background (potrace: white = background, black = ink)
      maskCtx.fillStyle = '#ffffff';
      maskCtx.fillRect(0, 0, cw, ch);

      // Read post-processed pixels from pg
      const pgCtx = (pg as any).drawingContext as CanvasRenderingContext2D;
      const srcData = pgCtx.getImageData(0, 0, cw, ch);
      const maskData = maskCtx.createImageData(cw, ch);
      const s = srcData.data;
      const m = maskData.data;

      for (let i = 0; i < s.length; i += 4) {
        let isInk: boolean;
        if (transparentBg) {
          // Ink wherever alpha > 128 (bg is transparent)
          isInk = s[i + 3] > 128;
        } else {
          // Ink wherever luminance < 128
          const lum = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
          isInk = lum < 128;
        }
        const v = isInk ? 0 : 255;
        m[i]     = v;
        m[i + 1] = v;
        m[i + 2] = v;
        m[i + 3] = 255;
      }
      maskCtx.putImageData(maskData, 0, 0);

      // ── 2. Trace with potrace ──
      let svgOut: string;
      try {
        svgOut = await potrace(maskCanvas, {
          turdsize: 2,
          alphamax: 1,
          opttolerance: 0.2,
        });
      } catch (err) {
        console.error('[halftoneSketch] potrace failed, falling back to per-dot SVG:', err);
        // Fallback: per-dot rect SVG (original behaviour, no ink bleed)
        const { gridAngle } = currentParams;
        const fmt = (n: number) => n.toFixed(2);
        const rects = dots
          .map(({ x, y, size, r }) => {
            const hx = fmt(x - size / 2);
            const hy = fmt(y - size / 2);
            const sz = fmt(size);
            const rx = fmt(r);
            const cx2 = fmt(x);
            const cy2 = fmt(y);
            return `<rect x="${hx}" y="${hy}" width="${sz}" height="${sz}" rx="${rx}" transform="rotate(${gridAngle} ${cx2} ${cy2})"/>`;
          })
          .join('\n    ');
        const bgRect2 = transparentBg
          ? ''
          : `\n  <rect width="100%" height="100%" fill="${bg}"/>`;
        svgOut = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">${bgRect2}
  <g fill="${dotColor}">
    ${rects}
  </g>
</svg>`;
        downloadSvg(svgOut);
        return;
      }

      // ── 3. Extract path d= attributes from potrace output ──
      const pathRe = /d="([^"]+)"/g;
      const dValues: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = pathRe.exec(svgOut)) !== null) {
        dValues.push(match[1]);
      }

      // ── 4. Build our own SVG with correct viewBox and colors ──
      const bgRect = transparentBg
        ? ''
        : `\n  <rect width="100%" height="100%" fill="${bg}"/>`;

      const pathEl = dValues.length > 0
        ? `\n  <path d="${dValues.join(' ')}" fill="${dotColor}"/>`
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
