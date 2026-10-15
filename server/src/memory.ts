import { repo } from "./db.js";
import type { AuthRequest } from "./types.js";
import { gbp } from "./policy.js";

/**
 * Company memory the agent reasons over: the employee's recent spend, the company's
 * history with this merchant, and free-text facts (trips, deals, past approvals).
 *
 * Swap point for Cognee: replace `facts` with a Cognee search over the same subjects.
 */
export function recall(req: AuthRequest) {
  const recent = repo.transactionsFor(req.employee.id, 10).map((t) => ({
    merchant: t.merchant,
    amount: gbp(t.amount),
    status: t.status,
    when: t.created_at,
  }));
  const atMerchant = repo.approvedAtMerchant(req.merchant);
  const avg = atMerchant.length ? atMerchant.reduce((s, t) => s + t.amount, 0) / atMerchant.length : 0;
  const facts = repo.memoriesAbout(["company", req.employee.id, req.merchant.toLowerCase()]);

  return {
    employee_recent_transactions: recent,
    employee_month_spent: gbp(repo.monthSpent(req.employee.id, req.at)),
    employee_monthly_budget: gbp(req.employee.monthly_budget),
    company_history_with_merchant: atMerchant.length
      ? { approved_payments: atMerchant.length, average: gbp(avg), last: atMerchant[0].created_at }
      : "none — first time this company pays this merchant",
    facts: facts.map((f) => `[${f.created_at.slice(0, 10)}] ${f.text}`),
  };
}
