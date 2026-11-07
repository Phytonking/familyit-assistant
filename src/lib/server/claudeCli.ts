import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "./config";
import { SYSTEM_PROMPT } from "./prompt";
import { toSingleUserMessage } from "./request";
import type { AgentEvent, WireTurn } from "@/lib/protocol";

// Backend that runs the local Claude Code CLI (`claude -p`) once per turn, using the
// user's own Claude Code login. Frames go in as real base64 image content blocks via
// `--input-format stream-json` on stdin; text streams back via `--include-partial-messages`.

/** Exact argv (no shell). User text never appears here; it only goes to stdin as JSON. */
export function claudeCliArgs(cfg: AgentConfig): string[] {
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose", // required by stream-json output in print mode
    "--include-partial-messages", // token-level text_delta events
    "--model", cfg.cli.model,
    "--effort", cfg.cli.effort,
    "--system-prompt", SYSTEM_PROMPT, // replaces Claude Code's coding-agent prompt entirely
    // Lock-down: no tools at all, no MCP servers, no slash commands/skills, no hooks/CLAUDE.md/plugins,
    // and nothing written to ~/.claude/projects.
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--safe-mode",
    "--no-session-persistence",
  ];
}

interface StreamLine {
  type?: string;
  subtype?: string;
  event?: { type?: string; delta?: { type?: string; text?: string }; message?: { stop_reason?: string | null } };
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  errors?: string[];
  model?: string;
}

/** Kill the CLI and anything it spawned (it runs in its own process group). */
function killTree(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

export async function streamClaudeCli(
  turns: WireTurn[],
  cfg: AgentConfig,
  signal: AbortSignal,
  send: (e: AgentEvent) => void,
): Promise<void> {
  if (!cfg.cli.path) throw new CliError("not_found", "The `claude` CLI wasn't found. Set CLAUDE_CLI_PATH or install Claude Code.");
  if (signal.aborted) return;

  // Empty throwaway cwd: no project files, CLAUDE.md, or settings for the CLI to pick up.
  const cwd = await mkdtemp(path.join(os.tmpdir(), "live-help-cli-"));
  const t0 = performance.now();
  let tSpawned = 0;
  let tInit = 0;
  let tFirst = 0;

  const env = { ...process.env };
  // Nested-session markers from a parent Claude Code process would change CLI behaviour.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  const child = spawn(cfg.cli.path, claudeCliArgs(cfg), {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true, // own process group so we can kill the whole tree
    shell: false,
  });
  tSpawned = performance.now();

  const onAbort = () => {
    killTree(child, "SIGTERM");
    setTimeout(() => killTree(child, "SIGKILL"), 2000).unref();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    onAbort();
  }, cfg.cli.timeoutMs);

  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (d: string) => {
    stderr = (stderr + d).slice(-4000);
  });

  const exited = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
    child.on("close", (code, sig) => resolve({ code, sig }));
  });
  const spawnError = new Promise<Error>((resolve) => child.on("error", resolve));

  // One stream-json user message in Anthropic message format, then close stdin so the CLI exits after one turn.
  const message = { type: "user", message: { role: "user", content: toSingleUserMessage(turns) } };
  child.stdin!.on("error", () => {}); // EPIPE if the CLI dies early; surfaced via exit code instead
  child.stdin!.end(JSON.stringify(message) + "\n");

  let result: StreamLine | null = null;
  let sawText = false;
  let buf = "";
  try {
    const reading = (async () => {
      child.stdout!.setEncoding("utf8");
      for await (const chunk of child.stdout! as AsyncIterable<string>) {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: StreamLine;
          try {
            ev = JSON.parse(line) as StreamLine;
          } catch {
            continue; // non-JSON noise
          }
          if (ev.type === "system" && ev.subtype === "init" && !tInit) tInit = performance.now();
          if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
            const text = ev.event.delta.text ?? "";
            if (!text) continue;
            if (!tFirst) tFirst = performance.now();
            sawText = true;
            send({ type: "text", text });
          } else if (ev.type === "result") {
            result = ev;
          }
        }
      }
    })();
    const first = await Promise.race([reading.then(() => null), spawnError]);
    if (first instanceof Error) throw new CliError("spawn", `Couldn't start the claude CLI: ${first.message}`);
    const { code, sig } = await exited;

    if (signal.aborted) return;
    if (timedOut) throw new CliError("timeout", `The claude CLI took longer than ${cfg.cli.timeoutMs / 1000}s.`);
    const r = result as StreamLine | null;
    if (r?.is_error || (!r && code !== 0)) {
      const detail = (r?.result || r?.errors?.join("; ") || stderr.trim().split("\n").slice(-3).join(" ") || `exit ${code ?? sig}`).slice(0, 300);
      throw new CliError(/log ?in|auth|credential/i.test(detail) ? "auth" : "cli", `Claude CLI error: ${detail}`);
    }
    // Some versions only put text in the final result; fall back to it if no deltas arrived.
    if (!sawText && r?.result) {
      tFirst = tFirst || performance.now();
      send({ type: "text", text: r.result });
    }
    const stop = r?.stop_reason ?? "end_turn";
    if (stop === "refusal") {
      send({ type: "error", code: "refusal", message: "Sorry, I can't help with that one. Is there something else I can look at?" });
    }
    send({ type: "done", stopReason: stop });

    const ms = (t: number) => (t ? `${Math.round(t - t0)}ms` : "n/a");
    console.log(
      `[claude-cli] model=${cfg.cli.model} images=${turns[turns.length - 1].images?.length ?? 0} turns=${turns.length}` +
        ` spawn=${ms(tSpawned)} init=${ms(tInit)} ttft=${ms(tFirst)} total=${ms(performance.now())}` +
        (r?.duration_api_ms ? ` api=${r.duration_api_ms}ms` : "") +
        (r?.total_cost_usd !== undefined ? ` cost=$${r.total_cost_usd.toFixed(4)}` : ""),
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    if (child.exitCode === null && child.signalCode === null) onAbort();
    if (signal.aborted) console.log(`[claude-cli] cancelled after ${Math.round(performance.now() - t0)}ms; killed pid ${child.pid}`);
    void rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

export class CliError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
