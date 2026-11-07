# Live Help

A prototype video-call app where you talk to an AI expert and show it your camera. Point
your phone at a router with a blinking orange light, a tangle of cables, an error on a
screen, or a jammed printer, say what's wrong, and it talks you through the fix one step
at a time.

- **Call UI**: full-bleed camera preview (front/back switch on phones), agent tile showing
  listening / thinking / speaking, mute, camera on/off, end call, live captions, and a
  transcript panel (side panel on desktop, bottom sheet on mobile) with a text box.
- **Voice in**: hands-free with silence detection, plus push-to-talk (hold the hand
  button or hold Space).
- **Vision**: each turn sends the live frame plus a recent one (downscaled to 768px JPEG
  at 0.7 quality). "Look at this" sends frames without speaking.
- **Brain**: Claude through the Anthropic API, streamed. The system prompt asks for short,
  spoken-style, one-step-at-a-time guidance, asks you to show specific things, and gives
  safety warnings and "call a professional" advice.
- **Voice out**: the reply is spoken sentence by sentence while it streams. Barge-in:
  start talking (or tap the agent tile) and it stops.
- **Mock mode**: with no API key, a scripted agent answers so you can demo the whole loop.

## Run it

```bash
npm install
cp .env.example .env.local       # add ANTHROPIC_API_KEY=sk-ant-... (or leave empty for mock mode)
npm run dev                      # http://localhost:3000
```

Open it in **Chrome or Edge** on desktop for the best experience, click **Start call**, and
allow camera + microphone. Headphones help: on speakers the mic hears the agent (there is
an echo filter, but headphones make barge-in reliable).

**On a phone**: camera and mic need HTTPS. Run `npm run dev:https` (self-signed cert,
binds to all interfaces), open `https://<your-computer-ip>:3000` on the phone, and accept
the certificate warning. Android Chrome works best; iOS Safari works with the limits below.

Other scripts: `npm run lint`, `npm run build`, `npm start`.

### Configuration (`.env.local`)

| Variable | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _(empty)_ | Empty: mock mode. Server-side only, never sent to the browser. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | `claude-sonnet-5-5` or `claude-haiku-5-5` for faster turns. |
| `ANTHROPIC_EFFORT` | `low` | `low`…`max`. Higher = slower, more thorough. |
| `ANTHROPIC_MAX_TOKENS` | `4096` | Per reply. |
| `LIVE_HELP_MOCK` | | `1` forces mock mode even with a key. |
| `LIVE_HELP_FALLBACKS` | on | `0` disables server-side refusal fallback (`fallbacks: "default"`; used on Opus 5.x / Sonnet 5.5 / Fable 5.x). |
| `NEXT_PUBLIC_FRAMES_PER_TURN` | `2` | 1–3 camera frames per turn (build-time). |

## Architecture

```
Browser                                                 Next.js server
───────────────────────────────────────────────────    ─────────────────────────────
camera ─► FrameSampler (ring of recent 768px JPEGs)
mic ─► SpeechToText (Web Speech) ─► utterance ─┐
"Look at this" / typed text ───────────────────┤
                                               ▼
                         CallController.sendTurn ──POST /api/agent──►  validate + cap
                         (history + frames)            {turns}          history/images
                                               ◄── NDJSON stream ───   Claude (streaming)
                                               │   meta/text/error/done  or mock agent
                         SentenceSplitter ─► TextToSpeech (speechSynthesis)
          barge-in: user speech while agent is busy ─► cancel TTS + abort fetch
```

- `src/lib/callController.ts`: the call loop and state machine (lobby → active → ended;
  agent idle / listening / thinking / speaking). It owns media, history, interrupts, echo
  filtering and errors. It's framework-agnostic; React subscribes with `useSyncExternalStore`.
- `src/lib/speech/`: provider interfaces (`SpeechToText`, `TextToSpeech`) and the browser
  implementations, `WebSpeechStt` (continuous recognition + silence-timer endpointing,
  auto-restart, push-to-talk `finish()`) and `BrowserTts` (sentence queue, voice
  selection, cancel). Swap providers in `src/lib/speech/index.ts`.
