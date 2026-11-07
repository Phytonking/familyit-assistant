"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CallController, type CallState } from "@/lib/callController";
import { fetchAgentStatus } from "@/lib/agentClient";
import type { AgentStatus } from "@/lib/protocol";
import { AgentTile } from "./AgentTile";
import { Transcript } from "./Transcript";
import {
  CamIcon,
  CamOffIcon,
  ChatIcon,
  CloseIcon,
  EyeIcon,
  FlipIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
} from "./icons";

export default function LiveHelpApp() {
  const [controller] = useState(() => new CallController());
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAgentStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      setStatusError(!s);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => controller.end(), [controller]);

  const inCall = state.phase === "starting" || state.phase === "active";
  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-zinc-950 text-white">
      {status && <BackendBanner status={status} />}
      {statusError && (
        <div className="z-30 bg-red-500 px-4 py-1.5 text-center text-xs font-medium text-white">
          Can&apos;t reach the server. Check that the app is running and your connection is up.
        </div>
      )}
      {inCall ? <CallView c={controller} s={state} status={status} /> : <Lobby c={controller} s={state} status={status} />}
    </div>
  );
}

function Lobby({ c, s, status }: { c: CallController; s: CallState; status: AgentStatus | null }) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(45,212,191,0.18),transparent_60%)]" />
      <div className="relative w-full max-w-md text-center">
        <div className="mx-auto mb-6 grid h-24 w-24 place-items-center">
          <span className="orb h-20 w-20 rounded-full shadow-[0_0_60px_rgba(45,212,191,0.45)]" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Live Help</h1>
        <p className="mt-3 text-balance text-white/70">
          Show it the problem, talk it through. A video call with an expert who can see your router lights, cables, error
          screens and printers, and walks you through the fix one step at a time.
        </p>
        {s.phase === "ended" && (
          <p className="mt-4 rounded-xl bg-white/5 px-4 py-2 text-sm text-white/70">
            Call ended · {s.transcript.filter((t) => t.role === "user").length} things you asked about.
          </p>
        )}
        <button
          onClick={() => void c.start()}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-teal-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-500/30 transition hover:bg-teal-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-300/50"
        >
          <PhoneIcon /> {s.phase === "ended" ? "Start a new call" : "Start call"}
        </button>
        <p className="mt-3 text-xs text-white/50">
          {status ? `Agent: ${backendLabel(status)}` : "Checking agent…"}
        </p>
        <ul className="mt-8 space-y-2 text-left text-sm text-white/60">
          <li>• You&apos;ll be asked for camera and microphone access.</li>
          <li>• Best in Chrome or Edge (desktop/Android). Safari works with limits. Firefox can only type.</li>
          <li>• Use headphones for the smoothest interruptions; on speakers the mic can hear the agent.</li>
          {!s.sttSupported && <li className="text-amber-300">• This browser has no speech recognition, so you&apos;ll type instead.</li>}
        </ul>
      </div>
    </main>
  );
}

