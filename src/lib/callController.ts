import { streamAgent, AgentHttpError } from "./agentClient";
import {
  countCameras,
  describeMediaError,
  FrameSampler,
  getCamera,
  getMicrophone,
  mediaSupported,
  MicLevel,
  type Facing,
} from "./media";
import { LOOK_PROMPT, type WireTurn } from "./protocol";
import { createSpeechProviders, type SpeechToText, type TextToSpeech } from "./speech";
import { isLikelyEcho, SentenceSplitter, wordCount } from "./text";

// The call loop: mic -> STT -> (frames + history) -> /api/agent stream -> sentence TTS,
// with barge-in. Framework-agnostic; React subscribes via subscribe()/getState().

export type AgentState = "idle" | "listening" | "thinking" | "speaking";
export type InputMode = "auto" | "ptt";

export interface TranscriptEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  kind?: "look" | "typed" | "greeting";
  frames?: number;
  pending?: boolean;
  interrupted?: boolean;
  failed?: boolean;
}

export interface Notice {
  id: number;
  level: "error" | "warn" | "info";
  text: string;
}

export interface CallState {
  phase: "lobby" | "starting" | "active" | "ended";
  agentState: AgentState;
  micMuted: boolean;
  cameraOn: boolean;
  facing: Facing;
  canFlip: boolean;
  hasCamera: boolean;
  hasMic: boolean;
  sttSupported: boolean;
  ttsSupported: boolean;
  inputMode: InputMode;
  pttHeld: boolean;
  interim: string;
  transcript: TranscriptEntry[];
  notices: Notice[];
  micLevel: number;
  /** Bumped when the camera stream object changes, so the <video> re-binds. */
  videoVersion: number;
}

const GREETING =
  "Hi, I'm Live Help. Point your camera at whatever you need help with and tell me what's going on.";

const FRAMES_PER_TURN = Math.min(3, Math.max(1, Number(process.env.NEXT_PUBLIC_FRAMES_PER_TURN) || 2));
/** Window after the agent stops talking in which recognized speech may still be its own echo. */
const ECHO_TAIL_MS = 1200;

export class CallController {
  private state: CallState;
  private listeners = new Set<() => void>();
  private stt: SpeechToText;
  private tts: TextToSpeech;
  private video: HTMLVideoElement | null = null;
  private camStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private frames: FrameSampler;
  private micLevel: MicLevel;
  private history: WireTurn[] = [];
  private inflight: AbortController | null = null;
  private streaming = false;
  private currentReply: TranscriptEntry | null = null;
  /** Text the agent is (or was just) saying, for echo filtering. */
  private agentSpeech = "";
  private agentSpeechEndedAt = 0;
  /** True when the user interrupted before the agent said anything: merge the next utterance into the last user turn. */
  private mergeNext = false;
  private nextId = 1;

  constructor() {
    const { stt, tts } = createSpeechProviders();
    this.stt = stt;
    this.tts = tts;
    this.frames = new FrameSampler(() => this.video, FRAMES_PER_TURN);
    this.micLevel = new MicLevel((level) => {
      if (Math.abs(level - this.state.micLevel) > 0.02) this.set({ micLevel: level });
    });
    this.state = {
      phase: "lobby",
      agentState: "idle",
      micMuted: false,
      cameraOn: true,
      facing: "environment",
      canFlip: false,
      hasCamera: false,
      hasMic: false,
      sttSupported: stt.supported,
      ttsSupported: tts.supported,
      inputMode: "auto",
      pttHeld: false,
      interim: "",
      transcript: [],
      notices: [],
      micLevel: 0,
      videoVersion: 0,
    };

    stt.setHandlers({
      onInterim: (text) => this.onInterim(text),
      onUtterance: (text) => this.onUtterance(text),
      onError: (err) => {
        if (err.fatal) {
          // Stop retrying voice input for this call; typing still works.
          this.set({ sttSupported: false });
          this.notify("error", `${err.message} You can type messages instead.`);
          this.set({ interim: "" });
          this.settle();
        } else if (err.code === "network") {
          this.notify("warn", err.message, "stt-network");
        }
      },
    });
    tts.setHandlers({
      onStart: () => {
        if (this.state.phase === "active") this.set({ agentState: "speaking" });
      },
      onIdle: () => {
        this.agentSpeechEndedAt = Date.now();
        this.settle();
      },
    });
  }

