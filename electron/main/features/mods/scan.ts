/**
 * Engine-aware mod detection.
 *
 * Ported from `src-tauri/src/mods/detect.rs`. Detection is read-only: it
 * identifies which modding "engines" an install uses and enumerates the mods
 * each one carries (Bethesda plugins, BepInEx/MelonLoader DLLs, Unreal paks,
 * Steam Workshop items and loose `Mods/` folders). The custom-root scan is
 * layered on top and wins the "Open mods folder" target.
 *
 * Differences from the Rust scanner, both deliberate:
 *  - Workshop title enrichment through Steam's Web API is not ported (the
 *    scanner stays offline); items fall back to manifest names or `Workshop #id`.
 *  - Folder sizing awaits between entries instead of blocking.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  findSteamInstallDir,
  parseLibraryFolders,
} from "../launch/steam";
import { detectMo2Instances } from "../mo2/instances";
import type { ModRow } from "./types";
import { scanPluginsTxtStarFormat } from "./pluginsFormat";
import { dirStats, isDir, isFile, modIdFor, nowSecs, stripDisabled } from "./util";

export interface ScanOutcome {
  mods: ModRow[];
  filesExamined: number;
  truncated: boolean;
  engines: string[];
  modsRoot?: string;
  pluginsTxt?: string;
  nexusDomain?: string;
}

export interface ScanOptions {
  gameId: string;
  gamePath: string;
  steamAppId?: string | null;
  customRoot?: string | null;
  isCancelled?: () => boolean;
  onProgress?: (filesExamined: number, modsFound: number) => void;
}

function baseRow(
  gameId: string,
  name: string,
  engine: string,
  kind: string,
  filePath: string,
  enabled: boolean,
): ModRow {
  const now = nowSecs();
  return {
    id: modIdFor(gameId, filePath),
    gameId,
    name,
    engine,
    kind,
    path: filePath,
    enabled,
    loadOrder: 0,
    updateAvailable: false,
    detectedAt: now,
    updatedAt: now,
  };
}

function fileSize(file: string): number | undefined {
  try {
    return fs.statSync(file).size;
  } catch {
    return undefined;
  }
}

// === Bethesda =======================================================

interface BethesdaProfile {
  localFolder: string;
  nexusDomain: string;
}

const BETHESDA_TABLE: Array<{ exes: string[]; folder: string; domain: string }> = [
  { exes: ["skyrimse.exe", "skse64_loader.exe"], folder: "Skyrim Special Edition", domain: "skyrimspecialedition" },
  { exes: ["skyrimvr.exe"], folder: "Skyrim VR", domain: "skyrimspecialedition" },
  { exes: ["tesv.exe", "skse_loader.exe"], folder: "Skyrim", domain: "skyrim" },
  { exes: ["fallout4.exe", "f4se_loader.exe"], folder: "Fallout4", domain: "fallout4" },
  { exes: ["fallout4vr.exe"], folder: "Fallout4VR", domain: "fallout4" },
  { exes: ["falloutnv.exe", "nvse_loader.exe"], folder: "FalloutNV", domain: "newvegas" },
  { exes: ["fallout3.exe", "fose_loader.exe"], folder: "Fallout3", domain: "fallout3" },
  { exes: ["oblivion.exe", "obse_loader.exe"], folder: "Oblivion", domain: "oblivion" },
  { exes: ["starfield.exe", "sfse_loader.exe"], folder: "Starfield", domain: "starfield" },
];

function bethesdaProfileForExe(exeLower: string): BethesdaProfile | null {
  for (const entry of BETHESDA_TABLE) {
    if (entry.exes.includes(exeLower)) {
      return { localFolder: entry.folder, nexusDomain: entry.domain };
    }
  }
  return null;
}

/** Legacy (pre-SSE) plugins.txt lists only enabled plugins (no `*`). */
export function pluginsTxtIsStarFormat(pluginsTxt: string): boolean {
  return scanPluginsTxtStarFormat(pluginsTxt);
}

