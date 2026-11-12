/**
 * Emulator / ROM-folder discovery and the read-only library health scan.
 *
 * Ported from `src-tauri/src/roms.rs` (`discover_emulators`,
 * `discover_rom_folders`, `known_exe_map`, `discovery_roots`,
 * `walk_for_exes`) and `src-tauri/src/emulator_health.rs`.
 *
 * The walk is depth-limited and async, so a deep Program Files tree cannot
 * stall the IPC loop. PATH is scanned too (the port brief asks for it), which
 * covers scoop/chocolatey/portable installs that live outside the usual roots.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { listGames, upsertGames } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";
import { biosRequirementsFor, checkBios, mandatoryBiosMissing } from "./bios";
import { hashRomFile } from "./library";
import { catalogMeta, EXTRA_KNOWN_EXES, listEmulatorDownloads } from "./catalog";
import { getEmulator, listEmulators } from "./store";
import type {
  DiscoveredEmulator,
  EmulatorHealthFinding,
  EmulatorHealthReport,
} from "./types";

const MAX_DISCOVERY_DEPTH = 2;
const YIELD_EVERY = 40;

async function yieldToLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

interface KnownExecutable {
  key: string;
  name: string;
  platform: string;
  exeLower: string;
}

function humanizeKey(key: string): string {
  return key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Catalog + extra Windows executables, keyed by lowercase file name. */
function knownExecutables(): KnownExecutable[] {
  const out: KnownExecutable[] = [];
  const seen = new Set<string>();

  for (const extra of EXTRA_KNOWN_EXES) {
    const exeLower = extra.exe.toLowerCase();
    if (seen.has(exeLower)) continue;
    seen.add(exeLower);
    out.push({
      key: extra.key,
      name: extra.name,
      platform: extra.platform,
      exeLower,
    });
  }
  for (const entry of listEmulatorDownloads()) {
    const exeLower = entry.exeName.toLowerCase();
    if (seen.has(exeLower)) continue;
    const extra = EXTRA_KNOWN_EXES.find((candidate) => candidate.key === entry.key);
    const meta = catalogMeta(entry.key);
    seen.add(exeLower);
    out.push({
      key: entry.key,
      name: extra?.name ?? meta?.name ?? humanizeKey(entry.key),
      platform: extra?.platform ?? meta?.platform ?? "",
      exeLower,
    });
  }
  return out;
}

interface RootSpec {
  dir: string;
  depth: number;
}

function directoryOrNull(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function discoveryRoots(): RootSpec[] {
  const roots: RootSpec[] = [];
  const push = (dir: string | undefined, depth: number): void => {
    const resolved = directoryOrNull(dir);
    if (resolved) roots.push({ dir: resolved, depth });
  };

  for (const variable of [
    "ProgramFiles",
    "ProgramFiles(x86)",
    "LOCALAPPDATA",
    "USERPROFILE",
    "ProgramData",
    "HOME",
  ]) {
    const value = process.env[variable];
    if (!value) continue;
    const depth =
      variable === "ProgramFiles" || variable === "ProgramFiles(x86)"
        ? MAX_DISCOVERY_DEPTH
        : 0;
    push(value, depth);
    if (variable === "LOCALAPPDATA" || variable === "USERPROFILE" || variable === "HOME") {
      push(path.join(value, "Programs"), MAX_DISCOVERY_DEPTH);
      push(path.join(value, "Emulation"), MAX_DISCOVERY_DEPTH);
      push(path.join(value, "Emulators"), MAX_DISCOVERY_DEPTH);
      push(path.join(value, "RetroArch-Win64"), MAX_DISCOVERY_DEPTH);
    }
  }

  // Portable installs commonly sit in a top-level folder on the system drive.
  const systemDrive = process.env.SystemDrive;
  if (systemDrive) {
    for (const relative of ["Emulators", "Emulation", "RetroArch-Win64"]) {
      push(path.join(`${systemDrive}${path.sep}`, relative), MAX_DISCOVERY_DEPTH);
    }
  }

  // PATH: shallow, but catches scoop/chocolatey shims and manual installs.
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, "");
    if (trimmed) push(trimmed, 0);
  }

  return roots;
}

