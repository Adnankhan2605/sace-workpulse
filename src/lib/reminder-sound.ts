/**
 * Web Audio API notification chime generator & browser audio-context unlocker.
 * Zero external audio assets required so Edge/Chrome playback never fails on 404s.
 */

const GLOBAL_SOUND_STORAGE_KEY_PREFIX = "sace_notepad_sound_enabled";

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let sharedAudioCtx: AudioContext | null = null;
let unlockListenersInstalled = false;

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

function getOrCreateAudioContext(): AudioContext | null {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

/**
 * Unlock/resume the browser AudioContext during a user gesture (click, keydown, touch)
 * so scheduled reminders can play audible chimes automatically.
 */
export async function unlockReminderAudio(): Promise<boolean> {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return false;
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    // Silent 1-frame buffer nudge ensures Safari/Chrome/Edge mark audio unlocked
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    return ctx.state === "running";
  } catch {
    return false;
  }
}

/**
 * Install passive global interaction listeners so any click/tap/keypress unlocks AudioContext.
 */
export function installAudioUnlockListeners(): () => void {
  if (typeof window === "undefined" || unlockListenersInstalled) {
    return () => {};
  }
  unlockListenersInstalled = true;
  const handler = () => {
    void unlockReminderAudio();
  };
  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("keydown", handler, { passive: true });
  window.addEventListener("touchstart", handler, { passive: true });

  return () => {
    window.removeEventListener("pointerdown", handler);
    window.removeEventListener("keydown", handler);
    window.removeEventListener("touchstart", handler);
    unlockListenersInstalled = false;
  };
}

function scheduleChimePhrase(ctx: AudioContext, startAt: number): void {
  // Pleasant bright bell chord progression: C6 -> E6 -> G6 -> C7
  const notes: Array<{ freq: number; offset: number; duration: number; peakGain: number }> = [
    { freq: 1046.5, offset: 0.0, duration: 0.34, peakGain: 0.16 },
    { freq: 1318.51, offset: 0.11, duration: 0.36, peakGain: 0.15 },
    { freq: 1567.98, offset: 0.22, duration: 0.44, peakGain: 0.14 },
    { freq: 2093.0, offset: 0.34, duration: 0.58, peakGain: 0.12 },
  ];

  for (const n of notes) {
    const t0 = startAt + n.offset;
    const tEnd = t0 + n.duration;

    const oscMain = ctx.createOscillator();
    const oscHarmonic = ctx.createOscillator();
    const gain = ctx.createGain();

    oscMain.type = "sine";
    oscMain.frequency.setValueAtTime(n.freq, t0);

    oscHarmonic.type = "triangle";
    oscHarmonic.frequency.setValueAtTime(n.freq * 2, t0);

    const harmonicGain = ctx.createGain();
    harmonicGain.gain.setValueAtTime(0.18, t0);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(n.peakGain, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    oscMain.connect(gain);
    oscHarmonic.connect(harmonicGain);
    harmonicGain.connect(gain);
    gain.connect(ctx.destination);

    oscMain.start(t0);
    oscHarmonic.start(t0);
    oscMain.stop(tEnd + 0.02);
    oscHarmonic.stop(tEnd + 0.02);
  }
}

/**
 * Play a gentle multi-tone reminder chime repeating 2-3 times.
 * Returns a stop() function to silence remaining repeats immediately on Dismiss/Snooze.
 */
export function playReminderChime(options?: {
  repeatCount?: number;
  intervalMs?: number;
}): () => void {
  const repeatCount = Math.max(1, Math.min(4, options?.repeatCount ?? 3));
  const intervalMs = options?.intervalMs ?? 1500;
  let stopped = false;
  const timers: number[] = [];

  const triggerSinglePhrase = async () => {
    if (stopped) return;
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      if (stopped || ctx.state !== "running") return;
      scheduleChimePhrase(ctx, ctx.currentTime + 0.02);
    } catch {
      // Ignore Web Audio errors if blocked by strict policy
    }
  };

  void triggerSinglePhrase();

  for (let i = 1; i < repeatCount; i += 1) {
    const id = window.setTimeout(() => {
      void triggerSinglePhrase();
    }, i * intervalMs);
    timers.push(id);
  }

  return () => {
    stopped = true;
    for (const id of timers) {
      window.clearTimeout(id);
    }
  };
}

/**
 * Plays a single crisp chime preview and unlocks AudioContext for future reminders.
 */
export async function playTestChime(): Promise<{ ok: boolean; error?: string }> {
  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    return { ok: false, error: "Web Audio API is not supported in this browser." };
  }
  try {
    await unlockReminderAudio();
    if (ctx.state !== "running") {
      return {
        ok: false,
        error: "Browser blocked audio playback. Please interact with the page and try again.",
      };
    }
    scheduleChimePhrase(ctx, ctx.currentTime + 0.02);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not play sound preview." };
  }
}

export function getGlobalSoundStorageKey(userId?: string | null): string {
  return userId ? `${GLOBAL_SOUND_STORAGE_KEY_PREFIX}_${userId}` : GLOBAL_SOUND_STORAGE_KEY_PREFIX;
}

export function isGlobalReminderSoundEnabled(userId?: string | null): boolean {
  if (typeof window === "undefined") return true;
  try {
    const val = window.localStorage.getItem(getGlobalSoundStorageKey(userId));
    if (val === "false") return false;
    return true;
  } catch {
    return true;
  }
}

export function setGlobalReminderSoundEnabled(enabled: boolean, userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getGlobalSoundStorageKey(userId), enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent("sace:reminder-sound-pref", { detail: { enabled, userId } }),
    );
  } catch {
    // Ignore storage errors
  }
}

export async function requestDesktopNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}