const VANILLA_PLUGINS = new Set([
  "skyrim.esm", "update.esm", "dawnguard.esm", "hearthfires.esm", "dragonborn.esm",
  "_resourcepack.esl",
  "fallout4.esm", "dlcrobot.esm", "dlcworkshop01.esm", "dlcworkshop02.esm",
  "dlcworkshop03.esm", "dlccoast.esm", "dlcnukaworld.esm", "dlcultrahighresolution.esm",
  "falloutnv.esm", "deadmoney.esm", "honesthearts.esm", "oldworldblues.esm",
  "lonesomeroad.esm", "gunrunnersarsenal.esm", "caravanpack.esm", "classicpack.esm",
  "mercenarypack.esm", "tribalpack.esm",
  "fallout3.esm", "anchorage.esm", "thepitt.esm", "brokensteel.esm",
  "pointlookout.esm", "zeta.esm",
  "oblivion.esm", "knights.esp", "dlcshiveringisles.esp", "dlcbattlehorncastle.esp",
  "dlcfrostcrag.esp", "dlchorsearmor.esp", "dlcmehrunesrazor.esp", "dlcorrery.esp",
  "dlcspelltomes.esp", "dlcthievesden.esp", "dlcvilelair.esp",
  "starfield.esm", "constellation.esm", "oldmars.esm", "blueprintships-starfield.esm",
  "sfbgs003.esm", "sfbgs004.esm", "sfbgs006.esm", "sfbgs007.esm", "sfbgs008.esm",
]);

function isVanillaPlugin(lowerName: string): boolean {
  return lowerName.startsWith("cc") || VANILLA_PLUGINS.has(lowerName);
}

/** `filename(lower) -> [enabled, position]`. */
export function parsePluginsTxt(file: string): Map<string, [boolean, number]> {
  const out = new Map<string, [boolean, number]>();
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const starFormat = pluginsTxtIsStarFormat(file);
  let position = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let enabled: boolean;
    let name: string;
    if (line.startsWith("*")) {
      enabled = true;
      name = line.slice(1).trim();
    } else {
      enabled = !starFormat;
      name = line;
    }
    out.set(name.toLowerCase(), [enabled, position]);
    position += 1;
  }
  return out;
}

async function scanBethesda(
  gameId: string,
  gameDir: string,
  exeLower: string,
  out: ScanOutcome,
): Promise<void> {
  const data = path.join(gameDir, "Data");
  if (!isDir(data)) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(data, { withFileTypes: true });
  } catch {
    return;
  }
  const pluginFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(data, entry.name))
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      if (![".esp", ".esm", ".esl"].includes(ext)) return false;
      return !isVanillaPlugin(path.basename(file).toLowerCase());
    });
  if (pluginFiles.length === 0) return;

  const profile = bethesdaProfileForExe(exeLower);
  let pluginsTxt: string | null = null;
  const localAppData = process.env.LOCALAPPDATA;
  if (profile && localAppData) {
    pluginsTxt = path.join(localAppData, profile.localFolder, "Plugins.txt");
  }

  // An MO2 instance with a positive relevance owns the active plugins.txt.
  try {
    const instances = await detectMo2Instances(gameDir, "");
    const best = instances.find((instance) => instance.relevance > 0);
    if (best) {
      const candidate = path.join(best.profilesDir, best.selectedProfile, "plugins.txt");
      if (isFile(candidate)) pluginsTxt = candidate;
    }
  } catch {
    /* MO2 detection is an enhancement, never a blocker */
  }

  const state = pluginsTxt && isFile(pluginsTxt) ? parsePluginsTxt(pluginsTxt) : new Map();
  const hasState = state.size > 0;

  const rows: ModRow[] = pluginFiles.map((file) => {
    const fname = path.basename(file);
    const stem = path.basename(file, path.extname(file));
    const entry = state.get(fname.toLowerCase());
    const enabled = entry ? entry[0] : !hasState;
    const order = entry ? entry[1] : Number.MAX_SAFE_INTEGER;
    const row = baseRow(gameId, stem, "bethesda", "plugin", file, enabled);
    row.loadOrder = order;
    const size = fileSize(file);
    if (size !== undefined) row.sizeBytes = size;
    row.fileCount = 1;
    return row;
  });
  rows.sort(
    (a, b) => a.loadOrder - b.loadOrder || a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );

  if (!out.engines.includes("bethesda")) out.engines.push("bethesda");
  out.modsRoot ??= data;
  if (pluginsTxt) out.pluginsTxt ??= pluginsTxt;
  if (profile) out.nexusDomain ??= profile.nexusDomain;
  out.mods.push(...rows);
}

// === Loose-folder engines ===========================================

