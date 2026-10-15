import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { POLICY, RULES, categorize, gbp } from "./policy.js";
import { recall } from "./memory.js";
import type { AgentVerdict, AuthRequest, RuleResult } from "./types.js";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const agentEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const client = new Anthropic();

const Verdict = z.object({
  decision: z.enum(["approve", "decline", "escalate"]),
  cited_rules: z.array(z.string()).describe("Policy rule IDs the decision rests on, e.g. [\"P3\", \"P8\"]"),
  summary: z.string().describe("One sentence shown to the employee on their phone, max 140 chars"),
  reasoning: z.string().describe("2-4 sentences for the finance audit trail, citing rule IDs and evidence"),
  risk_score: z.number().int().describe("0 (routine) to 100 (almost certainly misuse)"),
});

const SYSTEM = `You are Clearance, the real-time spend controller for ${POLICY.company}.
A company card is being charged right now and the money moves only if you approve it.
A deterministic engine has already checked the written policy; the payments you see have at least one flagged rule that needs judgement.

Decide:
- approve: the flags are explained by evidence in company memory (a known trip, an approved deal, a normal pattern) and nothing suggests misuse.
- escalate: plausibly legitimate but unverified — a manager should confirm. The payment is held and the employee is told it is with their manager.
- decline: clearly against policy or suspicious.

Ground every decision in the policy rule IDs and the specific evidence you used. Do not invent facts that are not in the input.

Written policy:
${RULES.map((r) => `${r.id} ${r.title}: ${r.text}`).join("\n")}`;

/**
 * Asks Claude for a verdict on a flagged payment within `deadlineMs`. Returns null on
 * timeout or failure so the caller can apply the safe default.
 */
export async function review(req: AuthRequest, rules: RuleResult[], deadlineMs: number): Promise<AgentVerdict | null> {
  const payload = {
    payment: {
      employee: `${req.employee.name} (${req.employee.role}, ${req.employee.team})`,
      merchant: req.merchant,
      merchant_category: `${req.mcc} → ${categorize(req.mcc)}`,
      city: req.city,
      amount: gbp(req.amount),
      at: req.at.toISOString(),
    },
    rule_results: rules.filter((r) => r.outcome !== "pass"),
    memory: recall(req),
  };

  try {
    const response = await client.messages.parse(
      {
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
        output_config: { effort: "low", format: zodOutputFormat(Verdict) },
      },
      { timeout: deadlineMs, maxRetries: 0 },
    );
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return response.parsed_output;
  } catch (err) {
    console.warn(`[agent] no verdict within ${deadlineMs}ms:`, (err as Error).message);
    return null;
  }
}
