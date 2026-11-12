/**
 * Small, synchronous app-level settings store.
 *
 * The renderer keeps most UI preferences in `localStorage`, but a handful are
 * consumed by the main process *before* a window exists (boot splash, close to
 * tray, autostart, accent/theme for the splash page). Those live here in
 * `app-settings.json` under `app.getPath('userData')`.
 *
 * Values are intentionally kept in the same snake_case shape the Rust backend
 * used so the renderer commands can stay drop-in replacements.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface AppSettings {
  theme: string;
  accent_color: string;
  adaptive_palette: unknown;
  language: string;
  startup_splash: boolean;
  close_to_tray: boolean;
  minimize_on_launch: boolean;
  restore_on_exit: boolean;
  disable_elevation_prompts: boolean;
  discord_presence: boolean;
  local_achievements: boolean;
  [key: string]: unknown;
}

const DEFAULTS: AppSettings = {
  theme: "dark",
  accent_color: "",
  adaptive_palette: null,
  language: "en",
  startup_splash: true,
  close_to_tray: false,
  minimize_on_launch: false,
  restore_on_exit: true,
  disable_elevation_prompts: false,
  discord_presence: false,
  local_achievements: true,
};

let cache: AppSettings | null = null;

function settingsFile(): string {
  return path.join(app.getPath("userData"), "app-settings.json");
}

export function loadAppSettings(): AppSettings {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    cache = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export function getAppSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadAppSettings()[key];
}

export function getAllAppSettings(): AppSettings {
  return { ...loadAppSettings() };
}

/** Atomic-ish write: temp file then rename, so a crash cannot truncate it. */
export function saveAppSettings(): void {
  if (!cache) return;
  const target = settingsFile();
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch (error) {
    console.error("[app-settings] failed to persist:", error);
  }
}

export function setAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): void {
  const settings = loadAppSettings();
  settings[key] = value;
  saveAppSettings();
}

export function patchAppSettings(patch: Partial<AppSettings>): void {
  const settings = loadAppSettings();
  Object.assign(settings, patch);
  saveAppSettings();
}
