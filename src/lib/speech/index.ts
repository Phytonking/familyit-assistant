import { BrowserTts } from "./browserTts";
import { WebSpeechStt } from "./webSpeechStt";
import type { SpeechToText, TextToSpeech } from "./types";

export type { SpeechToText, TextToSpeech, SttError, SttHandlers, TtsHandlers } from "./types";

/**
 * Single place to choose speech providers. To swap in a server-backed provider,
 * implement SpeechToText / TextToSpeech and return it here.
 */
export function createSpeechProviders(): { stt: SpeechToText; tts: TextToSpeech } {
  return { stt: new WebSpeechStt(), tts: new BrowserTts() };
}
