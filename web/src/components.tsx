import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  DECIDED_BY_LABEL, money,
  type Approval, type Card, type Employee, type Transaction,
} from "./api";
import { BrandMark, Icon } from "./icons";

/* ---------- Avatars ---------- */

export function Avatar({ employee, size = 40 }: { employee: Employee; size?: number }) {
  const initials = employee.name.split(" ").map((p) => p[0]).join("");
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.36, "--c": employee.avatar_color } as CSSProperties}>
      {initials}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function MerchantAvatar({ merchant, category, status, size = 44 }: {
  merchant: string; category: string; status?: Transaction["status"]; size?: number;
}) {
  const tint = (hash(merchant) % 8) + 1;
  const letters = merchant.replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <div className="mono" style={{ width: size, height: size, fontSize: size * 0.34, background: `var(--tint-${tint}-bg)`, color: `var(--tint-${tint}-fg)` }}>
      {letters.slice(0, size > 50 ? 2 : 2)}
      <span className={`mono-badge ${status ? `mono-${status}` : ""}`}>
        <Icon name={status === "declined" ? "x" : status === "escalated" ? "clock" : category} size={11} strokeWidth={2.2} />
      </span>
    </div>
  );
}

/* ---------- Card ---------- */

export function PaymentCard({ card, employee }: { card: Card; employee: Employee }) {
  const frozen = card.status === "frozen";
  return (
    <div className={`pcard ${frozen ? "frozen" : ""}`}>
      <div className="pcard-bars" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="pcard-top">
        <span className="pcard-brand"><BrandMark size={22} /> clearance</span>
        <span className="pcard-tag">{card.stripe_card_id ? "Stripe · test" : "Virtual"}</span>
      </div>
      <div className="pcard-mid">
        <div className="pcard-chip" />
        <Icon name="tap" size={22} className="pcard-nfc" />
      </div>
      <div className="pcard-bottom">
        <div>
          <div className="pcard-number">•••• {card.last4}</div>
          <div className="pcard-name">{employee.name}</div>
        </div>
        <div className="pcard-right">
          <div className="pcard-label">{card.nickname}</div>
          <div className="pcard-exp">{card.exp}</div>
        </div>
      </div>
      {frozen && <div className="pcard-frozen"><span><Icon name="snow" size={18} /> Frozen</span></div>}
    </div>
  );
}

/* ---------- Status ---------- */

export const STATUS_LABEL = { approved: "Approved", declined: "Declined", escalated: "With manager" } as const;

export function StatusPill({ status }: { status: Transaction["status"] }) {
  const icon = status === "approved" ? "check" : status === "declined" ? "x" : "clock";
  return <span className={`pill pill-${status}`}><Icon name={icon} size={13} strokeWidth={2.4} />{STATUS_LABEL[status]}</span>;
}

const released = (t: Transaction) => t.captured_amount != null && t.captured_amount < t.amount && t.status === "approved";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? `Today ${time(iso)}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time(iso)}`;
};

