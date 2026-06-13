import { useRef } from 'react';

interface Props {
  value: string;
  onChange: (hex: string) => void;
}

export default function ColorWheel({ value, onChange }: Props) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const { h, s, v } = hexToHsv(value);

  function pick(clientX: number, clientY: number) {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const r = rect.width / 2;
    const dx = clientX - (rect.left + r);
    const dy = clientY - (rect.top + r);
    const sat = Math.min(1, Math.hypot(dx, dy) / r);
    let hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    hue = (hue + 360) % 360;
    onChange(hsvToHex(hue, sat, v));
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    pick(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => pick(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const ang = ((h - 90) * Math.PI) / 180;
  const mx = 50 + Math.cos(ang) * s * 50;
  const my = 50 + Math.sin(ang) * s * 50;

  return (
    <div className="color-wheel-wrap">
      <div
        ref={wheelRef}
        className="color-wheel"
        onPointerDown={onPointerDown}
        style={{ ['--v' as string]: String(1 - v) }}
      >
        <div
          className="color-wheel__marker"
          style={{ left: `${mx}%`, top: `${my}%`, background: value }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(v * 100)}
        className="slider"
        onChange={e => onChange(hsvToHex(h, s, parseInt(e.target.value, 10) / 100))}
      />
    </div>
  );
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (m.length === 3) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
