import { useEffect, useRef } from "react";
import "./request-agent.css";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "approved" | "declined" | "countered" | "referred";

/** Status word shown on the card for each mood. */
export const ORB_WORD: Record<OrbState, string> = {
  idle: "READY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  approved: "RELEASED",
  declined: "REFUSED",
  countered: "OFFER",
  referred: "WITH FINANCE",
};

/* Eye bitmaps: 8 wide x 11 tall, authored as the LEFT eye. The right eye mirrors it unless given. */
const ROUND = [
  "..####..",
  ".######.",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  ".######.",
  "..####..",
];
const WIDE = [
  ".######.",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  "########",
  ".######.",
];
const SQUINT = [
  "........",
  "........",
  "........",
  "........",
  "########",
  "########",
  "########",
  "########",
  ".######.",
  "..####..",
  "........",
];
const HAPPY = [
  "........",
  "........",
  "..####..",
  ".######.",
  "########",
  "###..###",
  "##....##",
  "##....##",
  "#......#",
  "........",
  "........",
];
const STERN = [
  "##......",
  "####....",
  "######..",
  "########",
  "########",
  "########",
  "########",
  "########",
  ".######.",
  "..####..",
  "........",
];
const RAISED = [
  ".######.",
  "########",
  "........",
  "..####..",
  ".######.",
  "########",
  "########",
  "########",
  ".######.",
  "..####..",
  "........",
];
const NEUTRAL = [
  "........",
  "........",
  "........",
  ".######.",
  "########",
  "########",
  "########",
  "########",
  ".######.",
  "........",
  "........",
];

const mirror = (rows: string[]) => rows.map((r) => r.split("").reverse().join(""));
const EYES: Record<OrbState, [string[], string[]]> = {
  idle: [ROUND, ROUND],
  listening: [WIDE, WIDE],
  thinking: [SQUINT, SQUINT],
  speaking: [ROUND, ROUND],
  approved: [HAPPY, HAPPY],
  declined: [STERN, mirror(STERN)],
  countered: [SQUINT, RAISED],
  referred: [NEUTRAL, NEUTRAL],
};
const EW = 8, EH = 11, GAP = 2.6; // gap between eyes in dot pitches
const WASABI = [[-1.9, -0.9], [1.95, -0.75], [-1.6, 0.85], [1.75, 0.95], [0, -1.25], [-2.2, 0.1]];

/**
 * Clearance agent face. size <= 90: a squircle with mini eyes (home button).
 * size > 90: a wide aura card (fills its container width, `size` px tall) with
 * brand, status pill, big dot-matrix eyes and the status word.
 */