function CallView({ c, s, status }: { c: CallController; s: CallState; status: AgentStatus | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const voiceAvailable = s.sttSupported && s.hasMic;

  useEffect(() => {
    const v = videoRef.current;
    c.attachVideo(v);
    if (v) {
      v.srcObject = c.cameraStream;
      if (c.cameraStream) void v.play().catch(() => {});
    }
  }, [c, s.videoVersion]);

  // Hold Space to talk (when not typing).
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      c.pttDown();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      c.pttUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [c]);

  const lastUser = [...s.transcript].reverse().find((e) => e.role === "user");
  const lastAgent = [...s.transcript].reverse().find((e) => e.role === "assistant");
  const userCaption = s.interim || (lastUser && lastAgent && lastUser.id > lastAgent.id ? lastUser.text : "");
  const agentCaption = lastAgent?.text ? tail(lastAgent.text, 220) : "";
  const showVideo = s.hasCamera && s.cameraOn;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {/* Camera */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${showVideo ? "opacity-100" : "opacity-0"} ${s.facing === "user" ? "-scale-x-100" : ""}`}
        />
        {!showVideo && (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-zinc-900 to-zinc-950">
            <div className="text-center text-white/60">
              <CamOffIcon width={40} height={40} className="mx-auto mb-3" />
              <p className="text-sm">{s.hasCamera ? "Camera is off" : s.phase === "starting" ? "Starting camera…" : "No camera available"}</p>
              <p className="mt-1 text-xs text-white/40">The assistant can&apos;t see anything right now.</p>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        {/* Top bar */}
        <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
          <div className="flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-xs backdrop-blur">
            <span className={`h-2 w-2 rounded-full ${s.phase === "active" ? "animate-pulse bg-red-500" : "bg-white/40"}`} />
            <span className="font-medium">{s.phase === "starting" ? "Connecting…" : "On call"}</span>
            {status && <span className="hidden text-white/50 sm:inline">· {backendLabel(status)}</span>}
          </div>
          <AgentTile state={s.agentState} micLevel={s.micMuted ? 0 : s.micLevel} onTap={() => c.stopSpeaking()} />
        </header>

        {/* Notices */}
        <div className="absolute inset-x-0 top-24 z-20 mx-auto flex max-w-md flex-col gap-2 px-3" role="status">
          {s.notices.map((n) => (
            <div
              key={n.id}
              className={`flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-sm shadow-lg backdrop-blur ${
                n.level === "error" ? "bg-red-500/90" : n.level === "warn" ? "bg-amber-500/90 text-amber-950" : "bg-white/15"
              }`}
            >
              <span className="flex-1">{n.text}</span>
              <button onClick={() => c.dismiss(n.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
                <CloseIcon width={16} height={16} />
              </button>
            </div>
          ))}
        </div>

        {/* Captions */}
        <div className="absolute inset-x-0 bottom-28 mx-auto max-w-2xl space-y-2 px-4 text-center sm:bottom-32">
          {agentCaption && (
            <p className="text-pretty text-base font-medium leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] sm:text-lg">
              {agentCaption}
            </p>
          )}
          {userCaption && (
            <p className={`text-sm leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${s.interim ? "italic text-teal-200" : "text-white/70"}`}>
              You: {userCaption}
            </p>
          )}
        </div>

        {/* Controls */}
        <nav className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-3">
          <RoundButton
            label={s.micMuted ? "Unmute microphone" : "Mute microphone"}
            active={!s.micMuted && s.hasMic}
            disabled={!s.hasMic}
            onClick={() => c.toggleMute()}
          >
            {s.micMuted || !s.hasMic ? <MicOffIcon /> : <MicIcon />}
          </RoundButton>
          <RoundButton
            label={s.cameraOn ? "Turn camera off" : "Turn camera on"}
            active={s.cameraOn && s.hasCamera}
            disabled={!s.hasCamera}
            onClick={() => c.toggleCamera()}
          >
            {s.cameraOn && s.hasCamera ? <CamIcon /> : <CamOffIcon />}
          </RoundButton>
          {s.canFlip && (
            <RoundButton label="Switch camera" active onClick={() => void c.flipCamera()}>
              <FlipIcon />
            </RoundButton>
          )}
          <button
            onClick={() => c.lookAtThis()}
            disabled={s.phase !== "active" || !showVideo}
            className="flex h-12 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-zinc-900 shadow-lg transition hover:bg-teal-50 disabled:opacity-40 sm:h-14 sm:px-5"
          >
            <EyeIcon width={20} height={20} /> <span className="hidden min-[400px]:inline">Look at this</span>
          </button>
          {voiceAvailable && !s.micMuted && (
            <button
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                c.pttDown();
              }}
              onPointerUp={() => c.pttUp()}
              onPointerCancel={() => c.pttUp()}
              onContextMenu={(e) => e.preventDefault()}
              aria-label="Hold to talk"
              title="Hold to talk (or hold Space)"
              className={`grid h-12 w-12 touch-none select-none place-items-center rounded-full transition sm:h-14 sm:w-14 ${
                s.pttHeld ? "scale-110 bg-teal-400 text-zinc-950" : "bg-white/15 text-white backdrop-blur hover:bg-white/25"
              }`}
            >
              <HandIcon />
            </button>
          )}
          <RoundButton label={panelOpen ? "Hide transcript" : "Show transcript"} active={panelOpen} onClick={() => setPanelOpen((o) => !o)} className="lg:hidden">
            <ChatIcon />
          </RoundButton>
          <button
            onClick={() => c.end()}
            aria-label="End call"
            className="grid h-12 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-400 sm:h-14 sm:w-16"
          >
            <PhoneOffIcon />
          </button>
        </nav>
        {s.inputMode === "ptt" && voiceAvailable && s.phase === "active" && !s.pttHeld && s.agentState === "idle" && (
          <p className="absolute inset-x-0 bottom-[5.5rem] text-center text-xs text-white/60 sm:bottom-24">Hold the hand button (or Space) to talk</p>
        )}
      </section>

      {/* Transcript: side panel on desktop, bottom sheet on mobile */}
      <aside
        className={`${panelOpen ? "fixed inset-x-0 bottom-0 z-40 h-[70dvh] rounded-t-3xl" : "hidden"} border-white/10 bg-zinc-900/95 backdrop-blur-xl lg:static lg:block lg:h-auto lg:w-[380px] lg:rounded-none lg:border-l`}
      >
        <button onClick={() => setPanelOpen(false)} aria-label="Close transcript" className="absolute right-3 top-2.5 rounded-full p-1 text-white/60 lg:hidden">
          <CloseIcon width={18} height={18} />
        </button>
        <Transcript
          entries={s.transcript}
          interim={s.interim}
          onSend={(t) => c.sendTyped(t)}
          inputMode={s.inputMode}
          onInputMode={(m) => c.setInputMode(m)}
          voiceAvailable={voiceAvailable}
        />
      </aside>
    </div>
  );
}

function backendLabel(s: AgentStatus) {
  if (s.mode === "api") return `Anthropic API · ${s.model}`;
  if (s.mode === "claude-cli") return `Claude CLI · ${s.model}`;
  return "scripted mock";
}

function BackendBanner({ status }: { status: AgentStatus }) {
  if (status.mode === "mock") {
    return (
      <div className="z-30 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
        Mock mode: no API key and no Claude CLI, so a scripted agent is answering. It doesn&apos;t really see your camera.
      </div>
    );
  }
  if (status.mode === "claude-cli") {
    return (
      <div className="z-30 bg-indigo-500 px-4 py-1.5 text-center text-xs font-medium text-white">
        Claude CLI mode: answering through your local Claude Code login (model: {status.model}). For local prototyping only.
      </div>
    );
  }
  return (
    <div className="z-30 bg-teal-600/90 px-4 py-1 text-center text-[11px] font-medium text-white">
      Anthropic API · {status.model}
    </div>
  );
}

function RoundButton({
  label,
  active,
  disabled,
  onClick,
  children,
  className = "",
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-12 w-12 place-items-center rounded-full transition disabled:opacity-40 sm:h-14 sm:w-14 ${
        active ? "bg-white/15 text-white backdrop-blur hover:bg-white/25" : "bg-white text-zinc-900 hover:bg-white/90"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function tail(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(-max);
  const space = cut.indexOf(" ");
  return "…" + (space > 0 ? cut.slice(space + 1) : cut);
}
