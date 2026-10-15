import { newId, repo } from "./db.js";
import { evaluate } from "./rules.js";
import { funds, spendFrom } from "./funds.js";
import { broadcast } from "./events.js";
import { categorize, gbp } from "./policy.js";
import type { AuthRequest, DecidedBy, RuleResult, Status, Transaction } from "./types.js";

const cite = (rules: RuleResult[], ...outcomes: RuleResult["outcome"][]) =>
  rules.filter((r) => outcomes.includes(r.outcome));

/**
 * Decides one card payment in milliseconds: the thinking happened earlier, when Clearance
 * negotiated and released the funds. Order: absolute blocks → released funds → manager
 * pre-approval → wrong purpose → no funds.
 */
export async function decide(req: AuthRequest): Promise<Transaction> {
  const started = performance.now();
  const { results, preApproval } = evaluate(req);

  let status: Status;
  let decidedBy: DecidedBy = "rules";
  let cited: RuleResult[];
  let summary: string;
  const category = categorize(req.mcc);
  const { match: cover, wrongPurpose } = funds.coverFor(req.employee.id, req.amount, category);

  // Funds released up front already cleared limits and budget, so only absolute blocks apply.
  const hardBlocks = cite(results, "block").filter((r) => !((cover || preApproval) && (r.id === "P3" || r.id === "P4")));

  if (hardBlocks.length) {
    status = "declined";
    cited = hardBlocks;
    summary = `Declined: ${hardBlocks[0].evidence}`;
  } else if (cover) {
    status = "approved";
    decidedBy = "allowance";
    results.push({ id: "P11", title: "Funds first", outcome: "pass", evidence: `Drawn from ${gbp(cover.remaining)} released for "${cover.purpose}" (${cover.id}).` });
    cited = results.slice(-1);
    summary = `Approved from funds released for ${cover.purpose}.`;
  } else if (preApproval) {
    status = "approved";
    decidedBy = "pre_approval";
    cited = cite(results, "override");
    summary = `Approved with ${preApproval.approver ?? "manager"}'s pre-approval.`;
    repo.resolveApproval(preApproval.id, "used", null, null);
  } else if (wrongPurpose) {
    status = "declined";
    const r: RuleResult = { id: "P12", title: "Agreed purpose", outcome: "block", evidence: `Funds were released for ${wrongPurpose.purpose} (${wrongPurpose.category}), not ${category}.` };
    results.push(r);
    cited = [r];
    summary = `Declined: these funds are for ${wrongPurpose.purpose}. Ask Clearance for new funds.`;
  } else {
    status = "declined";
    const available = funds.available(req.employee.id);
    const r: RuleResult = {
      id: "P11", title: "Funds first", outcome: "block",
      evidence: available ? `Only ${gbp(available)} released; this payment is ${gbp(req.amount)}.` : "No funds released on this card.",
    };
    results.push(r);
    cited = [r];
    summary = available ? `Declined: ${gbp(req.amount)} is more than the ${gbp(available)} released. Tap + to ask for more.` : "Declined: your card has £0 released. Tap + to ask Clearance for funds.";
  }

  const tx: Transaction = {
    id: newId("tx"),
    stripe_authorization_id: cover?.stripe_hold ?? req.authorizationId,
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
    agent: null,
    summary,
    cited_rules: cited.map((r) => r.id),
    latency_ms: Math.round(performance.now() - started),
    created_at: req.at.toISOString(),
    captured_amount: status === "approved" ? req.amount : null,
    released_by: null,
  };
  repo.insertTransaction(tx);
  if (cover) await spendFrom(cover, req.amount);

  console.log(`[decide] ${req.employee.name} ${gbp(req.amount)} @ ${req.merchant} → ${status} by ${decidedBy} in ${tx.latency_ms}ms [${tx.cited_rules.join(",")}]`);
  broadcast("transaction", tx);
  return tx;
}