export function AgentOrb({ state, size = 160, level }: { state: OrbState; size?: number; level?: number }) {
  const card = size > 90;
  const wrapRef = useRef<HTMLDivElement>(null);
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
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const fit = () => {
      W = wrap.clientWidth || size;
      H = wrap.clientHeight || size;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(wrap);

    const N = EW * EH;
    const vals = [new Float32Array(N), new Float32Array(N)];
    const init = EYES[stateRef.current];
    for (let s = 0; s < 2; s++) for (let i = 0; i < N; i++) vals[s][i] = init[s][Math.floor(i / EW)][i % EW] === "#" ? 1 : 0;
    let wasabi = 0;
    const gaze = { x: 0, y: 0 };
    let gx = 0, gy = 0;
    let blink = 0, blinkAt = -1, nextBlink = performance.now() + 1600, raf = 0;

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      gaze.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.4)));
      gaze.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.5)));
    };
    window.addEventListener("pointermove", onMove);

    const frame = (now: number) => {
      const st = stateRef.current;
      const since = (now - changedAt.current) / 1000;
      const target = EYES[st];
      const k = reduce ? 1 : 0.2;
      for (let s = 0; s < 2; s++) {
        const v = vals[s];
        for (let i = 0; i < N; i++) {
          const t = target[s][Math.floor(i / EW)][i % EW] === "#" ? 1 : 0;
          // stagger by row so shapes "wipe" between moods
          const kk = k * (0.55 + 0.45 * ((Math.floor(i / EW) % 3) / 2));
          v[i] += (t - v[i]) * kk;
        }
      }
      wasabi += ((st === "approved" ? 1 : 0) - wasabi) * k;

      // gaze / bounce targets (in pitch units)
      let tx = 0, ty = 0;
      if (st === "idle") { tx = gaze.x * 0.7; ty = gaze.y * 0.4; }
      if (st === "thinking" && !reduce) { tx = Math.sin(now / 420) * 1.1; ty = -0.2; }
      if (st === "listening") ty = -Math.min(1, levelRef.current) * 0.9 + (reduce ? 0 : Math.sin(now / 260) * 0.12);
      gx += (tx - gx) * (reduce ? 1 : 0.12);
      gy += (ty - gy) * (reduce ? 1 : 0.2);
      const pulse = st === "speaking" && !reduce ? 1 + 0.14 * Math.abs(Math.sin(now / 150)) : 1;
      const shake = st === "declined" && since < 0.7 && !reduce ? Math.sin(since * 40) * (1 - since / 0.7) * 0.6 : 0;

      const blinky = st === "idle" || st === "listening" || st === "speaking" || st === "referred";
      if (!reduce && blinky && now > nextBlink && blinkAt < 0) blinkAt = now;
      if (blinkAt >= 0) {
        const b = (now - blinkAt) / 110;
        blink = b < 1 ? b : b < 2 ? 2 - b : 0;
        if (b >= 2) { blinkAt = -1; nextBlink = now + 2400 + Math.random() * 3000; }
      }

      // layout
      const padTop = card ? 58 : 0, padBot = card ? 66 : 0;
      const availW = card ? W - 48 : W * 0.78;
      const availH = card ? H - padTop - padBot : H * 0.62;
      const pitch = Math.min(card ? 17 : 99, availW / (EW * 2 + GAP + 2), availH / (EH + 1));
      const cx = W / 2 + (gx + shake) * pitch;
      const cy = padTop + availH / 2 + (card ? 0 : (H - availH) / 2 - 0) + gy * pitch;
      const eyeOff = (EW + GAP) / 2 * pitch; // centre of each eye from mid
      const rDot = pitch * (card ? 0.38 : 0.42) * pulse;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      for (let s = 0; s < 2; s++) {
        const ex = cx + (s === 0 ? -eyeOff : eyeOff);
        const v = vals[s];
        for (let i = 0; i < N; i++) {
          const a = v[i];
          if (a < 0.03) continue;
          const r = Math.floor(i / EW), c = i % EW;
          const x = ex + (c - (EW - 1) / 2) * pitch;
          const y = cy + (r - (EH - 1) / 2) * pitch * (1 - blink * 0.92);
          ctx.globalAlpha = Math.min(1, a * 1.1) * 0.98;
          ctx.beginPath();
          ctx.arc(x, y, rDot * (0.35 + 0.65 * a), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (wasabi > 0.03) {
        ctx.fillStyle = "#E4F25A";
        const span = (EW * 2 + GAP) * pitch / 2;
        WASABI.forEach(([ax, ay], j) => {
          const tw = reduce ? 1 : 0.6 + 0.4 * Math.sin(now / 300 + j * 1.7);
          ctx.globalAlpha = wasabi * tw;
          ctx.beginPath();
          ctx.arc(cx + ax * span * 0.62, cy + ay * EH * pitch * 0.42, pitch * 0.3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener("pointermove", onMove); };
  }, [size, card]);

  const word = ORB_WORD[state];
  return (
    <div
      ref={wrapRef}
      className={`orb orb--${state}${card ? " orb--card" : ""}`}
      style={card ? { height: size } : { width: size, height: size }}
      data-state={state}
      aria-hidden
    >
      <span className="orb-aura" />
      <span className="orb-grid" />
      <canvas ref={canvasRef} className="orb-canvas" />
      {card && (
        <>
          <div className="orb-brand">Clearance</div>
          <div className="orb-pill"><i />{word}</div>
          <div className="orb-word" key={word}>{word}</div>
        </>
      )}
    </div>
  );
}
