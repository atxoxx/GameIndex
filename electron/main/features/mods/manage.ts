/**
 * Mod-manager write operations.
 *
 * Ported from `src-tauri/src/mods/mod.rs`: enable/disable (plugins.txt marker
 * or `.disabled` rename), load-order persistence with a `plugins.txt`
 * rewrite, conflict detection, health checks, archive installation and the
 * single-step undo journal.
 *
 * Every operation that mutates disk leaves a backup under
 * `<userData>/mod-backups/<gameId>/` and an entry in `<userData>/mod-journal/`.
 */
import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import {
  deleteMod,
  getMod,
  getSettings,
  listModsForGame,
  setLoadOrders,
  upsertMod,
} from "./store";
import type {
  GameModsPayload,
  ModConflict,
  ModHealthFinding,
  ModHealthReport,
  ModRow,
} from "./types";
import { scanPluginsTxtStarFormat } from "./pluginsFormat";
import {
  atomicWrite,
  backupDirFor,
  backupFile,
  backupFolder,
  clearUndo,
  isDir,
  isFile,
  journalEntry,
  nowSecs,
  readUndo,
  walkRelative,
  writeUndo,
} from "./util";

export function payloadFor(gameId: string): GameModsPayload {
  const mods = listModsForGame(gameId);
  const settings = getSettings(gameId) ?? undefined;
  const engines: string[] = [];
  for (const row of mods) if (!engines.includes(row.engine)) engines.push(row.engine);
  return {
    mods,
    ...(settings ? { settings } : {}),
    engines,
    supportsReorder: !!settings?.pluginsTxt,
    scanFilesExamined: 0,
    scanTruncated: false,
  };
}

/** Rebuild `plugins.txt` from the stored enabled flags + load order. */
export function rewritePluginsTxt(gameId: string): void {
  const settings = getSettings(gameId);
  const pluginsTxt = settings?.pluginsTxt;
  if (!pluginsTxt) return;
  const star = scanPluginsTxtStarFormat(pluginsTxt);
  const mods = listModsForGame(gameId);
  const lines = ["# This file was written by GameIndex mod manager."];
  for (const mod of mods) {
    if (mod.engine !== "bethesda") continue;
    const fname = path.basename(mod.path);
    if (!fname) continue;
    if (star) lines.push(mod.enabled ? `*${fname}` : fname);
    else if (mod.enabled) lines.push(fname);
  }
  fs.mkdirSync(path.dirname(pluginsTxt), { recursive: true });
  if (isFile(pluginsTxt)) {
    try {
      fs.copyFileSync(pluginsTxt, `${pluginsTxt}.gameindex-backup`);
    } catch {
      /* backup is best effort */
    }
  }
  atomicWrite(pluginsTxt, `${lines.join("\r\n")}\r\n`);
}

/**
 * Rename-based enable/disable for file/folder artifacts: append or strip the
 * `.disabled` suffix. Returns the new path.
 */
export function toggleArtifact(filePath: string, enabled: boolean): string {
  const name = path.basename(filePath);
  if (!name) throw new Error(`bad mod path '${filePath}'`);
  const currentlyDisabled = name.toLowerCase().endsWith(".disabled");
  let targetName: string;
  if (enabled) {
    if (!currentlyDisabled) return filePath;
    targetName = name.slice(0, -".disabled".length);
  } else {
    if (currentlyDisabled) return filePath;
    targetName = `${name}.disabled`;
  }
  const target = path.join(path.dirname(filePath), targetName);
  fs.renameSync(filePath, target);
  return target;
}

/** `.ucas`/`.utoc` IoStore siblings of an Unreal `.pak` (ignoring `.disabled`). */
function unrealCompanions(filePath: string): string[] {
  const visible = filePath.toLowerCase().endsWith(".disabled")
    ? filePath.slice(0, -".disabled".length)
    : filePath;
  const stem = path.join(path.dirname(visible), path.basename(visible, path.extname(visible)));
  return [".ucas", ".utoc"].map((ext) => `${stem}${ext}`);
}

export function setModEnabled(modId: string, enabled: boolean): ModRow {
  const row = getMod(modId);
  if (!row) throw new Error(`Mod not found: ${modId}`);
  const originalPath = row.path;
  const backupDir = backupDirFor(row.gameId);
  if (isFile(originalPath)) backupFile(originalPath, backupDir);

  let next = { ...row };
  if (row.engine === "workshop") {
    throw new Error("unsupported_operation: Steam Workshop items are managed by Steam");
  }

  if (row.engine === "unreal") {
    const current = originalPath;
    const toggled = toggleArtifact(current, enabled);
    for (const companion of unrealCompanions(current)) {
      if (isFile(companion) || isFile(`${companion}.disabled`)) {
        const actual = isFile(companion) ? companion : `${companion}.disabled`;
        backupFile(actual, backupDir);
        toggleArtifact(actual, enabled);
      }
    }
    next = { ...next, path: toggled };
  } else if (row.engine === "bethesda") {
    // State lives in plugins.txt; the file itself is untouched.
  } else {
    next = { ...next, path: toggleArtifact(row.path, enabled) };
  }

  next = { ...next, enabled, updatedAt: nowSecs() };
  upsertMod(next);
  if (row.engine === "bethesda") rewritePluginsTxt(row.gameId);

  journalEntry(row.gameId, "set_enabled", `${row.id} -> ${enabled}`);
  writeUndo({
    gameId: row.gameId,
    operation: "set_enabled",
    originalPath,
    currentPath: next.path,
    timestamp: nowSecs(),
  });
  return next;
}

