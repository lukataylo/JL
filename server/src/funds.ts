import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { client, MODEL } from "./agent.js";
import { db, newId, repo } from "./db.js";
import { broadcast } from "./events.js";
import { POLICY, RULES, gbp } from "./policy.js";
import { cancelHold, captureHold, placeHold, stripe, stripeMode } from "./stripe.js";
import type { Category, Employee, NegotiationMessage, NegotiationOutcome } from "./types.js";

/**
 * Funds-first spending: every card starts at £0. Before spending, the employee asks Clearance
 * for money (by voice or text) and negotiates. Released funds are reserved as a Stripe hold
 * and the card can spend against them instantly.
 */
export interface FundRequest {
  id: string;
  employee_id: string;
  status: "open" | "countered" | "released" | "referred" | "denied" | "spent";
  messages: NegotiationMessage[];
  purpose: string | null;
  category: Category | null;
  amount_requested: number | null;
  counter_amount: number | null;
  amount_released: number | null;
  /** What's left to spend from the released amount. */
  remaining: number;
  stripe_hold: string | null;
  created_at: string;
}

db.exec(`CREATE TABLE IF NOT EXISTS fund_requests (
  id TEXT PRIMARY KEY, employee_id TEXT, status TEXT, messages TEXT, purpose TEXT, category TEXT,
  amount_requested INTEGER, counter_amount INTEGER, amount_released INTEGER, remaining INTEGER,
  stripe_hold TEXT, created_at TEXT
)`);

type Row = Record<string, unknown>;
const toRequest = (r: Row): FundRequest => ({ ...(r as unknown as FundRequest), messages: JSON.parse(r.messages as string) });

export const funds = {
  get: (id: string) => {
    const r = db.prepare("SELECT * FROM fund_requests WHERE id = ?").get(id) as Row | undefined;
    return r ? toRequest(r) : undefined;
  },
  forEmployee: (employeeId: string) =>
    (db.prepare("SELECT * FROM fund_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 30").all(employeeId) as Row[]).map(toRequest),
  save(f: FundRequest) {
    db.prepare(
      `INSERT INTO fund_requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, messages = excluded.messages, purpose = excluded.purpose, category = excluded.category,
       amount_requested = excluded.amount_requested, counter_amount = excluded.counter_amount,
       amount_released = excluded.amount_released, remaining = excluded.remaining, stripe_hold = excluded.stripe_hold`,
    ).run(f.id, f.employee_id, f.status, JSON.stringify(f.messages), f.purpose, f.category, f.amount_requested,
      f.counter_amount, f.amount_released, f.remaining, f.stripe_hold, f.created_at);
  },
  /** Money released and not yet spent. */
  available: (employeeId: string) =>
    (db.prepare("SELECT COALESCE(SUM(remaining),0) AS t FROM fund_requests WHERE employee_id = ? AND status = 'released'")
      .get(employeeId) as { t: number }).t,
  /** The released request a payment of this size and category can draw on. */
  coverFor(employeeId: string, amount: number, category: Category) {
    const open = (db.prepare("SELECT * FROM fund_requests WHERE employee_id = ? AND status = 'released' AND remaining >= ? ORDER BY created_at")
      .all(employeeId, amount) as Row[]).map(toRequest);
    return {
      match: open.find((f) => !f.category || f.category === category),
      wrongPurpose: open[0],
    };
  },
};

export function budgetLeft(employee: Employee) {
  return employee.monthly_budget - repo.monthSpent(employee.id, new Date()) - funds.available(employee.id);
}

const CATEGORIES = ["software", "hardware", "travel", "lodging", "transport", "meals", "books", "gifts", "repairs", "gambling", "jewelry", "cash", "other"] as const;

const Turn = z.object({
  reply: z.string().describe("What you say. Warm, direct, spoken-friendly (it may be read aloud). At most 2 sentences, under 40 words."),
  outcome: z.enum(["ask", "approve", "counter", "refer", "deny"]),
  amount_requested_pence: z.number().int().nullable().describe("The amount the employee is asking for, in pence, once known"),
  release_pence: z.number().int().nullable().describe("approve: the full requested amount; counter: the lower amount you'll release"),
  purpose: z.string().nullable().describe("Short purpose label once known, e.g. 'Emergency plumber, office leak'"),
  category: z.enum(CATEGORIES).nullable().describe("Spend category the funds are for, once known"),
  cited_rules: z.array(z.string()),
  memory_note: z.string().nullable().describe("A durable fact worth remembering for future decisions, or null"),
});

