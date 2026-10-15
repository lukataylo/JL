import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CHAT_MODEL, CHAT_TIMEOUT_MS, client } from "./agent.js";
import { newId, repo } from "./db.js";
import { recall } from "./memory.js";
import { POLICY, RULES, gbp } from "./policy.js";
import { close, release } from "./settle.js";
import type { Negotiation, NegotiationMessage, Transaction } from "./types.js";

/** Rules no amount of persuasion can override. Enforced in code, not just in the prompt. */
const NON_NEGOTIABLE = ["P1", "P4", "P9"];
const MAX_EMPLOYEE_TURNS = 6;

const Turn = z.object({
  reply: z.string().describe("What you say, in your sardonic CARROT-style voice. At most 2 sentences, under 40 words. The decision must be unmistakable."),
  outcome: z.enum(["ask", "approve", "counter", "refer", "deny"]),
  counter_amount_pence: z.number().int().nullable().describe("Only for outcome=counter: the amount you will release, in pence"),
  cited_rules: z.array(z.string()),
  memory_note: z.string().nullable().describe("A durable fact learned in this conversation worth remembering for future decisions, or null"),
});

const SYSTEM = `You are Clearance, ${POLICY.company}'s spend controller. An employee's card payment was declined or held, and they have opened a chat to negotiate.
You represent finance: firm but fair, never preachy. Your goal is the right outcome for the company, not winning.
Personality: CARROT Weather energy — a sardonic, theatrically superior AI with dry wit and mock menace. Roast flimsy excuses, never the person; no swearing, nothing cruel. The decision, amount and rule IDs must always be unmistakable.

How to negotiate:
- Find out the specific business purpose. If the reason is vague, ask ONE pointed question (who it was for, which client, how many attendees, why not the normal route).
- Check their story against company memory and the policy. Reward specifics that match memory; be sceptical of stories memory contradicts.
- Outcomes:
  - ask: you need one more piece of information.
  - approve: the purpose is clear and legitimate; release the full amount.
  - counter: legitimate but over what policy supports — release a lower amount the policy can justify (e.g. a per-head allowance × attendees). The employee covers the rest.
  - refer: legitimate but beyond your release cap, or it needs a manager's judgement. Referrals go to the Finance approver (${"${approver}"}); name them.
  - deny: against policy or not credible. Say what would change your mind if anything.
- Prefer counter over refer whenever a known allowance (e.g. £ per head × attendees) gives a defensible lower amount within your cap. Refer only when you genuinely can't size it.
- Cite only the rule IDs that actually flagged this payment (see policy_checks). Never cite a rule that passed.
- Keep it short: at most 2 sentences, under 40 words. No lists.

Hard limits (code enforces these; don't promise otherwise):
- ${NON_NEGOTIABLE.join(", ")} cannot be negotiated.
- Your release authority is at most 2× the employee's per-transaction limit. Above that, refer.
- After ${MAX_EMPLOYEE_TURNS} employee messages, decide (no more "ask").

Written policy:
${RULES.map((r) => `${r.id} ${r.title}: ${r.text}`).join("\n")}`;

export function negotiationFor(tx: Transaction): Negotiation {
  return repo.negotiation(tx.id) ?? {
    id: newId("neg"), transaction_id: tx.id, status: "open", messages: [], counter_amount: null, created_at: new Date().toISOString(),
  };
}

const approverName = () => repo.employees().find((e) => e.role === "finance")?.name ?? "Finance";