async function scanLooseFolder(
  gameId: string,
  dir: string,
  engine: string,
  dllOnly: boolean,
): Promise<ModRow[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const rows: ModRow[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const { visible, disabled } = stripDisabled(entry.name);
    if (entry.isDirectory()) {
      const name = path.basename(visible) || visible;
      const { bytes, files } = await dirStats(full);
      const row = baseRow(gameId, name, engine, "folder", full, !disabled);
      row.sizeBytes = bytes;
      row.fileCount = files;
      rows.push(row);
      continue;
    }
    const lower = visible.toLowerCase();
    const isDll = lower.endsWith(".dll");
    if (dllOnly && !isDll) continue;
    if (!dllOnly && !isDll && lower.endsWith(".txt")) continue;
    const stem = path.basename(visible, path.extname(visible));
    const row = baseRow(gameId, stem, engine, isDll ? "dll" : "file", full, !disabled);
    const size = fileSize(full);
    if (size !== undefined) row.sizeBytes = size;
    row.fileCount = 1;
    rows.push(row);
  }
  return rows;
}

async function scanBepinex(gameId: string, gameDir: string, out: ScanOutcome): Promise<void> {
  const plugins = path.join(gameDir, "BepInEx", "plugins");
  if (!isDir(plugins)) return;
  const rows = await scanLooseFolder(gameId, plugins, "bepinex", true);
  if (!out.engines.includes("bepinex")) out.engines.push("bepinex");
  out.modsRoot ??= plugins;
  out.mods.push(...rows);
}

async function scanMelonLoader(gameId: string, gameDir: string, out: ScanOutcome): Promise<void> {
  const mods = path.join(gameDir, "Mods");
  if (!isDir(path.join(gameDir, "MelonLoader")) || !isDir(mods)) return;
  const rows = await scanLooseFolder(gameId, mods, "melonloader", true);
  if (!out.engines.includes("melonloader")) out.engines.push("melonloader");
  out.modsRoot ??= mods;
  out.mods.push(...rows);
}

async function scanGeneric(gameId: string, gameDir: string, out: ScanOutcome): Promise<void> {
  if (out.engines.includes("melonloader")) return;
  for (const candidate of ["Mods", "mods"]) {
    const dir = path.join(gameDir, candidate);
    if (!isDir(dir)) continue;
    const rows = await scanLooseFolder(gameId, dir, "generic", false);
    if (rows.length === 0) continue;
    if (!out.engines.includes("generic")) out.engines.push("generic");
    out.modsRoot ??= dir;
    out.mods.push(...rows);
    break;
  }
}

// === Unreal Engine ==================================================

function findPaksDir(gameDir: string): string | null {
  const roots: string[] = [gameDir];
  let current = gameDir;
  for (let i = 0; i < 3; i += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    roots.push(parent);
    current = parent;
  }
  for (const root of roots) {
    const direct = path.join(root, "Content", "Paks");
    if (isDir(direct)) return direct;
    let entries: import("node:fs").Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const paks = path.join(root, entry.name, "Content", "Paks");
      if (isDir(paks)) return paks;
    }
  }
  return null;
}

async function scanUnreal(gameId: string, gameDir: string, out: ScanOutcome): Promise<void> {
  const paks = findPaksDir(gameDir);
  if (!paks) return;
  const rows: ModRow[] = [];
  let root: string | null = null;

  for (const sub of ["~mods", "LogicMods", "Mods"]) {
    const dir = path.join(paks, sub);
    if (!isDir(dir)) continue;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const { visible, disabled } = stripDisabled(entry.name);
      if (!visible.toLowerCase().endsWith(".pak")) continue;
      const stem = path.basename(visible, ".pak");
      const row = baseRow(gameId, stem, "unreal", "pak", full, !disabled);
      let bytes = fileSize(full) ?? 0;
      let count = 1;
      for (const ext of [".ucas", ".utoc"]) {
        const sibling = path.join(path.dirname(full), `${path.basename(full, path.extname(full))}${ext}`);
        const size = fileSize(sibling);
        if (size !== undefined) {
          bytes += size;
          count += 1;
        }
      }
      row.sizeBytes = bytes;
      row.fileCount = count;
      rows.push(row);
    }
    root ??= dir;
  }

  if (rows.length === 0) return;
  if (!out.engines.includes("unreal")) out.engines.push("unreal");
  out.modsRoot ??= root ?? undefined;
  out.mods.push(...rows);
}

// === Steam Workshop =================================================

function workshopItemName(dir: string): string | null {
  try {
    const about = fs.readFileSync(path.join(dir, "About", "About.xml"), "utf8");
    const match = /<name>\s*([\s\S]*?)\s*<\/name>/i.exec(about);
    if (match && match[1].trim()) return match[1].trim();
  } catch {
    /* no About.xml */
  }
  for (const candidate of ["descriptor.mod", "mod.mod"]) {
    try {
      const text = fs.readFileSync(path.join(dir, candidate), "utf8");
      const match = /^\s*name\s*=\s*"(.*?)"/m.exec(text);
      if (match) return match[1];
    } catch {
      /* not a Paradox mod */
    }
  }
  for (const candidate of ["modinfo.json", "mod.info", "info.json", "manifest.json", "mod.json"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, candidate), "utf8")) as Record<
        string,
        unknown
      >;
      for (const key of ["name", "Name", "title", "Title", "displayName"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      /* not JSON */
    }
  }
  return null;
}

