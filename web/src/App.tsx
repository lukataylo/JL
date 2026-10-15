import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, money,
  type Approval, type Employee, type Health, type Overview, type PolicyDoc, type Transaction,
} from "./api";
import {
  ApprovalCard, Avatar, PaymentCard, PRESETS, Sheet, TransactionDetail, TransactionList,
} from "./components";

type Tab = "home" | "approvals" | "audit" | "policy";

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>(() => localStorageGet("employee") ?? "emp_maya");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<Transaction[]>([]);
  const [policy, setPolicy] = useState<PolicyDoc | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [open, setOpen] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [toast, setToast] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const employeeRef = useRef(employeeId);
  employeeRef.current = employeeId;

  const refresh = useCallback(async () => {
    try {
      const [o, a, au] = await Promise.all([api.overview(employeeRef.current), api.approvals(), api.audit()]);
      setOverview(o);
      setApprovals(a);
      setAudit(au);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setError("Can't reach the Clearance API on :4242"));
    api.employees().then(setEmployees).catch(() => {});
    api.policy().then(setPolicy).catch(() => {});
  }, []);

  useEffect(() => {
    localStorageSet("employee", employeeId);
    refresh();
  }, [employeeId, refresh]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("transaction", (e) => {
      const tx = JSON.parse((e as MessageEvent).data) as Transaction;
      if (tx.employee_id === employeeRef.current) setToast(tx);
      refresh();
    });
    es.addEventListener("approval", () => refresh());
    return () => es.close();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? id;
  const pending = approvals.filter((a) => a.status === "pending");

  if (!overview) {
    return <div className="boot">{error ?? "Loading…"}</div>;
  }

  const { employee, cards, transactions, monthSpent } = overview;
  const card = cards[0];
  const budgetPct = Math.min(100, (monthSpent / employee.monthly_budget) * 100);

  return (
    <div className="app">
      {toast && (
        <button className={`toast toast-${toast.status}`} onClick={() => { setOpen(toast); setToast(null); }}>
          <div className="toast-title">
            {toast.status === "approved" ? "✓ Payment approved" : toast.status === "declined" ? "✕ Payment declined" : "⏳ Sent to your manager"}
            <span>{money(toast.amount)} · {toast.merchant}</span>
          </div>
          <div className="toast-body">{toast.summary}</div>
        </button>
      )}

      <header className="topbar">
        <button className="who" onClick={() => setSwitcher(true)}>
          <Avatar employee={employee} />
          <div>
            <div className="who-name">{employee.name}</div>
            <div className="who-sub">{employee.team} · switch ▾</div>
          </div>
        </button>
        <div className={`mode ${health?.agent ? "on" : ""}`} title={health?.model}>
          <span className="dot" /> {health?.agent ? "Agent live" : "Rules only"}
        </div>
      </header>

      {error && <div className="banner">{error}</div>}

      <main className="content">
        {tab === "home" && (
          <>
            <section className="hero">
              <div className="hero-label">Spent this month</div>
              <div className="hero-amount">{money(monthSpent)}</div>
              <div className="budget">
                <div className="budget-bar"><div style={{ width: `${budgetPct}%` }} /></div>
                <span>{money(employee.monthly_budget - monthSpent)} left of {money(employee.monthly_budget)}</span>
              </div>
            </section>

            {card && <PaymentCard card={card} employee={employee} />}

            <div className="actions">
              <Action icon="⌁" label="Tap to pay" primary onClick={() => setPaying(true)} disabled={!card} />
              <Action
                icon="❄"
                label={card?.status === "frozen" ? "Unfreeze" : "Freeze"}
                onClick={async () => { if (card) { await api.freeze(card.id, card.status !== "frozen"); refresh(); } }}
              />
              <Action icon="⛨" label="Policy" onClick={() => setTab("policy")} />
              <Action icon="⇄" label="Requests" onClick={() => setTab("approvals")} badge={pending.filter((a) => a.employee_id === employee.id).length} />
            </div>

            <TransactionList transactions={transactions} onOpen={setOpen} />
          </>
        )}

        {tab === "approvals" && (
          <section>
            <h2 className="h2">Approvals</h2>
            <p className="muted">Payments the agent held for a human. Approving lets one matching retry through.</p>
            {approvals.length === 0 && <div className="empty">Nothing waiting.</div>}
            {approvals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                who={nameOf(a.employee_id)}
                onResolve={employee.role === "finance" ? async (action) => { await api.resolve(a.id, action); refresh(); } : undefined}
              />
            ))}
            {employee.role !== "finance" && pending.length > 0 && (
              <p className="muted center">Switch to Priya Shah (Finance) to approve.</p>
            )}
          </section>
        )}

        {tab === "audit" && (
          <section>
            <h2 className="h2">Audit trail</h2>
            <div className="stats">
              <Stat label="Decisions" value={String(audit.length)} />
              <Stat label="Blocked" value={money(audit.filter((t) => t.status !== "approved").reduce((s, t) => s + t.amount, 0))} />
              <Stat label="Median" value={`${median(audit.map((t) => t.latency_ms))} ms`} />
            </div>
            <TransactionList transactions={audit} onOpen={setOpen} showWho={nameOf} />
          </section>
        )}

        {tab === "policy" && policy && (
          <section>
            <h2 className="h2">Spend policy</h2>
            <p className="muted">{policy.policy.company} · {policy.policy.version}</p>
            <div className="panel">
              {policy.rules.map((r) => (
                <div key={r.id} className="rule-row">
                  <div className="rule-top"><span className="rule-id">{r.id}</span><span className="rule-title">{r.title}</span></div>
                  <div className="rule-ev">{r.text}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <nav className="tabbar">
        <TabButton icon="◉" label="Home" active={tab === "home"} onClick={() => setTab("home")} />
        <TabButton icon="✓" label="Approvals" active={tab === "approvals"} onClick={() => setTab("approvals")} badge={pending.length} />
        <TabButton icon="≡" label="Audit" active={tab === "audit"} onClick={() => setTab("audit")} />
        <TabButton icon="⛨" label="Policy" active={tab === "policy"} onClick={() => setTab("policy")} />
      </nav>

      <Sheet open={!!open} onClose={() => setOpen(null)}>
        {open && <TransactionDetail tx={open} />}
      </Sheet>

      <Sheet open={paying} onClose={() => setPaying(false)}>
        {card && (
          <PaySheet
            onPay={async (p) => {
              setPaying(false);
              try {
                const r = await api.simulate({ cardId: card.id, ...p });
                if (r.transaction) setToast(r.transaction);
                refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        )}
      </Sheet>

      <Sheet open={switcher} onClose={() => setSwitcher(false)}>
        <h3 className="sheet-title">Switch employee</h3>
        <div className="panel">
          {employees.map((e) => (
            <button key={e.id} className="txrow" onClick={() => { setEmployeeId(e.id); setSwitcher(false); setTab("home"); }}>
              <Avatar employee={e} />
              <div className="txmain">
                <div className="txmerchant">{e.name}</div>
                <div className="txsub">{e.team} · {e.role}</div>
              </div>
              {e.id === employeeId && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function PaySheet({ onPay }: { onPay: (p: { merchant: string; mcc: string; amount: number; city?: string; hour?: number }) => void }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return (
    <div>
      <h3 className="sheet-title">Tap to pay</h3>
      <p className="muted">Creates a card authorization. Clearance decides before the money moves.</p>
      <div className="panel">
        {PRESETS.map((p) => (
          <div key={p.merchant} className="preset">
            <div className="txmain">
              <div className="txmerchant">{p.merchant}</div>
              <div className="txsub">{p.note}{p.hour !== undefined ? ` · ${String(p.hour).padStart(2, "0")}:17` : ""}</div>
            </div>
            <input
              className="amount-input"
              inputMode="decimal"
              value={amounts[p.merchant] ?? (p.amount / 100).toFixed(2)}
              onChange={(e) => setAmounts({ ...amounts, [p.merchant]: e.target.value })}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => onPay({ ...p, amount: Math.round(Number(amounts[p.merchant] ?? p.amount / 100) * 100) })}
            >
              Pay
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Action({ icon, label, onClick, primary, disabled, badge }: {
  icon: string; label: string; onClick: () => void; primary?: boolean; disabled?: boolean; badge?: number;
}) {
  return (
    <button className="action" onClick={onClick} disabled={disabled}>
      <span className={`action-icon ${primary ? "primary" : ""}`}>{icon}{!!badge && <i className="badge">{badge}</i>}</span>
      <span className="action-label">{label}</span>
    </button>
  );
}

function TabButton({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      <span className="tab-icon">{icon}{!!badge && <i className="badge">{badge}</i>}</span>
      <span>{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat panel"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function localStorageGet(key: string) {
  try { return localStorage.getItem(`clearance:${key}`); } catch { return null; }
}
function localStorageSet(key: string, value: string) {
  try { localStorage.setItem(`clearance:${key}`, value); } catch { /* private mode */ }
}

