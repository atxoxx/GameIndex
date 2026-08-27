/**
 * Tactile Audio Synthesizer
 * ─────────────────────────
 * Pure WebAudio API synthesizer providing subtle, satisfying mechanical
 * and tactile micro-cues without audio files, network requests, or external deps.
 *
 * All sounds are synthesized mathematically using oscillators and envelope shaping.
 * Lazily initialized on the first user interaction to comply with browser autoplay policies.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Global cached sound settings (synced with SettingsContext / localStorage)
let soundEnabled = true;
let soundVolume = 0.25;

export function updateSoundConfig(enabled: boolean, volume: number): void {
  soundEnabled = enabled;
  soundVolume = Math.max(0, Math.min(1, volume / 100));
}

// Initial hydration from localStorage
if (typeof window !== "undefined") {
  try {
    const storedEnabled = localStorage.getItem("gamelib.ui_sound_enabled");
    if (storedEnabled !== null) {
      soundEnabled = storedEnabled === "true";
    }
    const storedVol = localStorage.getItem("gamelib.ui_sound_volume");
    if (storedVol !== null) {
      const parsed = Number(storedVol);
      if (!Number.isNaN(parsed)) {
        soundVolume = Math.max(0, Math.min(1, parsed / 100));
      }
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Soft, crisp tactile click for tab navigation / switching.
 */
export function playTabSound(): void {
  if (!soundEnabled || soundVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(3.5, now);

    osc.type = "sine";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.035);

    const peakGain = 0.08 * soundVolume;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.035);
  } catch {
    /* non-fatal audio failure */
  }
}

/**
 * Satisfying mechanical click for buttons and toggles.
 */
export function playActionSound(): void {
  if (!soundEnabled || soundVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.045);

    const peakGain = 0.12 * soundVolume;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  } catch {
    /* non-fatal audio failure */
  }
}

/**
 * Ascending pleasant melodic chime for game launches and activations.
 */
export function playLaunchSound(): void {
  if (!soundEnabled || soundVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5

    notes.forEach((freq, idx) => {
      const noteTime = now + idx * 0.055;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, noteTime);

      const noteVolume = (0.1 - idx * 0.015) * soundVolume;
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(noteVolume, noteTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.22);
    });
  } catch {
    /* non-fatal audio failure */
  }
}

/**
 * Gentle warm double-chime for toast notifications.
 */
export function playNotificationSound(): void {
  if (!soundEnabled || soundVolume <= 0) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const notes = [587.33, 880]; // D5 -> A5

    notes.forEach((freq, idx) => {
      const noteTime = now + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, noteTime);

      const noteVolume = 0.07 * soundVolume;
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(noteVolume, noteTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteTime);
      osc.stop(noteTime + 0.18);
    });
  } catch {
    /* non-fatal audio failure */
  }
}
