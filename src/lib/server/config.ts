import "server-only";
import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentMode } from "@/lib/protocol";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AgentConfig {
  /** Which backend answers: Anthropic API, local Claude Code CLI, or the scripted mock. */
  mode: AgentMode;
  /** Model label shown in the UI (API model id, CLI model alias, or "mock"). */
  model: string;
  // API backend
  apiModel: string;
  effort: Effort;
  maxTokens: number;
  fallbacks: boolean;
  // Claude CLI backend
  cli: {
    path: string | null;
    model: string;
    effort: Effort;
    timeoutMs: number;
  };
  /** Why the mode was chosen (logged once, handy when debugging env). */
  reason: string;
}

/** Models that accept the server-side `fallbacks: "default"` refusal fallback. */
const FALLBACK_MODELS = /^claude-(opus-5|sonnet-5-5|fable-5)/;

function parseEffort(raw: string | undefined, fallback: Effort): Effort {
  const v = raw?.trim() as Effort | undefined;
  return v && EFFORTS.includes(v) ? v : fallback;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

let cachedCli: { key: string; path: string | null } | null = null;

/**
 * Locates the `claude` executable: CLAUDE_CLI_PATH, then PATH, then common install
 * locations (dev servers launched from a GUI often have a minimal PATH).
 */
export function findClaudeCli(): string | null {
  const explicit = process.env.CLAUDE_CLI_PATH?.trim();
  const key = `${explicit ?? ""}|${process.env.PATH ?? ""}`;
  if (cachedCli?.key === key) return cachedCli.path;
  let found: string | null = null;
  if (explicit) {
    found = isExecutable(explicit) ? explicit : null;
  } else {
    const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    const home = os.homedir();
    dirs.push(path.join(home, ".local/bin"), path.join(home, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin");
    for (const d of dirs) {
      const candidate = path.join(d, "claude");
      if (isExecutable(candidate)) {
        found = candidate;
        break;
      }
    }
  }
  cachedCli = { key, path: found };
  return found;
}

let loggedReason = "";

export function getAgentConfig(): AgentConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const apiModel = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
  const cliPath = findClaudeCli();
  const cli = {
    path: cliPath,
    model: process.env.CLAUDE_CLI_MODEL?.trim() || "sonnet",
    effort: parseEffort(process.env.CLAUDE_CLI_EFFORT, "low"),
    timeoutMs: Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 60_000,
  };

  const requested = (process.env.AGENT_BACKEND?.trim().toLowerCase() || "") as AgentMode | "";
  let mode: AgentMode;
  let reason: string;
  if (process.env.LIVE_HELP_MOCK === "1" || requested === "mock") {
    mode = "mock";
    reason = "mock forced by env";
  } else if (requested === "api") {
    mode = apiKey ? "api" : "mock";
    reason = apiKey ? "AGENT_BACKEND=api" : "AGENT_BACKEND=api but ANTHROPIC_API_KEY is unset";
  } else if (requested === "claude-cli") {
    mode = cliPath ? "claude-cli" : "mock";
    reason = cliPath ? "AGENT_BACKEND=claude-cli" : "AGENT_BACKEND=claude-cli but `claude` was not found";
  } else if (apiKey) {
    mode = "api";
    reason = "ANTHROPIC_API_KEY is set";
  } else if (cliPath) {
    mode = "claude-cli";
    reason = "no ANTHROPIC_API_KEY; using local Claude Code CLI";
  } else {
    mode = "mock";
    reason = "no ANTHROPIC_API_KEY and `claude` not found";
  }

  const summary = `${mode} (${reason})`;
  if (summary !== loggedReason) {
    loggedReason = summary;
    console.log(`[live-help] agent backend: ${summary}${mode === "claude-cli" ? ` path=${cliPath} model=${cli.model}` : ""}`);
  }

  return {
    mode,
    model: mode === "api" ? apiModel : mode === "claude-cli" ? cli.model : "mock",
    apiModel,
    effort: parseEffort(process.env.ANTHROPIC_EFFORT, "low"),
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096,
    fallbacks: process.env.LIVE_HELP_FALLBACKS !== "0" && FALLBACK_MODELS.test(apiModel),
    cli,
    reason,
  };
}
