/**
 * Save-file backup engine: detect locations, snapshot, restore, prune.
 *
 * Workstream: `saves-engine`. Ported from `src-tauri/src/saves/` (mod, detect,
 * registry, engine) and `src-tauri/src/db/saves.rs`. The settings/list/summary
 * read commands live in `commands/saves.ts` and are not duplicated here.
 *
 * Detection merges into the same `save_locations` rows the UI already lists;
 * backups are self-describing snapshot folders under the configured backup
 * directory (see `features/savesEngine/engine.ts` for the layout).
 */
import fs from "node:fs";
import path from "node:path";
import type { Game } from "../../../src/types/game";
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import { ensureStorage, getGameRow, listGameSummaries } from "../state/db";
import type { SaveBackup, SaveLocation } from "../state/db";
import { detectForGame, resolveRoots, type SaveRoots } from "../features/savesEngine/detect";
import * as engine from "../features/savesEngine/engine";
import {
  beginOperation,
  cancelActiveOperation,
  endOperation,
  isCancelled,
  SaveProgressReporter,
} from "../features/savesEngine/progress";
import { readSettings, writeSettings } from "../features/savesEngine/settings";
import * as store from "../features/savesEngine/store";
import type { SaveRestoreResult } from "../features/savesEngine/types";

// ── Argument helpers ────────────────────────────────────────────────────────

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function gameNameOf(game: Game): string {
  const display = game.displayName?.trim();
  return display && display.length > 0 ? display : game.name;
}

function requireGame(gameId: string): Game {
  ensureStorage("games");
  const game = getGameRow(gameId);
  if (!game) throw new Error(`Game not found: ${gameId}`);
  return game;
}

function includedLocations(gameId: string): SaveLocation[] {
  return store.listLocations(gameId).filter((location) => location.include);
}

/**
 * Merge detection results into the stored set (case-insensitive path de-dupe).
 * Returns how many rows were added.
 */
function mergeDetected(
  game: Game,
  roots: SaveRoots,
  includeEmulatorSaves: boolean,
): number {
  const detected = detectForGame(game, { roots, includeEmulatorSaves });
  let added = 0;
  for (const candidate of detected) {
    if (store.findLocationByPath(game.id, candidate.path)) continue;
    store.upsertLocation({
      id: "",
      gameId: game.id,
      path: candidate.path,
      label: candidate.label,
      kind: candidate.kind,
      source: candidate.source,
      include: true,
      createdAt: 0,
      updatedAt: 0,
      lastBackupAt: null,
      lastRestoreAt: null,
    });
    added += 1;
  }
  return added;
}

/** Normalize a renderer-supplied location before it is written. */
function normalizeLocationInput(raw: unknown): SaveLocation {
  if (!raw || typeof raw !== "object") {
    throw new Error("A location object is required");
  }
  const input = raw as Partial<SaveLocation> & Record<string, unknown>;
  const id = asString(input.id);
  if (!id.trim()) throw new Error("Location id is required");
  const stored = store.listLocations().find((row) => row.id === id);
  const locationPath = asString(input.path, stored?.path ?? "").trim();
  if (!locationPath) throw new Error("A path is required");
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(locationPath).isDirectory();
  } catch {
    isDirectory = false;
  }
  const kind =
    input.kind === "dir" || input.kind === "file"
      ? input.kind
      : isDirectory
        ? "dir"
        : "file";
  return {
    id,
    gameId: asString(input.gameId, stored?.gameId ?? ""),
    path: locationPath,
    label: asString(input.label, stored?.label ?? path.basename(locationPath)),
    kind,
    source: asString(input.source, stored?.source ?? "manual"),
    include: typeof input.include === "boolean" ? input.include : (stored?.include ?? true),
    createdAt: stored?.createdAt ?? 0,
    updatedAt: stored?.updatedAt ?? 0,
    lastBackupAt: stored?.lastBackupAt ?? null,
    lastRestoreAt: stored?.lastRestoreAt ?? null,
  };
}

// ── Commands ────────────────────────────────────────────────────────────────

