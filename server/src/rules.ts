import { repo } from "./db.js";
import { POLICY, categorize, gbp, ruleTitle, type RuleId } from "./policy.js";
import type { Approval, AuthRequest, RuleOutcome, RuleResult } from "./types.js";

const r = (id: RuleId, outcome: RuleOutcome, evidence: string): RuleResult => ({
  id, title: ruleTitle(id), outcome, evidence,
});

const londonHour = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(d));

const londonTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(d);

/**
 * Deterministic pass over the written policy. Runs in well under a millisecond, so the
 * hard cases never wait on the model.
 */
export function evaluate(req: AuthRequest): { results: RuleResult[]; preApproval?: Approval } {
  const { employee, card, amount, merchant } = req;
  const category = categorize(req.mcc);
  const role = POLICY.roles[employee.role];
  const results: RuleResult[] = [];

  results.push(card.status === "frozen"
    ? r("P9", "block", `Card •••• ${card.last4} is frozen.`)
    : r("P9", "pass", `Card •••• ${card.last4} is active.`));

  results.push(POLICY.prohibitedCategories.includes(category)
    ? r("P1", "block", `Merchant category "${req.mcc}" maps to ${category}, which is prohibited.`)
    : r("P1", "pass", `Category ${category} is not prohibited.`));

  const since = Date.now() - POLICY.duplicateWindowMinutes * 60_000;
  const dup = repo.transactionsFor(employee.id, 20).find(
    (t) => t.status === "approved" && t.merchant.toLowerCase() === merchant.toLowerCase() &&
      t.amount === amount && Date.parse(t.created_at) >= since,
  );
  results.push(dup
    ? r("P5", "block", `Identical ${gbp(amount)} payment to ${merchant} approved at ${londonTime(new Date(dup.created_at))} (${dup.id}).`)
    : r("P5", "pass", "No identical payment in the last 15 minutes."));

  const preApproval = repo.matchingPreApproval(employee.id, merchant, amount);
  if (preApproval) {
    results.push(r("P10", "override", `${preApproval.approver ?? "Manager"} pre-approved up to ${gbp(preApproval.amount)} at ${merchant} (${preApproval.id}).`));
  }

  const spent = repo.monthSpent(employee.id, req.at);
  results.push(spent + amount > employee.monthly_budget
    ? r("P4", "block", `${gbp(spent)} spent this month + ${gbp(amount)} exceeds the ${gbp(employee.monthly_budget)} budget.`)
    : r("P4", "pass", `${gbp(spent + amount)} of ${gbp(employee.monthly_budget)} monthly budget after this payment.`));

  if (amount > role.perTxnLimit * POLICY.hardBlockMultiple) {
    results.push(r("P3", "block", `${gbp(amount)} is over ${POLICY.hardBlockMultiple}× the ${employee.role} limit of ${gbp(role.perTxnLimit)}.`));
  } else if (amount > role.perTxnLimit) {
    results.push(r("P3", "flag", `${gbp(amount)} is over the ${employee.role} limit of ${gbp(role.perTxnLimit)}.`));
  } else {
    results.push(r("P3", "pass", `${gbp(amount)} is within the ${gbp(role.perTxnLimit)} limit.`));
  }

  results.push((role.categories as string[]).includes(category)
    ? r("P2", "pass", `${category} is allowed for ${employee.role}s.`)
    : r("P2", "flag", `${category} is not a listed category for ${employee.role}s.`));

  if (category === "hardware" && amount > POLICY.hardwarePreApprovalOver) {
    results.push(r("P6", "escalate", `Hardware purchase of ${gbp(amount)} is over ${gbp(POLICY.hardwarePreApprovalOver)} with no pre-approval.`));
  }

  const hour = londonHour(req.at);
  if (hour >= POLICY.quietHours.from && hour < POLICY.quietHours.to) {
    results.push(r("P7", "flag", `Payment at ${String(hour).padStart(2, "0")}:00 UK time is outside working hours.`));
  }

  const approvedVendor = POLICY.approvedVendors.some((v) => v.toLowerCase() === merchant.toLowerCase());
  const seenBefore = repo.approvedAtMerchant(merchant).length > 0;
  if (!approvedVendor && !seenBefore && amount > POLICY.newMerchantReviewOver) {
    results.push(r("P8", "flag", `${merchant} is a first-time, non-approved merchant and ${gbp(amount)} is over ${gbp(POLICY.newMerchantReviewOver)}.`));
  }

  return { results, preApproval };
}