const SYSTEM = `You are Clearance, ${POLICY.company}'s spend agent. Company cards hold £0 until you release money onto them.
An employee is asking you for funds before they spend — often something urgent. You may be talking over voice, so speak naturally and briefly.

Negotiate like a sharp, fair finance partner:
- You need three things: what it's for, how much, and why it can't go through the normal route. Ask for whatever is missing, one question at a time.
- Check the story against company memory and the written policy. Specifics that match memory earn trust; contradictions earn scepticism.
- Outcomes:
  - ask: you need one more piece of information.
  - approve: purpose is clear and legitimate; release the full amount requested.
  - counter: legitimate but more than policy supports; release a lower amount you can justify (e.g. per-head allowance × people, or the role limit).
  - refer: legitimate but above your authority — it goes to the Finance approver (\${approver}). Name them.
  - deny: against policy or not credible. Say what would change your mind.
- Released funds are tied to the purpose and category you record, so set purpose and category precisely.
- The employee may have picked a category before speaking (category_so_far in the case file). Treat it as their claim: keep it if the story fits, correct it if it doesn't.
- Cite the policy rule IDs that drive your decision.

Hard limits (code enforces these):
- Prohibited categories (P1) are never funded.
- You can't release more than the employee's remaining monthly budget (P4).
- Your authority is at most 2× their per-transaction limit; above that, refer.

Written policy:
${RULES.map((r) => `${r.id} ${r.title}: ${r.text}`).join("\n")}`;

const MAX_EMPLOYEE_TURNS = 6;
const approverName = () => repo.employees().find((e) => e.role === "finance")?.name ?? "Finance";

function recallFor(employee: Employee) {
  return {
    recent_payments: repo.transactionsFor(employee.id, 8).map((t) => `${t.created_at.slice(0, 10)} ${t.merchant} ${gbp(t.amount)} ${t.status}`),
    recent_fund_requests: funds.forEmployee(employee.id).slice(0, 5).map((f) => `${f.created_at.slice(0, 10)} ${f.purpose ?? "?"} ${f.status} ${f.amount_released ? gbp(f.amount_released) : ""}`),
    facts: repo.memoriesAbout(["company", employee.id]).map((m) => m.text),
  };
}

/** One round of a funds request. Creates the request on the first message. */
export async function talk(employee: Employee, requestId: string | null, text: string, pickedCategory: string | null = null) {
  const req: FundRequest = (requestId && funds.get(requestId)) || {
    id: newId("req"), employee_id: employee.id, status: "open", messages: [], purpose: null, category: null,
    amount_requested: null, counter_amount: null, amount_released: null, remaining: 0, stripe_hold: null,
    created_at: new Date().toISOString(),
  };
  if (req.status !== "open" && req.status !== "countered") throw new Error("This request is closed. Start a new one.");
  if (req.messages.length === 0 && pickedCategory && (CATEGORIES as readonly string[]).includes(pickedCategory)) req.category = pickedCategory as Category;

  req.messages.push({ role: "employee", text, at: new Date().toISOString() });
  const turns = req.messages.filter((m) => m.role === "employee").length;
  const limit = POLICY.roles[employee.role].perTxnLimit;
  const left = budgetLeft(employee);

  const caseFile = {
    employee: `${employee.name}, ${employee.role}, ${employee.team}`,
    per_transaction_limit: gbp(limit),
    your_release_cap: gbp(limit * 2),
    budget: { monthly: gbp(employee.monthly_budget), spent: gbp(repo.monthSpent(employee.id, new Date())), released_unspent: gbp(funds.available(employee.id)), left_to_release: gbp(left) },
    now: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }),
    memory: recallFor(employee),
    employee_messages_so_far: turns,
    category_so_far: req.category,
  };
  const transcript = req.messages.map((m) => `${m.role === "employee" ? employee.name.split(" ")[0] : "Clearance"}: ${m.text}`).join("\n");

  const response = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM.replace("${approver}", approverName()),
      messages: [{ role: "user", content: `<case_file>\n${JSON.stringify(caseFile, null, 2)}\n</case_file>\n\n<conversation>\n${transcript}\n</conversation>\n\nReply as Clearance.` }],
      output_config: { effort: "medium", format: zodOutputFormat(Turn) },
    },
    { timeout: 45_000 },
  );
  const turn = response.parsed_output;
  if (response.stop_reason === "refusal" || !turn) throw new Error("Clearance couldn't respond to that. Try rephrasing.");

  if (turn.purpose) req.purpose = turn.purpose;
  if (turn.category) req.category = turn.category;
  if (turn.amount_requested_pence) req.amount_requested = turn.amount_requested_pence;

  // Guardrails: the model proposes, code disposes.
  let { outcome, reply } = turn;
  let release = outcome === "approve" ? (turn.release_pence ?? req.amount_requested) : outcome === "counter" ? turn.release_pence : null;
  if ((outcome === "approve" || outcome === "counter") && (!release || release <= 0)) outcome = "ask";
  if (release && req.category && POLICY.prohibitedCategories.includes(req.category)) {
    outcome = "deny";
    reply = "I can't fund that: prohibited categories are never allowed on company cards (P1).";
  } else if (release && release > left) {
    if (left <= 0) {
      outcome = "deny";
      reply = `You've no budget left to release this month (P4). ${approverName()} can raise it.`;
    } else {
      outcome = "counter";
      release = left;
      reply = `${reply} The most I can release is your remaining budget, ${gbp(left)} (P4).`;
    }
  } else if (release && release > limit * 2) {
    outcome = "refer";
    reply = `${reply} That's above what I can release myself, so I've sent it to ${approverName()}.`;
  }
  if (outcome === "counter" && req.amount_requested && release && release >= req.amount_requested) outcome = "approve";
  if (outcome === "ask" && turns >= MAX_EMPLOYEE_TURNS) {
    outcome = "refer";
    reply = `${reply} Let's get ${approverName()} to decide this one.`;
  }

  req.messages.push({
    role: "agent", text: reply, at: new Date().toISOString(), outcome: outcome as NegotiationOutcome,
    counter_amount: outcome === "counter" ? release : outcome === "approve" ? release : null,
    cited_rules: turn.cited_rules,
  });
  if (turn.memory_note) repo.addMemory(employee.id, turn.memory_note);

  if (outcome === "approve") await releaseFunds(req, release!, "Clearance");
  else if (outcome === "counter") { req.status = "countered"; req.counter_amount = release; }
  else if (outcome === "deny") req.status = "denied";
  else if (outcome === "refer") {
    req.status = "referred";
    repo.insertApproval({
      id: newId("apr"), transaction_id: req.id, employee_id: employee.id, merchant: req.purpose ?? "Funds request",
      amount: release ?? req.amount_requested ?? 0, reason: `Funds request referred by Clearance. ${employee.name.split(" ")[0]}: "${text}"`,
      status: "pending", approver: null, note: null, created_at: new Date().toISOString(), resolved_at: null,
    });
    broadcast("approval", { request: req.id });
  }
  funds.save(req);
  broadcast("funds", req);
  return req;
}

