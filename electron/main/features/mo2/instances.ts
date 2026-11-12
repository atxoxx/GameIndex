/**
 * Mod Organizer 2 instance discovery and resolution.
 *
 * Ported from `src-tauri/src/mods/mo2.rs`: the INI/path resolvers, relevance
 * scoring and the portable/global scans are the same algorithm. The Electron
 * port additionally probes the MO2 instance registry keys the Tauri build did
 * not read (`HKCU`/`HKLM\Software\Mod Organizer 2`), which is where a global
 * install records instances that live outside `%LOCALAPPDATA%\ModOrganizer`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseIni, type IniMap } from "./ini";
import type { Mo2Executable, Mo2Instance } from "./types";

export function normalizePathStr(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Component-aware ancestor test, so `c:/mo2` never matches `c:/mo2game`. */
export function pathIsAncestorOrSame(a: string, b: string): boolean {
  const left = normalizePathStr(a);
  const right = normalizePathStr(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    const fromEnv = process.env[name];
    return fromEnv !== undefined ? fromEnv : match;
  });
}

function parseBaseDir(ini: IniMap, instanceDir: string): string {
  let raw = ini["Settings"]?.["base_directory"] ?? ini["General"]?.["base_directory"] ?? "";
  raw = raw.trim().replace(/^"+|"+$/g, "").replace(/[\\/]+$/, "");
  if (!raw) return instanceDir;
  const expanded = raw.replace(/%BASE_DIR%/g, instanceDir);
  const resolved = path.isAbsolute(expanded) ? expanded : path.join(instanceDir, expanded);
  return path.normalize(resolved);
}

function resolveMo2Dir(baseDir: string, raw: string, fallbackSub: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return path.join(baseDir, fallbackSub);
  const expanded = cleaned.replace(/%BASE_DIR%/g, baseDir);
  return path.normalize(path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded));
}

