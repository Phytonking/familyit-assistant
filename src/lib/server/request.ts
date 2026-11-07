import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { LIMITS, type WireTurn } from "@/lib/protocol";

type Result = { ok: true; turns: WireTurn[] } | { ok: false; error: string };

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates and normalises the request body; applies history/image caps. */
export function parseAgentRequest(body: unknown): Result {
  if (!body || typeof body !== "object" || !Array.isArray((body as { turns?: unknown }).turns)) {
    return { ok: false, error: "Body must be {\"turns\": [...]}" };
  }
  const raw = (body as { turns: unknown[] }).turns;
  const turns: WireTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return { ok: false, error: "Each turn must be an object" };
    const { role, text, images } = t as Partial<WireTurn>;
    if (role !== "user" && role !== "assistant") return { ok: false, error: "turn.role must be user|assistant" };
    if (typeof text !== "string") return { ok: false, error: "turn.text must be a string" };
    if (images !== undefined) {
      if (!Array.isArray(images) || images.some((i) => typeof i !== "string")) {
        return { ok: false, error: "turn.images must be an array of base64 strings" };
      }
      for (const img of images) {
        if (img.length > LIMITS.maxImageBase64) return { ok: false, error: "Image too large (downscale to <=768px JPEG)" };
        if (!BASE64.test(img)) return { ok: false, error: "Images must be raw base64 JPEG (no data: prefix)" };
      }
    }
    turns.push({ role, text: text.slice(0, LIMITS.maxTextChars), images });
  }

  // Keep the most recent turns; the conversation must start with a user turn.
  let recent = turns.slice(-LIMITS.maxTurns);
  while (recent.length && recent[0].role !== "user") recent = recent.slice(1);
  if (!recent.length || recent[recent.length - 1].role !== "user") {
    return { ok: false, error: "The last turn must be a user turn" };
  }

  // Only the latest user turn keeps images (capped); older frames are dropped to bound cost.
  const last = recent.length - 1;
  recent = recent.map((t, i) =>
    i === last
      ? { ...t, images: (t.images ?? []).slice(-LIMITS.maxImages) }
      : { role: t.role, text: t.text },
  );
  if (recent.every((t) => !t.text.trim() && !t.images?.length)) {
    return { ok: false, error: "Nothing to send" };
  }
  return { ok: true, turns: recent };
}

function turnText(t: WireTurn): string {
  return t.text.trim() || (t.role === "user" ? "(no speech)" : "(no reply)");
}

/** Content blocks for a user turn: an intro line, the camera frames (base64 JPEG), then the words. */
export function userTurnContent(t: WireTurn): Anthropic.Beta.BetaContentBlockParam[] {
  const text = turnText(t);
  const n = t.images?.length ?? 0;
  if (!n) return [{ type: "text", text: `User said (camera is off or no frame available): ${text}` }];
  return [
    {
      type: "text",
      text:
        n === 1
          ? "Live camera frame:"
          : `${n} camera frames from the last few seconds, oldest first; the last one is the live view right now:`,
    },
    ...t.images!.map(
      (data): Anthropic.Beta.BetaContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data },
      }),
    ),
    { type: "text", text: `User said: ${text}` },
  ];
}

/** Converts wire turns to Anthropic message params (images attached to the latest user turn). */
export function toAnthropicMessages(turns: WireTurn[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t) => {
    if (t.role === "assistant" || !t.images?.length) {
      return { role: t.role, content: turnText(t) };
    }
    return { role: "user", content: userTurnContent(t) };
  });
}

/**
 * Single-message form for backends that take one user message per request (the Claude CLI):
 * earlier turns become a plain-text transcript, the latest turn keeps its image blocks.
 */
export function toSingleUserMessage(turns: WireTurn[]): Anthropic.Beta.BetaContentBlockParam[] {
  const earlier = turns.slice(0, -1);
  const latest = turns[turns.length - 1];
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (earlier.length) {
    const transcript = earlier
      .map((t) => `${t.role === "user" ? "User" : "You (assistant)"}: ${turnText(t)}`)
      .join("\n");
    blocks.push({
      type: "text",
      text: `Conversation so far on this call (oldest first; older camera frames are not included):\n${transcript}\n\nNow the user's latest turn. Reply to it as your next spoken line.`,
    });
  }
  return [...blocks, ...userTurnContent(latest)];
}
