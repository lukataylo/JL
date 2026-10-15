/*
 * Dot Aura primitives. Styled in dot-aura.css (classes prefixed da-).
 *  - Aura: rounded card with a blurred, slowly drifting gradient whose colours follow `state`.
 *  - DotNumber: count-up money figure set in Doto (dot matrix).
 *  - BudgetRuler: white tick ruler with a "spent" marker and released band.
 *  - GlassOrb: flat bright tile tinted by the --tint-N tokens.
 *  - DotPager: decorative 4-dot pager under the hero.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { money } from "./api";

export type AuraState = "idle" | "funded" | "thinking" | "approved" | "declined";

export function Aura({ state, children, className }: { state: AuraState; children?: ReactNode; className?: string }) {
  return (
    <div className={`da-aura da-aura--${state}${className ? ` ${className}` : ""}`} data-state={state}>
      <div className="da-aura-body">{children}</div>
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Whole-pound label without ".00" (e.g. £1,265), keeps pence when present. */
const short = (minor: number) => money(minor).replace(/\.00$/, "");

/** Animated money in Doto. `value` is in pence. */
export function DotNumber({ value, currency, className }: { value: number; currency?: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (prefersReducedMotion()) { from.current = value; setShown(value); return; }
    const t0 = performance.now();
    const dur = 1100;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (value - start) * e);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const fmt = (n: number) => {
    const s = money(n);
    return currency && currency !== "£" ? s.replace("£", currency) : s;
  };
  const text = fmt(shown);
  const sign = text.startsWith("-") ? "-" : "";
  const body = sign ? text.slice(1) : text;
  const sym = body.match(/^[^\d]+/)?.[0] ?? "";
  const [whole, pence] = body.slice(sym.length).split(".");
  return (
    <span className={`da-num${className ? ` ${className}` : ""}`}>
      <span className="da-sr">{fmt(value)}</span>
      <span aria-hidden="true">
        {sign}<span className="da-num-cur">{sym}</span>{whole}{pence !== undefined && <span className="da-num-pence">.{pence}</span>}
      </span>
    </span>
  );
}

/** Tick ruler: marker = month spent / budget, translucent band = released (on card). All values in pence. */
export function BudgetRuler({ budget, spent, released, className }: { budget: number; spent: number; released: number; className?: string }) {
  const b = Math.max(1, budget);
  const clamp = (n: number) => Math.max(0, Math.min(100, (n / b) * 100));
  const spentPct = clamp(spent);
  const relPct = Math.min(100 - spentPct, clamp(released));
  const over = spent > budget;
  return (
    <div
      className={`da-ruler${over ? " da-ruler--over" : ""}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={`${money(spent)} spent of ${money(budget)} this month${released > 0 ? `, ${money(released)} on card` : ""}`}
    >
      <div className="da-ruler-track" aria-hidden="true">
        <div className="da-ruler-ticks" />
        {relPct > 0 && <div className="da-ruler-rel" style={{ left: `${spentPct}%`, width: `${relPct}%` }} />}
        <div className="da-ruler-marker" style={{ left: `${spentPct}%` }} />
      </div>
      <div className="da-ruler-labels" aria-hidden="true">
        <span>£0</span>
        <span><b>{short(spent)}</b> of {short(budget)} this month</span>
      </div>
    </div>
  );
}

/** Flat colour tile (no gloss). `tint` 1..8 maps to --tint-N-bg / --tint-N-fg. `label` is read by screen readers. */
export function GlassOrb({ tint, size = 44, label, children, className }: {
  tint: number; size?: number; label: string; children?: ReactNode; className?: string;
}) {
  const n = Math.min(9, Math.max(1, Math.round(tint) || 1));
  const style = { width: size, height: size, "--o-bg": `var(--tint-${n}-bg)`, "--o-fg": `var(--tint-${n}-fg)` } as CSSProperties;
  return (
    <span className={`da-orb${className ? ` ${className}` : ""}`} style={style} role="img" aria-label={label}>
      {children}
    </span>
  );
}

/** Decorative pager dots (aria-hidden). */
export function DotPager({ count = 4, active = 0 }: { count?: number; active?: number }) {
  return (
    <div className="da-pager" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <i key={i} className={i === active ? "on" : undefined} />)}
    </div>
  );
}
