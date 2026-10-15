import { useState, type ReactNode } from "react";
import {
  CATEGORY_ICON, DECIDED_BY_LABEL, money,
  type Approval, type Card, type Employee, type Transaction,
} from "./api";

export function Avatar({ employee, size = 36 }: { employee: Employee; size?: number }) {
  const initials = employee.name.split(" ").map((p) => p[0]).join("");
  return (
    <div className="avatar" style={{ width: size, height: size, background: employee.avatar_color, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

export function PaymentCard({ card, employee }: { card: Card; employee: Employee }) {
  return (
    <div className={`pcard pcard-${card.color} ${card.status === "frozen" ? "frozen" : ""}`}>
      <div className="pcard-top">
        <span className="pcard-brand">clearance</span>
        <span className="pcard-tag">{card.stripe_card_id ? "Stripe · test" : "Virtual"}</span>
      </div>
      <div className="pcard-chip" />
      <div className="pcard-number">•••• {card.last4}</div>
      <div className="pcard-bottom">
        <div>
          <div className="pcard-label">{card.nickname}</div>
          <div className="pcard-name">{employee.name}</div>
        </div>
        <div className="pcard-exp">{card.exp}</div>
      </div>
      {card.status === "frozen" && <div className="pcard-frozen">❄ Frozen</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: Transaction["status"] }) {
  const label = { approved: "Approved", declined: "Declined", escalated: "With manager" }[status];
  return <span className={`pill pill-${status}`}>{label}</span>;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function TransactionList({ transactions, onOpen, showWho }: {
  transactions: Transaction[];
  onOpen: (t: Transaction) => void;
  showWho?: (employeeId: string) => string;
}) {
  if (!transactions.length) return <div className="empty">No payments yet. Tap to pay to try the card.</div>;
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
          <div className="panel">
            {txs.map((t) => (
              <button key={t.id} className="txrow" onClick={() => onOpen(t)}>
                <div className={`txicon txicon-${t.status}`}>{CATEGORY_ICON[t.category] ?? "🧾"}</div>
                <div className="txmain">
                  <div className="txmerchant">{t.merchant}</div>
                  <div className="txsub">
                    {showWho ? `${showWho(t.employee_id)} · ` : ""}
                    {new Date(t.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    {t.status !== "approved" && <> · <span className={`txstate-${t.status}`}>{t.status === "declined" ? "Declined" : "With manager"}</span></>}
                  </div>
                </div>
                <div className={`txamount ${t.status !== "approved" ? "struck" : ""}`}>-{money(t.amount)}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {children}
      </div>
    </div>
  );
}

const OUTCOME_LABEL = { pass: "Pass", flag: "Flag", block: "Block", escalate: "Escalate", override: "Override" };

export function TransactionDetail({ tx }: { tx: Transaction }) {
  const [showAll, setShowAll] = useState(false);
  const rules = showAll ? tx.rule_results : tx.rule_results.filter((r) => r.outcome !== "pass");
  return (
    <div className="detail">
      <div className={`detail-icon txicon-${tx.status}`}>{CATEGORY_ICON[tx.category] ?? "🧾"}</div>
      <div className="detail-amount">-{money(tx.amount)}</div>
      <div className="detail-merchant">{tx.merchant}</div>
      <div className="detail-meta">
        {new Date(tx.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        {tx.city ? ` · ${tx.city}` : ""}
      </div>
      <StatusPill status={tx.status} />

      <div className="why panel">
        <div className="why-head">
          <span className="why-title">Why</span>
          <span className="why-by">{DECIDED_BY_LABEL[tx.decided_by]} · {tx.latency_ms} ms</span>
        </div>
        <p className="why-summary">{tx.summary}</p>
        {tx.agent && (
          <div className="agent-box">
            <div className="agent-head">
              <span>✦ Agent reasoning</span>
              <span className="risk">Risk {tx.agent.risk_score}/100</span>
            </div>
            <p>{tx.agent.reasoning}</p>
          </div>
        )}
      </div>

      <div className="panel rules">
        <div className="rules-head">
          <span>Policy checks</span>
          <button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? "Only exceptions" : `All ${tx.rule_results.length}`}</button>
        </div>
        {rules.length === 0 && <div className="rule-row"><span className="rule-ev">Every policy check passed.</span></div>}
        {rules.map((r) => (
          <div key={r.id} className={`rule-row ${tx.cited_rules.includes(r.id) ? "cited" : ""}`}>
            <div className="rule-top">
              <span className="rule-id">{r.id}</span>
              <span className="rule-title">{r.title}</span>
              <span className={`outcome outcome-${r.outcome}`}>{OUTCOME_LABEL[r.outcome]}</span>
            </div>
            <div className="rule-ev">{r.evidence}</div>
          </div>
        ))}
      </div>

      <div className="detail-foot">
        <span>Category · {tx.mcc}</span>
        <span>Authorization · {tx.stripe_authorization_id}</span>
      </div>
    </div>
  );
}

export const PRESETS = [
  { merchant: "Figma", mcc: "computer_software_stores", amount: 4_500, note: "Approved SaaS vendor" },
  { merchant: "Hôtel Pullman Paris", mcc: "hotels_motels_and_resorts", amount: 18_900, city: "Paris", note: "Conference trip" },
  { merchant: "Nobu London", mcc: "eating_places_restaurants", amount: 68_000, note: "Over role limit" },
  { merchant: "Apple Store", mcc: "electronics_stores", amount: 129_900, note: "Hardware over £500" },
  { merchant: "QuickTech Ltd", mcc: "computer_software_stores", amount: 24_000, hour: 2, note: "New merchant at 2am" },
  { merchant: "Bet365", mcc: "betting_casino_gambling", amount: 5_000, note: "Prohibited" },
];

export function ApprovalCard({ approval, who, onResolve }: {
  approval: Approval;
  who: string;
  onResolve?: (action: "approve" | "reject") => void;
}) {
  return (
    <div className="panel approval">
      <div className="approval-top">
        <div>
          <div className="approval-merchant">{approval.merchant}</div>
          <div className="txsub">{who} · {new Date(approval.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</div>
        </div>
        <div className="approval-amount">{money(approval.amount)}</div>
      </div>
      <p className="approval-reason">{approval.reason}</p>
      {approval.status === "pending" && onResolve ? (
        <div className="approval-actions">
          <button className="btn btn-ghost" onClick={() => onResolve("reject")}>Reject</button>
          <button className="btn btn-primary" onClick={() => onResolve("approve")}>Approve once</button>
        </div>
      ) : (
        <div className={`approval-status st-${approval.status}`}>
          {{ pending: "Pending", approved: `Approved by ${approval.approver} · retry the payment`, rejected: `Rejected by ${approval.approver}`, used: "Approved and used" }[approval.status]}
        </div>
      )}
    </div>
  );
}