export function reorderMods(gameId: string, orderedIds: string[]): GameModsPayload {
  const mods = listModsForGame(gameId);
  const byId = new Map(mods.map((row) => [row.id, row]));
  const unique = new Set(orderedIds);
  if (unique.size !== orderedIds.length || orderedIds.some((id) => !byId.has(id))) {
    throw new Error("invalid_load_order: ids must be unique and belong to this game");
  }
  setLoadOrders(orderedIds.map((id, index) => [id, index]));
  rewritePluginsTxt(gameId);
  return payloadFor(gameId);
}

export function deleteModArtifact(modId: string): void {
  const row = getMod(modId);
  if (!row) throw new Error(`Mod not found: ${modId}`);
  const backupDir = backupDirFor(row.gameId);
  let backupPath: string | null = null;

  if (isDir(row.path)) {
    backupPath = backupFolder(row.path, backupDir);
    fs.rmSync(row.path, { recursive: true, force: true });
  } else if (isFile(row.path)) {
    backupPath = backupFile(row.path, backupDir);
    fs.rmSync(row.path, { force: true });
    if (row.engine === "unreal") {
      for (const companion of unrealCompanions(row.path)) {
        for (const candidate of [companion, `${companion}.disabled`]) {
          if (isFile(candidate)) {
            backupFile(candidate, backupDir);
            fs.rmSync(candidate, { force: true });
          }
        }
      }
    }
  }

  deleteMod(modId);
  if (row.engine === "bethesda") rewritePluginsTxt(row.gameId);

  journalEntry(row.gameId, "delete", row.id);
  writeUndo({
    gameId: row.gameId,
    operation: "delete",
    originalPath: row.path,
    ...(backupPath ? { backupPath } : {}),
    timestamp: nowSecs(),
  });
}

function unlinkOnly(modId: string): void {
  const row = getMod(modId);
  if (!row) return;
  deleteMod(modId);
  journalEntry(row.gameId, "unlink", row.id);
}

export { unlinkOnly };

export async function listModFiles(modId: string): Promise<string[]> {
  const row = getMod(modId);
  if (!row) throw new Error(`Mod not found: ${modId}`);
  if (isFile(row.path)) return [path.basename(row.path)];
  if (!isDir(row.path)) return [];
  const files = await walkRelative(row.path, 1_000);
  return files.sort();
}

function copyTree(from: string, to: string): void {
  if (isFile(from)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile()) fs.copyFileSync(src, dest);
  }
}

export function undoLast(): void {
  const record = readUndo();
  if (!record) throw new Error("undo_unavailable: no reversible mod operation");

  if (record.operation === "delete") {
    if (!record.backupPath) throw new Error("undo_unavailable: backup missing");
    if (fs.existsSync(record.originalPath)) {
      throw new Error("undo_conflict: original path already exists");
    }
    if (!fs.existsSync(record.backupPath)) {
      throw new Error("undo_unavailable: backup missing");
    }
    copyTree(record.backupPath, record.originalPath);
  } else if (record.operation === "set_enabled") {
    if (!record.currentPath) throw new Error("undo_unavailable: current path missing");
    if (fs.existsSync(record.currentPath) && record.currentPath !== record.originalPath) {
      fs.mkdirSync(path.dirname(record.originalPath), { recursive: true });
      fs.renameSync(record.currentPath, record.originalPath);
    }
  } else {
    throw new Error(`undo_unavailable: '${record.operation}' cannot be reversed`);
  }

  journalEntry(record.gameId, "undo", record.operation);
  clearUndo();
}

// ── Conflicts & health ──────────────────────────────────────────────

