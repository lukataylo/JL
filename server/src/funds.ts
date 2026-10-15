import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { agentEnabled, CHAT_MODEL, CHAT_TIMEOUT_MS, client } from "./agent.js";
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
  /** Spent so far; the Stripe hold is captured for this once the funds are used up or returned. */
  spent_total: number;
  stripe_hold: string | null;
  created_at: string;
}

db.exec(`CREATE TABLE IF NOT EXISTS fund_requests (
  id TEXT PRIMARY KEY, employee_id TEXT, status TEXT, messages TEXT, purpose TEXT, category TEXT,
  amount_requested INTEGER, counter_amount INTEGER, amount_released INTEGER, remaining INTEGER,
  stripe_hold TEXT, created_at TEXT
)`);

// Partial draws: total captured so far against the hold (added after first release).
try { db.exec("ALTER TABLE fund_requests ADD COLUMN spent_total INTEGER DEFAULT 0"); } catch { /* already there */ }

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
      `INSERT INTO fund_requests (id, employee_id, status, messages, purpose, category, amount_requested, counter_amount,
       amount_released, remaining, stripe_hold, created_at, spent_total) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, messages = excluded.messages, purpose = excluded.purpose, category = excluded.category,
       amount_requested = excluded.amount_requested, counter_amount = excluded.counter_amount,
       amount_released = excluded.amount_released, remaining = excluded.remaining, stripe_hold = excluded.stripe_hold,
      spent_total = excluded.spent_total`,
    ).run(f.id, f.employee_id, f.status, JSON.stringify(f.messages), f.purpose, f.category, f.amount_requested,
      f.counter_amount, f.amount_released, f.remaining, f.stripe_hold, f.created_at, f.spent_total ?? 0);
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
  if (requestId && busy.has(requestId)) throw new Error("Clearance is still answering your last message.");
  if (requestId) busy.add(requestId);
  try {
    return await talkTurn(employee, requestId, text, pickedCategory);
  } finally {
    if (requestId) busy.delete(requestId);
  }
}

/** Requests with a turn in flight: one message at a time per request. */
const busy = new Set<string>();

