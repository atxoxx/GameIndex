/**
 * MO2 profile reading and mutation.
 *
 * Ported from `src-tauri/src/mods/mo2.rs` (`get_profile_details`,
 * `set_mods_enabled`, `reorder_mods`, `set_plugin_enabled`,
 * `reorder_plugins`, `switch_profile`, `create_profile`, `delete_profile`).
 *
 * Every rewrite keeps the original comment/blank lines, writes CRLF like MO2,
 * and leaves a `<file>.gameindex-backup` copy behind first.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseIni, writeTextWithBackup } from "./ini";
import { parseInstanceAt } from "./instances";
import type { Mo2Instance, Mo2Mod, Mo2Plugin, Mo2ProfileDetails } from "./types";

export function resolveProfileDir(profilesDir: string, profileName: string): string | null {
  const cleanName = profileName.trim();
  if (!cleanName) return null;
  const direct = path.join(profilesDir, cleanName);
  try {
    if (fs.statSync(direct).isDirectory()) return direct;
  } catch {
    /* fall through to the case-insensitive scan */
  }
  try {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase() === cleanName.toLowerCase()) {
        return path.join(profilesDir, entry.name);
      }
    }
  } catch {
    /* missing profiles folder */
  }
  return null;
}

function instanceFor(instancePath: string): Mo2Instance {
  const instance = parseInstanceAt(path.join(instancePath, "ModOrganizer.ini"), null);
  if (!instance) throw new Error(`Invalid MO2 instance at ${instancePath}`);
  return instance;
}

interface FolderStats {
  mtimeMs: number;
  bytes: number;
  files: number;
}

const folderStatsCache = new Map<string, FolderStats>();

async function walkStats(dir: string, depth: number): Promise<{ bytes: number; files: number }> {
  if (depth > 10) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = path.join(dir, name);
    if (entry.isDirectory()) {
      const nested = await walkStats(full, depth + 1);
      bytes += nested.bytes;
      files += nested.files;
    } else {
      try {
        const stat = await fsp.stat(full);
        bytes += stat.size;
        files += 1;
      } catch {
        /* vanished file: keep the partial sum */
      }
    }
  }
  return { bytes, files };
}

async function folderStats(dir: string): Promise<{ bytes: number; files: number }> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fsp.stat(dir)).mtimeMs;
  } catch {
    return { bytes: 0, files: 0 };
  }
  const cached = folderStatsCache.get(dir);
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  const walked = await walkStats(dir, 0);
  folderStatsCache.set(dir, { mtimeMs, ...walked });
  return walked;
}

interface ModMeta {
  version?: string;
  author?: string;
  nexusModId?: number;
  nexusDomain?: string;
  category?: string;
  url?: string;
}

function parseModMeta(modPath: string): ModMeta {
  const metaFile = path.join(modPath, "meta.ini");
  let content: string;
  try {
    content = fs.readFileSync(metaFile, "utf8");
  } catch {
    return {};
  }
  const general = parseIni(content)["General"] ?? {};
  const version = general["version"] ?? general["newestVersion"];
  const rawId = general["modid"];
  const parsedId = rawId ? Number.parseInt(rawId, 10) : NaN;
  return {
    ...(version ? { version } : {}),
    ...(general["author"] ? { author: general["author"] } : {}),
    ...(Number.isFinite(parsedId) && parsedId > 0 ? { nexusModId: parsedId } : {}),
    ...(general["gameName"] ? { nexusDomain: general["gameName"] } : {}),
    ...(general["category"] ? { category: general["category"] } : {}),
    ...(general["url"] ? { url: general["url"] } : {}),
  };
}

