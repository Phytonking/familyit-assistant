import { connection } from "next/server";
import { getAgentConfig } from "@/lib/server/config";
import { parseAgentRequest } from "@/lib/server/request";
import { describeError, streamClaude } from "@/lib/server/claude";
import { mockReply } from "@/lib/server/mockAgent";
import { LIMITS, type AgentEvent, type AgentStatus } from "@/lib/protocol";

/** GET /api/agent -> { mode: "live" | "mock", model } (never exposes the key). */
export async function GET() {
  await connection(); // evaluate env at request time, not at build time
  const cfg = getAgentConfig();
  const status: AgentStatus = { mode: cfg.mode, model: cfg.mode === "live" ? cfg.model : "mock" };
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/agent  body: { turns: WireTurn[] }
 * Streams newline-delimited JSON AgentEvents: meta, text*, (error), done.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxBodyBytes) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "Could not read body" }, { status: 400 });
  }
  if (raw.length > LIMITS.maxBodyBytes) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = parseAgentRequest(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const cfg = getAgentConfig();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: AgentEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          open = false;
        }
      };
      send({ type: "meta", mode: cfg.mode, model: cfg.mode === "live" ? cfg.model : "mock" });
      try {
        if (cfg.mode === "mock") {
          for await (const chunk of mockReply(parsed.turns, abort.signal)) send({ type: "text", text: chunk });
          send({ type: "done", stopReason: "end_turn" });
        } else {
          await streamClaude(parsed.turns, cfg, abort.signal, send);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[api/agent]", err);
          send({ type: "error", ...describeError(err) });
          send({ type: "done", stopReason: null });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Agent-Mode": cfg.mode,
    },
  });
}
