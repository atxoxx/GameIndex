/**
 * Save Backups — settings, stored locations and the header summary.
 *
 * The screenshot/backup engine is not part of this pass, but the settings and
 * location index are cheap and boot-relevant: the renderer calls
 * `saves_get_settings` + `saves_summary` on mount and gates the whole feature
 * on them. A first-run install therefore gets the real defaults (disabled,
 * app-data backup folder) instead of a rejected promise.
 *
 * Mirrors the `saves_get_settings` / `saves_set_settings` / `saves_summary` /
 * `saves_list_locations` contracts from `src-tauri/src/saves/mod.rs`.
 *
 * Storage: `<userData>/db/saves.db` for locations/backups and the `saves.settings`
 * key in `kv.db` — the same split the Rust build used.
 */
import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { CommandHandler } from "../ipc";
import {
  ensureStorage,
  getSavesSettings,
  listSaveBackups,
  listSaveLocations,
  setSavesSettings,
  type SaveBackup,
  type SaveLocation,
} from "../state/db";

interface SavesSettings {
  enabled: boolean;
  backupDir: string;
  autoBackupOnExit: boolean;
  includeEmulatorSaves: boolean;
  includePcgw: boolean;
  retention: number;
  restoreSafetySnapshot: boolean;
  ignorePatterns: string[];
  lastScanAt: number;
}

function defaultSettings(): SavesSettings {
  return {
    enabled: false,
    backupDir: "",
    autoBackupOnExit: true,
    includeEmulatorSaves: true,
    includePcgw: true,
    retention: 10,
    restoreSafetySnapshot: true,
    ignorePatterns: [],
    lastScanAt: 0,
  };
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function resolveBackupDir(settings: SavesSettings): SavesSettings {
  if (settings.backupDir.trim() === "") {
    settings.backupDir = path.join(app.getPath("userData"), "save_backups");
  }
  return settings;
}

function normalizeSettings(raw: unknown): SavesSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const input = raw as Partial<SavesSettings>;
  return {
    enabled: asBool(input.enabled, base.enabled),
    backupDir: asString(input.backupDir, base.backupDir),
    autoBackupOnExit: asBool(input.autoBackupOnExit, base.autoBackupOnExit),
    includeEmulatorSaves: asBool(input.includeEmulatorSaves, base.includeEmulatorSaves),
    includePcgw: asBool(input.includePcgw, base.includePcgw),
    retention: Math.min(1000, asNumber(input.retention, base.retention)),
    restoreSafetySnapshot: asBool(
      input.restoreSafetySnapshot,
      base.restoreSafetySnapshot,
    ),
    ignorePatterns: Array.isArray(input.ignorePatterns)
      ? input.ignorePatterns.filter((value): value is string => typeof value === "string")
      : [],
    lastScanAt: asNumber(input.lastScanAt, 0),
  };
}

function effectiveSettings(): SavesSettings {
  ensureStorage("saves");
  return resolveBackupDir(normalizeSettings(getSavesSettings()));
}

function listAllLocations(): SaveLocation[] {
  ensureStorage("saves");
  return listSaveLocations();
}

function listAllBackups(): SaveBackup[] {
  ensureStorage("saves");
  return listSaveBackups();
}

export const savesCommands: Record<string, CommandHandler> = {
  saves_get_settings: () => effectiveSettings(),

  saves_set_settings: (args) => {
    ensureStorage("saves");
    const next = resolveBackupDir(normalizeSettings(args.settings));
    setSavesSettings({ ...next });
    return next;
  },

  saves_summary: () => {
    const settings = effectiveSettings();
    const locations = listAllLocations();
    const backups = listAllBackups();
    const games = new Set(locations.map((location) => location.gameId));
    const missing = locations.reduce(
      (count, location) => (fs.existsSync(location.path) ? count : count + 1),
      0,
    );
    const totalBackupBytes = backups.reduce(
      (sum, backup) => sum + (backup.totalBytes || 0),
      0,
    );
    const lastBackupAt =
      backups.length > 0
        ? Math.max(...backups.map((backup) => backup.createdAt || 0))
        : null;

    return {
      enabled: settings.enabled,
      backupDir: settings.backupDir,
      gamesWithLocations: games.size,
      totalLocations: locations.length,
      missingLocations: missing,
      totalBackups: backups.length,
      totalBackupBytes,
      lastBackupAt,
      autoBackupOnExit: settings.autoBackupOnExit,
      retention: settings.retention,
    };
  },

  saves_list_locations: (args) => {
    const gameId = asString(args.gameId ?? args.game_id);
    return listAllLocations().filter((location) => location.gameId === gameId);
  },

  saves_list_all_locations: () => listAllLocations(),

  saves_location_health: (args) => {
    const gameId = asString(args.gameId ?? args.game_id);
    const rows = gameId
      ? listAllLocations().filter((location) => location.gameId === gameId)
      : listAllLocations();
    return rows.map((location) => ({
      id: location.id,
      exists: fs.existsSync(location.path),
    }));
  },

  saves_open_path: async (args) => {
    const target = asString(args.path);
    if (!target) throw new Error("Empty path");
    const error = await shell.openPath(target);
    if (error) throw new Error(`open path: ${error}`);
    return null;
  },

  saves_open_location: async (args) => {
    const id = asString(args.id ?? args.locationId);
    const location = listAllLocations().find((row) => row.id === id);
    if (!location) throw new Error(`Location not found: ${id}`);
    const target = fs.existsSync(location.path) && fs.statSync(location.path).isDirectory()
      ? location.path
      : path.dirname(location.path);
    const error = await shell.openPath(target);
    if (error) throw new Error(`open location: ${error}`);
    return null;
  },

  saves_open_backup: async (args) => {
    const id = asString(args.backupId ?? args.id);
    const backup = listAllBackups().find((row) => row.id === id);
    if (!backup) throw new Error(`Backup not found: ${id}`);
    let target = backup.rootPath;
    try {
      if (fs.statSync(target).isFile()) target = path.dirname(target);
    } catch {
      /* keep the recorded path */
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(`open backup: ${error}`);
    return null;
  },
};
