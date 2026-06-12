import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';

export interface DropEffectHandle {
  setPos(x: number, y: number): void;
}

const CORE = 30;     // central mass radius (the "hole")
const ORBIT = 200;   // spawn distance from cursor (px)
const N = 26;        // particle count

interface P {
  angle: number;
  radius: number;  // current orbit distance, shrinking inward
  speed: number;   // inward px/frame — varies per particle
  spin: number;    // angular drift
  r: number;       // dot radius
  wx: number;      // world (screen) position, lags its orbit target
  wy: number;
  drag: number;    // ease factor toward target — lower = slimier trail
}

function spawn(): P {
  return {
    angle: Math.random() * Math.PI * 2,
    radius: ORBIT * (0.7 + Math.random() * 0.3),
    speed: 0.5 + Math.random() * 2.6,
    spin: (Math.random() - 0.5) * 0.05,
    r: 9 + Math.random() * 16,
    wx: 0,
    wy: 0,
    drag: 0.06 + Math.random() * 0.16,
  };
}

const DropEffect = forwardRef<DropEffectHandle>((_, ref) => {
  const circleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const coreRef = useRef<SVGCircleElement | null>(null);
  const particles = useRef<P[]>(Array.from({ length: N }, spawn));
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const core = useRef<{ x: number; y: number } | null>(null);
  const [dims, setDims] = useState({ w: window.innerWidth, h: window.innerHeight });

  useImperativeHandle(ref, () => ({
    setPos(x, y) {
      cursor.current = { x, y };
      if (!core.current) {
        // Snap everything to the cursor on first frame (no fly-in).
        core.current = { x, y };
        for (const p of particles.current) {
          p.wx = x + Math.cos(p.angle) * p.radius;
          p.wy = y + Math.sin(p.angle) * p.radius;
        }
      }
    },
  }), []);

  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const cu = cursor.current;
      if (cu) {
        // Core trails the cursor a touch for cohesion.
        const co = core.current!;
        co.x += (cu.x - co.x) * 0.22;
        co.y += (cu.y - co.y) * 0.22;
        if (coreRef.current) {
          coreRef.current.setAttribute('cx', String(co.x));
          coreRef.current.setAttribute('cy', String(co.y));
        }

        const ps = particles.current;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          p.radius -= p.speed;
          p.angle += p.spin;
          if (p.radius <= CORE) {
            const np = spawn();
            np.wx = p.wx;
            np.wy = p.wy; // keep current spot so it re-streams, no jump
            ps[i] = np;
            continue;
          }
          // Each blob eases toward its own orbit point → individual slime drag.
          const tx = cu.x + Math.cos(p.angle) * p.radius;
          const ty = cu.y + Math.sin(p.angle) * p.radius;
          p.wx += (tx - p.wx) * p.drag;
          p.wy += (ty - p.wy) * p.drag;
          const el = circleRefs.current[i];
          if (el) {
            el.setAttribute('cx', String(p.wx));
            el.setAttribute('cy', String(p.wy));
            el.setAttribute('r', String(p.r));
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      className="drop-effect"
      width={dims.w}
      height={dims.h}
      viewBox={`0 0 ${dims.w} ${dims.h}`}
    >
      <defs>
        <filter id="metaball">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
          />
        </filter>
      </defs>
      <g filter="url(#metaball)" fill="#000">
        <circle ref={coreRef} cx={-999} cy={-999} r={CORE} />
        {particles.current.map((_, i) => (
          <circle
            key={i}
            ref={el => {
              circleRefs.current[i] = el;
            }}
            cx={-999}
            cy={-999}
            r={12}
          />
        ))}
      </g>
    </svg>
  );
});

DropEffect.displayName = 'DropEffect';

export default DropEffect;
