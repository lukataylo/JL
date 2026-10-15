# Clearance

**An AI controller that approves every company card payment before the money moves.**

Expense tools check spend after it has happened. Clearance checks it while the card is being charged. Each employee gets a Stripe Issuing virtual card. When the card is used, Stripe's real-time authorization webhook (`issuing_authorization.request`) asks Clearance to approve or decline, and Clearance answers within Stripe's ~2-second window:

1. **Policy engine (<5 ms).** Checks the written policy (`server/src/policy.ts`, rules P1–P10). Hard breaches are declined straight away: prohibited categories, duplicates, budget overruns and frozen cards.
2. **Claude agent (for flagged payments only).** Borderline payments go to Claude, along with company memory: the employee's recent spend, the company's history with the merchant, and known facts such as trips and deals. Claude returns approve, decline or escalate, and cites the rule IDs it relied on.
3. **Safe default.** If the agent is off or runs out of time, the payment is held for a manager rather than guessed at.
4. **Human in the loop.** Escalated payments appear in the Approvals tab. A manager can approve once, which lets the employee's retry through, and the approval is saved to company memory.

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

### With real Stripe test-mode money movement

```bash
# server/.env: STRIPE_SECRET_KEY=sk_test_...  (Issuing enabled in test mode)
npm run seed:stripe        # creates cardholders + virtual cards in Stripe
npm run stripe:listen      # copy the whsec_... into STRIPE_WEBHOOK_SECRET, restart dev
```

After this, *Tap to pay* creates a real authorization with `stripe.testHelpers.issuing.authorizations.create`. Stripe calls the webhook, and Clearance approves or declines it by responding directly to the webhook.

### With the Claude agent

Set `ANTHROPIC_API_KEY` in `server/.env`. `CLAUDE_MODEL` defaults to `claude-opus-5-5` with low effort. `AGENT_DEADLINE_MS` (default 1500) is how much of Stripe's 2 seconds the agent gets.

## 2-minute demo script

1. **Maya, engineer:** pays **Figma £45**. Approved instantly by the policy engine.
2. Taps **Bet365**. Declined, citing P1 (prohibited category).
3. Taps **Hôtel Pullman Paris £189**. The agent finds "Maya is speaking at KubeCon Paris" in memory and approves.
4. Taps **QuickTech Ltd £240 at 2am**. New merchant, out of hours. The agent escalates.
5. Taps **Apple Store £1,299**. Held under P6 (hardware pre-approval).
6. Switches to **Priya, Finance**, opens Approvals and taps *Approve once*. Maya retries and it goes through, citing P10.
7. Opens **Audit**: every decision with its rule, evidence, decision-maker and response time.
