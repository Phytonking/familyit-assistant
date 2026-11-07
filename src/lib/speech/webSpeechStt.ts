import type { SpeechToText, SttHandlers } from "./types";

// Minimal typings for the (still prefixed in some browsers) Web Speech API.
interface RecognitionAlternative { transcript: string }
interface RecognitionResult { readonly isFinal: boolean; readonly length: number; [i: number]: RecognitionAlternative }
interface RecognitionResultList { readonly length: number; [i: number]: RecognitionResult }
interface RecognitionEvent { resultIndex: number; results: RecognitionResultList }
interface RecognitionErrorEvent { error: string; message?: string }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const NOOP: SttHandlers = { onInterim() {}, onUtterance() {}, onError() {} };

/**
 * Speech-to-text via the browser's Web Speech API (Chrome/Edge: Google cloud recognizer;
 * Safari: Apple's recognizer). Endpointing is a silence timer on top of the result stream.
 */
export class WebSpeechStt implements SpeechToText {
  readonly name = "Web Speech API";
  readonly supported = getCtor() !== null;

  private handlers: SttHandlers = NOOP;
  private rec: Recognition | null = null;
  private running = false;
  private want = false;
  private endpointing = true;
  private finishing = false;
  /** Results with index < committedUpTo belong to an utterance already emitted. */
  private committedUpTo = 0;
  private finalText = "";
  private interimText = "";
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private networkErrors = 0;

  constructor(private readonly silenceMs = 1100, private readonly lang = "en-US") {}

  setHandlers(h: SttHandlers) {
    this.handlers = h;
  }

  setEndpointing(enabled: boolean) {
    this.endpointing = enabled;
    if (!enabled) this.clearSilence();
  }

  start() {
    if (!this.supported) {
      this.handlers.onError({ code: "unsupported", message: "Speech recognition isn't supported in this browser.", fatal: true });
      return;
    }
    this.want = true;
    if (this.finishing) {
      // A finish() is still waiting for final results; emit what we have now.
      this.finishing = false;
      if (this.finishTimer) clearTimeout(this.finishTimer);
      this.commit();
    }
    this.boot();
  }

  stop() {
    this.want = false;
    this.finishing = false;
    this.reset();
    this.halt(true);
  }

  finish() {
    this.want = false;
    this.clearSilence();
    if (!this.running) {
      this.commit();
      return;
    }
    // Graceful stop lets the recognizer deliver its final results, then onend commits.
    this.finishing = true;
    this.halt(false);
    this.finishTimer = setTimeout(() => {
      if (this.finishing) {
        this.finishing = false;
        this.commit();
      }
    }, 1500);
  }

  private boot() {
    if (this.running || !this.want) return;
    const Ctor = getCtor()!;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => this.onResult(e);
    rec.onerror = (e) => this.onRecError(e);
    rec.onend = () => this.onEnd(rec);
    this.rec = rec;
    this.committedUpTo = 0;
    try {
      rec.start();
      this.running = true;
    } catch {
      // "already started" races; retry shortly.
      this.scheduleRestart(300);
    }
  }

  private halt(abort: boolean) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.rec;
    if (!rec) return;
    try {
      if (abort) rec.abort();
      else rec.stop();
    } catch {
      /* not started */
    }
  }

  private onResult(e: RecognitionEvent) {
    this.networkErrors = 0;
    let interim = "";
    for (let i = Math.max(e.resultIndex, this.committedUpTo); i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0]?.transcript ?? "";
      if (r.isFinal) {
        this.finalText += t + " ";
        this.committedUpTo = Math.max(this.committedUpTo, i + 1);
      } else {
        interim += t;
      }
    }
    this.interimText = interim;
    this.lastResultsLength = e.results.length;
    const live = this.current();
    if (live) this.handlers.onInterim(live);
    if (this.endpointing && this.want) this.armSilence();
  }

  private lastResultsLength = 0;

  private current() {
    return `${this.finalText} ${this.interimText}`.replace(/\s+/g, " ").trim();
  }

  private armSilence() {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => this.commit(), this.silenceMs);
  }

  private clearSilence() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private commit() {
    this.clearSilence();
    const text = this.current();
    // Interim results that later turn final must not be emitted twice.
    this.committedUpTo = Math.max(this.committedUpTo, this.lastResultsLength);
    this.finalText = "";
    this.interimText = "";
    if (text) this.handlers.onUtterance(text);
  }

  private reset() {
    this.clearSilence();
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    this.finalText = "";
    this.interimText = "";
  }

  private onRecError(e: RecognitionErrorEvent) {
    switch (e.error) {
      case "no-speech":
      case "aborted":
        return;
      case "not-allowed":
      case "service-not-allowed":
        this.want = false;
        this.handlers.onError({ code: e.error, message: "Microphone or speech recognition permission was denied.", fatal: true });
        return;
      case "audio-capture":
        this.want = false;
        this.handlers.onError({ code: e.error, message: "No microphone was found.", fatal: true });
        return;
      case "network":
        this.networkErrors++;
        this.handlers.onError({
          code: e.error,
          message: "Speech recognition lost its network connection. Retrying…",
          fatal: this.networkErrors > 4,
        });
        if (this.networkErrors > 4) this.want = false;
        return;
      default:
        this.handlers.onError({ code: e.error, message: `Speech recognition error: ${e.error}`, fatal: false });
    }
  }

  private onEnd(rec: Recognition) {
    if (rec !== this.rec) return;
    this.running = false;
    this.rec = null;
    if (this.finishing) {
      this.finishing = false;
      if (this.finishTimer) clearTimeout(this.finishTimer);
      this.commit();
      return;
    }
    // Recognizers end on their own (silence, ~60s cap). Flush, then restart if we still want to listen.
    if (this.endpointing && this.current()) this.commit();
    if (this.want) this.scheduleRestart(this.networkErrors ? 1000 * this.networkErrors : 150);
  }

  private scheduleRestart(ms: number) {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.boot();
    }, ms);
  }
}
