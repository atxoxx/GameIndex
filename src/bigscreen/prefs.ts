// Big Screen preference persistence.
//
// The shell's look is a durable preference, not a session flag, so it
// lives in the SQLite `kv` domain (`bigscreen.prefs.v1`) through two
// thin Tauri commands. localStorage mirrors every write so the first
// paint after launch resolves the right preset without waiting on IPC,
// and so `npm run dev` (no Tauri runtime) keeps working.
//
// The stored shape is intentionally forward-compatible: unknown keys
// are ignored and every field is sanitised on read, so a rollback to
// an older build cannot wedge the shell.

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  DEFAULT_PRESET,
  coercePreset,
  getPreset,
  isNavVisibility,
  type BigScreenPresetId,
  type NavVisibility,
} from "./presets";

export const PREFS_KV_KEY = "bigscreen.prefs.v1";
export const PREFS_LS_KEY = "gamelib.bigscreen.prefs";

export interface BigScreenPrefs {
  preset: BigScreenPresetId;
  navVisibility: NavVisibility;
}

export const DEFAULT_PREFS: BigScreenPrefs = {
  preset: DEFAULT_PRESET,
  navVisibility: getPreset(DEFAULT_PRESET).navVisibility,
};

/** Coerce any persisted payload into a complete, valid preference set. */
export function sanitizePrefs(raw: unknown): BigScreenPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const record = raw as Record<string, unknown>;
  const preset = coercePreset(record.preset);
  return {
    preset,
    navVisibility: isNavVisibility(record.navVisibility)
      ? record.navVisibility
      : getPreset(preset).navVisibility,
  };
}

function readLocal(): BigScreenPrefs | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREFS_LS_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(prefs: BigScreenPrefs): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFS_LS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode: the kv copy is authoritative anyway */
  }
}

function tauriAvailable(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Resolve the stored preferences. SQLite wins when it is reachable;
 * localStorage covers the first frame, a wiped DB and browser dev.
 */
export async function loadPrefs(): Promise<BigScreenPrefs> {
  const cached = readLocal();
  if (!tauriAvailable()) return cached ?? { ...DEFAULT_PREFS };

  try {
    const raw = await invoke<string | null>("bigscreen_prefs_get");
    if (!raw) return cached ?? { ...DEFAULT_PREFS };
    const prefs = sanitizePrefs(JSON.parse(raw));
    writeLocal(prefs);
    return prefs;
  } catch {
    return cached ?? { ...DEFAULT_PREFS };
  }
}

/** Persist locally at once, then mirror into SQLite. */
export async function savePrefs(prefs: BigScreenPrefs): Promise<void> {
  writeLocal(prefs);
  if (!tauriAvailable()) return;
  try {
    await invoke("bigscreen_prefs_set", { json: JSON.stringify(prefs) });
  } catch {
    /* the local mirror keeps the choice for the session */
  }
}