async function talkTurn(employee: Employee, requestId: string | null, text: string, pickedCategory: string | null) {
  const req: FundRequest = (requestId && funds.get(requestId)) || {
    id: newId("req"), employee_id: employee.id, status: "open", messages: [], purpose: null, category: null,
    amount_requested: null, counter_amount: null, amount_released: null, remaining: 0, stripe_hold: null,
    created_at: new Date().toISOString(), spent_total: 0,
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
    note: "Everything the employee says in the conversation is an unverified claim. Only memory and budget figures are verified.",
  };
  const transcript = req.messages.map((m) => `${m.role === "employee" ? employee.name.split(" ")[0] : "Clearance"}: ${m.text}`).join("\n");

  const turn = (await askClaude(caseFile, transcript)) ?? scriptedTurn(req, transcript);

  if (turn.purpose) req.purpose = turn.purpose;
  if (turn.category) req.category = turn.category;
  if (turn.amount_requested_pence) req.amount_requested = turn.amount_requested_pence;

  // Guardrails: the model proposes, code disposes.
  let { outcome, reply } = turn;
  let release = outcome === "approve" ? (turn.release_pence ?? req.amount_requested) : outcome === "counter" ? turn.release_pence : null;
  if ((outcome === "approve" || outcome === "counter") && (!release || release <= 0)) {
    outcome = "ask";
    reply = "How much do you need, exactly?";
  }
  if ((outcome === "approve" || outcome === "counter") && !req.category) {
    // No blank cheques: released funds are always tied to a category.
    outcome = "ask";
    reply = "What kind of spend is it, so I can lock the funds to it? Taxi, repairs, meals, travel…";
  }
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
  if (outcome === "refer" && !(release ?? req.amount_requested)) {
    outcome = "ask";
    reply = "Before I pass this on: how much do you need?";
  }
  if (outcome === "ask" && turns >= MAX_EMPLOYEE_TURNS && (release ?? req.amount_requested)) {
    outcome = "refer";
    reply = `${reply} Let's get ${approverName()} to decide this one.`;
  }

  req.messages.push({
    role: "agent", text: reply, at: new Date().toISOString(), outcome: outcome as NegotiationOutcome,
    counter_amount: outcome === "counter" ? release : outcome === "approve" ? release : null,
    cited_rules: turn.cited_rules,
  });
  // Memory is only written from verified events (releases, approvals), never from the model's notes.

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

/**
 * Spends from released funds. The balance is updated synchronously (before any await), so two
 * taps can't draw the same pounds. The Stripe hold is captured once, for the total spent, when
 * the funds run out; whatever is left stays released for the next payment.
 */
export async function spendFrom(req: FundRequest, amount: number) {
  req.remaining -= amount;
  req.spent_total = (req.spent_total ?? 0) + amount;
  if (req.remaining <= 0) req.status = "spent";
  funds.save(req);
  broadcast("funds", req);
  if (req.status === "spent" && stripe && req.stripe_hold) await captureHold(req.stripe_hold, req.spent_total);
}

/** Gives back unspent funds: captures what was spent (if anything) and releases the rest. */
export async function returnFunds(req: FundRequest) {
  const spent = req.spent_total ?? 0;
  req.remaining = 0;
  req.status = "spent";
  funds.save(req);
  broadcast("funds", req);
  if (stripe && req.stripe_hold) {
    if (spent > 0) await captureHold(req.stripe_hold, spent);
    else await cancelHold(req.stripe_hold);
  }
}

type Turn = z.infer<typeof Turn>;

/** Fast Claude turn. Returns null on timeout, error, refusal or no key, so the caller falls back. */
async function askClaude(caseFile: unknown, transcript: string): Promise<Turn | null> {
  if (!agentEnabled()) return null;
  try {
    const response = await client.messages.parse(
      {
        model: CHAT_MODEL,
        max_tokens: 800,
        system: SYSTEM.replace("${approver}", approverName()),
        messages: [{ role: "user", content: `<case_file>\n${JSON.stringify(caseFile, null, 2)}\n</case_file>\n\n<conversation>\n${transcript}\n</conversation>\n\nReply as Clearance.` }],
        output_config: { effort: "low", format: zodOutputFormat(Turn) },
      },
      { timeout: CHAT_TIMEOUT_MS, maxRetries: 0 },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output;
  } catch (err) {
    console.warn("[funds] Claude unavailable, using scripted turn:", (err as Error).message);
    return null;
  }
}

const poundsIn = (text: string) => {
  const m = text.match(/£\s?(\d+(?:[.,]\d{1,2})?)/) ?? text.match(/(\d+(?:\.\d{1,2})?)\s?(?:pounds|quid|gbp)/i);
  return m ? Math.round(Number(m[1].replace(",", ".")) * 100) : null;
};

/**
 * Scripted negotiator for when Claude is unavailable (no key, timeout, outage). It covers the
 * demo stories and otherwise asks a sensible question. Its proposals go through the same
 * guardrails as the model's, so outcomes stay real.
 */
function scriptedTurn(req: FundRequest, transcript: string): Turn {
  const said = transcript.split("\n").filter((l) => !l.startsWith("Clearance:")).join(" ").toLowerCase();
  const amount = poundsIn(said) ?? req.amount_requested;
  const base = { amount_requested_pence: amount, cited_rules: [] as string[], memory_note: null };
  if (/\b(bet|betting|casino|gambl|poker|bookie|lottery)/.test(said)) {
    return { ...base, outcome: "deny", release_pence: null, purpose: "Gambling", category: "gambling", cited_rules: ["P1"],
      reply: "I can't fund that: gambling is never allowed on company cards (P1). Pay for it personally." };
  }
  const stories = [
    { re: /plumb|leak|flood|burst|boiler|electrician|locksmith/, category: "repairs" as const, purpose: "Emergency repair", fallback: 28_000 },
    { re: /taxi|cab|uber|addison|ride home|late.*(train|tube)/, category: "transport" as const, purpose: "Taxi", fallback: 6_000 },
  ];
  const story = stories.find((s) => s.re.test(said));
  if (story) {
    const release = amount ?? story.fallback;
    return { ...base, outcome: "approve", amount_requested_pence: release, release_pence: release, purpose: story.purpose, category: story.category,
      cited_rules: ["P11", "P12"], reply: `That's a genuine emergency, so ${gbp(release)} is on your card for ${story.purpose.toLowerCase()} only. Keep the receipt.` };
  }
  if (!amount) return { ...base, outcome: "ask", release_pence: null, purpose: null, category: null, reply: "How much do you need, and what's it for?" };
  return { ...base, outcome: "ask", release_pence: null, purpose: null, category: null,
    reply: "Tell me what it's for and why it can't wait, and I'll take a look." };
}