- `src/lib/media.ts`: camera/mic acquisition with friendly errors, frame capture
  (canvas → JPEG), recent-frame ring, mic level meter.
- `src/app/api/agent/route.ts`: `GET` returns `{mode, model}`; `POST {turns}` streams
  newline-delimited JSON events. Validation and caps are in `src/lib/server/request.ts`:
  last 16 turns, at most 3 images and only on the latest user turn, ≤400 KB per image,
  2 MB body.
- `src/lib/server/claude.ts`: `client.beta.messages.stream` with base64 image blocks,
  a cached system prompt, `output_config.effort`, refusal handling + server-side fallback,
  and typed SDK error mapping.
- `src/lib/server/mockAgent.ts`: scripted, topic-aware replies (router, printer, cables,
  error screens, electrical, gas) streamed word by word. It knows whether frames were
  attached but doesn't analyse them.

### Wire format

```bash
curl -N localhost:3000/api/agent -H 'content-type: application/json' \
  -d '{"turns":[{"role":"user","text":"My router light is orange","images":["<base64 jpeg>"]}]}'
# {"type":"meta","mode":"mock","model":"mock"}
# {"type":"text","text":"Got"} ...
# {"type":"done","stopReason":"end_turn"}
```

## Browser support

| | Speech recognition | Speech synthesis | Notes |
| --- | --- | --- | --- |
| Chrome / Edge (desktop, Android) | ✅ (audio goes to Google's servers) | ✅ | Best. Needs internet for STT. |
| Safari macOS / iOS 14.5+ | ⚠️ `webkitSpeechRecognition` (Siri must be enabled); continuous mode is flaky and can stop after a pause | ✅ | Hands-free may need re-taps. Push-to-talk is more reliable. |
| Firefox | ❌ | ✅ | Type messages instead; replies are still spoken. |
| In-app browsers / old WebViews | ❌ usually | varies | |

Camera and mic need a secure context (HTTPS or `localhost`).

## What's real vs mocked

- **Real**: camera capture and frame sampling, mic + Web Speech transcription, silence
  endpointing, push-to-talk, sentence-streamed TTS, barge-in, the streaming API route,
  Claude vision + conversation (with a key), error handling for denied/missing devices,
  network failures and API errors.
- **Mocked (no key)**: the agent's brain. Replies are canned and only pretend to see.

## Known limits

- Web Speech STT/TTS quality and latency vary by browser and OS voice. Chrome cuts off
  recognition after ~60s or on network hiccups; the provider auto-restarts.
- Echo: on speakers, the recognizer can hear the agent. An overlap filter drops
  transcripts that mostly repeat what the agent is saying, but a real AEC pipeline
  (WebRTC + server STT) or headphones is better.
- On iOS, using getUserMedia audio (for the level meter) and speech recognition together
  can be unreliable.
- Images are only attached to the latest turn; older frames are dropped (the model keeps
  its own earlier descriptions in history) to bound cost.
- History is held in memory in the tab; there's no auth, persistence, or rate limiting.
  Don't expose the server publicly with your key.
- End-to-end latency is speech endpoint (~1.1s silence) + time to first sentence + TTS
  start. Haiku 5.5 / Sonnet 5.5 at low effort feel snappier than Opus.

## Next steps

- **Speech-to-speech realtime**: replace STT → LLM → TTS with a streaming audio model, or
  stream mic audio to a server STT with proper VAD/endpointing (Deepgram, Whisper
  streaming) and use a streaming neural TTS (ElevenLabs, etc.) for natural voices and
  lower latency.
- **WebRTC transport**: send audio/video over WebRTC to the server for echo cancellation,
  continuous low-fps video, and a path to human-expert escalation in the same call.
- **On-screen annotations**: let Claude return structured hints (tool use or structured
  output) like "circle the WAN port at (x, y)" and draw arrows/boxes over the live video.
- Smarter frame selection: send frames only when the scene changes; crop or zoom on
  request ("let me zoom in on that label").
- Session memory and summaries, device-specific knowledge (model lookup from a label
  photo, manuals via web search/fetch tools), and a hand-off "call a pro" summary.
