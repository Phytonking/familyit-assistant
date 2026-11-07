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

/** Converts wire turns to Anthropic message params (images attached to the latest user turn). */
export function toAnthropicMessages(turns: WireTurn[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t) => {
    const text = t.text.trim() || (t.role === "user" ? "(no speech)" : "(no reply)");
    if (t.role === "assistant" || !t.images?.length) {
      return { role: t.role, content: text };
    }
    const n = t.images.length;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      {
        type: "text",
        text:
          n === 1
            ? "Live camera frame:"
            : `${n} camera frames from the last few seconds, oldest first; the last one is the live view right now:`,
      },
      ...t.images.map(
        (data): Anthropic.Beta.BetaContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data },
        }),
      ),
      { type: "text", text: `User said: ${text}` },
    ];
    return { role: "user", content };
  });
}
