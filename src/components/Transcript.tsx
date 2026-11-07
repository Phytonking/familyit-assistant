"use client";

import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "@/lib/callController";
import { CamIcon, SendIcon } from "./icons";

export function Transcript({
  entries,
  interim,
  onSend,
  inputMode,
  onInputMode,
  voiceAvailable,
}: {
  entries: TranscriptEntry[];
  interim: string;
  onSend: (text: string) => void;
  inputMode: "auto" | "ptt";
  onInputMode: (m: "auto" | "ptt") => void;
  voiceAvailable: boolean;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries, interim]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 py-3 pl-4 pr-12 lg:pr-4">
        <h2 className="text-sm font-semibold text-white">Transcript</h2>
        {voiceAvailable && (
          <div className="flex rounded-full bg-white/5 p-0.5 text-xs" role="radiogroup" aria-label="Voice input mode">
            {(["auto", "ptt"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={inputMode === m}
                onClick={() => onInputMode(m)}
                className={`rounded-full px-2.5 py-1 transition ${inputMode === m ? "bg-white text-zinc-900" : "text-white/60 hover:text-white"}`}
              >
                {m === "auto" ? "Hands-free" : "Push-to-talk"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {entries.map((e) => (
          <div key={e.id} className={`flex ${e.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                e.role === "user" ? "rounded-br-md bg-teal-500/90 text-white" : "rounded-bl-md bg-white/10 text-white/90"
              } ${e.failed ? "opacity-60" : ""}`}
            >
              {e.kind === "look" ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <CamIcon width={14} height={14} /> {e.text}
                </span>
              ) : (
                e.text || (e.pending ? <span className="text-white/50">…</span> : null)
              )}
              {(e.frames || e.interrupted || e.kind === "typed") && (
                <span className="mt-1 block text-[11px] opacity-70">
                  {e.frames ? `${e.frames} frame${e.frames > 1 ? "s" : ""} sent` : ""}
                  {e.kind === "typed" ? `${e.frames ? " · " : ""}typed` : ""}
                  {e.interrupted ? "interrupted" : ""}
                </span>
              )}
            </div>
          </div>
        ))}
        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-teal-300/50 px-3.5 py-2 text-sm italic text-white/70">
              {interim}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex gap-2 border-t border-white/10 p-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!draft.trim()) return;
          onSend(draft);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          aria-label="Type a message"
          className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!draft.trim()}
          className="grid h-9 w-9 place-items-center rounded-full bg-teal-500 text-white transition disabled:opacity-40"
        >
          <SendIcon width={16} height={16} />
        </button>
      </form>
    </div>
  );
}