async function scanWorkshop(
  gameId: string,
  gamePath: string,
  steamAppId: string | null,
  out: ScanOutcome,
): Promise<void> {
  const appId = steamAppId?.trim();
  if (!appId) return;

  const candidates: string[] = [];
  let current = path.resolve(gamePath);
  for (;;) {
    if (path.basename(current).toLowerCase() === "steamapps") {
      candidates.push(path.join(current, "workshop", "content", appId));
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  try {
    const steamRoot = await findSteamInstallDir();
    if (steamRoot) {
      candidates.push(path.join(steamRoot, "steamapps", "workshop", "content", appId));
      try {
        const raw = fs.readFileSync(path.join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8");
        for (const library of parseLibraryFolders(raw)) {
          candidates.push(path.join(library, "steamapps", "workshop", "content", appId));
        }
      } catch {
        /* no secondary libraries */
      }
    }
  } catch {
    /* Steam not installed */
  }

  const seen = new Set<string>();
  const contentDirs = candidates.filter((dir) => {
    if (!isDir(dir)) return false;
    const key = dir.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (contentDirs.length === 0) return;

  const rows: ModRow[] = [];
  let primaryRoot: string | undefined;

  for (const contentDir of contentDirs) {
    primaryRoot ??= contentDir;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(contentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(contentDir, entry.name);
      const { visible: itemId, disabled } = stripDisabled(entry.name);
      if (!itemId) continue;
      const name = workshopItemName(full) ?? `Workshop #${itemId}`;
      const { bytes, files } = await dirStats(full);
      const row = baseRow(gameId, name, "workshop", "folder", full, !disabled);
      row.sizeBytes = bytes;
      row.fileCount = files;
      row.notes = `workshop:${itemId}`;
      rows.push(row);
    }
  }

  if (rows.length === 0) return;
  if (!out.engines.includes("workshop")) out.engines.push("workshop");
  out.modsRoot ??= primaryRoot;
  out.mods.push(...rows);
}

// === Entry point ====================================================

async function scanCustomRoot(gameId: string, root: string, out: ScanOutcome): Promise<void> {
  if (!isDir(root)) return;
  const rows = await scanLooseFolder(gameId, root, "generic", false);
  if (!out.engines.includes("generic")) out.engines.push("generic");
  out.modsRoot = root;
  out.mods.push(...rows);
}

export async function scanGame(options: ScanOptions): Promise<ScanOutcome> {
  const gamePath = options.gamePath?.trim() ?? "";
  const customRoot = options.customRoot?.trim() || null;
  const exe = path.resolve(gamePath || ".");
  const gameDir = gamePath ? (isDir(exe) ? exe : isDir(path.dirname(exe)) ? path.dirname(exe) : null) : null;
  if (!gameDir && !customRoot) {
    throw new Error(`game folder not found for '${gamePath}'`);
  }
  const exeLower = gamePath ? path.basename(exe).toLowerCase() : "";

  const out: ScanOutcome = {
    mods: [],
    filesExamined: 0,
    truncated: false,
    engines: [],
  };

  const cancelled = () => options.isCancelled?.() === true;

  if (gameDir) {
    if (cancelled()) throw new Error("scan_cancelled: scan was cancelled");
    await scanBethesda(options.gameId, gameDir, exeLower, out);
    await scanBepinex(options.gameId, gameDir, out);
    await scanMelonLoader(options.gameId, gameDir, out);
    await scanUnreal(options.gameId, gameDir, out);
    await scanGeneric(options.gameId, gameDir, out);
    await scanWorkshop(options.gameId, exe, options.steamAppId ?? null, out);
    if (cancelled()) throw new Error("scan_cancelled: scan was cancelled");
  }
  if (customRoot) await scanCustomRoot(options.gameId, customRoot, out);

  // A custom root may overlap an auto-detected folder; ids are path-stable.
  const seen = new Set<string>();
  out.mods = out.mods.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  out.filesExamined = out.mods.reduce((sum, row) => sum + Math.max(row.fileCount ?? 1, 1), 0);
  out.truncated = out.filesExamined >= 20_000;
  out.mods.forEach((row, index) => {
    row.loadOrder = index;
  });

  options.onProgress?.(out.filesExamined, out.mods.length);
  return out;
}
