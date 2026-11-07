import type { AgentState } from "@/lib/callController";

const LABEL: Record<AgentState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export function AgentTile({
  state,
  micLevel,
  onTap,
  compact = false,
}: {
  state: AgentState;
  micLevel: number;
  onTap?: () => void;
  compact?: boolean;
}) {
  const size = compact ? "h-14 w-14" : "h-20 w-20";
  const ring = state === "listening" ? 1 + micLevel * 0.35 : 1;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={state === "speaking" ? "Stop the assistant talking" : `Assistant: ${LABEL[state]}`}
      className="group flex items-center gap-3 rounded-3xl border border-white/10 bg-black/45 p-2.5 pr-4 text-left shadow-2xl backdrop-blur-xl transition hover:bg-black/60"
    >
      <span className={`relative grid ${size} shrink-0 place-items-center`}>
        <span
          className={`absolute inset-0 rounded-full bg-teal-400/25 transition-transform duration-100 ${state === "listening" ? "animate-breathe" : ""}`}
          style={{ transform: `scale(${ring})` }}
        />
        <span
          className={`orb absolute inset-1.5 rounded-full ${state === "thinking" ? "orb-thinking" : ""} ${state === "speaking" ? "orb-speaking" : ""}`}
        />
        {state === "speaking" && (
          <span className="relative flex h-6 items-end gap-[3px]">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="eq-bar w-[3px] rounded-full bg-white" style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
        )}
        {state === "thinking" && (
          <span className="relative flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="dot h-1.5 w-1.5 rounded-full bg-white" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">Live Help</span>
        <span className="flex items-center gap-1.5 text-xs text-white/70">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              state === "speaking" ? "bg-teal-300" : state === "thinking" ? "bg-amber-300" : state === "listening" ? "bg-emerald-400" : "bg-white/40"
            }`}
          />
          {LABEL[state]}
          {state === "speaking" && <span className="hidden text-white/40 group-hover:inline">· tap to stop</span>}
        </span>
      </span>
    </button>
  );
}
