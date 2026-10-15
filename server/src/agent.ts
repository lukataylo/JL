import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
export const agentEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const client = new Anthropic();

/** Conversational turns (funds requests, negotiation): fast settings, then a scripted fallback. */
export const CHAT_MODEL = process.env.CLAUDE_CHAT_MODEL ?? MODEL;
export const CHAT_TIMEOUT_MS = Number(process.env.CLAUDE_CHAT_TIMEOUT_MS ?? 12_000);
