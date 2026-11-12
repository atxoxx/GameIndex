/**
 * Legacy save-snapshot discovery.
 *
 * The retired Tauri profile (`%APPDATA%\com.gameindex.app`) keeps snapshots in
 * `<profile>/save_backups/<game-id>/`:
 *
 * ```text
 * <game-id>/<created-at>-<kind>.gisave      # Rust / current layout
 * <game-id>/<created-at>-<kind>/            # legacy directory snapshot
 *   manifest.json + files/<index>/…
 * ```
 *
 * The library import already copied the old `save_backups` rows into the
 * current `saves.db`, so this module only adds snapshots that exist on disk but
 * are missing from the index. Matching is by normalized `root_path` first and
 * by `(gameId, createdAt, kind)` second, which keeps re-runs idempotent and
 * never duplicates an imported row.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { legacyAppDataDir, userDataPath } from "../../lib/paths";
import type { SaveBackup } from "../../state/db";
import { isArchivePath, resolveManifest, sha256 } from "./format";
import * as store from "./store";

function legacyProfileDirs(): string[] {
  const appData = app.getPath("appData");
  const candidates = [
    path.join(appData, "com.gameindex.app"),
    path.join(appData, "GameIndex"),
    path.join(appData, "gameindex"),
  ];
  const detected = legacyAppDataDir();
  if (detected) candidates.push(detected);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const key = path.resolve(candidate).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * Every folder a save snapshot may legitimately live in: the current profile's
 * `save_backups/` plus each retired profile's. Used for discovery and as the
 * allow-list for deletion.
 */
export function saveBackupRoots(): string[] {
  const candidates = [userDataPath("save_backups")];
  for (const profile of legacyProfileDirs()) {
    candidates.push(path.join(profile, "save_backups"));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function existingRoots(): string[] {
  return saveBackupRoots().filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Candidate snapshot paths below one root (one game directory deep). */
function candidatesUnder(root: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isFile()) {
      if (isArchivePath(full)) out.push(full);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (fs.existsSync(path.join(full, "manifest.json"))) {
      // A snapshot directory sitting directly in the root.
      out.push(full);
      continue;
    }
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const childFull = path.join(full, child.name);
      if (child.isFile()) {
        if (isArchivePath(childFull)) out.push(childFull);
      } else if (child.isDirectory() && fs.existsSync(path.join(childFull, "manifest.json"))) {
        out.push(childFull);
      }
    }
  }
  return out;
}

function fallbackGameId(candidate: string): string {
  const parent = path.basename(path.dirname(candidate));
  if (!parent || parent.toLowerCase() === "save_backups") return "unknown";
  return parent;
}

function fallbackCreatedAt(candidate: string): number {
  try {
    return Math.trunc(fs.statSync(candidate).mtimeMs);
  } catch {
    return 0;
  }
}

/**
 * Turn one on-disk snapshot into an index row. `null` when it is not a
 * readable GameIndex save snapshot.
 */
export function snapshotFromPath(candidate: string): SaveBackup | null {
  const manifest = resolveManifest({ rootPath: candidate, manifestPath: "" });
  if (!manifest) return null;
  const createdAt =
    typeof manifest.createdAt === "number" && manifest.createdAt > 0
      ? manifest.createdAt
      : fallbackCreatedAt(candidate);
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const locations = Array.isArray(manifest.locations) ? manifest.locations : [];
  return {
    id: "",
    gameId: manifest.gameId?.trim() || fallbackGameId(candidate),
    gameName: manifest.gameName ?? "",
    createdAt,
    kind: manifest.kind || "manual",
    note: manifest.note ?? "",
    locationCount: locations.length,
    fileCount: files.length,
    totalBytes: files.reduce(
      (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
      0,
    ),
    status: "complete",
    error:
      Array.isArray(manifest.warnings) && manifest.warnings.length > 0
        ? manifest.warnings.slice(0, 20).join("; ")
        : null,
    rootPath: path.resolve(candidate),
    manifestPath: "",
  };
}

/** Every readable snapshot under the given roots (deduplicated by path). */
export function discoverSnapshots(roots: string[]): SaveBackup[] {
  const seen = new Set<string>();
  const out: SaveBackup[] = [];
  for (const root of roots) {
    for (const candidate of candidatesUnder(root)) {
      const key = store.pathKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const snapshot = snapshotFromPath(candidate);
        if (snapshot) out.push(snapshot);
      } catch (error) {
        console.error(`[saves] could not read legacy snapshot ${candidate}:`, error);
      }
    }
  }
  return out;
}

/** Roots already reconciled in this process (scanning big folders is not free). */
const reconciledRoots = new Set<string>();

/**
 * Import snapshots that exist on disk but not in `save_backups`.
 *
 * Returns how many rows were added. Safe to call repeatedly: rows are matched
 * by path / identity before insert and ids are deterministic.
 */
export function reconcileLegacySnapshots(backupDir: string): number {
  const scanRoots = existingRoots();
  const current = path.resolve(backupDir);
  if (!scanRoots.some((root) => store.pathKey(root) === store.pathKey(current))) {
    try {
      if (fs.statSync(current).isDirectory()) scanRoots.push(current);
    } catch {
      /* the configured directory does not exist yet */
    }
  }

  const cacheKey = scanRoots.map((root) => store.pathKey(root)).sort().join("|");
  if (reconciledRoots.has(cacheKey)) return 0;
  reconciledRoots.add(cacheKey);

  const discovered = discoverSnapshots(scanRoots);
  if (discovered.length === 0) return 0;

  const existing = store.listBackups();
  const knownPaths = new Set(existing.map((row) => store.pathKey(row.rootPath)).filter(Boolean));
  const knownIdentity = new Set(
    existing.map((row) => `${row.gameId}|${row.createdAt}|${row.kind}`),
  );

  let added = 0;
  for (const snapshot of discovered) {
    const pathKey = store.pathKey(snapshot.rootPath);
    const identity = `${snapshot.gameId}|${snapshot.createdAt}|${snapshot.kind}`;
    if (knownPaths.has(pathKey) || knownIdentity.has(identity)) continue;
    const id = `legacy-${sha256(Buffer.from(pathKey)).slice(0, 12)}`;
    try {
      store.insertBackup({ ...snapshot, id });
      knownPaths.add(pathKey);
      knownIdentity.add(identity);
      added += 1;
    } catch (error) {
      console.error(`[saves] could not import legacy snapshot ${snapshot.rootPath}:`, error);
    }
  }
  return added;
}
