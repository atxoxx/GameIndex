/**
 * Save-suite settings normalization.
 *
 * `commands/saves.ts` (not editable from this workstream) keeps its own copy of
 * the same defaults for the read/write commands. This module is the engine's
 * view: it reads the same `saves.settings` kv blob and resolves the backup
 * directory the same way, so both halves agree byte for byte.
 */
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { ensureStorage, getSavesSettings, setSavesSettings } from "../../state/db";
import type { SaveEngineSettings } from "./types";

export function defaultSettings(): SaveEngineSettings {
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

/** Fill in the app-data default backup directory when unset. */
export function resolveBackupDir(settings: SaveEngineSettings): SaveEngineSettings {
  if (settings.backupDir.trim() === "") {
    settings.backupDir = path.join(userDataPath(), "save_backups");
  }
  return settings;
}

export function normalizeSettings(raw: unknown): SaveEngineSettings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const input = raw as Partial<SaveEngineSettings>;
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

/** Effective settings with the backup directory resolved. */
export function readSettings(): SaveEngineSettings {
  ensureStorage("saves");
  return resolveBackupDir(normalizeSettings(getSavesSettings()));
}

/** Persist a settings blob (used for the scan timestamp only). */
export function writeSettings(settings: SaveEngineSettings): void {
  ensureStorage("saves");
  setSavesSettings({ ...settings });
}