/** Directories the walk must never descend into. */
const SKIPPED_DIRECTORY_NAMES = new Set([
  "windows",
  "system32",
  "syswow64",
  "node_modules",
  "__macosx",
  "winsxs",
]);

async function walkForExecutables(
  dir: string,
  depth: number,
  maxDepth: number,
  known: KnownExecutable[],
  seen: Set<string>,
  out: DiscoveredEmulator[],
): Promise<void> {
  if (depth > maxDepth) return;
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const lower = entry.name.toLowerCase();
    if (entry.isDirectory()) {
      if (lower.startsWith(".") || SKIPPED_DIRECTORY_NAMES.has(lower)) continue;
      await walkForExecutables(
        path.join(dir, entry.name),
        depth + 1,
        maxDepth,
        known,
        seen,
        out,
      );
    } else if (entry.isFile()) {
      if (process.platform === "win32" && !lower.endsWith(".exe")) continue;
      const hit = known.find((candidate) => candidate.exeLower === lower);
      if (!hit) continue;
      const absolute = path.join(dir, entry.name);
      const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: hit.key,
        name: hit.name,
        platform: hit.platform,
        executablePath: absolute,
        executableName: entry.name,
      });
    }
    if (index % YIELD_EVERY === YIELD_EVERY - 1) {
      await yieldToLoop();
    }
  }
}

/** Scan common install folders + PATH for known emulator executables. */
export async function discoverEmulators(): Promise<DiscoveredEmulator[]> {
  const known = knownExecutables();
  const seen = new Set<string>();
  const found: DiscoveredEmulator[] = [];
  for (const root of discoveryRoots()) {
    await walkForExecutables(root.dir, 0, root.depth, known, seen, found);
  }
  found.sort((left, right) => left.name.localeCompare(right.name));
  return found;
}

