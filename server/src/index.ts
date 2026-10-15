import "dotenv/config";
import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import type Stripe from "stripe";
import { db, newId, repo } from "./db.js";
import { decide } from "./engine.js";
import { subscribe, broadcast } from "./events.js";
import { POLICY, RULES, gbp } from "./policy.js";
import { CURRENCY, detectStripeMode, captureHold, placeHold, stripe, stripeMode } from "./stripe.js";
import { close, release } from "./settle.js";
import { acceptCounter, negotiate, negotiationFor } from "./negotiate.js";
import * as fundsApi from "./funds.js";
import { MODEL, agentEnabled } from "./agent.js";
import type { AuthRequest, Transaction } from "./types.js";

const app = express();
app.use(cors());

type MerchantCategory = NonNullable<NonNullable<Parameters<Stripe["testHelpers"]["issuing"]["authorizations"]["create"]>[0]["merchant_data"]>["category"]>;

/** Demo-only: a simulated "time of day" to apply to the next authorization on a card. */
const pendingAt = new Map<string, Date>();

// --- Stripe Issuing real-time authorization -------------------------------------------
// Must be registered before express.json(): signature verification needs the raw body.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(400).send("Stripe not configured");
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.header("stripe-signature") ?? "", process.env.STRIPE_WEBHOOK_SECRET ?? "");
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${(err as Error).message}`);
  }

  if (event.type !== "issuing_authorization.request") return res.json({ received: true });

  const auth = event.data.object;
  const card = repo.cardByStripeId(auth.card.id);
  const employee = card && repo.employee(card.employee_id);
  if (!card || !employee) {
    return res.set("Stripe-Version", event.api_version ?? "").json({ approved: false });
  }

  const at = pendingAt.get(card.id) ?? new Date();
  pendingAt.delete(card.id);
  const tx = await decide({
    authorizationId: auth.id,
    card,
    employee,
    amount: auth.pending_request?.amount ?? auth.amount,
    currency: auth.currency,
    merchant: auth.merchant_data.name ?? "Unknown merchant",
    mcc: auth.merchant_data.category,
    city: auth.merchant_data.city,
    at,
  });

  // Respond directly to approve or decline. Escalated payments are declined at the network
  // and wait for a manager; the employee retries once approved.
  res.set("Stripe-Version", event.api_version ?? "").json({
    approved: tx.status === "approved",
    metadata: { clearance_tx: tx.id, decided_by: tx.decided_by, rules: tx.cited_rules.join(",") },
  });
});

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ stripe: Boolean(stripe), stripeMode, agent: agentEnabled(), model: MODEL, currency: CURRENCY });
});

app.get("/api/events", (_req, res) => subscribe(res));

app.get("/api/employees", (_req, res) => res.json(repo.employees()));

app.get("/api/employees/:id/overview", (req, res) => {
  const employee = repo.employee(req.params.id);
  if (!employee) return res.status(404).json({ error: "not found" });
  res.json({
    employee,
    cards: repo.cardsFor(employee.id),
    transactions: repo.transactionsFor(employee.id),
    monthSpent: repo.monthSpent(employee.id, new Date()),
    available: fundsApi.funds.available(employee.id),
    budgetLeft: fundsApi.budgetLeft(employee),
    requests: fundsApi.funds.forEmployee(employee.id),
    limit: POLICY.roles[employee.role].perTxnLimit,
  });
});

app.post("/api/cards/:id/freeze", async (req, res) => {
  const card = repo.card(req.params.id);
  if (!card) return res.status(404).json({ error: "not found" });
  const status = req.body.frozen ? "frozen" : "active";
  if (stripe && card.stripe_card_id) {
    await stripe.issuing.cards.update(card.stripe_card_id, { status: status === "frozen" ? "inactive" : "active" });
  }
  repo.setCardStatus(card.id, status);
  res.json(repo.card(card.id));
});

app.get("/api/policy", (_req, res) => res.json({ policy: POLICY, rules: RULES }));

app.get("/api/audit", (_req, res) => res.json(repo.recentTransactions(100)));

app.get("/api/transactions/:id", (req, res) => {
  const tx = repo.transaction(req.params.id);
  tx ? res.json(tx) : res.status(404).json({ error: "not found" });
});

app.get("/api/approvals", (_req, res) => res.json(repo.approvals()));

app.post("/api/approvals/:id", async (req, res) => {
  const approval = repo.approval(req.params.id);
  if (!approval || approval.status !== "pending") return res.status(409).json({ error: "not pending" });
  const { action, approver = "Priya Shah", note = null } = req.body as { action: "approve" | "reject"; approver?: string; note?: string | null };
  if (approval.transaction_id.startsWith("req_")) {
    repo.resolveApproval(approval.id, action === "approve" ? "used" : "rejected", approver, note);
    await fundsApi.decideReferred(approval.transaction_id, action === "approve", approver, approval.amount);
    const done = repo.approval(approval.id);
    broadcast("approval", done);
    return res.json(done);
  }
  const tx = repo.transaction(approval.transaction_id)!;
  try {
    if (action === "approve") await release(tx, approval.amount, approver, "manager", `Approved by ${approver}${note ? `: ${note}` : "."}`);
    else await close(tx, approver, "manager", `Rejected by ${approver}${note ? `: ${note}` : "."}`);
  } catch (err) {
    return res.status(502).json({ error: (err as Error).message });
  }
  const updated = repo.approval(approval.id);
  broadcast("approval", updated);
  res.json(updated);
});

app.get("/api/transactions/:id/negotiation", (req, res) => {
  const tx = repo.transaction(req.params.id);
  tx ? res.json(negotiationFor(tx)) : res.status(404).json({ error: "not found" });
});

app.post("/api/transactions/:id/negotiation", async (req, res) => {
  const tx = repo.transaction(req.params.id);
  if (!tx) return res.status(404).json({ error: "not found" });
  if (!agentEnabled()) return res.status(503).json({ error: "Add ANTHROPIC_API_KEY to server/.env to negotiate with Clearance." });
  try {
    const result = req.body.accept ? await acceptCounter(tx) : await negotiate(tx, String(req.body.message ?? "").slice(0, 1000));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// --- Funds requests: negotiate with Clearance before spending ----------------------------
app.get("/api/requests/:id", (req, res) => {
  const f = fundsApi.funds.get(req.params.id);
  f ? res.json(f) : res.status(404).json({ error: "not found" });
});

/** Body: { employeeId, message, requestId? }. Omit requestId to start a new request. */
app.post("/api/requests", async (req, res) => {
  const { employeeId, message, requestId = null } = req.body as { employeeId: string; message: string; requestId?: string | null };
  const employee = repo.employee(employeeId);
  if (!employee) return res.status(404).json({ error: "employee not found" });
  if (!agentEnabled()) return res.status(503).json({ error: "Add ANTHROPIC_API_KEY to server/.env to talk to Clearance." });
  try {
    res.json(await fundsApi.talk(employee, requestId, String(message ?? "").slice(0, 1000)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/requests/:id/accept", async (req, res) => {
  try {
    res.json(await fundsApi.acceptCounter(req.params.id));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/requests/:id/return", async (req, res) => {
  const f = fundsApi.funds.get(req.params.id);
  if (!f || f.status !== "released") return res.status(409).json({ error: "nothing to return" });
  await fundsApi.returnFunds(f);
  res.json(fundsApi.funds.get(f.id));
});

/**
 * Taps a card. With Stripe configured this creates a real test-mode authorization, which
 * Stripe sends back through the webhook above. Without Stripe it decides locally.
 */
app.post("/api/simulate", async (req, res) => {
  const { cardId, merchant, mcc, amount, city = "London", hour } = req.body as {
    cardId: string; merchant: string; mcc: string; amount: number; city?: string; hour?: number;
  };
  const card = repo.card(cardId);
  const employee = card && repo.employee(card.employee_id);
  if (!card || !employee) return res.status(404).json({ error: "card not found" });

  let at = new Date();
  if (typeof hour === "number") {
    at = new Date(at);
    at.setUTCHours(hour - londonOffsetHours(at), 17, 0, 0);
  }

  if (stripeMode === "payments") {
    try {
      const tx = await decide({ authorizationId: newId("pending"), card, employee, amount, currency: CURRENCY, merchant, mcc, city, at });
      // Released funds are already a Stripe hold (captured inside decide). A manager pre-approval
      // charges directly. A decline moves no money.
      if (tx.status === "approved" && tx.decided_by !== "allowance") {
        const pi = await placeHold(amount, merchant, employee.name, card.last4);
        await captureHold(pi, amount);
        repo.setAuthorizationId(tx.id, pi);
      }
      return res.json({ transaction: repo.transaction(tx.id) });
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message });
    }
  }

  if (stripeMode === "issuing" && card.stripe_card_id) {
    pendingAt.set(card.id, at);
    try {
      const auth = await stripe!.testHelpers.issuing.authorizations.create({
        card: card.stripe_card_id,
        amount,
        currency: CURRENCY,
        merchant_data: { name: merchant, category: mcc as MerchantCategory, city },
      });
      const tx = db.prepare("SELECT id FROM transactions WHERE stripe_authorization_id = ?").get(auth.id) as { id: string } | undefined;
      return res.json({ stripe_authorization: { id: auth.id, approved: auth.approved, status: auth.status }, transaction: tx && repo.transaction(tx.id) });
    } catch (err) {
      pendingAt.delete(card.id);
      return res.status(502).json({ error: (err as Error).message });
    }
  }

  const request: AuthRequest = { authorizationId: newId("iauth_local"), card, employee, amount, currency: CURRENCY, merchant, mcc, city, at };
  const tx: Transaction = await decide(request);
  res.json({ transaction: tx });
});

function londonOffsetHours(d: Date) {
  const london = new Date(d.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((london.getTime() - utc.getTime()) / 3_600_000);
}

// Production: serve the built PWA from the same origin as the API.
const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|webhooks).*/, (_req, res) => res.sendFile(`${webDist}/index.html`));
}

const port = Number(process.env.PORT ?? 4242);
await detectStripeMode();
if (repo.employees().length === 0) await import("./seed.js");
app.listen(port, () => {
  console.log(`Clearance API on http://localhost:${port}`);
  console.log(`  Stripe: ${stripeMode} · Agent: ${agentEnabled() ? MODEL : "off (flags escalate)"}`);
});