export function TransactionList({ transactions, onOpen, showWho }: {
  transactions: Transaction[];
  onOpen: (t: Transaction) => void;
  showWho?: (employeeId: string) => string;
}) {
  if (!transactions.length) {
    return (
      <div className="empty glass">
        <Icon name="tap" size={26} />
        <div>No payments yet</div>
        <span>Use Tap to pay to try the card.</span>
      </div>
    );
  }
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = dayLabel(t.created_at);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return (
    <div className="txlist">
      {[...groups].map(([day, txs]) => (
        <section key={day}>
          <h3 className="txday">{day}</h3>
          <div className="glass list">
            {txs.map((t) => (
              <button key={t.id} className="txrow" onClick={() => onOpen(t)}>
                <MerchantAvatar merchant={t.merchant} category={t.category} status={t.status} />
                <div className="txmain">
                  <div className="txmerchant">{t.merchant}</div>
                  <div className="txsub">
                    {showWho ? `${showWho(t.employee_id)} · ` : ""}
                    {time(t.created_at)}
                    {!showWho && <StateText t={t} sep />}
                  </div>
                  {showWho && (t.status !== "approved" || released(t)) && <div className="txsub"><StateText t={t} /></div>}
                </div>
                <div className="txamounts">
                  <div className={`txamount ${t.status !== "approved" ? "struck" : ""}`}>
                    {t.status === "approved" ? "-" : ""}{money(released(t) ? t.captured_amount! : t.amount)}
                  </div>
                  {released(t) && <div className="txorig">{money(t.amount)}</div>}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StateText({ t, sep }: { t: Transaction; sep?: boolean }) {
  const label = t.status !== "approved" ? STATUS_LABEL[t.status] : released(t) ? "Partly released" : null;
  if (!label) return null;
  return <>{sep ? " · " : ""}<span className={`txstate-${t.status}`}>{label}</span></>;
}

/* ---------- Sheet ---------- */

export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <button className="sheet-close" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        {children}
      </div>
    </div>
  );
}

/* ---------- Transaction detail ---------- */

const OUTCOME_LABEL = { pass: "Pass", flag: "Flag", block: "Block", escalate: "Escalate", override: "Override" };

export function TransactionDetail({ tx, onNegotiate }: { tx: Transaction; onNegotiate?: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const rules = showAll ? tx.rule_results : tx.rule_results.filter((r) => r.outcome !== "pass");
  const exceptions = tx.rule_results.filter((r) => r.outcome !== "pass").length;
  const canNegotiate = (tx.status === "declined" || tx.status === "escalated") && onNegotiate;
  const partly = released(tx);

  return (
    <div className="detail">
      <div className="detail-head">
        <MerchantAvatar merchant={tx.merchant} category={tx.category} status={tx.status} size={64} />
        <div className={`detail-amount ${tx.status !== "approved" ? "struck" : ""}`}>{tx.status === "approved" ? "-" : ""}{money(partly ? tx.captured_amount! : tx.amount)}</div>
        {partly && <div className="detail-orig">Requested {money(tx.amount)} · released {money(tx.captured_amount!)}</div>}
        <div className="detail-merchant">{tx.merchant}</div>
        <div className="detail-meta">
          {new Date(tx.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          {tx.city ? ` · ${tx.city}` : ""}
        </div>
        <StatusPill status={tx.status} />
      </div>

      {canNegotiate && (
        <div className="negotiate-cta">
          <button className="btn btn-ink btn-block" onClick={onNegotiate}>
            <Icon name="sparkle" size={18} /> Negotiate with Clearance
          </button>
          <p>Explain the context — Clearance can approve, offer a partial amount, or refer it to your manager.</p>
        </div>
      )}

      <div className="glass card-pad why">
        <div className="section-head">
          <span className="section-title">Why</span>
          <span className="why-by">{DECIDED_BY_LABEL[tx.decided_by]} · {tx.latency_ms.toLocaleString()} ms</span>
        </div>
        <p className="why-summary">{tx.summary}</p>
        {tx.agent && (
          <div className="agent-box">
            <div className="agent-head">
              <span><Icon name="sparkle" size={15} /> Agent reasoning</span>
              <RiskMeter score={tx.agent.risk_score} />
            </div>
            <p>{tx.agent.reasoning}</p>
            {tx.agent.cited_rules.length > 0 && (
              <div className="cites">{tx.agent.cited_rules.map((r) => <span key={r} className="cite">{r}</span>)}</div>
            )}
          </div>
        )}
      </div>

      <div className="glass card-pad">
        <div className="section-head"><span className="section-title">Decision timeline</span></div>
        <Timeline tx={tx} exceptions={exceptions} />
      </div>

      <div className="glass rules">
        <div className="section-head card-pad-x">
          <span className="section-title">Policy checks</span>
          <button className="link" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Only exceptions" : `Show all ${tx.rule_results.length}`}
          </button>
        </div>
        {rules.length === 0 && (
          <div className="rule-row"><span className="rule-pass"><Icon name="checkCircle" size={16} /> Every policy check passed.</span></div>
        )}
        {rules.map((r) => (
          <div key={r.id} className={`rule-row ${tx.cited_rules.includes(r.id) ? "cited" : ""}`}>
            <div className="rule-top">
              <span className="rule-id">{r.id}</span>
              <span className="rule-title">{r.title}</span>
              <span className={`outcome outcome-${r.outcome}`}>{OUTCOME_LABEL[r.outcome]}</span>
            </div>
            <div className="rule-ev">{r.evidence}</div>
            {tx.cited_rules.includes(r.id) && <div className="cited-tag">Cited in decision</div>}
          </div>
        ))}
      </div>

      <dl className="detail-foot">
        <div><dt>Category</dt><dd>{tx.mcc.replace(/_/g, " ")}</dd></div>
        <div><dt>Authorization</dt><dd>{tx.stripe_authorization_id}</dd></div>
        {tx.released_by && <div><dt>Released by</dt><dd>{tx.released_by}</dd></div>}
      </dl>
    </div>
  );
}

function RiskMeter({ score }: { score: number }) {
  const level = score >= 70 ? "high" : score >= 40 ? "mid" : "low";
  return (
    <span className={`risk risk-${level}`}>
      <span className="risk-bar"><i style={{ width: `${Math.max(4, Math.min(100, score))}%` }} /></span>
      Risk {score}
    </span>
  );
}

function Timeline({ tx, exceptions }: { tx: Transaction; exceptions: number }) {
  const agentUsed = !!tx.agent || tx.decided_by === "agent";
  const steps: { icon: string; title: string; sub: string; tone?: string }[] = [
    { icon: "tap", title: "Card tapped", sub: `${money(tx.amount)} at ${tx.merchant} · ${time(tx.created_at)}` },
    {
      icon: "shield", title: "Policy engine",
      sub: tx.rule_results.length ? `${tx.rule_results.length} rules checked · ${exceptions ? `${exceptions} exception${exceptions > 1 ? "s" : ""}` : "all passed"}` : "Within policy",
      tone: exceptions ? "flag" : undefined,
    },
  ];
  if (agentUsed) steps.push({ icon: "sparkle", title: "Agent review", sub: tx.agent ? `Risk ${tx.agent.risk_score}/100 · ${tx.agent.decision}` : "Reviewed by Clearance", tone: "agent" });
  if (tx.decided_by === "manager" || tx.decided_by === "pre_approval") steps.push({ icon: "user", title: "Manager", sub: DECIDED_BY_LABEL[tx.decided_by] });
  if (tx.decided_by === "negotiation") steps.push({ icon: "sparkle", title: "Negotiation", sub: released(tx) ? `Settled at ${money(tx.captured_amount!)}` : "Settled with Clearance", tone: "agent" });
  steps.push({
    icon: tx.status === "approved" ? "check" : tx.status === "declined" ? "x" : "clock",
    title: STATUS_LABEL[tx.status],
    sub: `${DECIDED_BY_LABEL[tx.decided_by]} · ${tx.latency_ms.toLocaleString()} ms`,
    tone: tx.status,
  });
  return (
    <ol className="timeline">
      {steps.map((s, i) => (
        <li key={i} className={s.tone ? `tl-${s.tone}` : ""}>
          <span className="tl-dot"><Icon name={s.icon} size={14} strokeWidth={2.2} /></span>
          <div><div className="tl-title">{s.title}</div><div className="tl-sub">{s.sub}</div></div>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Presets / approvals ---------- */

export const PRESETS = [
  { merchant: "Figma", mcc: "computer_software_stores", amount: 4_500, note: "Approved SaaS vendor", category: "software" },
  { merchant: "Hôtel Pullman Paris", mcc: "hotels_motels_and_resorts", amount: 18_900, city: "Paris", note: "Conference trip", category: "lodging" },
  { merchant: "Nobu London", mcc: "eating_places_restaurants", amount: 68_000, note: "Over role limit", category: "meals" },
  { merchant: "Apple Store", mcc: "electronics_stores", amount: 129_900, note: "Hardware over £500", category: "hardware" },
  { merchant: "QuickTech Ltd", mcc: "computer_software_stores", amount: 24_000, hour: 2, note: "New merchant at 2am", category: "software" },
  { merchant: "Bet365", mcc: "betting_casino_gambling", amount: 5_000, note: "Prohibited", category: "gambling" },
];

export function ApprovalCard({ approval, who, onResolve }: {
  approval: Approval;
  who: string;
  onResolve?: (action: "approve" | "reject") => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const act = async (a: "approve" | "reject") => {
    setBusy(a);
    try { await onResolve?.(a); } finally { setBusy(null); }
  };
  return (
    <div className={`glass approval ap-${approval.status}`}>
      <div className="approval-top">
        <MerchantAvatar merchant={approval.merchant} category="other" size={44} />
        <div className="txmain">
          <div className="txmerchant">{approval.merchant}</div>
          <div className="txsub">{who} · {when(approval.created_at)}</div>
        </div>
        <div className="approval-amount">{money(approval.amount)}</div>
      </div>
      <p className="approval-reason">{approval.reason}</p>
      {approval.status === "pending" && onResolve ? (
        <div className="approval-actions">
          <button className="btn btn-white" disabled={!!busy} onClick={() => act("reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
          <button className="btn btn-ink" disabled={!!busy} onClick={() => act("approve")}>{busy === "approve" ? "Approving…" : "Approve once"}</button>
        </div>
      ) : (
        <div className={`approval-status st-${approval.status}`}>
          <Icon name={approval.status === "pending" ? "clock" : approval.status === "rejected" ? "xCircle" : "checkCircle"} size={16} />
          {{ pending: "Waiting for Finance", approved: `Approved by ${approval.approver} · retry the payment`, rejected: `Rejected by ${approval.approver}`, used: "Approved and used" }[approval.status]}
        </div>
      )}
    </div>
  );
}
