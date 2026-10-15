import { useEffect, useRef } from "react";
import "./request-agent.css";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "approved" | "declined" | "countered" | "referred";

/**
 * Eye shape in dot-grid units. w/h = half-size of a squircle eye, top = upper lid drop,
 * slant = lid tilt toward the nose (+ angry, - sad), happy = carve the bottom into an arch,
 * bottom = lower lid lift, lx/ly = gaze offset, gap = extra spread between the eyes.
 */
interface Eye { w: number; h: number; top: number; slant: number; happy: number; bottom: number; lx: number; ly: number; gap: number }

const EYES: Record<OrbState, Eye> = {
  idle:      { w: 3.6, h: 5.2, top: 0,   slant: 0,     happy: 0, bottom: 0,   lx: 0,    ly: 0,    gap: 0 },
  listening: { w: 4.2, h: 6.2, top: 0,   slant: 0,     happy: 0, bottom: 0,   lx: 0,    ly: 0.2,  gap: 0 },
  thinking:  { w: 3.4, h: 4.6, top: 0.6, slant: 0,     happy: 0, bottom: 0,   lx: 0.7,  ly: -0.7, gap: 0 },
  speaking:  { w: 3.8, h: 5.4, top: 0,   slant: 0,     happy: 0, bottom: 0,   lx: 0,    ly: 0,    gap: 0 },
  approved:  { w: 4.4, h: 5.2, top: 0,   slant: 0,     happy: 1, bottom: 0,   lx: 0,    ly: -0.2, gap: 0 },
  declined:  { w: 4.4, h: 5.4, top: 2.2, slant: 0.55,  happy: 0, bottom: 0,   lx: 0,    ly: 0.2,  gap: 0 },
  countered: { w: 4.4, h: 5.2, top: 2.8, slant: 0.18,  happy: 0, bottom: 1.4, lx: -0.5, ly: 0,    gap: 0 },
  referred:  { w: 3.8, h: 4.8, top: 1.6, slant: -0.42, happy: 0, bottom: 0,   lx: 0,    ly: 0.6,  gap: 0 },
};
const KEYS = ["w", "h", "top", "slant", "happy", "bottom", "lx", "ly", "gap"] as const;

function inEye(gx: number, gy: number, cx: number, cy: number, e: Eye, blink: number, side: 1 | -1) {
  const h = Math.max(0.2, e.h * (1 - blink));
  const dx = gx - cx, dy = gy - cy;
  if (Math.pow(Math.abs(dx / e.w), 4) + Math.pow(Math.abs(dy / h), 4) > 1) return false;
  if (gy < cy - h + e.top + e.slant * side * dx * 1.4) return false;
  if (e.bottom > 0.05 && dy > h - e.bottom) return false;
  if (e.happy > 0.02) {
    const r = e.w * 1.25 * e.happy, ccy = cy + h * 0.95;
    if (dx * dx + (gy - ccy) * (gy - ccy) < r * r) return false;
  }
  return true;
}

/** Clearance agent face: dot-matrix eyes on a mood aura. Same props as the old glass orb. */
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
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    // Small faces (the home button) get a coarser grid so each dot stays legible.
    const cols = size < 90 ? 15 : 22;
    const scale = cols / 30; // eye shapes are authored for a 30-column grid
    const pitch = canvas.width / cols;
    const rows = Math.floor(canvas.height / pitch);
    const cur: Eye = { ...EYES[stateRef.current] };
    const gaze = { x: 0, y: 0 };
    let blink = 0, blinkAt = -1, nextBlink = performance.now() + 1800, raf = 0;

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      gaze.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.4)));
      gaze.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.5)));
    };
    window.addEventListener("pointermove", onMove);

    const frame = (now: number) => {
      const st = stateRef.current;
      const since = (now - changedAt.current) / 1000;
      const tg: Eye = { ...EYES[st] };
      if (st === "thinking" && !reduce) { tg.lx = Math.sin(now / 380) * 0.8; tg.ly = -0.6 + Math.sin(now / 900) * 0.15; }
      if (st === "idle") { tg.lx = gaze.x; tg.ly += gaze.y * 0.6; }
      if (st === "listening") tg.h *= 1 + Math.min(1, levelRef.current) * 0.25;
      if (st === "speaking" && !reduce) tg.ly = Math.abs(Math.sin(now / 140)) * -0.35;
      const k = reduce ? 1 : 0.16;
      for (const key of KEYS) cur[key] += (tg[key] - cur[key]) * k;

      if (!reduce && now > nextBlink && blinkAt < 0 && st !== "approved") blinkAt = now;
      if (blinkAt >= 0) {
        const b = (now - blinkAt) / 150;
        blink = b < 1 ? b : b < 2 ? 2 - b : 0;
        if (b >= 2) { blinkAt = -1; nextBlink = now + 2200 + Math.random() * 3200; }
      }
      // Declined: a short head-shake.
      const shake = st === "declined" && since < 0.7 && !reduce ? Math.sin(since * 40) * (1 - since / 0.7) * 1.2 : 0;

      const e: Eye = { ...cur, w: cur.w * scale, h: cur.h * scale, top: cur.top * scale, bottom: cur.bottom * scale };
      const sep = cols * 0.17 + cur.gap * scale;
      const mid = (cols - 1) / 2 + cur.lx * 2.2 * scale + shake;
      const cy = (rows - 1) / 2 - 0.4 * scale + cur.ly * 1.6 * scale;
      const offX = (canvas.width - cols * pitch) / 2 + pitch / 2, offY = (canvas.height - rows * pitch) / 2 + pitch / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const on = inEye(c, r, mid - sep, cy, e, blink, 1) || inEye(c, r, mid + sep, cy, e, blink, -1);
          ctx.beginPath();
          ctx.fillStyle = on ? "rgba(255,255,255,0.97)" : "rgba(255,255,255,0.16)";
          ctx.arc(offX + c * pitch, offY + r * pitch, pitch * (on ? 0.4 : 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [size]);

  return (
    <div className={`orb orb--${state}`} style={{ width: size, height: size }} data-state={state} aria-hidden>
      <span className="orb-aura" />
      <canvas ref={canvasRef} className="orb-canvas" style={{ width: size, height: size }} />
    </div>
  );
}
