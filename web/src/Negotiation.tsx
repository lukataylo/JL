import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, money, type Negotiation as Neg, type NegotiationMessage, type Transaction } from "./api";
import "./negotiation.css";

const QUICK_REPLIES = [
  "It's for a client dinner",
  "Replacing a broken laptop",
  "Conference travel",
  "Can you approve part of it?",
];
const THINKING_STEPS = ["Reading policy", "Checking company memory", "Deciding"];
const FINAL = new Set(["approved", "accepted", "referred", "denied"]);

const time = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

/** Lower-case the first letter of a policy summary so it reads inside a sentence. */
const inline = (s: string) => {
  const t = s.trim().replace(/^[^:]{0,40}:\s*/, "").replace(/\.$/, "");
  return t ? t[0].toLowerCase() + t.slice(1) : t;
};

function opener(tx: Transaction): NegotiationMessage {
  const verb = tx.status === "escalated" ? "held" : "declined";
  const rules = tx.cited_rules.length ? ` (${tx.cited_rules.join(", ")})` : "";
  const why = tx.summary ? ` because ${inline(tx.summary)}${rules}` : rules;
  return {
    role: "agent",
    at: tx.created_at,
    text: `I ${verb} ${money(tx.amount)} at ${tx.merchant}${why}. Tell me what it's for and I'll take a look.`,
  };
}

/* ---------- icons ---------- */
const IconBack = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
);
const IconSend = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
);
const IconCheck = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
);
const IconForward = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h14M13 6l6 6-6 6" /></svg>
);
const IconSplit = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M12 4v16" /></svg>
);
const IconAlert = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
);

function Orb({ size = 40, thinking = false }: { size?: number; thinking?: boolean }) {
  return (
    <span className={`neg-orb${thinking ? " is-thinking" : ""}`} style={{ width: size, height: size }} aria-hidden>
      <span className="neg-orb-core" />
    </span>
  );
}