/** One round: the employee says something, Clearance answers and may settle the payment. */
export async function negotiate(tx: Transaction, text: string) {
  const neg = negotiationFor(tx);
  if (neg.status !== "open" && neg.status !== "countered") throw new Error("This negotiation is closed.");
  if (tx.status === "approved") throw new Error("This payment is already approved.");

  const employee = repo.employee(tx.employee_id)!;
  const limit = POLICY.roles[employee.role].perTxnLimit;
  neg.messages.push({ role: "employee", text, at: new Date().toISOString() });
  const employeeTurns = neg.messages.filter((m) => m.role === "employee").length;

  const caseFile = {
    payment: { merchant: tx.merchant, category: `${tx.mcc} → ${tx.category}`, amount: gbp(tx.amount), at: tx.created_at, city: tx.city, status: tx.status },
    original_decision: { summary: tx.summary, cited_rules: tx.cited_rules, agent_reasoning: tx.agent?.reasoning ?? null },
    policy_checks: tx.rule_results.filter((r) => r.outcome !== "pass"),
    employee: `${employee.name}, ${employee.role}, ${employee.team}. Per-transaction limit ${gbp(limit)}. Your release cap for them: ${gbp(limit * 2)}.`,
    memory: recall({
      authorizationId: tx.stripe_authorization_id, card: repo.card(tx.card_id)!, employee, amount: tx.amount,
      currency: tx.currency, merchant: tx.merchant, mcc: tx.mcc, city: tx.city, at: new Date(tx.created_at),
    }),
    employee_messages_so_far: employeeTurns,
  };
  const transcript = neg.messages.map((m) => `${m.role === "employee" ? employee.name.split(" ")[0] : "Clearance"}: ${m.text}`).join("\n");

  const response = await client.messages.parse(
    {
      model: CHAT_MODEL,
      max_tokens: 800,
      system: SYSTEM.replace("${approver}", approverName()),
      messages: [{
        role: "user",
        content: `<case_file>\n${JSON.stringify(caseFile, null, 2)}\n</case_file>\n\n<conversation>\n${transcript}\n</conversation>\n\nReply as Clearance.`,
      }],
      output_config: { effort: "low", format: zodOutputFormat(Turn) },
    },
    { timeout: CHAT_TIMEOUT_MS, maxRetries: 0 },
  ).catch((err: Error) => {
    console.warn("[negotiate] Claude unavailable, referring:", err.message);
    return null;
  });
  // Fallback when Claude is unavailable: hand it to a human rather than guess.
  const turn = response && response.stop_reason !== "refusal" && response.parsed_output
    ? response.parsed_output
    : { reply: "I can't review this right now, so I've passed it to Finance with your message.", outcome: "refer" as const, counter_amount_pence: null, cited_rules: [], memory_note: null };

  // Guardrails: the model proposes, code disposes.
  let { outcome, reply } = turn;
  let counter = turn.counter_amount_pence;
  const blockedBy = tx.rule_results.filter((r) => r.outcome === "block" && NON_NEGOTIABLE.includes(r.id));
  const releasing = outcome === "approve" ? tx.amount : outcome === "counter" ? counter ?? 0 : 0;
  if ((outcome === "approve" || outcome === "counter") && blockedBy.length) {
    outcome = "deny";
    reply = `I can't release this: ${blockedBy[0].title} (${blockedBy[0].id}) isn't negotiable.`;
  } else if (outcome === "counter" && (!counter || counter <= 0 || counter >= tx.amount)) {
    outcome = "approve";
    counter = null;
  } else if (releasing > limit * 2) {
    outcome = "refer";
    reply = `${reply} This is above what I can release on my own, so I've sent it to ${approverName()} with our conversation.`;
  }
  if (outcome === "ask" && employeeTurns >= MAX_EMPLOYEE_TURNS) outcome = "refer";

  const flagged = new Set(tx.rule_results.filter((r) => r.outcome !== "pass").map((r) => r.id));
  const agentMsg: NegotiationMessage = {
    role: "agent", text: reply, at: new Date().toISOString(), outcome, counter_amount: outcome === "counter" ? counter : null,
    cited_rules: turn.cited_rules.filter((id) => flagged.has(id)),
  };
  neg.messages.push(agentMsg);

  let updated = tx;
  if (outcome === "approve") {
    neg.status = "approved";
    updated = await release(tx, tx.amount, "Clearance (negotiated)", "negotiation", `Approved after negotiation: ${reply}`);
  } else if (outcome === "counter") {
    neg.status = "countered";
    neg.counter_amount = counter;
  } else if (outcome === "deny") {
    neg.status = "denied";
    updated = await close(tx, "Clearance (negotiated)", "negotiation", `Declined after negotiation: ${reply}`);
  } else if (outcome === "refer") {
    neg.status = "referred";
    const reason = `Referred by Clearance after negotiation. ${employee.name.split(" ")[0]}: "${text}"`;
    const pending = repo.pendingApprovalFor(tx.id);
    if (!pending) {
      repo.insertApproval({
        id: newId("apr"), transaction_id: tx.id, employee_id: tx.employee_id, merchant: tx.merchant, amount: tx.amount,
        reason, status: "pending", approver: null, note: null, created_at: new Date().toISOString(), resolved_at: null,
      });
    }
  }
  repo.saveNegotiation(neg);
  return { negotiation: neg, transaction: updated };
}

/** The employee accepts Clearance's counter-offer: release the lower amount. */
export async function acceptCounter(tx: Transaction) {
  const neg = negotiationFor(tx);
  if (neg.status !== "countered" || !neg.counter_amount) throw new Error("There is no offer to accept.");
  neg.status = "accepted";
  neg.messages.push({ role: "employee", text: `Accepted ${gbp(neg.counter_amount)}.`, at: new Date().toISOString() });
  const updated = await release(tx, neg.counter_amount, "Clearance (negotiated)", "negotiation",
    `Released ${gbp(neg.counter_amount)} of ${gbp(tx.amount)} after negotiation; the rest is personal.`);
  repo.saveNegotiation(neg);
  return { negotiation: neg, transaction: updated };
}
