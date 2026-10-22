// Handheld (Steam Deck / SteamOS) mode — detection + preference logic.
//
// Handheld mode is the Big Screen shell plus a compact layout: SteamOS
// hardware boots straight into a controller-first experience, so the
// shell defaults to enabled there, while a desktop user can opt in (or
// out) explicitly. The preference is a three-state value so "auto"
// (device detection) stays distinguishable from a deliberate "off".

/** localStorage key holding the user's explicit preference. */
export const HANDHELD_PREF_KEY = "gamelib.handheld.mode";

export type HandheldPref = "auto" | "on" | "off";

export function isHandheldPref(value: unknown): value is HandheldPref {
  return value === "auto" || value === "on" || value === "off";
}

/** Load the stored preference, defaulting to "auto". Tolerates garbage
 *  and storage failures (private mode, cleared storage). */
export function loadHandheldPref(
  storage: Pick<Storage, "getItem"> = localStorage
): HandheldPref {
  try {
    const raw = storage.getItem(HANDHELD_PREF_KEY);
    return isHandheldPref(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function saveHandheldPref(
  pref: HandheldPref,
  storage: Pick<Storage, "setItem"> = localStorage
): void {
  try {
    storage.setItem(HANDHELD_PREF_KEY, pref);
  } catch {
    // Muting is a nicety; never break the shell over storage limits.
  }
}

/**
 * Detect SteamOS-family handheld hardware from the user agent. Only
 * explicit signals count — a Windows tablet or a narrow window is NOT
 * a handheld, because guessing wrong would hijack the desktop shell.
 */
export function detectHandheldHost(userAgent: string): boolean {
  const ua = (userAgent || "").toLowerCase();
  return (
    ua.includes("steamdeck") ||
    ua.includes("steamos") ||
    // Steam Deck's stock browser identifies with "Valve Steam" tokens.
    (ua.includes("valve") && ua.includes("steam"))
  );
}

/** Final answer for "is handheld mode on right now". */
export function resolveHandheldEnabled(
  pref: HandheldPref,
  detected: boolean
): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return detected;
}

/** The next preference when the user presses the toggle: an explicit
 *  opposite of whatever state is currently effective. */
export function nextHandheldPref(enabledNow: boolean): HandheldPref {
  return enabledNow ? "off" : "on";
}