export async function detectConflicts(gameId: string): Promise<ModConflict[]> {
  const mods = listModsForGame(gameId);
  const byPath = new Map<string, string[]>();

  for (const mod of mods.filter((row) => row.kind === "folder")) {
    if (!isDir(mod.path)) continue;
    const files = await walkRelative(mod.path, 5_000);
    for (const file of files) {
      const key = file.toLowerCase();
      const providers = byPath.get(key);
      if (providers) providers.push(mod.id);
      else byPath.set(key, [mod.id]);
    }
  }

  const byId = new Map(mods.map((row) => [row.id, row]));
  const out: ModConflict[] = [];
  for (const [relativePath, modIds] of byPath) {
    if (modIds.length <= 1) continue;
    const providers = modIds
      .map((id) => byId.get(id))
      .filter((row): row is ModRow => row !== undefined)
      .sort((a, b) => a.loadOrder - b.loadOrder);
    const winner = [...providers].reverse().find((row) => row.enabled);
    out.push({
      relativePath,
      modIds,
      ...(winner ? { winnerModId: winner.id } : {}),
      disabledModIds: providers.filter((row) => !row.enabled).map((row) => row.id),
    });
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out.slice(0, 500);
}

export function healthCheck(gameId: string): ModHealthReport {
  const mods = listModsForGame(gameId);
  const findings: ModHealthFinding[] = [];
  const seenNames = new Map<string, string>();

  for (const mod of mods) {
    if (!fs.existsSync(mod.path)) {
      findings.push({
        id: `missing:${mod.id}`,
        kind: "missing_path",
        severity: "error",
        modId: mod.id,
        name: mod.name,
        path: mod.path,
      });
    } else if ((mod.sizeBytes ?? 1) === 0) {
      findings.push({
        id: `empty:${mod.id}`,
        kind: "empty_mod",
        severity: "warning",
        modId: mod.id,
        name: mod.name,
        path: mod.path,
      });
    }

    const key = mod.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (key) {
      const first = seenNames.get(key);
      if (first && first !== mod.id) {
        findings.push({
          id: `dup:${first}:${mod.id}`,
          kind: "duplicate_mod",
          severity: "warning",
          modId: mod.id,
          name: mod.name,
          path: mod.path,
          detail: first,
        });
      } else if (!first) {
        seenNames.set(key, mod.id);
      }
    }

    if (mod.source && !mod.sourceModId) {
      findings.push({
        id: `unlinked:${mod.id}`,
        kind: "unlinked_source",
        severity: "info",
        modId: mod.id,
        name: mod.name,
        path: mod.path,
      });
    }
  }

  return {
    totalMods: mods.length,
    enabledMods: mods.filter((row) => row.enabled).length,
    errors: findings.filter((row) => row.severity === "error").length,
    warnings: findings.filter((row) => row.severity === "warning").length,
    findings,
    checkedAtMs: nowSecs() * 1000,
  };
}

// ── Archive install ─────────────────────────────────────────────────

function stagingRoot(): string {
  const stamp = `${Date.now()}-${process.pid}`;
  return userDataPath("mod-staging", stamp);
}

function safeEntryPath(root: string, entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  const target = path.resolve(root, normalized);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

/** Copy every file under `src` into `dest`; abort and roll back on conflicts. */
async function mergeDirInto(src: string, dest: string): Promise<number> {
  const created: string[] = [];
  let count = 0;

  const walk = async (current: string): Promise<void> => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const from = path.join(current, entry.name);
      const relative = path.relative(src, from);
      const target = path.join(dest, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        await walk(from);
        continue;
      }
      if (fs.existsSync(target)) {
        throw new Error(`install_conflict: '${target}' already exists`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(from, target);
      created.push(target);
      count += 1;
      if (count % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  };

  try {
    await walk(src);
    return count;
  } catch (error) {
    for (const file of [...created].reverse()) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* best effort rollback */
      }
    }
    throw error;
  }
}

/**
 * Extract a mod archive into `destination`, returning the file count.
 * Extraction is staged in a temp folder first; the merge then refuses to
 * overwrite anything and rolls back what it wrote on failure. Both loops
 * yield to the event loop so a large archive does not freeze the main process.
 */
export async function installArchive(archivePath: string, destination: string): Promise<number> {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext !== ".zip") {
    throw new Error(
      `unsupported_archive: ${ext || "this archive"} files need manual extraction — zip archives install directly`,
    );
  }
  if (!isFile(archivePath)) throw new Error("archive_missing: archive file was not found");
  if (!isDir(destination)) throw new Error("install_target_missing: destination folder was not found");

  const staging = stagingRoot();
  try {
    let zip: AdmZip;
    try {
      zip = new AdmZip(archivePath);
    } catch (error) {
      throw new Error(`archive_read: ${error instanceof Error ? error.message : String(error)}`);
    }

    const entries = zip.getEntries();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const safe = safeEntryPath(staging, entry.entryName);
      if (!safe) throw new Error("unsafe_archive: archive contains a path traversal entry");
      if (entry.isDirectory) {
        fs.mkdirSync(safe, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(safe), { recursive: true });
        fs.writeFileSync(safe, entry.getData());
      }
      if (index % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    }

    return await mergeDirInto(staging, destination);
  } finally {
    try {
      fs.rmSync(staging, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
