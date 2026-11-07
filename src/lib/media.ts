// Camera/microphone helpers: acquisition with friendly errors, frame capture, mic level.

export type Facing = "user" | "environment";

export interface MediaFailure {
  kind: "denied" | "missing" | "busy" | "insecure" | "unsupported" | "unknown";
  message: string;
}

export function mediaSupported(): MediaFailure | null {
  if (typeof window === "undefined") return { kind: "unsupported", message: "Not in a browser." };
  if (!window.isSecureContext) {
    return {
      kind: "insecure",
      message: "Camera and microphone need HTTPS (or localhost). On a phone, run `npm run dev:https` and open the https URL.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { kind: "unsupported", message: "This browser can't access the camera or microphone." };
  }
  return null;
}

export function describeMediaError(err: unknown, device: "camera" | "microphone"): MediaFailure {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return { kind: "denied", message: `${cap(device)} access was blocked. Allow it in your browser's site settings, then rejoin.` };
    case "NotFoundError":
    case "OverconstrainedError":
      return { kind: "missing", message: `No ${device} was found.` };
    case "NotReadableError":
    case "AbortError":
      return { kind: "busy", message: `Your ${device} is in use by another app.` };
    default:
      return { kind: "unknown", message: `Couldn't start the ${device}.` };
  }
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export async function getCamera(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
}

export async function getMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export async function countCameras(): Promise<number> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput").length;
  } catch {
    return 0;
  }
}

/** Grabs the current video frame as a downscaled base64 JPEG (no data: prefix). */
export function captureFrame(video: HTMLVideoElement, maxDim = 768, quality = 0.7): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h || video.readyState < 2) return null;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", quality);
  const comma = url.indexOf(",");
  return comma > 0 ? url.slice(comma + 1) : null;
}

/** Keeps a small ring of recent frames so each turn can include a bit of motion context. */
export class FrameSampler {
  private ring: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly getVideo: () => HTMLVideoElement | null,
    private readonly perTurn = 2,
    private readonly intervalMs = 1500,
  ) {}

  start() {
    this.stop();
    this.timer = setInterval(() => {
      const v = this.getVideo();
      const f = v && captureFrame(v);
      if (!f) return;
      this.ring.push(f);
      if (this.ring.length > Math.max(0, this.perTurn - 1)) this.ring.shift();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  clear() {
    this.ring = [];
  }

  /** Recent frames (oldest first) plus a fresh capture of the live view. */
  collect(): string[] {
    const v = this.getVideo();
    const fresh = v && captureFrame(v);
    const frames = fresh ? [...this.ring, fresh] : [...this.ring];
    return frames.slice(-this.perTurn);
  }
}

/** RMS level of a mic stream, 0..1, for the "you're being heard" ring. */
export class MicLevel {
  private ctx: AudioContext | null = null;
  private raf = 0;
  constructor(private readonly onLevel: (level: number) => void) {}

  start(stream: MediaStream) {
    this.stop();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (t - last < 80) return;
      last = t;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / data.length);
      this.onLevel(Math.min(1, rms * 6));
    };
    this.raf = requestAnimationFrame(tick);
  }

  resume() {
    void this.ctx?.resume();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
