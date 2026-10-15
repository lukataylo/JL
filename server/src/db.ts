import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Approval, Card, Employee, Negotiation, Transaction } from "./types.js";

export const db = new DatabaseSync(process.env.DB_PATH ?? "clearance.db");

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, team TEXT,
  monthly_budget INTEGER, stripe_cardholder_id TEXT, avatar_color TEXT
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, employee_id TEXT, stripe_card_id TEXT UNIQUE, last4 TEXT,
  exp TEXT, status TEXT, color TEXT, nickname TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, stripe_authorization_id TEXT, card_id TEXT, employee_id TEXT,
  merchant TEXT, category TEXT, mcc TEXT, city TEXT, amount INTEGER, currency TEXT,
  status TEXT, decided_by TEXT, rule_results TEXT, agent TEXT, summary TEXT,
  cited_rules TEXT, latency_ms INTEGER, created_at TEXT, captured_amount INTEGER, released_by TEXT
);
CREATE TABLE IF NOT EXISTS negotiations (
  id TEXT PRIMARY KEY, transaction_id TEXT UNIQUE, status TEXT, messages TEXT, counter_amount INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, transaction_id TEXT, employee_id TEXT, merchant TEXT, amount INTEGER,
  reason TEXT, status TEXT, approver TEXT, note TEXT, created_at TEXT, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, subject TEXT, text TEXT, created_at TEXT
);
`);

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

type Row = Record<string, unknown>;

function toTransaction(r: Row): Transaction {
  return {
    ...(r as unknown as Transaction),
    rule_results: JSON.parse(r.rule_results as string),
    agent: r.agent ? JSON.parse(r.agent as string) : null,
    cited_rules: JSON.parse(r.cited_rules as string),
  };
}

export const repo = {
  employees: () => db.prepare("SELECT * FROM employees ORDER BY name").all() as unknown as Employee[],
  employee: (id: string) => db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as unknown as Employee | undefined,

  cardsFor: (employeeId: string) =>
    db.prepare("SELECT * FROM cards WHERE employee_id = ?").all(employeeId) as unknown as Card[],
  card: (id: string) => db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as unknown as Card | undefined,
  cardByStripeId: (stripeId: string) =>
    db.prepare("SELECT * FROM cards WHERE stripe_card_id = ?").get(stripeId) as unknown as Card | undefined,
  setCardStatus: (id: string, status: Card["status"]) =>
    db.prepare("UPDATE cards SET status = ? WHERE id = ?").run(status, id),

  insertTransaction(t: Transaction) {
    db.prepare(
      `INSERT INTO transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      t.id, t.stripe_authorization_id, t.card_id, t.employee_id, t.merchant, t.category, t.mcc,
      t.city, t.amount, t.currency, t.status, t.decided_by, JSON.stringify(t.rule_results),
      t.agent ? JSON.stringify(t.agent) : null, t.summary, JSON.stringify(t.cited_rules),
      t.latency_ms, t.created_at, t.captured_amount, t.released_by,
    );
  },
  setAuthorizationId: (id: string, authorizationId: string) =>
    db.prepare("UPDATE transactions SET stripe_authorization_id = ? WHERE id = ?").run(authorizationId, id),
  /** Final outcome after a hold is released or closed by a manager or negotiation. */
  settleTransaction: (id: string, status: Transaction["status"], decidedBy: Transaction["decided_by"], summary: string, capturedAmount: number | null, releasedBy: string | null) =>
    db.prepare("UPDATE transactions SET status = ?, decided_by = ?, summary = ?, captured_amount = ?, released_by = ? WHERE id = ?")
      .run(status, decidedBy, summary, capturedAmount, releasedBy, id),
  transactionsFor: (employeeId: string, limit = 50) =>
    (db.prepare("SELECT * FROM transactions WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(employeeId, limit) as Row[]).map(toTransaction),
  recentTransactions: (limit = 50) =>
    (db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(toTransaction),
  transaction: (id: string) => {
    const r = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Row | undefined;
    return r ? toTransaction(r) : undefined;
  },
  approvedAtMerchant: (merchant: string) =>
    (db.prepare(
      "SELECT * FROM transactions WHERE status = 'approved' AND lower(merchant) = lower(?) ORDER BY created_at DESC",
    ).all(merchant) as Row[]).map(toTransaction),
  monthSpent(employeeId: string, at: Date) {
    const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
    const r = db.prepare(
      "SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE employee_id = ? AND status = 'approved' AND created_at >= ?",
    ).get(employeeId, monthStart) as { total: number };
    return r.total;
  },

  insertApproval(a: Approval) {
    db.prepare(`INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      a.id, a.transaction_id, a.employee_id, a.merchant, a.amount, a.reason, a.status,
      a.approver, a.note, a.created_at, a.resolved_at,
    );
  },
  approvals: () => db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 50").all() as unknown as Approval[],
  pendingApprovalFor: (transactionId: string) =>
    db.prepare("SELECT * FROM approvals WHERE transaction_id = ? AND status = 'pending'").get(transactionId) as unknown as Approval | undefined,
  approval: (id: string) => db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as unknown as Approval | undefined,
  /** An approved, unused pre-approval that covers this merchant and amount. */
  matchingPreApproval: (employeeId: string, merchant: string, amount: number) =>
    db.prepare(
      `SELECT * FROM approvals WHERE employee_id = ? AND status = 'approved'
       AND lower(merchant) = lower(?) AND amount >= ? ORDER BY resolved_at DESC LIMIT 1`,
    ).get(employeeId, merchant, amount) as unknown as Approval | undefined,
  resolveApproval: (id: string, status: Approval["status"], approver: string | null, note: string | null) =>
    db.prepare("UPDATE approvals SET status = ?, approver = COALESCE(?, approver), note = COALESCE(?, note), resolved_at = ? WHERE id = ?")
      .run(status, approver, note, new Date().toISOString(), id),

  negotiation(transactionId: string): Negotiation | undefined {
    const r = db.prepare("SELECT * FROM negotiations WHERE transaction_id = ?").get(transactionId) as Row | undefined;
    return r ? { ...(r as unknown as Negotiation), messages: JSON.parse(r.messages as string) } : undefined;
  },
  saveNegotiation(n: Negotiation) {
    db.prepare(
      `INSERT INTO negotiations VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, messages = excluded.messages, counter_amount = excluded.counter_amount`,
    ).run(n.id, n.transaction_id, n.status, JSON.stringify(n.messages), n.counter_amount, n.created_at);
  },

  addMemory: (subject: string, text: string) =>
    db.prepare("INSERT INTO memories VALUES (?,?,?,?)").run(newId("mem"), subject, text, new Date().toISOString()),
  memoriesAbout: (subjects: string[]) =>
    db.prepare(
      `SELECT subject, text, created_at FROM memories WHERE subject IN (${subjects.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 20`,
    ).all(...subjects) as { subject: string; text: string; created_at: string }[],
};
