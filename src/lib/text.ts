/** Accumulates streamed text and emits complete sentences for low-latency TTS. */
export class SentenceSplitter {
  private buf = "";
  constructor(private readonly emit: (sentence: string) => void, private readonly minChars = 12) {}

  push(delta: string) {
    this.buf += delta;
    // Sentence end: . ! ? … (optionally followed by quotes/brackets) then whitespace, or a newline.
    const re = /[.!?…]+["'”’)\]]*\s+|\n+/g;
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.buf))) {
      const end = m.index + m[0].length;
      const sentence = this.buf.slice(start, end);
      // Avoid tiny fragments like "Okay." being spoken as separate choppy utterances,
      // and don't split on decimals/abbreviations followed by a space (best effort).
      if (sentence.trim().length < this.minChars) continue;
      this.emit(cleanForSpeech(sentence));
      start = end;
    }
    this.buf = this.buf.slice(start);
  }

  flush() {
    if (this.buf.trim()) this.emit(cleanForSpeech(this.buf));
    this.buf = "";
  }
}

/** Strips markdown and symbols that TTS engines read out awkwardly. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Speakers + open mic means the recognizer can hear the agent's own voice.
 * Treat a transcript as echo if most of its words appear in what the agent is saying.
 */
export function isLikelyEcho(heard: string, agentSpeech: string): boolean {
  const h = words(heard);
  if (!h.length) return true;
  const spoken = new Set(words(agentSpeech));
  if (!spoken.size) return false;
  const hits = h.filter((w) => spoken.has(w)).length;
  return hits / h.length >= 0.6;
}

export function wordCount(s: string): number {
  return words(s).length;
}
