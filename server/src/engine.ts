import { newId, repo } from "./db.js";
import { evaluate } from "./rules.js";
import { agentEnabled, review } from "./agent.js";
import { broadcast } from "./events.js";
import { categorize, gbp } from "./policy.js";
import type { AgentVerdict, AuthRequest, DecidedBy, RuleResult, Status, Transaction } from "./types.js";

const DEADLINE_MS = Number(process.env.AGENT_DEADLINE_MS ?? 1500);

const statusFor: Record<AgentVerdict["decision"], Status> = {
  approve: "approved",
  decline: "declined",
  escalate: "escalated",
};

const cite = (rules: RuleResult[], ...outcomes: RuleResult["outcome"][]) =>
  rules.filter((r) => outcomes.includes(r.outcome));

/**
 * Decides one authorization. Order: hard blocks → manager pre-approval → escalations →
 * agent review for flags → approve. Everything is persisted and pushed to the app.
 */
export async function decide(req: AuthRequest): Promise<Transaction> {
  const started = performance.now();
  const { results, preApproval } = evaluate(req);

  let status: Status;
  let decidedBy: DecidedBy = "rules";
  let agent: AgentVerdict | null = null;
  let cited: RuleResult[];
  let summary: string;

  const hardBlocks = cite(results, "block").filter((r) => !(preApproval && (r.id === "P3" || r.id === "P4")));
  const escalations = cite(results, "escalate");
  const flags = cite(results, "flag");

  if (hardBlocks.length) {
    status = "declined";
    cited = hardBlocks;
    summary = `Declined: ${hardBlocks[0].evidence}`;
  } else if (preApproval) {
    status = "approved";
    decidedBy = "pre_approval";
    cited = cite(results, "override");
    summary = `Approved with ${preApproval.approver ?? "manager"}'s pre-approval.`;
    repo.resolveApproval(preApproval.id, "used", null, null);
  } else if (escalations.length) {
    status = "escalated";
    cited = escalations;
    summary = `Held for manager approval: ${escalations[0].evidence}`;
  } else if (flags.length) {
    agent = agentEnabled() ? await review(req, results, DEADLINE_MS) : null;
    if (agent) {
      status = statusFor[agent.decision];
      decidedBy = "agent";
      cited = results.filter((r) => agent!.cited_rules.includes(r.id));
      if (!cited.length) cited = flags;
      summary = agent.summary;
    } else {
      // Safe default when the agent is off or out of time: hold it for a human.
      status = "escalated";
      decidedBy = "timeout_fallback";
      cited = flags;
      summary = `Held for manager approval: ${flags[0].evidence}`;
    }
  } else {
    status = "approved";
    cited = [];
    summary = `Approved: within policy for ${req.employee.role}s.`;
  }

  const tx: Transaction = {
    id: newId("tx"),
    stripe_authorization_id: req.authorizationId,
    card_id: req.card.id,
    employee_id: req.employee.id,
    merchant: req.merchant,
    category: categorize(req.mcc),
    mcc: req.mcc,
    city: req.city,
    amount: req.amount,
    currency: req.currency,
    status,
    decided_by: decidedBy,
    rule_results: results,
    agent,
    summary,
    cited_rules: cited.map((r) => r.id),
    latency_ms: Math.round(performance.now() - started),
    created_at: req.at.toISOString(),
  };
  repo.insertTransaction(tx);

  if (status === "escalated") {
    const approval = {
      id: newId("apr"),
      transaction_id: tx.id,
      employee_id: req.employee.id,
      merchant: req.merchant,
      amount: req.amount,
      reason: summary,
      status: "pending" as const,
      approver: null,
      note: null,
      created_at: tx.created_at,
      resolved_at: null,
    };
    repo.insertApproval(approval);
    broadcast("approval", approval);
  }

  console.log(`[decide] ${req.employee.name} ${gbp(req.amount)} @ ${req.merchant} → ${status} by ${decidedBy} in ${tx.latency_ms}ms [${tx.cited_rules.join(",")}]`);
  broadcast("transaction", tx);
  return tx;
}
