import "dotenv/config";
import express from "express";
import cors from "cors";
import type Stripe from "stripe";
import { db, newId, repo } from "./db.js";
import { decide } from "./engine.js";
import { subscribe, broadcast } from "./events.js";
import { POLICY, RULES, gbp } from "./policy.js";
import { CURRENCY, stripe } from "./stripe.js";
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
  res.json({ stripe: Boolean(stripe), agent: agentEnabled(), model: MODEL, currency: CURRENCY });
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

app.post("/api/approvals/:id", (req, res) => {
  const approval = repo.approval(req.params.id);
  if (!approval || approval.status !== "pending") return res.status(409).json({ error: "not pending" });
  const { action, approver = "Priya Shah", note = null } = req.body as { action: "approve" | "reject"; approver?: string; note?: string | null };
  repo.resolveApproval(approval.id, action === "approve" ? "approved" : "rejected", approver, note);
  const employee = repo.employee(approval.employee_id);
  repo.addMemory(
    approval.employee_id,
    `${approver} ${action === "approve" ? "approved" : "rejected"} ${gbp(approval.amount)} at ${approval.merchant} for ${employee?.name}${note ? `: "${note}"` : ""}.`,
  );
  const updated = repo.approval(approval.id);
  broadcast("approval", updated);
  res.json(updated);
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

  if (stripe && card.stripe_card_id) {
    pendingAt.set(card.id, at);
    try {
      const auth = await stripe.testHelpers.issuing.authorizations.create({
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

const port = Number(process.env.PORT ?? 4242);
app.listen(port, () => {
  console.log(`Clearance API on http://localhost:${port}`);
  console.log(`  Stripe: ${stripe ? "test mode" : "off (local simulation)"} · Agent: ${agentEnabled() ? MODEL : "off (flags escalate)"}`);
});
