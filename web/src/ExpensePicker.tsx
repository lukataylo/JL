import { useEffect, useMemo, useRef, useState } from "react";
import { money, type Employee, type PolicyDoc, type Transaction } from "./api";
import { CATEGORY_META, categoryStatus, dialOrder, spentThisMonth, type Category } from "./categories";
import { GlassOrb } from "./DotAura";
import { Icon } from "./icons";
import "./expense-picker.css";

const ITEM_GAP = 80;   // px between icons along the arc
const TICKS_PER_ITEM = 3;
const FADE_AT = 1.25;  // radians from centre where items disappear
const DRAG_PX = 64;    // drag distance per item
const DEG = 180 / Math.PI;

/**
 * Full-screen expense type picker shown before a funds negotiation: a curved dial that
 * swings in from the left edge. See docs/expense-picker-ui.md.
 */
export function ExpensePicker({ employee, policy, transactions, budgetLeft, onPick, onSkip, onClose }: {
  employee: Employee;
  policy: PolicyDoc | null;
  transactions: Transaction[];
  budgetLeft: number;
  onPick: (category: Category) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const order = useMemo(() => dialOrder(employee, policy), [employee, policy]);
  const spent = useMemo(() => spentThisMonth(transactions), [transactions]);
  const initial = useMemo(() => {
    const top = (Object.entries(spent) as [Category, number][])
      .filter(([c]) => categoryStatus(c, employee, policy) !== "blocked")
      .sort((a, b) => b[1] - a[1])[0];
    return top ? Math.max(0, order.indexOf(top[0])) : 0;
  }, [spent, order, employee, policy]);

  const [sel, setSel] = useState(initial);
  const [closing, setClosing] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);
  const notchRef = useRef<HTMLDivElement>(null);
  const ticks = useRef<(HTMLElement | null)[]>([]);
  const labels = useRef<(HTMLElement | null)[]>([]);
  const icons = useRef<(HTMLElement | null)[]>([]);
  const lastDrag = useRef(0);
  const api = useRef<{ to: (i: number) => void } | null>(null);
  const N = order.length;
  const tickRange = useMemo(() => {
    const out: number[] = [];
    for (let k = -4 * TICKS_PER_ITEM; k <= (N + 3) * TICKS_PER_ITEM; k++) out.push(k);
    return out;
  }, [N]);

  const status = (c: Category) => categoryStatus(c, employee, policy);
  const limit = policy?.policy.roles?.[employee.role]?.perTxnLimit;

  const close = (then: () => void) => { setClosing(true); window.setTimeout(then, 220); };
  const start = (i: number) => {
    const c = order[i];
    if (c && status(c) !== "blocked") close(() => onPick(c));
  };
  const startRef = useRef(start);
  startRef.current = start;

  /* Dial physics. Positions are written straight to the DOM each frame; React only hears about index changes. */
  useEffect(() => {
    const dial = dialRef.current;
    if (!dial) return;
    let pos = initial, target = initial, raf = 0, snapT = 0, last = initial;
    let g = { R: 300, cx: 0, cy: 0, dt: ITEM_GAP / 300 };
    let drag: { y: number; t: number; moved: boolean; id: number } | null = null;

    const measure = () => {
      const W = dial.clientWidth, H = dial.clientHeight;
      const R = Math.max(300, H * 0.62);
      const apex = Math.min(W - 56, W * 0.74);
      g = { R, cx: apex - R, cy: H / 2, dt: ITEM_GAP / R };
      if (notchRef.current) { notchRef.current.style.left = `${apex - 52}px`; notchRef.current.style.top = `${g.cy}px`; }
    };

    const frame = () => {
      const { R, cx, cy, dt } = g, Rt = R - 72, Rl = R - 108;
      tickRange.forEach((k, j) => {
        const el = ticks.current[j];
        if (!el) return;
        const th = (k / TICKS_PER_ITEM - pos) * dt, a = Math.abs(th);
        el.style.opacity = String(a < FADE_AT ? (1 - a / FADE_AT) ** 1.3 : 0);
        el.style.transform = `translate(${cx + Rt * Math.cos(th)}px,${cy + Rt * Math.sin(th)}px) rotate(${th * DEG}deg) translate(-50%,-50%)`;
      });
      for (let i = 0; i < N; i++) {
        const d = i - pos, th = d * dt, a = Math.abs(th), vis = a < FADE_AT;
        const op = String(vis ? (1 - a / FADE_AT) ** 1.1 : 0);
        const l = labels.current[i], ic = icons.current[i];
        if (l) {
          l.style.opacity = op;
          l.style.transform = `translate(${cx + Rl * Math.cos(th)}px,${cy + Rl * Math.sin(th)}px) rotate(${th * DEG}deg) translate(-100%,-50%)`;
        }
        if (ic) {
          const s = 1.22 - Math.min(Math.abs(d), 3) * 0.14;
          ic.style.opacity = op;
          ic.style.visibility = vis ? "" : "hidden";
          ic.style.transform = `translate(${cx + R * Math.cos(th)}px,${cy + R * Math.sin(th)}px) scale(${s}) translate(-50%,-50%)`;
        }
      }
    };

    const tick = () => {
      pos += (target - pos) * 0.2;
      if (Math.abs(target - pos) < 0.002) pos = target;
      frame();
      const r = Math.round(pos);
      if (r !== last) { last = r; setSel(r); }
      raf = pos === target ? 0 : requestAnimationFrame(tick);
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const set = (v: number, snap = false) => {
      target = Math.max(0, Math.min(N - 1, v));
      if (snap) target = Math.round(target);
      go();
    };
    api.current = { to: (i) => set(i, true) };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      set(target + (e.deltaY + e.deltaX) / 110);
      window.clearTimeout(snapT);
      snapT = window.setTimeout(() => set(target, true), 130);
    };
    const onDown = (e: PointerEvent) => { drag = { y: e.clientY, t: target, moved: false, id: e.pointerId }; };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) > 5) {
        drag.moved = true;
        try { dial.setPointerCapture(drag.id); } catch { /* ignore */ }
      }
      if (drag.moved) set(drag.t - dy / DRAG_PX);
    };
    const onUp = () => {
      if (drag?.moved) { set(target, true); lastDrag.current = Date.now(); }
      drag = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") { set(Math.round(target) + 1, true); e.preventDefault(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { set(Math.round(target) - 1, true); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); startRef.current(Math.round(target)); }
    };

    measure();
    frame();
    const ro = new ResizeObserver(() => { measure(); frame(); });
    ro.observe(dial);
    dial.addEventListener("wheel", onWheel, { passive: false });
    dial.addEventListener("pointerdown", onDown);
    dial.addEventListener("pointermove", onMove);
    dial.addEventListener("pointerup", onUp);
    dial.addEventListener("pointercancel", onUp);
    dial.addEventListener("keydown", onKey);
    const focusT = window.setTimeout(() => dial.focus({ preventScroll: true }), 350);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(snapT);
      window.clearTimeout(focusT);
      ro.disconnect();
      dial.removeEventListener("wheel", onWheel);
      dial.removeEventListener("pointerdown", onDown);
      dial.removeEventListener("pointermove", onMove);
      dial.removeEventListener("pointerup", onUp);
      dial.removeEventListener("pointercancel", onUp);
      dial.removeEventListener("keydown", onKey);
      api.current = null;
    };
  }, [N, initial, tickRange]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(onClose); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const cur = order[sel] ?? order[0];
  const meta = CATEGORY_META[cur];
  const st = status(cur);
  const spentHere = spent[cur] ?? 0;

  return (
    <div className={`ep-overlay${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Choose an expense type">
      <div className="ep-shell">
        <header className="ep-header">
          <button className="ep-iconbtn" onClick={() => close(onClose)} aria-label="Close"><Icon name="x" size={20} strokeWidth={2} /></button>
          <div className="ep-title">
            <div className="ep-title-name">What's it for?</div>
            <div className="ep-title-sub">Pick a type, then talk to Clearance</div>
          </div>
          <button className="ep-skip" onClick={() => close(onSkip)}>Not sure</button>
        </header>

        <div
          className="ep-dial"
          ref={dialRef}
          tabIndex={0}
          role="listbox"
          aria-label="Expense types. Use the arrow keys to turn, Enter to start."
          aria-activedescendant={`ep-opt-${cur}`}
        >
          <div className="ep-arc">
            {tickRange.map((k, j) => (
              <i
                key={k}
                ref={(el) => { ticks.current[j] = el; }}
                className={`ep-tick${k % TICKS_PER_ITEM === 0 && k >= 0 && k < N * TICKS_PER_ITEM ? " is-major" : ""}`}
              />
            ))}
            {order.map((c, i) => (
              <span key={`l-${c}`} ref={(el) => { labels.current[i] = el; }} className={`ep-label${i === sel ? " is-cur" : ""}${status(c) === "blocked" ? " is-locked" : ""}`} aria-hidden>
                {CATEGORY_META[c].label}
              </span>
            ))}
            {order.map((c, i) => {
              const s = status(c);
              return (
                <button
                  key={c}
                  id={`ep-opt-${c}`}
                  role="option"
                  aria-selected={i === sel}
                  aria-label={`${CATEGORY_META[c].label}${s === "blocked" ? ", blocked by policy" : ""}`}
                  tabIndex={-1}
                  ref={(el) => { icons.current[i] = el; }}
                  className={`ep-icon${i === sel ? " is-cur" : ""}${s === "blocked" ? " is-locked" : ""}`}
                  onClick={() => {
                    if (Date.now() - lastDrag.current < 250) return;
                    if (i === sel) start(i);
                    else api.current?.to(i);
                  }}
                >
                  <GlassOrb tint={CATEGORY_META[c].tint} size={60} label={CATEGORY_META[c].label} className="ep-orb">
                    <Icon name={c} size={24} strokeWidth={2} />
                  </GlassOrb>
                  {s === "blocked" && <span className="ep-lock"><Icon name="lock" size={12} strokeWidth={2.2} /></span>}
                </button>
              );
            })}
          </div>
          <div className="ep-notch" ref={notchRef} aria-hidden />
        </div>

        <section
          key={cur}
          className={`ep-readout${st === "blocked" ? " is-blocked" : ""}`}
          aria-live="polite"
        >
          <div className="ep-ro-top">
            <GlassOrb tint={meta.tint} size={36} label="" className="ep-orb ep-ro-orb"><Icon name={cur} size={16} strokeWidth={2.2} /></GlassOrb>
            <h2 className="ep-ro-name">{meta.label}</h2>
            {st === "ok" && <span className="ep-pill ep-pill--ok">In your role</span>}
            {st === "reason" && <span className="ep-pill ep-pill--reason">Needs a reason · P2</span>}
            {st === "blocked" && <span className="ep-pill ep-pill--blocked">Blocked · P1</span>}
          </div>
          {st !== "blocked" && (
            <>
              <div className="ep-left">
                <span className="ep-left-num">{money(budgetLeft).replace(/\.00$/, "")}</span>
                <span className="ep-left-label">budget left to release</span>
              </div>
              <div className="ep-stats">
                {limit != null && <div><span>Per payment</span><b>{money(limit)}</b></div>}
                <div><span>Spent on {meta.label.toLowerCase()} in {new Date().toLocaleDateString("en-GB", { month: "short" })}</span><b>{money(spentHere)}</b></div>
              </div>
            </>
          )}
          <p className="ep-hint">{st === "reason" ? `${meta.hint} It's outside your role's usual categories, so tell Clearance why.` : meta.hint}</p>
          <button className="ep-cta" disabled={st === "blocked"} onClick={() => start(sel)}>
            {st === "blocked" ? "Can't be funded" : <>Start negotiation <Icon name="chevronRight" size={18} strokeWidth={2.2} /></>}
          </button>
        </section>
      </div>
    </div>
  );
}
