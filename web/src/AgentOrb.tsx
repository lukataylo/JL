import { useEffect, useRef } from "react";
import "./request-agent.css";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "approved" | "declined";

type RGB = [number, number, number];
interface Palette { hi: RGB; mid: RGB; core: RGB; deep: RGB; accent: RGB; glow: RGB }
interface Params { speed: number; wobble: number; pulse: number; pulseFreq: number; rings: number; shimmer: number; particles: number; scale: number; talk: number }

const PALETTES: Record<OrbState, Palette> = {
  idle:      { hi: [240, 255, 244], mid: [150, 230, 172], core: [63, 191, 106],  deep: [24, 140, 72],  accent: [200, 246, 150], glow: [63, 191, 106] },
  listening: { hi: [236, 255, 248], mid: [134, 239, 190], core: [40, 205, 140],  deep: [12, 140, 100], accent: [110, 225, 245], glow: [40, 205, 150] },
  thinking:  { hi: [236, 244, 255], mid: [120, 214, 228], core: [56, 170, 200],  deep: [72, 70, 210],  accent: [150, 130, 255], glow: [90, 120, 245] },
  speaking:  { hi: [240, 255, 246], mid: [160, 240, 200], core: [48, 196, 128],  deep: [14, 140, 120], accent: [196, 242, 110], glow: [52, 199, 128] },
  approved:  { hi: [240, 255, 244], mid: [120, 236, 160], core: [30, 200, 90],   deep: [16, 128, 58],  accent: [190, 250, 120], glow: [34, 210, 96] },
  declined:  { hi: [255, 240, 240], mid: [252, 160, 160], core: [232, 68, 72],   deep: [168, 24, 40],  accent: [255, 150, 90],  glow: [235, 70, 75] },
};

const PARAMS: Record<OrbState, Params> = {
  idle:      { speed: 0.55, wobble: 0.035, pulse: 0.03,  pulseFreq: 1.1, rings: 0,   shimmer: 0,   particles: 0.45, scale: 1,    talk: 0 },
  listening: { speed: 1.0,  wobble: 0.05,  pulse: 0.015, pulseFreq: 2.2, rings: 1,   shimmer: 0,   particles: 0.6,  scale: 1.02, talk: 0 },
  thinking:  { speed: 2.8,  wobble: 0.06,  pulse: 0.02,  pulseFreq: 3.4, rings: 0,   shimmer: 1,   particles: 1,    scale: 0.97, talk: 0 },
  speaking:  { speed: 1.4,  wobble: 0.06,  pulse: 0.01,  pulseFreq: 1.5, rings: 0.35, shimmer: 0.2, particles: 0.7, scale: 1,    talk: 1 },
  approved:  { speed: 0.7,  wobble: 0.025, pulse: 0.018, pulseFreq: 1.4, rings: 0,   shimmer: 0,   particles: 1,    scale: 1.04, talk: 0 },
  declined:  { speed: 0.3,  wobble: 0.015, pulse: 0.008, pulseFreq: 0.8, rings: 0,   shimmer: 0,   particles: 0.2,  scale: 0.9,  talk: 0 },
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixRGB = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const clonePal = (p: Palette): Palette => ({ hi: [...p.hi], mid: [...p.mid], core: [...p.core], deep: [...p.deep], accent: [...p.accent], glow: [...p.glow] });

const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  a: (i / 22) * Math.PI * 2 + Math.sin(i * 7.1) * 0.4,
  r: 1.08 + ((i * 37) % 11) / 26,
  s: 0.12 + ((i * 13) % 7) / 40,
  dir: i % 3 === 0 ? -1 : 1,
  tw: (i * 1.7) % 6.28,
  size: 0.9 + ((i * 5) % 4) * 0.45,
}));

