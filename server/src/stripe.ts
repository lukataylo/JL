import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (key && !key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  throw new Error("Clearance only runs against Stripe test mode. Use an sk_test_ key.");
}

export const stripe = key ? new Stripe(key) : null;
export const CURRENCY = process.env.ISSUING_CURRENCY ?? "gbp";
