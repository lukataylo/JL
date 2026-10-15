import { newId, repo } from "./db.js";
import { broadcast } from "./events.js";
import { gbp } from "./policy.js";
import { cancelHold, captureHold, isHold, placeHold, stripe, stripeMode } from "./stripe.js";
import type { DecidedBy, Transaction } from "./types.js";

/**
 * Releases a held or declined payment after a manager or a negotiation approves it.
 * A PaymentIntent hold is captured (optionally for less than was authorised). An Issuing
 * authorization can't be re-approved, so it becomes a one-time pre-approval for the retry.
 */
export async function release(tx: Transaction, amount: number, by: string, decidedBy: DecidedBy, summary: string) {
  const pending = repo.pendingApprovalFor(tx.id);

  const issuingAuth = tx.stripe_authorization_id.startsWith("iauth_") && !tx.stripe_authorization_id.startsWith("iauth_local");
  if (!issuingAuth) {
    if (stripe && isHold(tx.stripe_authorization_id) && tx.status === "escalated") {
      await captureHold(tx.stripe_authorization_id, amount);
    } else if (stripeMode === "payments") {
      // The original hold was already cancelled on decline: charge the agreed amount afresh.
      const employee = repo.employee(tx.employee_id)!;
      const card = repo.card(tx.card_id)!;
      const pi = await placeHold(amount, tx.merchant, employee.name, card.last4);
      await captureHold(pi, amount);
      repo.setAuthorizationId(tx.id, pi);
    }
    repo.settleTransaction(tx.id, "approved", decidedBy, summary, amount, by);
    if (pending) repo.resolveApproval(pending.id, "used", by, null);
  } else {
    // Issuing: the original authorization is final, so let one matching retry through.
    if (pending) repo.resolveApproval(pending.id, "approved", by, null);
    else {
      repo.insertApproval({
        id: newId("apr"), transaction_id: tx.id, employee_id: tx.employee_id, merchant: tx.merchant, amount,
        reason: summary, status: "approved", approver: by, note: null,
        created_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
      });
    }
    repo.settleTransaction(tx.id, tx.status, decidedBy, `${summary} Tap the card again to pay.`, null, by);
  }

  repo.addMemory(tx.employee_id, `${by} released ${gbp(amount)} at ${tx.merchant} (asked ${gbp(tx.amount)}).`);
  const updated = repo.transaction(tx.id)!;
  broadcast("transaction", updated);
  return updated;
}

/** Final decline of a held payment: cancels the hold so no money moves. */
export async function close(tx: Transaction, by: string, decidedBy: DecidedBy, summary: string) {
  if (stripe && isHold(tx.stripe_authorization_id) && tx.status === "escalated") {
    await cancelHold(tx.stripe_authorization_id);
  }
  const pending = repo.pendingApprovalFor(tx.id);
  if (pending) repo.resolveApproval(pending.id, "rejected", by, null);
  repo.settleTransaction(tx.id, "declined", decidedBy, summary, null, by);
  const updated = repo.transaction(tx.id)!;
  broadcast("transaction", updated);
  return updated;
}