function settingRaw(ini: IniMap, keys: string[]): string {
  for (const section of ["Settings", "General"]) {
    const values = ini[section];
    if (!values) continue;
    for (const key of keys) {
      const raw = values[key];
      if (raw !== undefined && raw.trim()) return raw.trim().replace(/^"+|"+$/g, "").trim();
    }
  }
  return "";
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate `ModOrganizer.exe`: the caller's hint when it is a real file, then the
 * instance folder, then the usual install locations.
 */
export function findMoExe(instanceDir: string, hint: string | null): string | undefined {
  if (hint && isFile(hint)) return hint;
  const sameDir = path.join(instanceDir, "ModOrganizer.exe");
  if (isFile(sameDir)) return sameDir;

  const candidates: string[] = [];
  for (const variable of ["ProgramFiles", "ProgramFiles(x86)"]) {
    const root = process.env[variable];
    if (root) candidates.push(path.join(root, "Mod Organizer 2", "ModOrganizer.exe"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "Programs", "Mod Organizer 2", "ModOrganizer.exe"));
  }
  candidates.push(
    "C:\\Modding\\MO2\\ModOrganizer.exe",
    "C:\\Mod Organizer 2\\ModOrganizer.exe",
    "D:\\Modding\\MO2\\ModOrganizer.exe",
    "D:\\Mod Organizer 2\\ModOrganizer.exe",
  );
  return candidates.find(isFile);
}

/** Available profile directory names, sorted case-insensitively. */
function listProfiles(profilesDir: string): string[] {
  const names: string[] = [];
  try {
    for (const entry of fs.readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.push(entry.name);
    }
  } catch {
    /* missing profiles folder: empty list */
  }
  names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return names;
}

function parseCustomExecutables(
  ini: IniMap,
  baseDir: string,
  gamePath: string | undefined,
): Mo2Executable[] {
  const section = ini["customExecutables"];
  if (!section) return [];
  const size = Number.parseInt(section["size"] ?? "0", 10);
  const limit = Math.max(Number.isFinite(size) ? size : 0, 30);
  const out: Mo2Executable[] = [];

  for (let i = 1; i <= limit; i += 1) {
    const title = section[`${i}\\title`];
    let rawPath = section[`${i}\\binary`] ?? section[`${i}\\custom`];
    if (!title || !rawPath || !title.trim() || !rawPath.trim()) continue;
    rawPath = rawPath.trim();
    if (rawPath.includes("%BASE_DIR%")) rawPath = rawPath.replace(/%BASE_DIR%/g, baseDir);
    if (gamePath && rawPath.includes("%GAME_PATH%")) {
      rawPath = rawPath.replace(/%GAME_PATH%/g, gamePath);
    }
    if (!path.isAbsolute(rawPath) && gamePath) {
      const candidate = path.join(gamePath, rawPath);
      if (fs.existsSync(candidate)) rawPath = candidate;
    }
    const args = section[`${i}\\arguments`];
    out.push({
      title: title.trim(),
      path: rawPath,
      ...(args && args.trim() ? { arguments: args } : {}),
    });
  }
  return out;
}

/** Parse one `ModOrganizer.ini` into an instance model, or `null`. */
export function parseInstanceAt(iniPath: string, moExeHint: string | null): Mo2Instance | null {
  if (!isFile(iniPath)) return null;
  let content: string;
  try {
    content = fs.readFileSync(iniPath, "utf8");
  } catch {
    return null;
  }
  const ini = parseIni(content);
  if (!ini["General"] && !ini["Settings"]) return null;

  const instanceDir = path.dirname(iniPath);
  const baseDir = parseBaseDir(ini, instanceDir);

  const modsDir = resolveMo2Dir(
    baseDir,
    settingRaw(ini, ["mod_directory", "mods_directory"]),
    "mods",
  );
  const profilesDir = resolveMo2Dir(baseDir, settingRaw(ini, ["profiles_directory"]), "profiles");
  const overwriteDir = resolveMo2Dir(
    baseDir,
    settingRaw(ini, ["overwrite_directory"]),
    "overwrite",
  );

  const general = ini["General"];
  const gameName = general?.["gameName"]?.trim() || undefined;
  const gamePath = general?.["gamePath"]?.trim() || undefined;
  const rawSelected = general?.["selected_profile"]?.trim() || "Default";

  const moExePath = findMoExe(instanceDir, moExeHint);
  const isPortable =
    !!moExePath && normalizePathStr(path.dirname(moExePath)) === normalizePathStr(instanceDir);

  const profiles = listProfiles(profilesDir);
  if (profiles.length === 0) profiles.push(rawSelected);
  const selectedProfile =
    profiles.find((name) => name.toLowerCase() === rawSelected.toLowerCase()) ?? rawSelected;

  const customExecutables = parseCustomExecutables(ini, baseDir, gamePath);

  const name = isPortable ? gameName ?? "Portable MO2" : path.basename(instanceDir) || "Mod Organizer 2";

  return {
    id: `mo2-${instanceDir.replace(/[\\/:]/g, "-")}`,
    name,
    instancePath: instanceDir,
    ...(moExePath ? { moExePath } : {}),
    isPortable,
    ...(gameName ? { gameName } : {}),
    ...(gamePath ? { gamePath } : {}),
    modsDir,
    profilesDir,
    overwriteDir,
    selectedProfile,
    profiles,
    customExecutables,
    relevance: 0,
  };
}

function isNamed(candidate: string, name: string): boolean {
  return path.basename(candidate).toLowerCase() === name.toLowerCase();
}

/**
 * Resolve a user-picked folder, `ModOrganizer.ini` or `ModOrganizer.exe`.
 * Machine-wide detection is never a fallback: a picked folder either resolves
 * or the command fails with a clear message.
 */
export function resolveInstanceAt(rawPath: string): Mo2Instance {
  const raw = rawPath.trim().replace(/^"+|"+$/g, "").trim();
  const notFound = () =>
    new Error(
      `No ModOrganizer.ini found in "${raw}" or its parent folders — pick the folder that contains ModOrganizer.ini`,
    );
  if (!raw) throw notFound();

  if (isFile(raw) && isNamed(raw, "ModOrganizer.ini")) {
    const instance = parseInstanceAt(raw, path.join(path.dirname(raw), "ModOrganizer.exe"));
    if (instance) return instance;
    throw new Error(`Found "${raw}" but it could not be read as a Mod Organizer 2 instance`);
  }

  let start: string | null = null;
  if (isFile(raw)) start = path.dirname(raw);
  else if (isDirectory(raw)) start = raw;
  if (!start) throw notFound();

  let current: string | null = start;
  let depth = 0;
  while (current) {
    const ini = path.join(current, "ModOrganizer.ini");
    if (isFile(ini)) {
      const hint =
        isFile(raw) && isNamed(raw, "ModOrganizer.exe")
          ? raw
          : path.join(current, "ModOrganizer.exe");
      const instance = parseInstanceAt(ini, hint);
      if (instance) return instance;
      throw new Error(`Found "${ini}" but it could not be read as a Mod Organizer 2 instance`);
    }
    if (depth >= 4) break;
    const parent = path.dirname(current);
    current = parent === current ? null : parent;
    depth += 1;
  }

  throw notFound();
}

// ── Registry discovery ──────────────────────────────────────────────

const REGISTRY_KEYS = [
  "HKCU\\Software\\Mod Organizer 2",
  "HKLM\\Software\\Mod Organizer 2",
  "HKLM\\Software\\WOW6432Node\\Mod Organizer 2",
];

function runRegQuery(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", key, "/s"],
      { timeout: 2_500, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : String(stdout)),
    );
  });
}