function existingDirectories(candidates: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate) continue;
    let resolved: string;
    try {
      resolved = path.resolve(candidate);
      if (!fs.statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  out.sort();
  return out;
}

/**
 * Suggest existing ROM folders near an emulator (sibling `roms` dirs) plus the
 * common per-user roots. `emulatorId` may be empty to get the global list.
 */
export function discoverRomFolders(emulatorId?: string): string[] {
  const candidates: string[] = [];
  const emulator = emulatorId ? getEmulator(emulatorId) : null;
  if (emulatorId && !emulator) throw new Error(`Emulator not found: ${emulatorId}`);

  const emulators = emulator ? [emulator] : listEmulators();
  const relativeNames = [
    "roms",
    "ROMs",
    "games",
    "Games",
    "saves",
    "Saves",
    path.join("roms", "games"),
    path.join("roms", "ROMS"),
  ];

  for (const row of emulators) {
    const executable = row.executablePath.trim();
    if (executable) {
      const executableDir = path.dirname(executable);
      for (const relative of relativeNames) {
        candidates.push(path.join(executableDir, relative));
        candidates.push(path.join(path.dirname(executableDir), relative));
      }
    }
    const romFolder = row.romFolder.trim();
    if (romFolder) {
      const parent = path.dirname(romFolder);
      candidates.push(path.join(parent, "roms"), path.join(parent, "ROMs"));
      candidates.push(romFolder);
    }
    if (row.platform) {
      const home = process.env.USERPROFILE ?? process.env.HOME;
      if (home) {
        candidates.push(path.join(home, "Emulation", "roms", row.platform));
      }
    }
  }

  const home = process.env.USERPROFILE ?? process.env.HOME;
  if (home) {
    for (const relative of [
      "ROMs",
      "roms",
      path.join("Emulation", "roms"),
      path.join("Games", "ROMs"),
      path.join("Documents", "ROMs"),
      path.join(".local", "share", "ROMs"),
    ]) {
      candidates.push(path.join(home, relative));
    }
  }

  return existingDirectories(candidates);
}

// ── Health scan ───────────────────────────────────────────────────────

function finding(
  id: string,
  kind: EmulatorHealthFinding["kind"],
  severity: EmulatorHealthFinding["severity"],
  message: string,
): EmulatorHealthFinding {
  return {
    id,
    kind,
    severity,
    gameIds: [],
    paths: [],
    missingFiles: [],
    message,
  };
}

function forEmulator(
  value: EmulatorHealthFinding,
  id: string,
  name: string,
): EmulatorHealthFinding {
  return {
    ...value,
    id: `${id}:${value.id}`,
    emulatorId: id,
    emulatorName: name,
  };
}

function forGame(
  value: EmulatorHealthFinding,
  game: Game,
  romPath: string,
): EmulatorHealthFinding {
  return {
    ...value,
    id: `${value.id}:${game.id}`,
    gameId: game.id,
    gameName: game.name,
    path: romPath,
  };
}

function summarize(report: EmulatorHealthReport): EmulatorHealthReport {
  for (const item of report.findings) {
    if (item.severity === "error") report.errors += 1;
    else if (item.severity === "warning") report.warnings += 1;
    if (item.kind === "missing_rom" || item.kind === "empty_rom") {
      report.missingRoms += 1;
    } else if (item.kind === "missing_bios") {
      report.missingBios += 1;
    } else if (item.kind === "duplicate_rom") {
      report.duplicateGroups += 1;
      report.reclaimableBytes += item.bytes ?? 0;
    }
  }
  return report;
}

/**
 * Read-only health pass over every configured emulator and its ROM rows.
 * `deep` additionally hashes ROMs that were never hashed (duplicate accuracy
 * at the cost of reading each file once).
 */
export async function healthScan(deep = false): Promise<EmulatorHealthReport> {
  const emulators = listEmulators();
  const roms = listGames().filter((game) => game.emulatorId);
  const report: EmulatorHealthReport = {
    findings: [],
    systems: emulators.length,
    roms: roms.length,
    errors: 0,
    warnings: 0,
    missingRoms: 0,
    missingBios: 0,
    duplicateGroups: 0,
    reclaimableBytes: 0,
    deep,
    checkedAtMs: Date.now(),
  };

  const hashedUpdates: Game[] = [];

  for (const emulator of emulators) {
    const games = roms.filter((game) => game.emulatorId === emulator.id);

    const executable = emulator.executablePath.trim();
    if (!executable) {
      report.findings.push(
        forEmulator(
          {
            ...finding(
              "missing-executable",
              "missing_executable",
              "error",
              `${emulator.name} has no emulator executable configured`,
            ),
            fix: "edit_emulator",
          },
          emulator.id,
          emulator.name,
        ),
      );
    } else {
      let isFile = false;
      try {
        isFile = fs.statSync(executable).isFile();
      } catch {
        isFile = false;
      }
      if (!isFile) {
        report.findings.push(
          forEmulator(
            {
              ...finding(
                "missing-executable",
                "missing_executable",
                "error",
                `Emulator executable not found: ${executable}`,
              ),
              fix: "edit_emulator",
            },
            emulator.id,
            emulator.name,
          ),
        );
      }
    }

    const folder = emulator.romFolder.trim();
    if (!folder) {
      report.findings.push(
        forEmulator(
          {
            ...finding(
              "missing-rom-folder",
              "missing_rom_folder",
              "error",
              `${emulator.name} has no ROM folder configured`,
            ),
            fix: "edit_emulator",
          },
          emulator.id,
          emulator.name,
        ),
      );
    } else {
      let isDir = false;
      try {
        isDir = fs.statSync(folder).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) {
        report.findings.push(
          forEmulator(
            {
              ...finding(
                "missing-rom-folder",
                "missing_rom_folder",
                "error",
                `ROM folder not found: ${folder}`,
              ),
              fix: "edit_emulator",
            },
            emulator.id,
            emulator.name,
          ),
        );
      }
    }

    // Firmware
    if (biosRequirementsFor(emulator.platform).length > 0) {
      const bios = await checkBios(emulator);
      const missing = mandatoryBiosMissing(bios);
      if (!bios.configured) {
        report.findings.push({
          ...forEmulator(
            finding(
              "bios-unconfigured",
              "bios_unconfigured",
              "info",
              `${emulator.name} has firmware requirements but no BIOS folder set`,
            ),
            emulator.id,
            emulator.name,
          ),
          fix: "edit_emulator",
          missingFiles: missing,
        });
      } else if (missing.length > 0) {
        report.findings.push({
          ...forEmulator(
            finding(
              "missing-bios",
              "missing_bios",
              "warning",
              `${emulator.name} is missing mandatory firmware: ${missing.join(", ")}`,
            ),
            emulator.id,
            emulator.name,
          ),
          fix: "edit_emulator",
          missingFiles: missing,
        });
      }
    }

    // ROM rows
    for (let index = 0; index < games.length; index += 1) {
      if (index % 32 === 31) await yieldToLoop();
      const game = games[index];
      const romPath = game.romPath;
      if (!romPath) continue;
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(romPath);
      } catch {
        stat = null;
      }
      if (!stat || !stat.isFile()) {
        report.findings.push(
          forEmulator(
            {
              ...forGame(
                finding(
                  "missing-rom",
                  "missing_rom",
                  "error",
                  `ROM file is missing: ${romPath}`,
                ),
                game,
                romPath,
              ),
              fix: "unlink_rom",
            },
            emulator.id,
            emulator.name,
          ),
        );
        continue;
      }
      if (stat.size === 0) {
        report.findings.push(
          forEmulator(
            {
              ...forGame(
                finding(
                  "empty-rom",
                  "empty_rom",
                  "warning",
                  `ROM file is empty: ${romPath}`,
                ),
                game,
                romPath,
              ),
              fix: "unlink_rom",
            },
            emulator.id,
            emulator.name,
          ),
        );
      }
      if ((game.sizeBytes ?? 0) === 0 && stat.size > 0) {
        report.findings.push(
          forEmulator(
            {
              ...forGame(
                finding(
                  "unknown-size",
                  "unknown_size",
                  "info",
                  `Size was never measured: ${romPath}`,
                ),
                game,
                romPath,
              ),
              fix: "recalc_sizes",
            },
            emulator.id,
            emulator.name,
          ),
        );
      }
    }
    await yieldToLoop();
  }

  // Duplicates (hash on demand for a deep scan, stored hashes otherwise).
  const byHash = new Map<string, Game[]>();
  for (let index = 0; index < roms.length; index += 1) {
    const game = roms[index];
    if (!game.romPath) continue;
    let hash = game.romHash;
    if (!hash && deep) {
      try {
        hash = await hashRomFile(game.romPath, game.sizeBytes);
        hashedUpdates.push({ ...game, romHash: hash });
      } catch {
        hash = undefined;
      }
    }
    if (!hash) continue;
    const list = byHash.get(hash) ?? [];
    list.push({ ...game, romHash: hash });
    byHash.set(hash, list);
    if (index % 16 === 15) await yieldToLoop();
  }
  if (hashedUpdates.length > 0) upsertGames(hashedUpdates);

  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    const size = group.reduce((max, game) => Math.max(max, game.sizeBytes ?? 0), 0);
    report.findings.push({
      id: `duplicate:${hash}`,
      kind: "duplicate_rom",
      severity: "warning",
      gameIds: group.map((game) => game.id),
      paths: group.map((game) => game.romPath).filter((value): value is string => Boolean(value)),
      missingFiles: [],
      message: `Duplicate ROMs: ${group.map((game) => game.name).join(", ")}`,
      fix: "review_duplicates",
      bytes: size * Math.max(0, group.length - 1),
    });
  }

  const severityRank: Record<EmulatorHealthFinding["severity"], number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  report.findings.sort(
    (left, right) => severityRank[left.severity] - severityRank[right.severity],
  );
  return summarize(report);
}
