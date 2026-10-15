# Clearance

**An AI controller that approves every company card payment before the money moves.**

Expense tools check spend after it has happened. With Clearance, **every company card holds £0**. When an employee needs to spend, say on an emergency plumber or a taxi home after a late client call, they tap **+ Request** and negotiate with Clearance **by voice or text**. Clearance is a Claude agent that knows the written policy (`server/src/policy.ts`, rules P1–P12) and company memory. It asks pointed questions, then:

- **releases** the amount onto the card (a real Stripe test-mode hold, tied to that purpose and category),
- **counters** with a lower amount the policy can justify,
- **refers** the request to Finance when it's above the agent's authority, or
- **denies** it, citing the rules.

The card payment itself then takes milliseconds, because the thinking already happened when the funds were released. It is approved only if released funds cover it **for the agreed purpose** (P11, P12). On approval Stripe captures exactly the amount spent, and the rest of the hold returns to the company. Absolute rules are enforced in code, not just in the prompt: prohibited categories, frozen cards, duplicates and the monthly budget, and the agent can release at most 2× the role limit.

Payments that are declined can still be negotiated after the fact from the transaction screen. A lower amount the employee accepts is captured as a partial capture.

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

1. **Maya** opens the app: **£0.00 available**, along with her spend and remaining budget.
2. She taps **Pimlico Plumbers £265**. It's declined (red, P11): no funds have been released.
3. She taps **+ Request** and says by voice: *"The server room is flooding, I need £280 for an emergency plumber."* The orb thinks, then turns green with **£280 released**. Stripe now holds £280.
4. She pays the plumber £265 and it's approved instantly. Stripe captures £265, and the other £15 returns to the company.
5. **Tom** asks for £60 for a taxi and gets it, then tries to spend it at Nobu. It's declined: the funds are for a taxi (P12).
6. Someone asks for money for a bet. Clearance refuses, citing P1, and the orb turns red.
7. **Audit:** every pound with its rule, evidence, decision-maker and the conversation behind it.