function pathsFromRegistryOutput(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /(REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+(.+)$/.exec(line);
    if (!match) continue;
    const value = expandEnv(match[2].trim().replace(/^"+|"+$/g, ""));
    if (!value) continue;
    if (isFile(value) && isNamed(value, "ModOrganizer.ini")) {
      out.push(value);
    } else if (isDirectory(value)) {
      const ini = path.join(value, "ModOrganizer.ini");
      if (isFile(ini)) out.push(ini);
    } else if (isFile(value) && isNamed(value, "ModOrganizer.exe")) {
      const ini = path.join(path.dirname(value), "ModOrganizer.ini");
      if (isFile(ini)) out.push(ini);
    }
  }
  return out;
}

/** Every `ModOrganizer.ini` the MO2 registry keys point at (Windows only). */
export async function registryInstanceInis(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const outputs = await Promise.all(REGISTRY_KEYS.map(runRegQuery));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const output of outputs) {
    for (const ini of pathsFromRegistryOutput(output)) {
      const key = normalizePathStr(ini);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ini);
    }
  }
  return out;
}

// ── Detection ───────────────────────────────────────────────────────

const MO2_FOLDER_NAMES = new Set([
  "modorganizer",
  "mod organizer",
  "mod organizer 2",
  "modorganizer2",
  "mo2",
]);

function pushUnique(list: Mo2Instance[], candidate: Mo2Instance | null): void {
  if (!candidate) return;
  const key = normalizePathStr(candidate.instancePath);
  if (list.some((entry) => normalizePathStr(entry.instancePath) === key)) return;
  list.push(candidate);
}

