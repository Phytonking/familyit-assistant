import "server-only";
import type { AgentMode } from "@/lib/protocol";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AgentConfig {
  mode: AgentMode;
  model: string;
  effort: Effort;
  maxTokens: number;
  fallbacks: boolean;
}

/** Models that accept the server-side `fallbacks: "default"` refusal fallback. */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

export function getAgentConfig(): AgentConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const forceMock = process.env.LIVE_HELP_MOCK === "1";
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
  const rawEffort = process.env.ANTHROPIC_EFFORT?.trim() as Effort | undefined;
  const effort: Effort = rawEffort && EFFORTS.includes(rawEffort) ? rawEffort : "low";
  const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096;
  return {
    mode: apiKey && !forceMock ? "live" : "mock",
    model,
    effort,
    maxTokens,
    fallbacks: process.env.LIVE_HELP_FALLBACKS !== "0" && FALLBACK_MODELS.test(model),
  };
}
