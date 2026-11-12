/**
 * Small, synchronous app-level settings store.
 *
 * The renderer keeps most UI preferences in `localStorage`, but a handful are
 * consumed by the main process *before* a window exists (boot splash, close to
 * tray, autostart, accent/theme for the splash page). Those live in `kv.db`
 * (`documents` row `app-settings`), matching every other domain now that the
 * JSON store is gone.
 *
 * The one-time migration reads the retired `app-settings.json` so an existing
 * profile keeps its theme, accent, language and toggles, then renames the file
 * to `*.migrated`. Values are kept in the same snake_case shape the Rust
 * backend used so the renderer commands stay drop-in replacements.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { readDocumentJson } from "./db/documents";
import { createSqliteStore } from "./sqliteStore";

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

const store = createSqliteStore<AppSettings>({
  domain: "kv",
  document: "app-settings",
  fileName: "app-settings.json",
  createDefault: () => ({ ...DEFAULTS }),
  normalize: (value) => ({ ...DEFAULTS, ...(value ?? {}) }),
});

let migrationChecked = false;

/** Import the retired JSON document once, then park it. */
function ensureLegacyImported(): void {
  if (migrationChecked) return;
  migrationChecked = true;
  try {
    // A document already in SQLite is authoritative (possible mid-migration
    // crash before the rename below).
    if (readDocumentJson("kv", "app-settings") !== null) return;
    const legacy = path.join(app.getPath("userData"), "app-settings.json");
    if (!fs.existsSync(legacy)) return;
    const parsed = JSON.parse(fs.readFileSync(legacy, "utf8")) as Partial<AppSettings>;
    store.write({ ...DEFAULTS, ...parsed });
    fs.renameSync(legacy, `${legacy}.migrated`);
  } catch (error) {
    console.error("[app-settings] legacy import failed:", error);
  }
}

export function loadAppSettings(): AppSettings {
  ensureLegacyImported();
  return store.read();
}

export function getAppSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadAppSettings()[key];
}

export function getAllAppSettings(): AppSettings {
  return { ...loadAppSettings() };
}

export function saveAppSettings(): void {
  // SQLite writes are synchronous and durable; keep the export for callers that
  // still ask for an explicit flush.
  ensureLegacyImported();
  store.write(store.read());
}

export function setAppSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): void {
  ensureLegacyImported();
  store.update((settings) => {
    settings[key] = value;
    return settings;
  });
}

export function patchAppSettings(patch: Partial<AppSettings>): void {
  ensureLegacyImported();
  store.update((settings) => {
    Object.assign(settings, patch);
    return settings;
  });
}
