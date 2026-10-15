import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, money, DECIDED_BY_LABEL,
  type Approval, type Employee, type Health, type Overview, type PolicyDoc, type Transaction,
} from "./api";
import {
  ApprovalCard, Avatar, MerchantAvatar, PaymentCard, PRESETS, Sheet, StatusPill, TransactionDetail, TransactionList,
} from "./components";
import { BrandMark, GlassLetterform, Icon } from "./icons";
import { Negotiation } from "./Negotiation";

type Tab = "home" | "approvals" | "audit" | "policy";

const ROLE_LABEL: Record<string, string> = { engineer: "Engineer", sales: "Account executive", finance: "Approver" };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(() => localStorageGet("employee"));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<Transaction[]>([]);
  const [policy, setPolicy] = useState<PolicyDoc | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [open, setOpen] = useState<Transaction | null>(null);
  const [negotiating, setNegotiating] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [freezing, setFreezing] = useState(false);
  const payingRef = useRef(false);
  payingRef.current = paying;
  const employeeRef = useRef(employeeId);
  employeeRef.current = employeeId;

  const refresh = useCallback(async () => {
    const id = employeeRef.current;
    if (!id) return;
    try {
      const [o, a, au] = await Promise.all([api.overview(id), api.approvals(), api.audit()]);
      if (employeeRef.current !== id) return;
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
    if (employeeId) localStorageSet("employee", employeeId);
    else localStorageRemove("employee");
    setOverview(null);
    refresh();
  }, [employeeId, refresh]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("transaction", (e) => {
      const tx = JSON.parse((e as MessageEvent).data) as Transaction;
      if (tx.employee_id === employeeRef.current && !payingRef.current) setToast(tx);
      setOpen((cur) => (cur && cur.id === tx.id ? tx : cur));
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

  const choose = (id: string) => { setEmployeeId(id); setTab("home"); };
  const signOut = () => { setEmployeeId(null); setOpen(null); setPaying(false); };

  if (!employeeId) {
    return <Welcome employees={employees} onChoose={choose} error={error} />;
  }

  if (!overview) {
    return (
      <div className="boot">
        <BrandMark size={44} />
        <span>{error ?? "Loading…"}</span>
        {error && <button className="btn btn-white" onClick={signOut}>Back</button>}
      </div>
    );
  }

  const nameOf = (id: string) => employees.find((e) => e.id === id)?.name ?? id;
  const pending = approvals.filter((a) => a.status === "pending");
  const { employee, cards, transactions, monthSpent } = overview;
  const card = cards[0];
  const budgetPct = Math.min(100, (monthSpent / employee.monthly_budget) * 100);
  const myRequests = pending.filter((a) => a.employee_id === employee.id).length;

  const toggleFreeze = async () => {
    if (!card || freezing) return;
    setFreezing(true);
    try { await api.freeze(card.id, card.status !== "frozen"); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setFreezing(false); }
  };

  return (
    <div className="app">
      <div className="bg-bloom" aria-hidden="true" />

      {toast && (
        <button className={`toast toast-${toast.status}`} onClick={() => { setOpen(toast); setToast(null); }}>
          <span className={`toast-icon ti-${toast.status}`}>
            <Icon name={toast.status === "approved" ? "check" : toast.status === "declined" ? "x" : "clock"} size={18} strokeWidth={2.4} />
          </span>
          <span className="toast-text">
            <span className="toast-title">
              {toast.status === "approved" ? "Payment cleared" : toast.status === "declined" ? "Payment declined" : "Sent to your manager"}
              <em>{money(toast.captured_amount != null && toast.captured_amount < toast.amount ? toast.captured_amount : toast.amount)}</em>
            </span>
            <span className="toast-body">{toast.merchant} · {toast.summary}</span>
          </span>
        </button>
      )}

      <header className="topbar">
        <button className="who" onClick={signOut} aria-label="Switch user">
          <Avatar employee={employee} size={40} />
          <div>
            <div className="who-hi">{greeting()},</div>
            <div className="who-name">{employee.name.split(" ")[0]} <Icon name="chevronDown" size={14} /></div>
          </div>
        </button>
        <div className={`mode ${health?.agent ? "on" : ""}`} title={health?.model}>
          <span className="dot" /> {health?.agent ? "AI controller live" : "Rules only"}
        </div>
      </header>

      {error && <div className="banner" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss"><Icon name="x" size={16} /></button></div>}

      <main className="content">
        {tab === "home" && (
          <div className="stack">
            <section className="hero">
              <div className="hero-label">Spent in {new Date().toLocaleDateString("en-GB", { month: "long" })}</div>
              <div className="hero-amount">{money(monthSpent)}</div>
              <div className="budget">
                <div className={`budget-bar ${budgetPct >= 100 ? "over" : budgetPct >= 80 ? "warn" : ""}`}><div style={{ width: `${Math.max(2, budgetPct)}%` }} /></div>
                <div className="budget-legend">
                  <span>{money(Math.max(0, employee.monthly_budget - monthSpent))} left</span>
                  <span>of {money(employee.monthly_budget)}</span>
                </div>
              </div>
            </section>

            {card && <PaymentCard card={card} employee={employee} />}

            <div className="actions">
              <Action icon="tap" label="Tap to pay" primary onClick={() => setPaying(true)} disabled={!card || card.status === "frozen"} />
              <Action icon="snow" label={card?.status === "frozen" ? "Unfreeze" : "Freeze"} onClick={toggleFreeze} disabled={!card || freezing} active={card?.status === "frozen"} />
              <Action icon="inbox" label="Requests" onClick={() => setTab("approvals")} badge={myRequests} />
              <Action icon="shield" label="Policy" onClick={() => setTab("policy")} />
            </div>

            <div className="list-head">
              <h2>Activity</h2>
              <span>{transactions.length} payment{transactions.length === 1 ? "" : "s"}</span>
            </div>
            <TransactionList transactions={transactions} onOpen={setOpen} />
          </div>
        )}

        {tab === "approvals" && (
          <section className="stack">
            <PageHead title="Approvals" sub={employee.role === "finance"
              ? "Payments Clearance held for a human. Approving lets one matching retry through."
              : "Payments waiting for Finance. Once approved, retry the payment and it goes through."} />
            {approvals.length === 0 && <div className="empty glass"><Icon name="checkCircle" size={26} /><div>All clear</div><span>Nothing is waiting for a decision.</span></div>}
            {[...pending, ...approvals.filter((a) => a.status !== "pending")].map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                who={nameOf(a.employee_id)}
                onResolve={employee.role === "finance" ? async (action) => { await api.resolve(a.id, action); await refresh(); } : undefined}
              />
            ))}
            {employee.role !== "finance" && pending.length > 0 && (
              <button className="hint" onClick={() => choose("emp_priya")}>
                <Icon name="switch" size={16} /> Switch to Priya Shah (Finance) to approve
              </button>
            )}
          </section>
        )}

        {tab === "audit" && (
          <section className="stack">
            <PageHead title="Audit trail" sub="Every decision, who made it and which policy rule it cites." />
            <div className="stats">
              <Stat label="Decisions" value={String(audit.length)} />
              <Stat label="Held back" value={money(audit.filter((t) => t.status !== "approved").reduce((s, t) => s + t.amount, 0))} />
              <Stat label="Median" value={`${median(audit.map((t) => t.latency_ms))} ms`} />
            </div>
            <div className="stat-split glass">
              {(["approved", "escalated", "declined"] as const).map((s) => {
                const n = audit.filter((t) => t.status === s).length;
                return <div key={s} className={`split-${s}`} style={{ flexGrow: n || 0.0001 }} title={`${s}: ${n}`} />;
              })}
            </div>
            <div className="split-legend">
              {(["approved", "escalated", "declined"] as const).map((s) => (
                <span key={s} className={`lg-${s}`}><i />{audit.filter((t) => t.status === s).length} {s === "escalated" ? "with manager" : s}</span>
              ))}
            </div>
            <TransactionList transactions={audit} onOpen={setOpen} showWho={nameOf} />
          </section>
        )}

        {tab === "policy" && (
          <section className="stack">
            <PageHead title="Spend policy" sub={policy ? `${policy.policy.company} · ${policy.policy.version} · enforced on every payment` : "Loading…"} />
            {policy && (
              <div className="glass list">
                {policy.rules.map((r) => (
                  <div key={r.id} className="rule-row">
                    <div className="rule-top"><span className="rule-id">{r.id}</span><span className="rule-title">{r.title}</span></div>
                    <div className="rule-ev">{r.text}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <nav className="tabbar" aria-label="Main">
        <TabButton icon="home" label="Home" active={tab === "home"} onClick={() => setTab("home")} />
        <TabButton icon="approvals" label="Approvals" active={tab === "approvals"} onClick={() => setTab("approvals")} badge={pending.length} />
        <TabButton icon="audit" label="Audit" active={tab === "audit"} onClick={() => setTab("audit")} />
        <TabButton icon="shield" label="Policy" active={tab === "policy"} onClick={() => setTab("policy")} />
      </nav>

      <Sheet open={!!open} onClose={() => setOpen(null)} label="Payment details">
        {open && <TransactionDetail key={open.id} tx={open} onNegotiate={() => setNegotiating(open)} />}
      </Sheet>

      <Sheet open={paying} onClose={() => setPaying(false)} label="Tap to pay">
        {card && (
          <PaySheet
            cardId={card.id}
            onDone={() => setPaying(false)}
            onResult={() => refresh()}
            onOpen={(tx) => { setPaying(false); setOpen(tx); }}
            onNegotiate={(tx) => { setPaying(false); setOpen(tx); setNegotiating(tx); }}
          />
        )}
      </Sheet>

      {negotiating && (
        <Negotiation
          tx={negotiating}
          onClose={() => setNegotiating(null)}
          onSettled={(updated) => {
            setOpen((cur) => (cur && cur.id === updated.id ? updated : cur));
            setNegotiating((cur) => (cur ? updated : cur));
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Welcome ---------- */

function Welcome({ employees, onChoose, error }: { employees: Employee[]; onChoose: (id: string) => void; error: string | null }) {
  const order = ["emp_maya", "emp_tom", "emp_priya"];
  const sorted = [...employees].sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99);
  return (
    <div className="welcome">
      <div className="welcome-art"><GlassLetterform /></div>
      <div className="welcome-copy">
        <div className="welcome-brand"><BrandMark size={20} /> Clearance</div>
        <h1>Every payment, cleared before it leaves.</h1>
        <p>Company cards with an AI controller that checks your policy on every tap — and explains each decision.</p>
      </div>
      <div className="welcome-pick">
        <div className="welcome-label">Continue as</div>
        {error && !employees.length && <div className="banner">{error}</div>}
        {!employees.length && !error && [0, 1, 2].map((i) => <div key={i} className="pill-btn skeleton" />)}
        {sorted.map((e) => (
          <button key={e.id} className="pill-btn" onClick={() => onChoose(e.id)}>
            <Avatar employee={e} size={38} />
            <span className="pill-text">
              <span className="pill-name">{e.name}</span>
              <span className="pill-sub">{e.team} · {ROLE_LABEL[e.role] ?? e.role}</span>
            </span>
            <Icon name="chevronRight" size={18} className="pill-chev" />
          </button>
        ))}
        <p className="welcome-foot"><Icon name="lock" size={13} /> Stripe test mode · demo company Acme</p>
      </div>
    </div>
  );
}

/* ---------- Pay sheet ---------- */

type PayPreset = (typeof PRESETS)[number];
const REVIEW_STEPS = ["Placing a Stripe test-mode hold", "Checking the spend policy", "Clearance agent reviewing", "Recording the decision"];

function PaySheet({ cardId, onDone, onResult, onOpen, onNegotiate }: {
  cardId: string;
  onDone: () => void;
  onResult: () => void;
  onOpen: (tx: Transaction) => void;
  onNegotiate: (tx: Transaction) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"pick" | "review" | "done" | "error">("pick");
  const [current, setCurrent] = useState<{ preset: PayPreset; amount: number } | null>(null);
  const [result, setResult] = useState<Transaction | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (phase !== "review") return;
    setStep(0);
    const t = setInterval(() => setStep((s) => Math.min(s + 1, REVIEW_STEPS.length - 1)), 1400);
    return () => clearInterval(t);
  }, [phase]);

  const pay = async (preset: PayPreset) => {
    const raw = amounts[preset.merchant];
    const amount = Math.round(Number(raw ?? preset.amount / 100) * 100);
    if (!Number.isFinite(amount) || amount <= 0) { setErr("Enter a valid amount"); return; }
    setCurrent({ preset, amount });
    setErr(null);
    setPhase("review");
    try {
      const { note: _n, category: _c, ...body } = preset;
      const r = await api.simulate({ cardId, ...body, amount });
      setResult(r.transaction ?? null);
      setPhase("done");
      onResult();
    } catch (e) {
      setErr((e as Error).message);
      setPhase("error");
    }
  };

  if (phase === "review" && current) {
    return (
      <div className="review">
        <div className="review-orb"><span /><span /><span /><BrandMark size={34} /></div>
        <div className="review-amount">{money(current.amount)}</div>
        <div className="review-merchant">{current.preset.merchant}</div>
        <h3>Clearance is reviewing…</h3>
        <ol className="review-steps">
          {REVIEW_STEPS.map((s, i) => (
            <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
              <span className="rs-dot">{i < step ? <Icon name="check" size={12} strokeWidth={3} /> : null}</span>{s}
            </li>
          ))}
        </ol>
        <p className="muted center">Money doesn't move until it's cleared.</p>
      </div>
    );
  }

  if ((phase === "done" || phase === "error") && current) {
    const tx = result;
    return (
      <div className="result">
        {tx ? (
          <>
            <div className={`result-icon ri-${tx.status}`}>
              <Icon name={tx.status === "approved" ? "check" : tx.status === "declined" ? "x" : "clock"} size={34} strokeWidth={2.4} />
            </div>
            <h3>{tx.status === "approved" ? "Cleared" : tx.status === "declined" ? "Declined" : "Sent to your manager"}</h3>
            <div className="result-amount">{money(tx.amount)} · {tx.merchant}</div>
            <StatusPill status={tx.status} />
            <p className="result-summary">{tx.summary}</p>
            <div className="result-by">{DECIDED_BY_LABEL[tx.decided_by]} · {tx.latency_ms.toLocaleString()} ms</div>
            <div className="result-actions">
              {tx.status !== "approved" && (
                <button className="btn btn-ink btn-block" onClick={() => onNegotiate(tx)}><Icon name="sparkle" size={18} /> Negotiate with Clearance</button>
              )}
              <button className={`btn btn-block ${tx.status === "approved" ? "btn-ink" : "btn-white"}`} onClick={() => onOpen(tx)}>See why</button>
              <button className="btn btn-text" onClick={onDone}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="result-icon ri-declined"><Icon name="x" size={34} strokeWidth={2.4} /></div>
            <h3>{err ? "Something went wrong" : "No decision returned"}</h3>
            <p className="result-summary">{err ?? "The card may be frozen or the payment was not created."}</p>
            <div className="result-actions">
              <button className="btn btn-ink btn-block" onClick={() => setPhase("pick")}>Try again</button>
              <button className="btn btn-text" onClick={onDone}>Close</button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <h3 className="sheet-title">Tap to pay</h3>
      <p className="muted">Places a real Stripe test-mode hold. Clearance decides before the money moves.</p>
      {err && <div className="banner">{err}</div>}
      <div className="glass list">
        {PRESETS.map((p) => (
          <div key={p.merchant} className="preset">
            <MerchantAvatar merchant={p.merchant} category={p.category} size={40} />
            <div className="txmain">
              <div className="txmerchant">{p.merchant}</div>
              <div className="txsub">{p.note}{p.hour !== undefined ? ` · ${String(p.hour).padStart(2, "0")}:17` : ""}</div>
            </div>
            <label className="amount-field">
              <span>£</span>
              <input
                aria-label={`Amount for ${p.merchant}`}
                inputMode="decimal"
                value={amounts[p.merchant] ?? (p.amount / 100).toFixed(2)}
                onChange={(e) => setAmounts({ ...amounts, [p.merchant]: e.target.value })}
              />
            </label>
            <button className="btn btn-ink btn-sm" onClick={() => pay(p)}>Pay</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Small bits ---------- */

function PageHead({ title, sub }: { title: string; sub: string }) {
  return <div className="page-head"><h1>{title}</h1><p>{sub}</p></div>;
}

function Action({ icon, label, onClick, primary, disabled, badge, active }: {
  icon: string; label: string; onClick: () => void; primary?: boolean; disabled?: boolean; badge?: number; active?: boolean;
}) {
  return (
    <button className={`action ${primary ? "primary" : ""} ${active ? "active" : ""}`} onClick={onClick} disabled={disabled}>
      <span className="action-icon"><Icon name={icon} size={22} />{!!badge && <i className="badge">{badge}</i>}</span>
      <span className="action-label">{label}</span>
    </button>
  );
}

function TabButton({ icon, label, active, onClick, badge }: { icon: string; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button className={`tab ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span className="tab-icon"><Icon name={icon} size={21} />{!!badge && <i className="badge">{badge}</i>}</span>
      <span>{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat glass"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

function localStorageGet(key: string) {
  try { return localStorage.getItem(`clearance:${key}`); } catch { return null; }
}
function localStorageSet(key: string, value: string) {
  try { localStorage.setItem(`clearance:${key}`, value); } catch { /* private mode */ }
}
function localStorageRemove(key: string) {
  try { localStorage.removeItem(`clearance:${key}`); } catch { /* private mode */ }
}