function readModlist(profileDir: string): string[] {
  const modlist = path.join(profileDir, "modlist.txt");
  let content: string;
  try {
    content = fs.readFileSync(modlist, "utf8");
  } catch {
    return [];
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export async function getProfileDetails(
  instancePath: string,
  profileName: string,
): Promise<Mo2ProfileDetails> {
  const instance = instanceFor(instancePath);
  const profileDir = resolveProfileDir(instance.profilesDir, profileName);
  if (!profileDir) {
    throw new Error(`Profile '${profileName}' not found in ${instance.profilesDir}`);
  }

  // modlist.txt stores the *highest* priority first; reverse so index 0 is
  // the lowest priority (the top of MO2's UI).
  const rawLines = readModlist(profileDir).reverse();
  const modsRoot = instance.modsDir;

  const folderPaths = rawLines.map((line) => {
    const modName = line.slice(1);
    const folder = path.join(modsRoot, modName);
    try {
      return fs.statSync(folder).isDirectory() ? folder : null;
    } catch {
      return null;
    }
  });

  const stats = await Promise.all(folderPaths.map((folder) => (folder ? folderStats(folder) : null)));

  const mods: Mo2Mod[] = [];
  let activeCount = 0;
  let currentCategory: string | undefined;

  rawLines.forEach((line, index) => {
    const prefix = line.slice(0, 1);
    const modName = line.slice(1);
    const enabled = prefix === "+";
    const isUnmanaged = prefix === "*";
    const isSeparator = modName.endsWith("_separator");
    const displayName = isSeparator ? modName.slice(0, -"_separator".length) : modName;

    if (isSeparator) currentCategory = displayName;

    const folder = path.join(modsRoot, modName);
    const isFolder = folderPaths[index] !== null;
    const meta = isFolder ? parseModMeta(folder) : {};
    if (enabled && !isSeparator) activeCount += 1;

    const measured = stats[index];
    mods.push({
      id: `mo2mod-${modName.replace(/[\\/: ]/g, "-")}`,
      name: displayName,
      enabled,
      priority: index,
      isSeparator,
      isUnmanaged,
      ...meta,
      category: isSeparator ? displayName : currentCategory ?? meta.category,
      ...(measured ? { sizeBytes: measured.bytes, fileCount: measured.files } : {}),
      path: folder,
    });
  });

  // plugins.txt wins over loadorder.txt (the latter is a fallback for
  // profiles that only carry a load order).
  const pluginsPath = path.join(profileDir, "plugins.txt");
  const loadOrderPath = path.join(profileDir, "loadorder.txt");
  const pluginFile = fs.existsSync(pluginsPath)
    ? pluginsPath
    : fs.existsSync(loadOrderPath)
      ? loadOrderPath
      : null;

  const plugins: Mo2Plugin[] = [];
  let activePlugins = 0;
  if (pluginFile) {
    try {
      const content = fs.readFileSync(pluginFile, "utf8");
      content.split(/\r?\n/).forEach((rawLine, index) => {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) return;
        const enabled = line.startsWith("*");
        const name = enabled ? line.slice(1).trim() : line;
        if (enabled) activePlugins += 1;
        plugins.push({ name, enabled, priority: index });
      });
    } catch {
      /* unreadable plugins file: empty list */
    }
  }

  return {
    instancePath,
    profileName,
    mods,
    plugins,
    activeModCount: activeCount,
    totalModCount: mods.filter((mod) => !mod.isSeparator).length,
    activePluginCount: activePlugins,
    totalPluginCount: plugins.length,
  };
}

// ── Mutations ───────────────────────────────────────────────────────

function writeCrlf(file: string, lines: string[]): void {
  writeTextWithBackup(file, `${lines.join("\r\n")}\r\n`);
}

/** Split on CRLF/LF without inventing a trailing empty line. */
function contentLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function setModsEnabled(
  instancePath: string,
  profileName: string,
  updates: Record<string, boolean>,
): void {
  if (Object.keys(updates).length === 0) return;
  const instance = instanceFor(instancePath);
  const profileDir = resolveProfileDir(instance.profilesDir, profileName);
  if (!profileDir) throw new Error(`Profile '${profileName}' not found in ${instance.profilesDir}`);
  const modlistPath = path.join(profileDir, "modlist.txt");
  if (!fs.existsSync(modlistPath)) throw new Error("modlist.txt does not exist for this profile");

  const content = fs.readFileSync(modlistPath, "utf8");
  const lines: string[] = [];
  let modified = false;

  for (const line of contentLines(content)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }
    const name = trimmed.slice(1);
    const separatorName = `${name}_separator`;
    const bareName = name.endsWith("_separator") ? name.slice(0, -"_separator".length) : name;
    const target = updates[name] ?? updates[separatorName] ?? updates[bareName];
    if (target === undefined) {
      lines.push(line);
      continue;
    }
    lines.push(`${target ? "+" : "-"}${name}`);
    modified = true;
  }

  if (!modified) throw new Error("None of the specified mods were found in modlist.txt");
  writeCrlf(modlistPath, lines);
}

