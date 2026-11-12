/**
 * One-time parking of the JSON documents the previous storage pass wrote.
 *
 * This build stores every domain in `<userData>/db/*.db` (see `STORAGE.md`).
 * The old `<userData>/*.json` documents are **not** imported — the owner chose a
 * clean start — and they are **not** deleted either: on the first storage access
 * of a profile they are moved into `<userData>/json-backup-<timestamp>/` so the
 * bytes stay recoverable by hand, and the move is recorded in `kv.db` under
 * `storage:legacy-json-parked`.
 *
 * Only the explicit allow-list below is touched. Electron/Chromium files
 * (`Preferences`, `Local State`, `*.db`, …) live in the same folder and must
 * never be moved.
 *
 * Two files intentionally stay where they are, both documented in `STORAGE.md`:
 *  • `app-settings.json` — read synchronously before `app.whenReady()` for the
 *    splash/window setup (`state/appSettings.ts`, shared with another
 *    workstream);
 *  • `overlay.json` — owned by `surfaces/` (out of this workstream's scope) and
 *    still read by the overlay window at startup.
 */
import fs from "node:fs";
import path from "node:path";

import { userDataPath } from "../lib/paths";
import { mergePluginConfigValues } from "./db/codecs";
import { kvSetJson } from "./db/sqlite";

/**
 * Every `*.json` document the pre-SQLite Electron build wrote for domain data.
 * Keep this list in sync with `STORAGE.md`; a file that is not listed here is
 * never moved (so an unrelated JSON the user dropped in the folder survives).
 */
export const LEGACY_JSON_FILES: readonly string[] = [
  // core library pass (imported by `state/db/importLegacy.ts` before this change)
  "library.json",
  "sessions.json",
  "sessions-db.json",
  "game-notes.json",
  "shelves.json",
  "wishlist_cache.json",
  "saves.json",
  // feature domains
  "achievements.json",
  "achievement-links.json",
  "achievement-settings.json",
  "beta-integrations.json",
  "clips.json",
  "compatibility.json",
  "downloads-history.json",
  "downloads-queue.json",
  "downloads-secrets.json",
  "downloads-state.json",
  "emulator-installs.json",
  "emulators.json",
  "extras-cache.json",
  "friends-db.json",
  "friends-secrets.json",
  "media-roots.json",
  "mods.json",
  "news.json",
  "nexus.json",
  "plugin_availability_cache.json",
  "plugins.json",
  "review-quotes.json",
  "source_cache.json",
  "sources.json",
  "steam-dlc.json",
  "steam-session.json",
  "storage-history.json",
  "store-cache.json",
  "store_cache.json",
  "store-ownership.json",
  "store-settings.json",
  "watcher-index.json",
];

export interface ParkedLegacyJson {
  /** Absolute folder the documents were moved into, or `null` when none moved. */
  dir: string | null;
  /** Base names that were moved, in allow-list order. */
  files: string[];
  /** Per-plugin `config.json` files migrated into `plugins.db` + parked. */
  pluginConfigs: number;
}

const PARKED_KEY = "storage:legacy-json-parked";

let parked: ParkedLegacyJson | null = null;

function timestampLabel(): string {
  const iso = new Date().toISOString();
  return iso.replace(/[:.]/g, "-");
}

/** Move one file, falling back to copy + unlink across volumes. */
function moveFile(source: string, destination: string): void {
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
}

/**
 * Move the legacy documents aside. Safe to call repeatedly: the result is
 * memoized per process and a second launch simply finds nothing left to move.
 */
export function parkLegacyJsonDocuments(): ParkedLegacyJson {
  if (parked) return parked;

  const root = userDataPath();
  const files: string[] = [];
  let dir: string | null = null;

  const ensureBackupDir = (): string | null => {
    if (dir !== null) return dir;
    const candidate = path.join(root, `json-backup-${timestampLabel()}`);
    try {
      fs.mkdirSync(candidate, { recursive: true });
      dir = candidate;
      return dir;
    } catch (error) {
      console.error("[legacy-json] cannot create the backup folder:", error);
      return null;
    }
  };

  for (const name of LEGACY_JSON_FILES) {
    const source = path.join(root, name);
    try {
      if (!fs.statSync(source).isFile()) continue;
    } catch {
      continue; // absent or unreadable: nothing to preserve
    }
    const target = ensureBackupDir();
    if (target === null) break;
    try {
      moveFile(source, path.join(target, name));
      files.push(name);
    } catch (error) {
      console.error(`[legacy-json] could not move ${name}:`, error);
    }
  }

  const pluginConfigs = migratePluginConfigs(root, ensureBackupDir);

  parked = {
    dir: files.length > 0 || pluginConfigs > 0 ? dir : null,
    files,
    pluginConfigs,
  };
  if (files.length === 0 && pluginConfigs === 0) return parked;

  console.info(
    `[legacy-json] moved ${files.length} legacy document(s) and ${pluginConfigs} plugin config(s) to ${parked.dir}`,
  );
  try {
    kvSetJson(PARKED_KEY, {
      at: Date.now(),
      dir: parked.dir,
      files,
      pluginConfigs,
    });
  } catch (error) {
    // The move itself succeeded; a missing record only loses the audit trail.
    console.error("[legacy-json] could not record the move in kv.db:", error);
  }
  return parked;
}

/**
 * Plugin secret config used to sit in `plugins/<id>/config.json`. The values
 * are already `safeStorage` ciphertext, so they can move into `plugins.db`
 * (`plugin_config`) unchanged; the file is then parked like the root documents
 * so re-entering keys is never required for a profile that still has DPAPI.
 */
function migratePluginConfigs(
  root: string,
  ensureBackupDir: () => string | null,
): number {
  const pluginsRoot = path.join(root, "plugins");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(pluginsRoot, { withFileTypes: true });
  } catch {
    return 0;
  }

  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configFile = path.join(pluginsRoot, entry.name, "config.json");
    let values: Record<string, string>;
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, "utf8")) as {
        values?: unknown;
      };
      const raw = parsed?.values;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      values = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string") values[key] = value;
      }
    } catch {
      continue; // missing or unreadable: leave the file alone
    }

    const target = ensureBackupDir();
    if (target === null) break;
    try {
      mergePluginConfigValues(entry.name, values);
      const destination = path.join(target, "plugins", entry.name, "config.json");
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      moveFile(configFile, destination);
      migrated += 1;
    } catch (error) {
      console.error(
        `[legacy-json] could not migrate the config for plugin ${entry.name}:`,
        error,
      );
    }
  }
  return migrated;
}

/** Test/harness hook: forget the memoized result (never used by the app). */
export function resetParkedLegacyJson(): void {
  parked = null;
}
