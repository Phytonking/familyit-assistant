import type { TextToSpeech, TtsHandlers } from "./types";

const NOOP: TtsHandlers = { onStart() {}, onIdle() {} };

/** Prefer natural-sounding English voices when the platform offers them. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  if (!voices.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (/natural|neural|premium|enhanced/i.test(v.name)) s += 4;
    if (/google us english|samantha|ava|allison|aria|jenny/i.test(v.name)) s += 3;
    if (v.lang === "en-US") s += 2;
    if (v.localService) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0];
}

/** Text-to-speech via window.speechSynthesis, fed one sentence at a time. */
export class BrowserTts implements TextToSpeech {
  readonly name = "speechSynthesis";
  readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;

  private handlers: TtsHandlers = NOOP;
  // Holding references avoids Chrome GC'ing utterances and never firing onend.
  private pending = new Set<SpeechSynthesisUtterance>();
  private generation = 0;
  private started = false;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(private readonly rate = 1.05) {
    if (this.supported) {
      this.voice = pickVoice();
      window.speechSynthesis.addEventListener?.("voiceschanged", () => {
        this.voice = pickVoice();
      });
    }
  }

  setHandlers(h: TtsHandlers) {
    this.handlers = h;
  }

  get speaking() {
    return this.pending.size > 0;
  }

  unlock() {
    if (!this.supported) return;
    // A silent utterance inside a user gesture unlocks audio on iOS Safari.
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }

  speak(sentence: string) {
    const text = sentence.trim();
    if (!this.supported || !text) return;
    const gen = this.generation;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang ?? "en-US";
    u.rate = this.rate;
    u.onstart = () => {
      if (gen !== this.generation) return;
      if (!this.started) {
        this.started = true;
        this.handlers.onStart();
      }
    };
    const done = () => {
      if (gen !== this.generation || !this.pending.delete(u)) return;
      if (this.pending.size === 0) {
        this.started = false;
        this.handlers.onIdle();
      }
    };
    u.onend = done;
    u.onerror = done;
    this.pending.add(u);
    const synth = window.speechSynthesis;
    // Chrome sometimes leaves the engine paused after a cancel.
    if (synth.paused) synth.resume();
    synth.speak(u);
  }

  cancel() {
    if (!this.supported) return;
    this.generation++;
    const wasSpeaking = this.pending.size > 0;
    this.pending.clear();
    this.started = false;
    window.speechSynthesis.cancel();
    if (wasSpeaking) this.handlers.onIdle();
  }
}