export function setModEnabled(
  instancePath: string,
  profileName: string,
  modName: string,
  enabled: boolean,
): void {
  setModsEnabled(instancePath, profileName, { [modName]: enabled });
}

export function reorderMods(
  instancePath: string,
  profileName: string,
  orderedModNames: string[],
): void {
  const instance = instanceFor(instancePath);
  const profileDir = resolveProfileDir(instance.profilesDir, profileName);
  if (!profileDir) throw new Error(`Profile '${profileName}' not found in ${instance.profilesDir}`);
  const modlistPath = path.join(profileDir, "modlist.txt");
  if (!fs.existsSync(modlistPath)) throw new Error("modlist.txt does not exist for this profile");

  const content = fs.readFileSync(modlistPath, "utf8");
  const prefixMap = new Map<string, string>();
  const headerLines: string[] = [];

  for (const line of contentLines(content)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      headerLines.push(line);
      continue;
    }
    const prefix = trimmed.slice(0, 1);
    const name = trimmed.slice(1);
    prefixMap.set(name, prefix);
    if (name.endsWith("_separator")) {
      prefixMap.set(name.slice(0, -"_separator".length), prefix);
    }
  }

  const resultLines = [...headerLines];
  for (const name of [...orderedModNames].reverse()) {
    const prefix = prefixMap.get(name) ?? "+";
    const fullName =
      !name.endsWith("_separator") && prefixMap.has(`${name}_separator`)
        ? `${name}_separator`
        : name;
    resultLines.push(`${prefix}${fullName}`);
  }

  writeCrlf(modlistPath, resultLines);
}

export function setPluginEnabled(
  instancePath: string,
  profileName: string,
  pluginName: string,
  enabled: boolean,
): void {
  const instance = instanceFor(instancePath);
  const profileDir = resolveProfileDir(instance.profilesDir, profileName);
  if (!profileDir) throw new Error(`Profile '${profileName}' not found in ${instance.profilesDir}`);
  const pluginsPath = path.join(profileDir, "plugins.txt");
  if (!fs.existsSync(pluginsPath)) throw new Error("plugins.txt does not exist for this profile");

  const content = fs.readFileSync(pluginsPath, "utf8");
  const lines: string[] = [];
  let modified = false;

  for (const line of contentLines(content)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }
    const active = trimmed.startsWith("*");
    const currentName = active ? trimmed.slice(1).trim() : trimmed;
    if (currentName.toLowerCase() === pluginName.toLowerCase()) {
      lines.push(enabled ? `*${currentName}` : currentName);
      modified = true;
    } else {
      lines.push(line);
    }
  }

  if (!modified) throw new Error(`Plugin '${pluginName}' not found in plugins.txt`);
  writeCrlf(pluginsPath, lines);
}

export function reorderPlugins(
  instancePath: string,
  profileName: string,
  orderedPluginNames: string[],
): void {
  const instance = instanceFor(instancePath);
  const profileDir = resolveProfileDir(instance.profilesDir, profileName);
  if (!profileDir) throw new Error(`Profile '${profileName}' not found in ${instance.profilesDir}`);
  const pluginsPath = path.join(profileDir, "plugins.txt");
  if (!fs.existsSync(pluginsPath)) throw new Error("plugins.txt does not exist for this profile");

  const content = fs.readFileSync(pluginsPath, "utf8");
  const statusMap = new Map<string, boolean>();
  const headerLines: string[] = [];

  for (const line of contentLines(content)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      headerLines.push(line);
      continue;
    }
    const active = trimmed.startsWith("*");
    const name = active ? trimmed.slice(1).trim() : trimmed;
    statusMap.set(name.toLowerCase(), active);
  }

  const resultLines = [...headerLines];
  for (const name of orderedPluginNames) {
    const active = statusMap.get(name.toLowerCase()) ?? true;
    resultLines.push(active ? `*${name}` : name);
  }
  writeCrlf(pluginsPath, resultLines);
}

