/**
 * Task-completion sound (#123).
 *
 * Plays a short synthesized chime when a session turn finishes, so users who
 * miss the visual notification (multi-window, background, full-screen IDE) still
 * get feedback. Uses the Web Audio API — no bundled audio assets, works on every
 * platform the webview runs on.
 *
 * The preference (enabled + style) is cached in-module so the hot path
 * (`playCompletionSound`) is synchronous and cheap. Call `loadCompletionSoundPref`
 * once at startup and `setCompletionSoundPref` whenever Settings changes.
 */

export type CompletionSoundStyle = "chime" | "ping" | "beep";

export const COMPLETION_SOUND_STYLES: CompletionSoundStyle[] = ["chime", "ping", "beep"];

let _enabled = false;
let _style: CompletionSoundStyle = "chime";

/** Update the cached preference (call from Settings on load/change). */
export function setCompletionSoundPref(enabled: boolean, style: string | undefined): void {
  _enabled = !!enabled;
  _style = normalizeStyle(style);
}

function normalizeStyle(style: string | undefined): CompletionSoundStyle {
  return COMPLETION_SOUND_STYLES.includes(style as CompletionSoundStyle)
    ? (style as CompletionSoundStyle)
    : "chime";
}

/** Idempotent one-time load of the saved preference. Safe to call repeatedly. */
let _loadPromise: Promise<void> | null = null;
export function loadCompletionSoundPref(): Promise<void> {
  if (!_loadPromise) {
    // Dynamic import avoids a static cycle with the api module.
    _loadPromise = import("$lib/api")
      .then((api) => api.getUserSettings())
      .then((s) =>
        setCompletionSoundPref(s.task_completion_sound_enabled ?? false, s.task_completion_sound),
      )
      .catch(() => {
        /* settings unavailable → stay disabled */
      });
  }
  return _loadPromise;
}

/** Play the configured sound iff the feature is enabled. Hot-path, synchronous. */
export function playCompletionSound(): void {
  if (_enabled) playSoundStyle(_style);
}

/** Play a specific style regardless of the enabled flag — for the Settings preview button. */
export function previewCompletionSound(style: string): void {
  playSoundStyle(normalizeStyle(style));
}

// ── Web Audio synthesis ──

type Tone = { freq: number; start: number; dur: number; type?: OscillatorType; gain?: number };

const STYLES: Record<CompletionSoundStyle, Tone[]> = {
  // Gentle ascending two-note "ding-dong" (E5 → B5).
  chime: [
    { freq: 659.25, start: 0, dur: 0.18 },
    { freq: 987.77, start: 0.13, dur: 0.3 },
  ],
  // Single bright ping (C6).
  ping: [{ freq: 1046.5, start: 0, dur: 0.25 }],
  // Two short square-wave beeps (G5).
  beep: [
    { freq: 784, start: 0, dur: 0.09, type: "square", gain: 0.12 },
    { freq: 784, start: 0.14, dur: 0.09, type: "square", gain: 0.12 },
  ],
};

let _ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      _ctx = new AC();
    } catch {
      return null;
    }
  }
  // Autoplay policies can leave the context suspended until a user gesture; the
  // user has already interacted (sent a message) by the time a turn completes.
  if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
  return _ctx;
}

function playSoundStyle(style: CompletionSoundStyle): void {
  const ac = audioContext();
  if (!ac) return;
  const tones = STYLES[style] ?? STYLES.chime;
  const t0 = ac.currentTime;
  for (const tone of tones) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    const peak = tone.gain ?? 0.18;
    const start = t0 + tone.start;
    const end = start + tone.dur;
    // Quick attack, exponential decay — avoids clicks.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.03);
  }
}