export const savesEngineCommands: Record<string, CommandHandler> = {
  /** Detect and persist locations for one game, returning the merged set. */
  saves_detect_locations: (args: CommandArgs) => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("A game id is required");
    const game = requireGame(gameId);
    const settings = readSettings();
    // `includePcgw` is accepted for signature compatibility; the wiki lookup
    // is not ported (no PCGamingWiki client in this build), so it is a no-op.
    mergeDetected(game, resolveRoots(), settings.includeEmulatorSaves);
    return store.listLocations(gameId);
  },

  /**
   * Scan the library for save locations. Only installed games are considered,
   * and games that already have stored locations are left alone (the per-game
   * "Rescan" action is how those look for more). Cancellable.
   */
  saves_detect_all: async (): Promise<number> => {
    ensureStorage("games");
    const controller = beginOperation();
    const settings = readSettings();
    const roots = resolveRoots();
    const reporter = new SaveProgressReporter("scan");
    const withLocations = new Set(store.listLocations().map((location) => location.gameId));
    const targets = listGameSummaries().filter(
      (game) => game.installed && !withLocations.has(game.id),
    );
    const total = targets.length;
    let scanned = 0;
    let addedTotal = 0;

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (isCancelled(controller)) break;
        const game = targets[index];
        const name = gameNameOf(game);
        reporter.emit(index, total, `Scanning ${name}`, true);
        try {
          addedTotal += mergeDetected(game, roots, settings.includeEmulatorSaves);
        } catch (error) {
          console.error(`[saves] scan ${game.id} failed:`, error);
        }
        scanned += 1;
        // Yield so a large library never starves the main process.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      if (!isCancelled(controller)) {
        writeSettings({ ...settings, lastScanAt: Date.now() });
        reporter.emit(total, total, `Found ${addedTotal} new save location(s)`, true);
      } else {
        reporter.emit(scanned, Math.max(1, total), `Scan cancelled after ${scanned} game(s)`, true);
      }
      return scanned;
    } finally {
      endOperation(controller);
    }
  },

  /** Add a user-chosen folder/file as a save location. */
  saves_add_location: (args: CommandArgs): SaveLocation => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("A game id is required");
    const locationPath = asString(args.path).trim();
    if (!locationPath) throw new Error("A path is required");

    const existing = store.findLocationByPath(gameId, locationPath);
    if (existing) return existing;

    let isDirectory = false;
    try {
      isDirectory = fs.statSync(locationPath).isDirectory();
    } catch {
      isDirectory = false;
    }
    const label = asOptionalString(args.label)?.trim() || path.basename(locationPath) || "Saves";
    return store.upsertLocation({
      id: "",
      gameId,
      path: locationPath,
      label,
      kind: isDirectory ? "dir" : "file",
      source: "manual",
      include: true,
      createdAt: 0,
      updatedAt: 0,
      lastBackupAt: null,
      lastRestoreAt: null,
    });
  },

  /** Update a stored location (label / include / kind). */
  saves_update_location: (args: CommandArgs): SaveLocation => {
    return store.upsertLocation(normalizeLocationInput(args.location));
  },

  /** Remove a stored location. */
  saves_remove_location: (args: CommandArgs): number => {
    const id = asString(args.id ?? args.locationId);
    if (!id) throw new Error("A location id is required");
    return store.deleteLocation(id);
  },

  /** Remove every location for a game. */
  saves_clear_locations: (args: CommandArgs): number => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("A game id is required");
    return store.deleteLocationsForGame(gameId);
  },

  /**
   * Snapshot a game's included save locations. Auto-detects on first backup so
   * a game the user never opened still gets sensible coverage.
   */
  saves_backup_game: async (args: CommandArgs): Promise<SaveBackup> => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("A game id is required");
    const game = requireGame(gameId);
    const name = gameNameOf(game);
    const note = asString(args.note);
    const settings = readSettings();

    if (store.listLocations(gameId).length === 0) {
      mergeDetected(game, resolveRoots(), settings.includeEmulatorSaves);
    }
    const locations = includedLocations(gameId);
    if (locations.length === 0) {
      throw new Error(
        "No save locations configured for this game — add a folder or rescan first",
      );
    }

    fs.mkdirSync(settings.backupDir, { recursive: true });
    const reporter = new SaveProgressReporter("backup", game.id, name);
    const backup = await engine.createBackup({
      gameId: game.id,
      gameName: name,
      locations,
      kind: "manual",
      note,
      backupDir: settings.backupDir,
      ignorePatterns: engine.effectiveIgnore(settings.ignorePatterns),
      onProgress: (current, total, message) => reporter.emit(current, total, message),
    });
    await engine.pruneBackups(gameId, settings.retention, settings.backupDir);
    reporter.finish("Backup complete");
    return backup;
  },

  /** Snapshot every game that has included locations. Cancellable. */
  saves_backup_all: async (): Promise<SaveBackup[]> => {
    ensureStorage("games");
    const controller = beginOperation();
    const settings = readSettings();
    const ignore = engine.effectiveIgnore(settings.ignorePatterns);
    fs.mkdirSync(settings.backupDir, { recursive: true });

    const games = listGameSummaries();
    const candidates = games
      .map((game) => ({ game, locations: includedLocations(game.id) }))
      .filter((entry) => entry.locations.length > 0);
    const total = candidates.length;
    const totalFiles = candidates.reduce(
      (sum, entry) => sum + entry.locations.length,
      0,
    );
    const done: SaveBackup[] = [];
    let seenLocations = 0;

    try {
      for (const entry of candidates) {
        if (isCancelled(controller)) break;
        const { game, locations } = entry;
        const name = gameNameOf(game);
        const reporter = new SaveProgressReporter("backup", game.id, name);
        const span = Math.max(1, locations.length);
        reporter.emit(seenLocations, totalFiles, `Backing up ${name}`, true);
        try {
          const backup = await engine.createBackup({
            gameId: game.id,
            gameName: name,
            locations,
            kind: "manual",
            note: "Backup all",
            backupDir: settings.backupDir,
            ignorePatterns: ignore,
            signal: controller.signal,
            onProgress: (current, fileTotal, message) => {
              const scaled = fileTotal > 0 ? current / fileTotal : 0;
              reporter.emit(
                seenLocations + Math.round(scaled * span),
                totalFiles,
                message,
              );
            },
          });
          await engine.pruneBackups(game.id, settings.retention, settings.backupDir);
          done.push(backup);
        } catch (error) {
          if (isCancelled(controller)) break;
          console.error(`[saves] backup_all ${game.id} failed:`, error);
        }
        seenLocations += span;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      if (isCancelled(controller)) {
        const reporter = new SaveProgressReporter("backup");
        reporter.emit(
          Math.max(1, totalFiles),
          Math.max(1, totalFiles),
          `Backup cancelled after ${done.length} game(s)`,
          true,
        );
      } else {
        const reporter = new SaveProgressReporter("backup");
        reporter.emit(
          Math.max(1, totalFiles),
          Math.max(1, totalFiles),
          `Backed up ${done.length} of ${total} game(s)`,
          true,
        );
      }
      return done;
    } finally {
      endOperation(controller);
    }
  },

  /** List backup snapshots, optionally scoped to a game. Newest first. */
  saves_list_backups: (args: CommandArgs): SaveBackup[] => {
    const gameId = asOptionalString(args.gameId ?? args.game_id);
    return store.listBackups(gameId);
  },

  /** Delete one snapshot (index row + on-disk folder). */
  saves_delete_backup: async (args: CommandArgs): Promise<number> => {
    const id = asString(args.backupId ?? args.id);
    if (!id) throw new Error("A backup id is required");
    const backup = store.getBackup(id);
    if (!backup) return 0;
    const settings = readSettings();
    await engine.deleteSnapshot(backup, settings.backupDir);
    return store.deleteBackupRow(id);
  },

  /** Delete every snapshot for a game. */
  saves_delete_game_backups: async (args: CommandArgs): Promise<number> => {
    const gameId = asString(args.gameId ?? args.game_id);
    if (!gameId) throw new Error("A game id is required");
    const settings = readSettings();
    for (const backup of store.listBackups(gameId)) {
      await engine.deleteSnapshot(backup, settings.backupDir);
    }
    return store.deleteBackupRowsForGame(gameId);
  },

  /**
   * Restore a snapshot. When the setting is on, the current saves are captured
   * first so the restore itself can be undone.
   */
  saves_restore_backup: async (args: CommandArgs): Promise<SaveRestoreResult> => {
    const id = asString(args.backupId ?? args.id);
    if (!id) throw new Error("A backup id is required");
    const backup = store.getBackup(id);
    if (!backup) throw new Error(`Backup not found: ${id}`);
    const settings = readSettings();

    let safetyBackupId: string | null = null;
    if (settings.restoreSafetySnapshot) {
      const current = includedLocations(backup.gameId);
      if (current.length > 0) {
        try {
          fs.mkdirSync(settings.backupDir, { recursive: true });
          const snapshot = await engine.createBackup({
            gameId: backup.gameId,
            gameName: backup.gameName,
            locations: current,
            kind: "pre-restore",
            note: "Automatic snapshot before restore",
            backupDir: settings.backupDir,
            ignorePatterns: engine.effectiveIgnore(settings.ignorePatterns),
          });
          safetyBackupId = snapshot.id;
        } catch (error) {
          console.error("[saves] safety snapshot failed:", error);
        }
      }
    }

    const reporter = new SaveProgressReporter("restore", backup.gameId, backup.gameName);
    const result = await engine.restoreSnapshot(backup, {
      onProgress: (current, total, message) => reporter.emit(current, total, message),
    });

    const now = Date.now();
    for (const location of store.listLocations(backup.gameId)) {
      store.touchLocationRestore(location.id, now);
    }
    await engine.pruneBackups(backup.gameId, settings.retention, settings.backupDir);
    reporter.finish(
      `Restored ${result.restoredFiles} file(s)${result.warnings.length > 0 ? ` with ${result.warnings.length} warning(s)` : ""}`,
    );

    return {
      backupId: backup.id,
      gameId: backup.gameId,
      restoredFiles: result.restoredFiles,
      totalBytes: result.totalBytes,
      safetyBackupId,
      warnings: result.warnings,
    };
  },

  /** Read a snapshot's manifest for the backup browser. */
  saves_get_backup_manifest: (args: CommandArgs) => {
    const id = asString(args.backupId ?? args.id);
    if (!id) throw new Error("A backup id is required");
    const backup = store.getBackup(id);
    if (!backup) throw new Error(`Backup not found: ${id}`);
    return engine.readManifest(backup);
  },

  /**
   * Cancel an in-flight `saves_detect_all` / `saves_backup_all`.
   *
   * Auxiliary to the 13 ported names: the renderer has no cancel control yet,
   * but the engine must expose one so the long scans stay interruptible.
   */
  saves_cancel_operation: (): boolean => cancelActiveOperation(),
};

export function registerSavesEngineCommands(): void {
  registerCommands(savesEngineCommands, { override: true });
}