/** Puts money on the card: reserves it as a Stripe test-mode hold. */
export async function releaseFunds(req: FundRequest, amount: number, by: string) {
  const employee = repo.employee(req.employee_id)!;
  if (stripeMode === "payments") {
    const card = repo.cardsFor(employee.id)[0];
    req.stripe_hold = await placeHold(amount, `Funds: ${req.purpose ?? "request"}`, employee.name, card?.last4 ?? "0000");
  }
  req.status = "released";
  req.amount_released = amount;
  req.remaining = amount;
  repo.addMemory(employee.id, `${by} released ${gbp(amount)} to ${employee.name} for ${req.purpose ?? "an unspecified purpose"}.`);
  return req;
}

export async function acceptCounter(requestId: string) {
  const req = funds.get(requestId);
  if (!req || req.status !== "countered" || !req.counter_amount) throw new Error("There is no offer to accept.");
  req.messages.push({ role: "employee", text: `Accepted ${gbp(req.counter_amount)}.`, at: new Date().toISOString() });
  await releaseFunds(req, req.counter_amount, "Clearance");
  funds.save(req);
  broadcast("funds", req);
  return req;
}

/** Manager decision on a referred request. */
export async function decideReferred(requestId: string, approve: boolean, by: string, amount: number) {
  const req = funds.get(requestId)!;
  if (approve) await releaseFunds(req, amount, by);
  else req.status = "denied";
  req.messages.push({ role: "agent", text: approve ? `${by} approved ${gbp(amount)}. It's on your card.` : `${by} declined this request.`, at: new Date().toISOString(), outcome: approve ? "approve" : "deny" });
  funds.save(req);
  broadcast("funds", req);
}

/** Spends from released funds: captures the hold (unused remainder returns to the company). */
export async function spendFrom(req: FundRequest, amount: number) {
  if (stripe && req.stripe_hold) await captureHold(req.stripe_hold, amount);
  req.remaining = 0;
  req.status = "spent";
  funds.save(req);
  broadcast("funds", req);
}

/** Gives back unspent funds. */
export async function returnFunds(req: FundRequest) {
  if (stripe && req.stripe_hold) await cancelHold(req.stripe_hold);
  req.remaining = 0;
  req.status = "spent";
  funds.save(req);
  broadcast("funds", req);
}