  // ---- subscription ----------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  attachVideo(el: HTMLVideoElement | null) {
    this.video = el;
  }
  get cameraStream() {
    return this.camStream;
  }

  // ---- lifecycle ---------------------------------------------------------------------

  /** Must be called from a click handler (audio unlock + permission prompts). */
  async start() {
    if (this.state.phase === "starting" || this.state.phase === "active") return;
    this.tts.unlock();
    this.history = [];
    this.set({ phase: "starting", transcript: [], notices: [], interim: "", agentState: "idle" });

    const unsupported = mediaSupported();
    if (unsupported) {
      this.notify("error", unsupported.message);
    } else {
      await Promise.all([this.openCamera(this.state.facing), this.openMic()]);
      const cams = await countCameras();
      if (this.getState().phase !== "starting") {
        // The call was ended while permissions were pending.
        this.camStream?.getTracks().forEach((t) => t.stop());
        this.micStream?.getTracks().forEach((t) => t.stop());
        this.micLevel.stop();
        this.camStream = this.micStream = null;
        return;
      }
      this.set({ canFlip: cams > 1 });
    }
    if (!this.state.sttSupported) {
      this.notify("warn", "Voice input isn't available in this browser (use Chrome, Edge or Safari). You can type instead.");
    }
    if (!this.state.ttsSupported) {
      this.notify("warn", "Spoken replies aren't available in this browser; replies will appear as text.");
    }
    this.set({ phase: "active" });
    this.frames.start();

    // Local greeting (not sent to the model) so the call feels instant.
    this.addEntry({ role: "assistant", text: GREETING, kind: "greeting" });
    this.sayDirect(GREETING);
    this.resumeListening();
  }

  end() {
    if (this.state.phase !== "active" && this.state.phase !== "starting") return;
    this.interrupt();
    this.stt.stop();
    this.frames.stop();
    this.frames.clear();
    this.micLevel.stop();
    this.camStream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.camStream = null;
    this.micStream = null;
    this.set({ phase: "ended", agentState: "idle", interim: "", pttHeld: false, micLevel: 0, videoVersion: this.state.videoVersion + 1 });
  }

  backToLobby() {
    this.set({ phase: "lobby", transcript: [], notices: [] });
  }

  // ---- media controls ----------------------------------------------------------------

  private async openCamera(facing: Facing) {
    try {
      const stream = await getCamera(facing);
      this.camStream?.getTracks().forEach((t) => t.stop());
      this.camStream = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.enabled = this.state.cameraOn;
        track.addEventListener("ended", () => {
          if (this.camStream === stream) {
            this.notify("warn", "The camera disconnected.");
            this.set({ hasCamera: false });
          }
        });
      }
      this.set({ hasCamera: true, facing, videoVersion: this.state.videoVersion + 1 });
    } catch (err) {
      const f = describeMediaError(err, "camera");
      this.set({ hasCamera: false });
      this.notify(f.kind === "denied" ? "error" : "warn", `${f.message} You can still talk; I just won't be able to see.`);
    }
  }

  private async openMic() {
    try {
      const stream = await getMicrophone();
      this.micStream = stream;
      this.micLevel.start(stream);
      this.set({ hasMic: true });
    } catch (err) {
      const f = describeMediaError(err, "microphone");
      this.set({ hasMic: false });
      this.notify("error", `${f.message} You can type messages instead.`);
    }
  }

  async flipCamera() {
    if (!this.state.hasCamera && !this.state.canFlip) return;
    const next: Facing = this.state.facing === "user" ? "environment" : "user";
    this.frames.clear();
    await this.openCamera(next);
  }

  toggleCamera() {
    const cameraOn = !this.state.cameraOn;
    this.camStream?.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
    if (!cameraOn) this.frames.clear();
    this.set({ cameraOn });
  }

  toggleMute() {
    const micMuted = !this.state.micMuted;
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
    this.set({ micMuted, interim: "" });
    if (micMuted) this.stt.stop();
    this.settle();
  }

  setInputMode(inputMode: InputMode) {
    this.set({ inputMode, interim: "" });
    this.stt.stop();
    this.stt.setEndpointing(inputMode === "auto");
    this.settle();
  }

  pttDown() {
    if (!this.canListen()) return;
    this.interrupt();
    this.micLevel.resume();
    this.set({ pttHeld: true, agentState: "listening" });
    this.stt.setEndpointing(false);
    this.stt.start();
  }

  pttUp() {
    if (!this.state.pttHeld) return;
    this.set({ pttHeld: false });
    this.stt.finish();
  }

  /** Stop the agent talking (tap on the agent tile). */
  stopSpeaking() {
    this.interrupt();
    this.settle();
  }

  // ---- turns -------------------------------------------------------------------------

  lookAtThis() {
    if (this.state.phase !== "active") return;
    if (!this.state.cameraOn || !this.state.hasCamera) {
      this.notify("info", "Turn your camera on so I can take a look.");
      return;
    }
    this.interrupt();
    void this.sendTurn(LOOK_PROMPT, { kind: "look", display: "Look at this" });
  }

  sendTyped(text: string) {
    const t = text.trim();
    if (!t || this.state.phase !== "active") return;
    this.interrupt();
    void this.sendTurn(t, { kind: "typed" });
  }

  private onInterim(text: string) {
    if (this.state.phase !== "active") return;
    const { agentState } = this.state;
    const agentBusy = agentState === "speaking" || this.tts.speaking || this.streaming;
    if (agentBusy || this.inEchoTail()) {
      if (isLikelyEcho(text, this.agentSpeech)) return; // the mic is hearing the agent
      if (agentBusy && wordCount(text) >= 2) {
        // Barge-in: the user started talking over the agent.
        this.interrupt();
      } else if (agentBusy) {
        return;
      }
    }
    this.set({ interim: text, agentState: "listening" });
  }

  private onUtterance(text: string) {
    this.set({ interim: "" });
    if (this.state.phase !== "active") return;
    const agentBusy = this.tts.speaking || this.streaming;
    if ((agentBusy || this.inEchoTail()) && isLikelyEcho(text, this.agentSpeech)) {
      this.settle();
      return;
    }
    if (agentBusy) this.interrupt();
    void this.sendTurn(text, {});
  }

  private inEchoTail() {
    return Date.now() - this.agentSpeechEndedAt < ECHO_TAIL_MS;
  }

  private async sendTurn(text: string, opts: { kind?: "look" | "typed"; display?: string }) {
    const frames = this.state.cameraOn && this.state.hasCamera ? this.frames.collect() : [];

    // If the user cut the agent off before it said anything, treat this as a continuation.
    const lastUser = this.history[this.history.length - 1];
    if (this.mergeNext && lastUser?.role === "user") {
      lastUser.text = `${lastUser.text} ${text}`.trim();
      this.appendToLastUserEntry(opts.display ?? text, frames.length);
    } else {
      this.history.push({ role: "user", text });
      this.addEntry({ role: "user", text: opts.display ?? text, kind: opts.kind, frames: frames.length });
    }
    this.mergeNext = false;

    const turns: WireTurn[] = this.history.map((t, i) =>
      i === this.history.length - 1 ? { ...t, images: frames } : { role: t.role, text: t.text },
    );

    const ac = new AbortController();
    this.inflight = ac;
    this.streaming = true;
    this.agentSpeech = "";
    const reply = this.addEntry({ role: "assistant", text: "", pending: true });
    this.currentReply = reply;
    this.set({ agentState: "thinking" });
    const splitter = new SentenceSplitter((s) => this.speak(s));

    try {
      for await (const ev of streamAgent(turns, ac.signal)) {
        if (this.inflight !== ac) return;
        if (ev.type === "text") {
          this.updateEntry(reply.id, { text: reply.text + ev.text });
          reply.text += ev.text;
          splitter.push(ev.text);
          if (!this.state.ttsSupported && this.state.agentState === "thinking") this.set({ agentState: "speaking" });
        } else if (ev.type === "error") {
          splitter.flush();
          if (ev.code === "refusal") {
            this.updateEntry(reply.id, { text: (reply.text ? reply.text + " " : "") + ev.message });
            reply.text = (reply.text ? reply.text + " " : "") + ev.message;
            this.speak(ev.message);
          } else {
            this.notify("error", ev.message);
            if (!reply.text) this.speak("Sorry, I hit a problem on my end. Could you say that again?");
          }
        }
      }
      if (this.inflight !== ac) return;
      splitter.flush();
      this.updateEntry(reply.id, { pending: false, failed: !reply.text });
      if (reply.text) this.history.push({ role: "assistant", text: reply.text });
      else this.removeEntry(reply.id);
    } catch (err) {
      if (ac.signal.aborted || this.inflight !== ac) return;
      const msg =
        err instanceof AgentHttpError
          ? err.message
          : "Couldn't reach the assistant. Check your connection and try again.";
      this.notify("error", msg);
      this.removeEntry(reply.id);
      this.speak("Sorry, I lost the connection for a moment. Could you say that again?");
    } finally {
      if (this.inflight === ac) {
        this.inflight = null;
        this.streaming = false;
        this.currentReply = null;
        this.settle();
      }
    }
  }

  private speak(sentence: string) {
    if (!sentence) return;
    this.agentSpeech += " " + sentence;
    if (this.state.ttsSupported && this.state.phase === "active") {
      this.tts.speak(sentence);
    }
  }

  private sayDirect(text: string) {
    this.agentSpeech = text;
    if (this.state.ttsSupported) {
      this.set({ agentState: "speaking" });
      this.tts.speak(text);
    }
  }

  /** Cancel the in-flight reply and any speech; keep what was already said in history. */
  private interrupt() {
    const wasSpeaking = this.tts.speaking;
    this.tts.cancel();
    if (wasSpeaking) this.agentSpeechEndedAt = Date.now();
    const ac = this.inflight;
    if (ac) {
      this.inflight = null;
      this.streaming = false;
      ac.abort();
      const reply = this.currentReply;
      this.currentReply = null;
      if (reply) {
        if (reply.text.trim()) {
          this.history.push({ role: "assistant", text: `${reply.text.trim()} [interrupted by the user]` });
          this.updateEntry(reply.id, { pending: false, interrupted: true });
        } else {
          this.removeEntry(reply.id);
          this.mergeNext = true;
        }
      }
    }
  }

  // ---- state helpers -----------------------------------------------------------------

  private canListen() {
    const s = this.state;
    return s.phase === "active" && s.hasMic && !s.micMuted && s.sttSupported;
  }

  private resumeListening() {
    if (this.canListen() && this.state.inputMode === "auto") {
      this.stt.setEndpointing(true);
      this.stt.start();
    }
  }

  /** Recompute the agent tile state after something finished. */
  private settle() {
    if (this.state.phase !== "active") return;
    if (this.streaming && !this.tts.speaking) {
      this.set({ agentState: this.currentReply?.text && !this.state.ttsSupported ? "speaking" : "thinking" });
      return;
    }
    if (this.tts.speaking) return;
    if (this.state.pttHeld) return;
    this.resumeListening();
    const listening = this.canListen() && this.state.inputMode === "auto";
    this.set({ agentState: listening ? "listening" : "idle" });
  }

  private addEntry(e: Omit<TranscriptEntry, "id">): TranscriptEntry {
    const entry = { ...e, id: this.nextId++ };
    this.set({ transcript: [...this.state.transcript, entry] });
    return { ...entry };
  }

  private updateEntry(id: number, patch: Partial<TranscriptEntry>) {
    this.set({ transcript: this.state.transcript.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  }

  private removeEntry(id: number) {
    this.set({ transcript: this.state.transcript.filter((e) => e.id !== id) });
  }

  private appendToLastUserEntry(text: string, frames: number) {
    const t = [...this.state.transcript];
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i].role === "user") {
        t[i] = { ...t[i], text: `${t[i].text} ${text}`.trim(), frames: Math.max(t[i].frames ?? 0, frames) };
        break;
      }
    }
    this.set({ transcript: t });
  }

  private noticeKeys = new Map<string, number>();
  notify(level: Notice["level"], text: string, key?: string) {
    if (key && this.noticeKeys.has(key)) this.dismiss(this.noticeKeys.get(key)!);
    if (this.state.notices.some((n) => n.text === text)) return;
    const id = this.nextId++;
    if (key) this.noticeKeys.set(key, id);
    this.set({ notices: [...this.state.notices, { id, level, text }].slice(-4) });
    if (level !== "error") setTimeout(() => this.dismiss(id), 6000);
  }

  dismiss(id: number) {
    this.set({ notices: this.state.notices.filter((n) => n.id !== id) });
  }
}
