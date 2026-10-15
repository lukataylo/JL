import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const agentEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const client = new Anthropic();
