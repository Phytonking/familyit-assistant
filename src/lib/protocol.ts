// Wire protocol shared by the browser client and the /api/agent route.

export type Role = "user" | "assistant";

/** One conversation turn as sent to the server. */
export interface WireTurn {
  role: Role;
  text: string;
  /** Base64 JPEG camera frames (no `data:` prefix), oldest first. Only honoured on the latest user turn. */
  images?: string[];
}

export interface AgentRequest {
  turns: WireTurn[];
}

/** Newline-delimited JSON events streamed back from POST /api/agent. */
export type AgentEvent =
  | { type: "meta"; mode: AgentMode; model: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string; code?: string }
  | { type: "done"; stopReason?: string | null };

export type AgentMode = "live" | "mock";

export interface AgentStatus {
  mode: AgentMode;
  model: string;
}

/** Cost / latency guard rails, enforced on the server and respected by the client. */
export const LIMITS = {
  /** Max conversation turns forwarded to the model. */
  maxTurns: 16,
  /** Max images per request (all attached to the latest user turn). */
  maxImages: 3,
  /** Max base64 length per image (~300 KB of JPEG). */
  maxImageBase64: 400_000,
  /** Max characters per turn of text. */
  maxTextChars: 4_000,
  /** Max request body size in bytes. */
  maxBodyBytes: 2_000_000,
} as const;

/** Text the client sends when the user taps "Look at this" without speaking. */
export const LOOK_PROMPT =
  "[The user tapped “Look at this”. Look at the live camera view and tell them what you notice that matters for their problem, then give the next step.]";
