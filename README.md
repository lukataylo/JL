# Clearance

**An AI controller that approves every company card payment before the money moves.**

Expense tools check spend after it has happened. Clearance checks it while the card is being charged. Each employee gets a Stripe Issuing virtual card. When the card is used, Stripe's real-time authorization webhook (`issuing_authorization.request`) asks Clearance to approve or decline, and Clearance answers within Stripe's ~2-second window:

1. **Policy engine (<5 ms).** Checks the written policy (`server/src/policy.ts`, rules P1–P10). Hard breaches are declined straight away: prohibited categories, duplicates, budget overruns and frozen cards.
2. **Claude agent (for flagged payments only).** Borderline payments go to Claude, along with company memory: the employee's recent spend, the company's history with the merchant, and known facts such as trips and deals. Claude returns approve, decline or escalate, and cites the rule IDs it relied on.
3. **Safe default.** If the agent is off or runs out of time, the payment is held for a manager rather than guessed at.
4. **Negotiation.** An employee whose payment was declined or held can open a chat and make their case. Clearance asks pointed questions and checks the answers against memory and policy. It then approves, offers a lower amount, refers to a manager, or denies. A lower amount the employee accepts is captured as a partial capture in Stripe. Guardrails are enforced in code, not just in the prompt: P1, P4 and P9 can't be negotiated, and the agent can release at most 2× the role limit.
5. **Human in the loop.** Referred and escalated payments go to the Approvals tab. A manager's decision releases or cancels the hold and is saved to company memory.

Every decision is stored with its rule results, evidence, agent reasoning and response time. The audit trail shows the reason for every pound.

Stripe **test mode only**: the server refuses to start with a live key.

## Run it

```bash
npm install && npm run install:all
cp server/.env.example server/.env   # add keys (all optional)
npm run seed                          # local demo data
npm run dev                           # API :4242 + PWA :5173
```

Open http://localhost:5173. On a phone on the same Wi-Fi, use the network URL Vite prints, then choose *Add to Home Screen*.

### Stripe test mode: two ways money moves

With `STRIPE_SECRET_KEY` set, the server detects what your account supports:

- **No Issuing (default for most accounts):** each tap places a manual-capture **PaymentIntent hold**. Clearance captures it when it approves, cancels it when it declines, and keeps holding it while a human or a negotiation decides. Partial captures implement negotiated amounts.
- **Issuing enabled:** real virtual cards and the real-time `issuing_authorization.request` webhook, as below.

### With Stripe Issuing

```bash
# server/.env: STRIPE_SECRET_KEY=sk_test_...  (Issuing enabled in test mode)
npm run seed:stripe        # creates cardholders + virtual cards in Stripe
npm run stripe:listen      # copy the whsec_... into STRIPE_WEBHOOK_SECRET, restart dev
```

After this, *Tap to pay* creates a real authorization with `stripe.testHelpers.issuing.authorizations.create`. Stripe calls the webhook, and Clearance approves or declines it by responding directly to the webhook.

### With the Claude agent

Set `ANTHROPIC_API_KEY` in `server/.env`. `CLAUDE_MODEL` defaults to `claude-opus-5-5` with low effort. `AGENT_DEADLINE_MS` (default 1500) is how much of Stripe's 2 seconds the agent gets.

## 2-minute demo script

1. **Maya, engineer:** taps **Figma £45**. Approved in milliseconds and captured in Stripe.
2. Taps **Bet365**. Declined under P1, and the hold is cancelled, so no money moves.
3. **Tom, sales:** taps **Nobu London £960**. The agent flags P3 and P8, recalls the Northwind deal from memory, and holds the payment.
4. Tom opens it and taps **Negotiate**: "Northwind closing dinner, 5 of us." Clearance counters: £150 a head × 5 = **£750**. Tom accepts, and Stripe captures £750 of the £960 hold.
5. Tom tries to negotiate the gambling payment. The guardrail refuses, because P1 isn't negotiable.
6. **Priya, Finance:** clears the Approvals queue. Her approval captures the held payment.
7. **Audit:** every pound with its rule, evidence, decision-maker and response time.
