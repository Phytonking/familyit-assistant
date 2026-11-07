import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AgentConfig } from "./config";
import { SYSTEM_PROMPT } from "./prompt";
import { toAnthropicMessages } from "./request";
import type { AgentEvent, WireTurn } from "@/lib/protocol";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY from the server environment (.env.local). Never exposed to the browser.
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 });
  return client;
}

/** Streams a Claude reply as AgentEvents. */
export async function streamClaude(
  turns: WireTurn[],
  cfg: AgentConfig,
  signal: AbortSignal,
  send: (e: AgentEvent) => void,
): Promise<void> {
  const stream = getClient().beta.messages.stream(
    {
      model: cfg.apiModel,
      max_tokens: cfg.maxTokens,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: toAnthropicMessages(turns),
      // Low effort keeps time-to-first-token short for a voice conversation.
      output_config: { effort: cfg.effort },
      // If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
      ...(cfg.fallbacks
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
    },
    { signal },
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      send({ type: "text", text: event.delta.text });
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    send({
      type: "error",
      code: "refusal",
      message: "Sorry, I can't help with that one. Is there something else I can look at?",
    });
  }
  send({ type: "done", stopReason: final.stop_reason });
}

/** Maps SDK errors to a short, user-facing message. */
export function describeError(err: unknown): { message: string; code: string } {
  if (err instanceof Anthropic.AuthenticationError) {
    return { code: "auth", message: "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY." };
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return { code: "permission", message: "This API key can't use the configured model." };
  }
  if (err instanceof Anthropic.NotFoundError) {
    return { code: "model", message: "The configured model wasn't found. Check ANTHROPIC_MODEL." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { code: "rate_limit", message: "I'm getting too many requests right now. Give it a few seconds and try again." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { code: "bad_request", message: `The request was rejected: ${err.message}` };
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: "network", message: "The server couldn't reach Anthropic. Check its network connection." };
  }
  if (err instanceof Anthropic.APIError) {
    return { code: "api", message: `Anthropic API error ${err.status ?? ""}`.trim() };
  }
  return { code: "internal", message: "Something went wrong on the server." };
}
