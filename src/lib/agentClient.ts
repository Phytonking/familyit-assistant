import type { AgentEvent, AgentStatus, WireTurn } from "./protocol";

export class AgentHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** POSTs the conversation to /api/agent and yields streamed AgentEvents. */
export async function* streamAgent(turns: WireTurn[], signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Server error ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* not JSON */
    }
    throw new AgentHttpError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as AgentEvent;
    }
  }
  if (buf.trim()) yield JSON.parse(buf) as AgentEvent;
}

export async function fetchAgentStatus(): Promise<AgentStatus | null> {
  try {
    const res = await fetch("/api/agent", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as AgentStatus;
  } catch {
    return null;
  }
}
