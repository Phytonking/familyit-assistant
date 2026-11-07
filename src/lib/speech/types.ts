// Provider interfaces so the browser Web Speech implementations can be swapped for
// server-backed ones (Whisper, Deepgram, ElevenLabs, OpenAI realtime, ...) later.

export interface SttError {
  /** e.g. "not-allowed", "audio-capture", "network", "unsupported" */
  code: string;
  message: string;
  /** Fatal errors stop listening; the UI should fall back to typing. */
  fatal: boolean;
}

export interface SttHandlers {
  /** Live caption of what the user is saying right now (unfinalised). */
  onInterim(text: string): void;
  /** The user finished an utterance (endpoint detected, or finish() was called). */
  onUtterance(text: string): void;
  onError(err: SttError): void;
}

export interface SpeechToText {
  readonly name: string;
  readonly supported: boolean;
  setHandlers(h: SttHandlers): void;
  /**
   * When true (hands-free mode) the provider decides when the user stopped talking
   * (silence detection) and emits onUtterance. When false (push-to-talk) it only
   * emits on finish().
   */
  setEndpointing(enabled: boolean): void;
  /** Start (or keep) listening continuously. */
  start(): void;
  /** Stop listening and discard anything not yet emitted. */
  stop(): void;
  /** Stop listening and emit whatever was heard as a final utterance. */
  finish(): void;
}

export interface TtsHandlers {
  /** First audio of a reply started playing. */
  onStart(): void;
  /** Everything queued has finished playing (or was cancelled). */
  onIdle(): void;
}

export interface TextToSpeech {
  readonly name: string;
  readonly supported: boolean;
  setHandlers(h: TtsHandlers): void;
  /** Queue one sentence. Called sentence-by-sentence as the reply streams in. */
  speak(sentence: string): void;
  /** Stop immediately and clear the queue (barge-in). */
  cancel(): void;
  readonly speaking: boolean;
  /** Call inside a user gesture (Safari/iOS require this before audio can play). */
  unlock(): void;
}