function scoreInstance(instance: Mo2Instance, normGamePath: string, normGameName: string): number {
  const instanceGamePath = instance.gamePath ? normalizePathStr(instance.gamePath) : "";
  const instanceGameName = instance.gameName ? instance.gameName.toLowerCase() : "";
  const instancePath = normalizePathStr(instance.instancePath);
  let score = 0;

  if (normGamePath) {
    if (pathIsAncestorOrSame(normGamePath, instancePath)) score += 80;

    if (instanceGamePath) {
      if (normGamePath === instanceGamePath) score += 100;
      else if (pathIsAncestorOrSame(normGamePath, instanceGamePath)) score += 75;
      else if (normGamePath.includes(instanceGamePath) || instanceGamePath.includes(normGamePath)) score += 50;
    }

    for (const exec of instance.customExecutables) {
      const execNorm = normalizePathStr(exec.path);
      if (!execNorm) continue;
      const execFile = path.basename(exec.path).toLowerCase();
      if (
        execNorm === normGamePath ||
        normGamePath.endsWith(execNorm) ||
        execNorm.endsWith(normGamePath)
      ) {
        score += 90;
        break;
      }
      if (execFile && normGamePath.endsWith(execFile)) {
        score += 65;
        break;
      }
    }
  }

  if (normGameName && instanceGameName) {
    if (normGameName === instanceGameName) score += 60;
    else if (normGameName.includes(instanceGameName) || instanceGameName.includes(normGameName)) {
      score += 40;
    }
  }

  // A portable install is only a nudge once the instance already matched.
  if (instance.isPortable && score > 0) score += 5;
  return score;
}

/**
 * Detect every MO2 instance relevant to a game, best match first. An empty
 * `gamePath` returns all discoverable global instances (relevance 0).
 */
export async function detectMo2Instances(
  gamePath: string,
  gameName: string,
): Promise<Mo2Instance[]> {
  const instances: Mo2Instance[] = [];
  const normGamePath = normalizePathStr(gamePath);
  const normGameName = (gameName ?? "").toLowerCase();

  const registryInis = await registryInstanceInis();
  for (const ini of registryInis) {
    pushUnique(instances, parseInstanceAt(ini, path.join(path.dirname(ini), "ModOrganizer.exe")));
  }

  // 1. Portable checks: the target path itself, its parents and their children.
  if (gamePath.trim()) {
    const target = path.resolve(gamePath);
    const directIni =
      isFile(target) && isNamed(target, "ModOrganizer.ini")
        ? target
        : isFile(path.join(target, "ModOrganizer.ini"))
          ? path.join(target, "ModOrganizer.ini")
          : null;
    if (directIni) {
      pushUnique(instances, parseInstanceAt(directIni, path.join(path.dirname(directIni), "ModOrganizer.exe")));
    }

    const start = isFile(target) ? path.dirname(target) : target;
    let current: string | null = start;
    let depth = 0;
    while (current) {
      if (depth > 4) break;
      const direct = path.join(current, "ModOrganizer.ini");
      if (isFile(direct)) {
        pushUnique(
          instances,
          parseInstanceAt(direct, path.join(current, "ModOrganizer.exe")),
        );
      }
      try {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (!MO2_FOLDER_NAMES.has(entry.name.toLowerCase())) continue;
          const folder = path.join(current, entry.name);
          const ini = path.join(folder, "ModOrganizer.ini");
          if (isFile(ini)) {
            pushUnique(instances, parseInstanceAt(ini, path.join(folder, "ModOrganizer.exe")));
          }
        }
      } catch {
        /* unreadable folder: keep walking */
      }
      const parent = path.dirname(current);
      current = parent === current ? null : parent;
      depth += 1;
    }
  }

  // 2. Global instances in %LOCALAPPDATA%\ModOrganizer.
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const root = path.join(localAppData, "ModOrganizer");
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const ini = path.join(root, entry.name, "ModOrganizer.ini");
        pushUnique(instances, parseInstanceAt(ini, null));
      }
    } catch {
      /* no global instances */
    }
  }

  const scored = instances.map((instance) => ({
    ...instance,
    relevance: scoreInstance(instance, normGamePath, normGameName),
  }));

  scored.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      a.instancePath.toLowerCase().localeCompare(b.instancePath.toLowerCase()) ||
      a.name.localeCompare(b.name),
  );
  return scored;
}
