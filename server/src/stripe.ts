import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (key && !key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error("Clearance only runs against Stripe test mode. Use an sk_test_ key.");
}

export const stripe = key ? new Stripe(key) : null;
export const CURRENCY = process.env.ISSUING_CURRENCY ?? "gbp";

/**
 * - issuing:  real Issuing cards; Stripe asks us to approve via issuing_authorization.request.
 * - payments: no Issuing on the account; each tap is a manual-capture PaymentIntent hold that
 *             Clearance captures (release) or cancels (decline). Money still moves only on approval.
 * - off:      no Stripe key; decisions are local.
 */
export type StripeMode = "issuing" | "payments" | "off";
export let stripeMode: StripeMode = "off";

export async function detectStripeMode(): Promise<StripeMode> {
  if (!stripe) return (stripeMode = "off");
  try {
    await stripe.issuing.cardholders.list({ limit: 1 });
    stripeMode = "issuing";
  } catch {
    stripeMode = "payments";
  }
  return stripeMode;
}

export async function placeHold(amount: number, merchant: string, employeeName: string, cardLast4: string) {
  const pi = await stripe!.paymentIntents.create({
    amount,
    currency: CURRENCY,
    payment_method: "pm_card_visa",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    capture_method: "manual",
    confirm: true,
    description: `${merchant} · ${employeeName} · card •••• ${cardLast4}`,
    metadata: { merchant, employee: employeeName, source: "clearance" },
  });
  return pi.id;
}

export const isHold = (authorizationId: string) => authorizationId.startsWith("pi_");

export async function captureHold(paymentIntentId: string, amount: number) {
  await stripe!.paymentIntents.capture(paymentIntentId, { amount_to_capture: amount });
}

export async function cancelHold(paymentIntentId: string) {
  await stripe!.paymentIntents.cancel(paymentIntentId);
}