/** Animated Clearance agent orb — a luminous, morphing glass sphere drawn on canvas. */
export function AgentOrb({ state, size = 160, level }: { state: OrbState; size?: number; level?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const levelRef = useRef(level ?? 0);
  const changedAt = useRef(0);

  useEffect(() => { levelRef.current = level ?? 0; }, [level]);
  useEffect(() => {
    if (stateRef.current !== state) changedAt.current = performance.now();
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size * 1.8;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(W * dpr);

    const pal = clonePal(PALETTES[stateRef.current]);
    const par: Params = { ...PARAMS[stateRef.current] };
    let t = 0;
    let last = performance.now();
    let lvl = 0;
    let raf = 0;
    const R0 = size / 2;
    const C = W / 2;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = stateRef.current;
      const k = 1 - Math.exp(-dt * 3.2);
      const tp = PALETTES[st];
      (Object.keys(pal) as (keyof Palette)[]).forEach((key) => { pal[key] = mixRGB(pal[key], tp[key], k); });
      const tpar = PARAMS[st];
      (Object.keys(par) as (keyof Params)[]).forEach((key) => { par[key] = lerp(par[key], tpar[key], k); });
      lvl = lerp(lvl, st === "listening" ? Math.min(1, levelRef.current) : 0, 1 - Math.exp(-dt * 12));
      t += dt * par.speed * (reduce ? 0.2 : 1);
      const clock = now / 1000;
      const since = (now - changedAt.current) / 1000;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, W);

      // ----- scale: breathing + level + talking + transition effects
      let scale = par.scale + (reduce ? 0 : Math.sin(clock * par.pulseFreq) * par.pulse) + lvl * 0.16;
      if (par.talk > 0.01 && !reduce) {
        const syll = Math.abs(Math.sin(clock * 7.3)) * 0.6 + Math.abs(Math.sin(clock * 11.1 + 1)) * 0.4;
        scale += syll * 0.06 * par.talk;
      }
      let dx = 0;
      if (st === "approved" && since < 1.2 && !reduce) scale += Math.sin(Math.min(1, since / 0.6) * Math.PI) * 0.1;
      if (st === "declined" && since < 0.8 && !reduce) dx = Math.sin(since * 48) * (1 - since / 0.8) * R0 * 0.09;
      const R = R0 * scale;
      const cx = C + dx;
      const cy = C;

      // ----- glow
      const glow = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.75);
      glow.addColorStop(0, rgba(pal.glow, 0.42 + lvl * 0.2));
      glow.addColorStop(0.45, rgba(pal.glow, 0.14));
      glow.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, W);

      // ----- listening / speaking rings
      if (par.rings > 0.02) {
        for (let i = 0; i < 3; i++) {
          const ph = reduce ? (i + 1) / 4 : (clock * (0.55 + lvl * 0.6) + i / 3) % 1;
          ctx.beginPath();
          ctx.arc(cx, cy, R * (1.02 + ph * 0.72), 0, Math.PI * 2);
          ctx.strokeStyle = rgba(pal.glow, (1 - ph) * 0.55 * par.rings);
          ctx.lineWidth = 1.5 + (1 - ph) * 1.5;
          ctx.stroke();
        }
      }

      // ----- approved burst
      if (st === "approved" && since < 1.6) {
        for (let i = 0; i < 2; i++) {
          const p = Math.min(1, Math.max(0, (since - i * 0.18) / 1.2));
          if (p <= 0 || p >= 1) continue;
          const e = 1 - Math.pow(1 - p, 3);
          ctx.beginPath();
          ctx.arc(cx, cy, R * (1 + e * 0.85), 0, Math.PI * 2);
          ctx.strokeStyle = rgba(pal.glow, (1 - p) * 0.8);
          ctx.lineWidth = 4 * (1 - p) + 1;
          ctx.stroke();
        }
      }

      // ----- body path (organic morph)
      const N = 72;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const w =
          Math.sin(a * 2 + t * 1.3) * 0.5 +
          Math.sin(a * 3 - t * 1.7 + 1.2) * 0.32 +
          Math.sin(a * 5 + t * 2.3 + 2.4) * 0.18 * (1 + par.talk);
        const r = R * (1 + w * par.wobble * (1 + lvl * 1.5));
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();

      ctx.save();
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.05, cx, cy, R * 1.05);
      body.addColorStop(0, rgba(pal.hi, 1));
      body.addColorStop(0.32, rgba(pal.mid, 1));
      body.addColorStop(0.72, rgba(pal.core, 1));
      body.addColorStop(1, rgba(pal.deep, 1));
      ctx.fillStyle = body;
      ctx.shadowColor = rgba(pal.deep, 0.35);
      ctx.shadowBlur = R * 0.35;
      ctx.shadowOffsetY = R * 0.12;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();

      // swirling inner blobs
      const blobs: [RGB, number, number, number, number][] = [
        [pal.accent, 0.62, 0.9, 0.0, 0.75],
        [pal.deep, 0.55, -0.7, 2.1, 0.7],
        [pal.mid, 0.5, 1.15, 4.2, 0.75],
        [pal.core, 0.45, -1.35, 1.0, 0.5],
        [pal.hi, 0.35, 0.8, 3.3, 0.55],
      ];
      for (const [col, rad, sp, ph, alpha] of blobs) {
        const bx = cx + Math.cos(t * sp + ph) * R * 0.48;
        const by = cy + Math.sin(t * sp * 1.3 + ph) * R * 0.42;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, R * rad * 1.4);
        g.addColorStop(0, rgba(col, alpha));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      }

      // luminous inner core
      ctx.globalCompositeOperation = "lighter";
      const lum = ctx.createRadialGradient(cx + Math.sin(t) * R * 0.1, cy + R * 0.08, 0, cx, cy, R * 0.75);
      lum.addColorStop(0, rgba(pal.accent, 0.22 + lvl * 0.2 + par.talk * 0.06));
      lum.addColorStop(1, rgba(pal.accent, 0));
      ctx.fillStyle = lum;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      ctx.globalCompositeOperation = "source-over";

      // thinking shimmer
      if (par.shimmer > 0.02 && "createConicGradient" in ctx) {
        const cg = ctx.createConicGradient(clock * 2.4, cx, cy);
        const s = 0.32 * par.shimmer;
        cg.addColorStop(0, `rgba(255,255,255,${s})`);
        cg.addColorStop(0.12, "rgba(255,255,255,0)");
        cg.addColorStop(0.5, `rgba(255,255,255,${s * 0.6})`);
        cg.addColorStop(0.62, "rgba(255,255,255,0)");
        cg.addColorStop(1, `rgba(255,255,255,${s})`);
        ctx.fillStyle = cg;
        ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      }

      // specular highlight + bottom shade
      const spec = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.45, 0, cx - R * 0.32, cy - R * 0.45, R * 0.55);
      spec.addColorStop(0, "rgba(255,255,255,0.85)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      const shade = ctx.createRadialGradient(cx, cy + R * 0.9, 0, cx, cy + R * 0.9, R * 0.9);
      shade.addColorStop(0, rgba(pal.deep, 0.35));
      shade.addColorStop(1, rgba(pal.deep, 0));
      ctx.fillStyle = shade;
      ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
      ctx.restore();

      // glass rim
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.stroke();

      // particles
      if (par.particles > 0.02) {
        for (const p of PARTICLES) {
          const a = p.a + clock * p.s * p.dir * (reduce ? 0.1 : 1) * (1 + par.shimmer * 2);
          const rr = R0 * p.r * (1 + Math.sin(clock * 0.7 + p.tw) * 0.04) * (st === "approved" && since < 1.5 ? 1 + (1 - since / 1.5) * 0.4 : 1);
          const al = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(clock * 2 + p.tw))) * par.particles * 0.7;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, p.size, 0, Math.PI * 2);
          ctx.fillStyle = rgba(mixRGB(pal.glow, [255, 255, 255], 0.35), al);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className={`orb orb--${state}`} style={{ width: size, height: size }} data-state={state} aria-hidden>
      <canvas ref={canvasRef} className="orb-canvas" style={{ width: size * 1.8, height: size * 1.8 }} />
      {state === "approved" && (
        <svg className="orb-mark orb-mark--check" viewBox="0 0 48 48" style={{ width: size * 0.34, height: size * 0.34 }}>
          <path d="M12 25.5 L21 34 L37 15" />
        </svg>
      )}
      {state === "declined" && (
        <svg className="orb-mark orb-mark--x" viewBox="0 0 48 48" style={{ width: size * 0.3, height: size * 0.3 }}>
          <path d="M14 14 L34 34" />
          <path d="M34 14 L14 34" />
        </svg>
      )}
    </div>
  );
}