export function switchProfile(instancePath: string, profileName: string): void {
  const cleanProfile = profileName.trim();
  const iniPath = path.join(instancePath, "ModOrganizer.ini");
  if (!fs.existsSync(iniPath)) throw new Error(`ModOrganizer.ini not found at ${instancePath}`);
  const content = fs.readFileSync(iniPath, "utf8");

  const lines: string[] = [];
  let inGeneral = false;
  let replaced = false;

  for (const line of contentLines(content)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inGeneral = trimmed.toLowerCase() === "[general]";
    }
    const eq = trimmed.indexOf("=");
    const key = eq >= 0 ? trimmed.slice(0, eq).trim() : "";
    if (inGeneral && key === "selected_profile") {
      lines.push(`selected_profile = ${cleanProfile}`);
      replaced = true;
    } else {
      lines.push(line);
    }
  }

  if (!replaced) {
    const header = lines.findIndex((line) => line.trim().toLowerCase() === "[general]");
    if (header < 0) {
      throw new Error(`ModOrganizer.ini at ${iniPath} has no [General] section`);
    }
    lines.splice(header + 1, 0, `selected_profile = ${cleanProfile}`);
  }

  writeCrlf(iniPath, lines);
}

function getInstanceProfilesDir(instancePath: string): string {
  const iniPath = path.join(instancePath, "ModOrganizer.ini");
  if (!fs.existsSync(iniPath)) throw new Error(`ModOrganizer.ini not found at ${instancePath}`);
  const content = fs.readFileSync(iniPath, "utf8");
  const ini = parseIni(content);
  const baseRaw = ini["Settings"]?.["base_directory"] ?? ini["General"]?.["base_directory"] ?? "";
  const baseTrimmed = baseRaw.replace(/[\\/]+$/, "");
  const expandedBase = baseTrimmed.replace(/%BASE_DIR%/g, instancePath);
  const baseDir = !expandedBase
    ? instancePath
    : path.isAbsolute(expandedBase)
      ? expandedBase
      : path.join(instancePath, expandedBase);
  const raw = (ini["Settings"]?.["profiles_directory"] ?? ini["General"]?.["profiles_directory"] ?? "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();
  if (!raw) return path.join(baseDir, "profiles");
  const expanded = raw.replace(/%BASE_DIR%/g, baseDir);
  return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
}

export function createProfile(
  instancePath: string,
  profileName: string,
  cloneFrom?: string | null,
): void {
  const cleanName = profileName.trim();
  if (!cleanName) throw new Error("Profile name cannot be empty");
  if (/[\\/:*?"<>|]/.test(cleanName)) throw new Error("Profile name contains invalid characters");

  const profilesDir = getInstanceProfilesDir(instancePath);
  const targetDir = path.join(profilesDir, cleanName);
  if (fs.existsSync(targetDir)) throw new Error(`Profile '${cleanName}' already exists`);

  fs.mkdirSync(targetDir, { recursive: true });

  const source = cloneFrom?.trim();
  if (source) {
    const sourceDir = path.join(profilesDir, source);
    try {
      for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
      }
    } catch {
      /* cloning is best-effort, matching the Rust profile creator */
    }
  } else {
    fs.writeFileSync(
      path.join(targetDir, "modlist.txt"),
      "# This file was automatically generated by Mod Organizer\r\n",
      "utf8",
    );
  }
}

export function deleteProfile(instancePath: string, profileName: string): void {
  const cleanName = profileName.trim();
  if (!cleanName) throw new Error("Profile name cannot be empty");
  if (cleanName.toLowerCase() === "default") throw new Error("Cannot delete the Default profile");

  const iniPath = path.join(instancePath, "ModOrganizer.ini");
  if (fs.existsSync(iniPath)) {
    const ini = parseIni(fs.readFileSync(iniPath, "utf8"));
    const selected = ini["General"]?.["selected_profile"];
    if (selected && selected.toLowerCase() === cleanName.toLowerCase()) {
      throw new Error(
        `Cannot delete active profile '${cleanName}'. Please switch to another profile first.`,
      );
    }
  }

  const profilesDir = getInstanceProfilesDir(instancePath);
  const targetDir = path.join(profilesDir, cleanName);
  if (!fs.existsSync(targetDir)) throw new Error(`Profile '${cleanName}' does not exist`);
  fs.rmSync(targetDir, { recursive: true, force: true });
}