function Rules({ ids }: { ids?: string[] }) {
  if (!ids?.length) return null;
  return (
    <div className="neg-rules">
      {ids.map((r) => <span key={r} className="neg-rule">{r}</span>)}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { approved: "Approved", declined: "Declined", escalated: "Held" };

/* ---------- outcome cards ---------- */
function OutcomeCard({
  msg, tx, neg, live, busy, onAccept, onKeepTalking,
}: {
  msg: NegotiationMessage; tx: Transaction; neg: Neg | null; live: boolean; busy: boolean;
  onAccept: () => void; onKeepTalking: () => void;
}) {
  switch (msg.outcome) {
    case "counter": {
      const amt = msg.counter_amount ?? neg?.counter_amount ?? 0;
      const pct = Math.max(4, Math.min(100, Math.round((amt / tx.amount) * 100)));
      const accepted = neg?.status === "accepted" && live;
      return (
        <div className="neg-card neg-card--offer">
          <div className="neg-card-head">
            <span className="neg-card-icon neg-card-icon--brand"><IconSplit /></span>
            <span className="neg-card-kicker">Counter-offer</span>
          </div>
          <div className="neg-offer-title">
            Clearance can release <strong>{money(amt)}</strong> <span>of {money(tx.amount)}</span>
          </div>
          <div className="neg-offer-bar"><span style={{ width: `${pct}%` }} /></div>
          <div className="neg-offer-legend">
            <span><i className="dot dot--brand" />Company · {money(amt)}</span>
            <span><i className="dot" />You · {money(tx.amount - amt)}</span>
          </div>
          {live && neg?.status === "countered" && (
            <div className="neg-card-actions">
              <button className="neg-btn neg-btn--primary" disabled={busy} onClick={onAccept}>
                {busy ? "Releasing…" : `Accept ${money(amt)}`}
              </button>
              <button className="neg-btn neg-btn--text" disabled={busy} onClick={onKeepTalking}>Keep talking</button>
            </div>
          )}
          {accepted && <div className="neg-card-foot">Accepted · {money(amt)} released</div>}
          {!live && <div className="neg-card-foot neg-card-foot--muted">Superseded</div>}
        </div>
      );
    }
    case "approve":
      return <SuccessCard amount={tx.captured_amount ?? tx.amount} />;
    case "refer":
      return (
        <div className="neg-card neg-card--refer">
          <div className="neg-card-head">
            <span className="neg-card-icon neg-card-icon--agent"><IconForward /></span>
            <span className="neg-card-kicker">Referred</span>
          </div>
          <div className="neg-card-title">Sent to Priya (Finance)</div>
          <div className="neg-card-sub">With this conversation attached. You'll be notified when she decides — the hold stays in place until then.</div>
        </div>
      );
    case "deny":
      return (
        <div className="neg-card neg-card--deny">
          <div className="neg-card-head">
            <span className="neg-card-icon neg-card-icon--deny"><IconX /></span>
            <span className="neg-card-kicker">Declined</span>
          </div>
          <div className="neg-card-title">{money(tx.amount)} won't be released</div>
          <div className="neg-card-sub">This decision is final for this payment. No money has moved.</div>
        </div>
      );
    default:
      return null;
  }
}

function SuccessCard({ amount, of }: { amount: number; of?: number }) {
  return (
    <div className="neg-card neg-card--success">
      <div className="neg-burst" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}
      </div>
      <div className="neg-success-check"><IconCheck /></div>
      <div className="neg-card-title neg-center">{money(amount)} released</div>
      <div className="neg-card-sub neg-center">
        {of && of > amount ? `of ${money(of)} · ` : ""}Captured in Stripe test mode
      </div>
    </div>
  );
}

/* ---------- main ---------- */
export function Negotiation({ tx: initialTx, onClose, onSettled }: { tx: Transaction; onClose: () => void; onSettled: (tx: Transaction) => void }) {
  const [tx, setTx] = useState(initialTx);
  const [neg, setNeg] = useState<Neg | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"send" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    api.negotiation(initialTx.id)
      .then((n) => alive && setNeg(n))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [initialTx.id]);

  // Cycle the "thinking" steps while waiting.
  useEffect(() => {
    if (busy !== "send") return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, [busy]);

  const messages = useMemo(() => {
    const list = neg?.messages ?? [];
    const first = list.length && list[0].role === "agent" ? [] : [opener(tx)];
    return [...first, ...list];
  }, [neg, tx]);

  const lastCounterIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].outcome === "counter") return i;
    return -1;
  }, [messages]);

  // Auto-scroll to newest.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: loading ? "auto" : "smooth" });
  }, [messages.length, busy, pending, error, loading, neg?.status]);

  const status = neg?.status ?? "open";
  const final = FINAL.has(status) || (tx.status === "approved" && !!neg);
  const employeeSent = messages.some((m) => m.role === "employee") || !!pending;

  const settle = (next: Transaction) => {
    if (next.status !== tx.status || next.captured_amount !== tx.captured_amount) onSettled(next);
    setTx(next);
  };

  async function send(raw?: string) {
    const msg = (raw ?? text).trim();
    if (!msg || busy || final) return;
    setError(null);
    setPending(msg);
    if (raw === undefined) setText("");
    setBusy("send");
    try {
      const res = await api.negotiate(tx.id, msg);
      setNeg(res.negotiation);
      settle(res.transaction);
    } catch (e) {
      setError((e as Error).message || "Something went wrong.");
      if (raw === undefined) setText(msg); // keep what they typed
    } finally {
      setPending(null);
      setBusy(null);
    }
  }

  async function accept() {
    if (busy) return;
    setError(null);
    setBusy("accept");
    try {
      const res = await api.acceptCounter(tx.id);
      setNeg(res.negotiation);
      onSettled(res.transaction);
      setTx(res.transaction);
    } catch (e) {
      setError((e as Error).message || "Couldn't accept the offer.");
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 260);
  };

  const released = tx.captured_amount ?? (tx.status === "approved" ? tx.amount : null);
  const pillStatus = status === "referred" ? "referred" : tx.status;
  const pillLabel = status === "referred" ? "With Finance" : status === "accepted" ? "Part released" : STATUS_LABEL[tx.status] ?? tx.status;

  return (
    <div className={`neg-overlay${closing ? " is-closing" : ""}`} role="dialog" aria-modal="true" aria-label={`Negotiate ${tx.merchant}`}>
      <div className="neg-bloom" aria-hidden />
      <div className="neg-shell">
        {/* Header */}
        <header className="neg-header">
          <button className="neg-iconbtn" onClick={close} aria-label="Back"><IconBack /></button>
          <div className="neg-agent">
            <Orb size={36} thinking={busy === "send"} />
            <div className="neg-agent-text">
              <div className="neg-agent-name">Clearance <span>· Spend agent</span></div>
              <div className="neg-agent-status">
                <i className="neg-pulse" />
                {busy === "send" ? "Reviewing…" : "Online · reviews in seconds"}
              </div>
            </div>
          </div>
          <span className="neg-iconbtn neg-iconbtn--ghost" aria-hidden />
        </header>

        <div className="neg-scroll" ref={scrollRef}>
          {/* Case card */}
          <section className="neg-case">
            <div className="neg-case-top">
              <div>
                <div className="neg-case-merchant">{tx.merchant}</div>
                <div className="neg-case-meta">{tx.category}{tx.city ? ` · ${tx.city}` : ""} · {time(tx.created_at)}</div>
              </div>
              <span className={`neg-pill neg-pill--${pillStatus}`}>{pillLabel}</span>
            </div>
            <div className="neg-case-amount">
              {released != null && released < tx.amount ? (
                <>{money(released)} <s>{money(tx.amount)}</s></>
              ) : money(tx.amount)}
            </div>
            {tx.summary && <p className="neg-case-why">{tx.summary}</p>}
            <Rules ids={tx.cited_rules} />
          </section>

          <div className="neg-daydivider"><span>Conversation</span></div>

          {/* Messages */}
          <div className="neg-thread">
            {loading && (
              <div className="neg-skel"><span /><span /></div>
            )}
            {!loading && messages.map((m, i) => (
              <Bubble key={i + m.at} msg={m}>
                {m.role === "agent" && m.outcome && m.outcome !== "ask" && (
                  <OutcomeCard
                    msg={m} tx={tx} neg={neg} busy={busy === "accept"}
                    live={m.outcome !== "counter" || i === lastCounterIdx}
                    onAccept={accept}
                    onKeepTalking={() => inputRef.current?.focus()}
                  />
                )}
              </Bubble>
            ))}
            {!loading && status === "accepted" && released != null && (
              <div className="neg-row neg-row--agent neg-rise">
                <div className="neg-col neg-col--wide neg-col--indent"><SuccessCard amount={released} of={tx.amount} /></div>
              </div>
            )}
            {pending && (
              <Bubble msg={{ role: "employee", text: pending, at: new Date().toISOString() }} />
            )}
            {busy === "send" && (
              <div className="neg-row neg-row--agent neg-rise">
                <div className="neg-thinking">
                  <div className="neg-dots"><i /><i /><i /></div>
                  <div>
                    <div className="neg-thinking-title">Clearance is checking policy &amp; company memory…</div>
                    <div className="neg-steps">
                      {THINKING_STEPS.map((s, i) => (
                        <span key={s} className={i < step ? "is-done" : i === step ? "is-active" : ""}>{s}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="neg-error neg-rise" role="alert">
                <IconAlert /><span>{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss">×</button>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="neg-footer">
          {final ? (
            <div className="neg-final neg-rise">
              <FinalSummary status={status} tx={tx} released={released} />
              <button className="neg-btn neg-btn--primary" onClick={close}>Done</button>
            </div>
          ) : (
            <>
              {!employeeSent && !loading && (
                <div className="neg-chips">
                  {QUICK_REPLIES.map((q) => (
                    <button key={q} className="neg-chip" disabled={!!busy} onClick={() => send(q)}>{q}</button>
                  ))}
                </div>
              )}
              <form
                className="neg-inputbar"
                onSubmit={(e) => { e.preventDefault(); send(); }}
              >
                <textarea
                  ref={inputRef}
                  className="neg-input"
                  rows={1}
                  value={text}
                  disabled={!!busy || loading}
                  placeholder={busy === "send" ? "Clearance is replying…" : status === "countered" ? "Push back or explain more…" : "Explain the business reason…"}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
                  }}
                  enterKeyHint="send"
                  aria-label="Message Clearance"
                />
                <button className="neg-send" type="submit" disabled={!text.trim() || !!busy || loading} aria-label="Send">
                  <IconSend />
                </button>
              </form>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Bubble({ msg, children }: { msg: NegotiationMessage; children?: ReactNode }) {
  const agent = msg.role === "agent";
  return (
    <div className={`neg-row neg-row--${msg.role} neg-rise`}>
      {agent && <Orb size={26} />}
      <div className={`neg-col${agent && children ? " neg-col--wide" : ""}`}>
        <div className={`neg-bubble neg-bubble--${msg.role}`}>{msg.text}</div>
        {agent && <Rules ids={msg.cited_rules} />}
        {children}
        <div className="neg-time">{agent ? "Clearance · " : ""}{time(msg.at)}</div>
      </div>
    </div>
  );
}

function FinalSummary({ status, tx, released }: { status: string; tx: Transaction; released: number | null }) {
  let tone = "brand", title = "", sub = "";
  if (status === "approved" || status === "accepted" || tx.status === "approved") {
    title = `${money(released ?? tx.amount)} released`;
    sub = released != null && released < tx.amount
      ? `You'll cover the remaining ${money(tx.amount - released)} personally.`
      : "Full amount captured in Stripe test mode.";
  } else if (status === "referred") {
    tone = "agent"; title = "Waiting on Priya (Finance)"; sub = "She has the full conversation. Nothing is charged until she decides.";
  } else {
    tone = "deny"; title = "Payment stays declined"; sub = "No money moved. Clearance logged the conversation for audit.";
  }
  return (
    <div className={`neg-final-summary neg-final-summary--${tone}`}>
      <div className="neg-final-title">{title}</div>
      <div className="neg-final-sub">{sub}</div>
    </div>
  );
}
