/**
 * Windows-first compatibility platform layer.
 *
 * The Wine/Proton tooling is Linux-only. On Windows every probe returns an
 * honest "nothing here" result (`[]`, all-false status) and every installer
 * refuses with a clear "Linux only" error instead of pretending to work. On
 * Linux the cheap paths are real: runner folders, prefix folders and the
 * system-status probes read the filesystem/PATH instead of inventing data.
 *
 * Reference: `src-tauri/src/compatibility/{runners,prefixes,wine}.rs`.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { listGamesSummary } from "../../state/libraryStore";
import { getCompatibilitySettings, customPrefixes } from "./settings";
import { parseVdfInstallPath, parseVdfValue } from "./vdf";
import type {
  CompatibilityRunner,
  LinuxSystemStatus,
  WinePrefixInfo,
} from "./types";
import { dirStats } from "../mods/util";

export const IS_WINDOWS = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";

/** Error used by every Linux-only operation on a non-Linux host. */
export function linuxOnlyError(action: string): Error {
  return new Error(
    `${action} is only available on Linux — Windows runs games natively, so Wine/Proton tooling does not apply.`,
  );
}

function homeDir(): string {
  return process.env.HOME || os.homedir();
}

function exists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function isDir(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

const commandCache = new Map<string, boolean>();

/** PATH probe that does not spawn a process. */
export function commandAvailable(command: string): boolean {
  const cached = commandCache.get(command);
  if (cached !== undefined) return cached;
  const pathVar = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? path.extname(command)
        ? [""]
        : [".exe", ".cmd", ".bat"]
      : [""];
  let available = false;
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      if (exists(path.join(dir, `${command}${ext}`))) {
        available = true;
        break;
      }
    }
    if (available) break;
  }
  commandCache.set(command, available);
  return available;
}

function findUmuRun(): string | null {
  const candidates = [
    path.join(homeDir(), ".local", "share", "umu", "umu-run"),
    "/usr/bin/umu-run",
    "/usr/local/bin/umu-run",
    path.join(homeDir(), ".local", "bin", "umu-run"),
  ];
  return candidates.find(exists) ?? null;
}

/** `umu-run` executable, or null when umu-launcher is not installed. */
export function umuRunPath(): string | null {
  if (commandAvailable("umu-run")) return "umu-run";
  return findUmuRun();
}

function steamCandidateRoots(): string[] {
  const home = homeDir();
  const roots = [
    path.join(home, ".steam", "root"),
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
    path.join(home, ".var", "app", "com.valvesoftware.Steam", "data", "Steam"),
    "/snap/steam/common/.steam/steam",
  ];
  return roots.filter(isDir);
}

/**
 * System-wide `compatibilitytools.d` directories.
 *
 * Steam searches these before the per-user root, and this is where distro
 * packages install Proton builds — notably CachyOS's `proton-cachyos-slr`
 * and `proton-cachyos-native` packages, which land in
 * `/usr/share/steam/compatibilitytools.d`. They were previously invisible
 * because only `~/.steam` and `~/.local/share/Steam` were scanned.
 */
function systemCompatibilityToolRoots(): string[] {
  const extra = (process.env.STEAM_EXTRA_COMPAT_TOOLS_PATHS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [
    "/usr/share/steam/compatibilitytools.d",
    "/usr/local/share/steam/compatibilitytools.d",
    "/usr/lib/steam/compatibilitytools.d",
    "/opt/steam/compatibilitytools.d",
    ...extra,
  ].filter(isDir);
}

/**
 * Runner directories under a `compatibilitytools.d` root.
 *
 * Two layouts exist in the wild:
 *  - a complete tool directory (`proton-cachyos-slr/proton`, …), and
 *  - a bare manifest (`proton-cachyos.vdf`) whose `install_path` points at
 *    the real tool elsewhere on disk (used by newer CachyOS packaging).
 */
function compatibilityToolsIn(root: string): string[] {
  const found = new Set(listDirs(root));
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [...found];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".vdf")) continue;
    const manifest = path.join(root, entry.name);
    let raw = "";
    try {
      raw = fs.readFileSync(manifest, "utf8");
    } catch {
      continue;
    }
    const installPath = parseVdfInstallPath(raw);
    if (!installPath) continue;
    const resolved = path.isAbsolute(installPath)
      ? installPath
      : path.resolve(root, installPath);
    if (resolved !== root && isDir(resolved)) found.add(resolved);
  }
  return [...found];
}

/**
 * Third-party Wine/Proton installs the old Rust detector also understood:
 * Lutris, Heroic, Bottles and `/opt` builds (e.g. `wine-cachyos-opt`).
 */
function thirdPartyRunnerDirs(): string[] {
  const home = homeDir();
  const roots = [
    path.join(home, ".local", "share", "lutris", "runners", "wine"),
    path.join(home, ".config", "heroic", "tools", "wine"),
    path.join(home, ".config", "heroic", "tools", "proton"),
    path.join(
      home,
      ".var", "app", "com.heroicgameslauncher.hgl", "config", "heroic", "tools", "wine",
    ),
    path.join(
      home,
      ".var", "app", "com.heroicgameslauncher.hgl", "config", "heroic", "tools", "proton",
    ),
    path.join(home, ".local", "share", "bottles", "runners"),
    path.join(
      home,
      ".var", "app", "com.usebottles.bottles", "data", "bottles", "runners",
    ),
  ];
  const dirs: string[] = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    for (const dir of listDirs(root)) dirs.push(dir);
    // Lutris/Heroic store a single Wine build directly under the root when
    // there is only one, so include the root itself when it looks like one.
    if (exists(path.join(root, "bin", "wine"))) dirs.push(root);
  }
  return dirs;
}

/** Locate a system Wine binary (PATH + the usual distro prefixes). */
export function systemWineBinary(): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "wine");
    if (exists(candidate)) return candidate;
  }
  const home = homeDir();
  const candidates = [
    "/usr/bin/wine",
    "/usr/local/bin/wine",
    "/opt/wine-cachyos/bin/wine",
    "/opt/wine/bin/wine",
    path.join(home, ".local", "bin", "wine"),
  ];
  return candidates.find(exists) ?? null;
}

/** Steam install roots that exist on this machine, most specific first. */
export function steamRoots(): string[] {
  return steamCandidateRoots();
}

function parseLibraryFolders(raw: string): string[] {
  const out: string[] = [];
  const parts = raw.split('"');
  for (let i = 1; i + 2 < parts.length; i += 2) {
    const key = parts[i];
    if (key === "path" || /^[0-9]+$/.test(key)) {
      const value = parts[i + 2].trim();
      if (value && (path.isAbsolute(value) || value.startsWith("/") || value.startsWith("\\"))) {
        if (!out.includes(value)) out.push(value);
      }
    }
  }
  return out;
}

function steamLibraryRoots(): string[] {
  const roots = steamCandidateRoots();
  const seen = new Set(roots);
  for (const root of [...roots]) {
    try {
      const raw = fs.readFileSync(path.join(root, "steamapps", "libraryfolders.vdf"), "utf8");
      for (const library of parseLibraryFolders(raw)) {
        if (!seen.has(library)) {
          seen.add(library);
          roots.push(library);
        }
      }
    } catch {
      /* no secondary libraries */
    }
  }
  return roots;
}

export function systemStatus(): LinuxSystemStatus {
  if (!IS_LINUX) {
    return {
      osName: IS_WINDOWS ? "windows" : process.platform === "darwin" ? "macos" : "unknown",
      kernelVersion: os.release(),
      displayServer: IS_WINDOWS ? "Windows" : "unknown",
      vulkanSupport: false,
      gamemodeAvailable: false,
      mangohudAvailable: false,
      gamescopeAvailable: false,
      winetricksAvailable: false,
      umuAvailable: false,
      eacRuntimeAvailable: false,
      battleyeRuntimeAvailable: false,
    };
  }
  const displayServer = process.env.WAYLAND_DISPLAY
    ? "Wayland"
    : process.env.DISPLAY
      ? "X11"
      : "unknown";
  return {
    osName: "linux",
    kernelVersion: os.release(),
    displayServer,
    vulkanSupport: commandAvailable("vulkaninfo"),
    gamemodeAvailable: commandAvailable("gamemoderun"),
    mangohudAvailable: commandAvailable("mangohud"),
    gamescopeAvailable: commandAvailable("gamescope"),
    winetricksAvailable: commandAvailable("winetricks"),
    umuAvailable: umuRunPath() !== null,
    eacRuntimeAvailable: exists(
      path.join(userDataPath("anticheat"), "easyanticheat"),
    ),
    battleyeRuntimeAvailable: exists(path.join(userDataPath("anticheat"), "battleye")),
  };
}

function runnerKind(name: string, isProton: boolean): string {
  const lower = name.toLowerCase();
  if (lower.includes("cachyos")) return "cachyos";
  if (lower.includes("ge-proton") || lower.includes("ge_proton")) return "ge-proton";
  return isProton ? "proton" : "wine";
}

function runnerManifest(dir: string): { displayName: string | null; version: string | null } {
  for (const fileName of ["compatibilitytool.vdf", "toolmanifest.vdf"]) {
    let raw = "";
    try {
      raw = fs.readFileSync(path.join(dir, fileName), "utf8");
    } catch {
      continue;
    }
    const displayName = parseVdfValue(raw, "display_name");
    const version = /(\d+(?:\.\d+)+)/.exec(displayName ?? "")?.[1] ?? null;
    if (displayName || version) return { displayName, version };
  }
  return { displayName: null, version: null };
}

function runnerEntry(
  dir: string,
  kindHint?: string,
  isDeletable = true,
): CompatibilityRunner | null {
  const baseName = path.basename(dir);
  if (!baseName) return null;
  const manifest = runnerManifest(dir);
  const name = manifest.displayName?.replace(/\s*\([^)]*runtime[^)]*\)\s*$/i, "").trim() || baseName;
  const lower = name.toLowerCase();
  const isProton =
    kindHint === "proton" ||
    lower.startsWith("proton") ||
    lower.includes("ge-proton") ||
    lower.includes("cachyos") ||
    isDir(path.join(dir, "files", "bin")) ||
    exists(path.join(dir, "proton"));
  const versionMatch = /(\d+(?:\.\d+)+)/.exec(name ?? "");
  return {
    id: `runner-${dir.replace(/[\\/:]/g, "-")}`,
    name,
    path: dir,
    kind: kindHint ?? runnerKind(name, isProton),
    version: manifest.version ?? (versionMatch ? versionMatch[1] : null),
    isProton,
    sizeBytes: null,
    isDeletable,
    installDir: dir,
  };
}

/** True when `dir` contains a Proton script or a Wine binary we can spawn. */
function looksLikeRunnerDir(dir: string): boolean {
  const base = path.basename(dir).toLowerCase();
  if (
    base.startsWith("proton") ||
    base.startsWith("ge-proton") ||
    base.includes("wine") ||
    base.includes("cachyos")
  ) {
    return true;
  }
  return (
    exists(path.join(dir, "proton")) ||
    exists(path.join(dir, "files", "bin", "proton")) ||
    exists(path.join(dir, "bin", "wine")) ||
    exists(path.join(dir, "bin", "wine64")) ||
    exists(path.join(dir, "files", "bin", "wine"))
  );
}

/** Locate the system Wine binary and describe it as a runner. */
export function systemWineRunner(): CompatibilityRunner | null {
  const binary = systemWineBinary();
  if (!binary) return null;
  let version: string | null = null;
  try {
    const out = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 2500,
      stdio: ["ignore", "pipe", "ignore"],
    });
    version = /(\d+(?:\.\d+)+)/.exec(out)?.[1] ?? null;
  } catch {
    /* `wine --version` is best-effort */
  }
  const cachyos = /cachyos/i.test(binary);
  return {
    id: "runner-system-wine",
    // Keep the name explicit so the Settings list distinguishes the distro
    // package from a downloaded Proton/GE build.
    name: cachyos ? "Wine (CachyOS)" : "System Wine",
    path: binary,
    kind: "wine",
    version,
    isProton: false,
    sizeBytes: null,
    isDeletable: false,
    installDir: path.dirname(binary),
  };
}

function listDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

export async function listRunners(): Promise<CompatibilityRunner[]> {
  if (!IS_LINUX) return [];

  // `dir` → whether the user owns it (safe to delete from the UI).
  const directories = new Map<string, boolean>();
  const add = (dir: string, deletable: boolean) => {
    if (!directories.has(dir)) directories.set(dir, deletable);
  };

  for (const root of steamCandidateRoots()) {
    for (const dir of compatibilityToolsIn(path.join(root, "compatibilitytools.d"))) {
      add(dir, true);
    }
  }
  // Distro packages (CachyOS Proton lives here) are not ours to delete.
  for (const root of systemCompatibilityToolRoots()) {
    for (const dir of compatibilityToolsIn(root)) add(dir, false);
  }
  for (const library of steamLibraryRoots()) {
    for (const dir of listDirs(path.join(library, "steamapps", "common"))) {
      add(dir, false);
    }
  }
  for (const kind of ["proton", "wine"]) {
    for (const dir of listDirs(
      path.join(homeDir(), ".local", "share", "GameIndex", "runners", kind),
    )) {
      add(dir, true);
    }
  }
  for (const dir of thirdPartyRunnerDirs()) add(dir, false);

  const seen = new Set<string>();
  const runners: CompatibilityRunner[] = [];
  for (const [dir, deletable] of directories) {
    if (!looksLikeRunnerDir(dir)) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = runnerEntry(dir, undefined, deletable);
    if (!entry) continue;
    try {
      const { bytes } = await dirStats(dir, 20_000);
      entry.sizeBytes = bytes;
    } catch {
      entry.sizeBytes = null;
    }
    runners.push(entry);
  }

  // The system Wine binary is a valid launch target even when no Proton build
  // exists; surfacing it means the Settings list and default-runner picker
  // show what the launcher will actually fall back to.
  const systemWine = systemWineRunner();
  if (systemWine && !seen.has(systemWine.path.toLowerCase())) {
    runners.push(systemWine);
  }

  runners.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return runners;
}

// ── Prefixes ────────────────────────────────────────────────────────

export function defaultPrefixBase(): string {
  return IS_LINUX
    ? path.join(homeDir(), ".local", "share", "GameIndex", "wineprefixes")
    : userDataPath("wineprefixes");
}

function prefixBaseDir(): string {
  const settings = getCompatibilitySettings();
  const configured = settings.defaultPrefixBaseDir?.trim();
  return configured || defaultPrefixBase();
}

function associatedGames(prefixPath: string): Array<{ id: string; title: string }> {
  const target = prefixPath.toLowerCase();
  const out: Array<{ id: string; title: string }> = [];
  for (const game of listGamesSummary()) {
    const custom = game.compatibility?.customWinePrefix?.trim();
    if (custom && custom.toLowerCase() === target) {
      out.push({ id: game.id, title: game.name });
    }
  }
  return out;
}

function inspectPrefix(prefixPath: string): {
  isValid: boolean;
  isProton: boolean;
  arch: string;
  winVersion: string | null;
} {
  const pfxDriveC = path.join(prefixPath, "pfx", "drive_c");
  const flatDriveC = path.join(prefixPath, "drive_c");
  const isValid = isDir(pfxDriveC) || isDir(flatDriveC);
  const isProton = isDir(pfxDriveC);
  let arch = "win64";
  const registry = path.join(prefixPath, "system.reg");
  try {
    const raw = fs.readFileSync(registry, "utf8");
    if (/#arch=win32/i.test(raw)) arch = "win32";
  } catch {
    /* no registry yet */
  }
  return { isValid, isProton, arch, winVersion: null };
}

export async function listPrefixes(): Promise<WinePrefixInfo[]> {
  if (!IS_LINUX) return [];
  const settings = getCompatibilitySettings();
  const base = prefixBaseDir();
  const candidates = new Set<string>();
  for (const dir of listDirs(base)) candidates.add(dir);
  if (settings.defaultPrefix?.trim()) candidates.add(settings.defaultPrefix.trim());
  for (const custom of customPrefixes()) candidates.add(custom);

  const out: WinePrefixInfo[] = [];
  for (const dir of candidates) {
    if (!isDir(dir)) continue;
    const inspected = inspectPrefix(dir);
    let sizeBytes = 0;
    let lastModified: number | null = null;
    try {
      const stats = await dirStats(dir, 25_000);
      sizeBytes = stats.bytes;
      lastModified = fs.statSync(dir).mtimeMs;
    } catch {
      /* unreadable prefix */
    }
    out.push({
      id: `prefix-${dir.replace(/[\\/:]/g, "-")}`,
      name: path.basename(dir),
      path: dir,
      sizeBytes,
      isValid: inspected.isValid,
      isProton: inspected.isProton,
      arch: inspected.arch,
      winVersion: inspected.winVersion,
      wineVersion: null,
      associatedGames: associatedGames(dir),
      lastModified,
      isDefaultBase: dir.startsWith(base),
      isCustom: customPrefixes().includes(dir),
    });
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}

export function createPrefix(name: string, customPath: string | null, arch: string): string {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Prefix name cannot be empty");
  if (/[\\/:*?"<>|]/.test(cleanName)) throw new Error("Prefix name contains invalid characters");
  const target = customPath?.trim() || path.join(prefixBaseDir(), cleanName);
  if (isDir(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`A prefix already exists at "${target}"`);
  }
  fs.mkdirSync(path.join(target, "drive_c"), { recursive: true });
  const registryArch = arch === "win32" ? "win32" : "win64";
  try {
    fs.writeFileSync(
      path.join(target, "system.reg"),
      `WINE REGISTRY Version 2\n#arch=${registryArch}\n`,
      "utf8",
    );
  } catch {
    /* registry seeding is best effort */
  }
  return target;
}

export async function deletePrefix(prefixPath: string): Promise<void> {
  const target = prefixPath.trim();
  if (!target) throw new Error("A prefix path is required");
  if (!isDir(target)) throw new Error(`Prefix "${target}" does not exist`);
  await fsp.rm(target, { recursive: true, force: true });
}

export async function duplicatePrefix(
  sourcePath: string,
  newName: string,
  targetPath: string | null,
): Promise<string> {
  const source = sourcePath.trim();
  if (!isDir(source)) throw new Error(`Prefix "${source}" does not exist`);
  const name = newName.trim();
  if (!name) throw new Error("Prefix name cannot be empty");
  const target = targetPath?.trim() || path.join(prefixBaseDir(), name);
  if (isDir(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`A prefix already exists at "${target}"`);
  }
  await fsp.cp(source, target, { recursive: true, force: false, errorOnExist: false });
  return target;
}

export async function clearPrefix(prefixPath: string): Promise<void> {
  const target = prefixPath.trim();
  if (!isDir(target)) throw new Error(`Prefix "${target}" does not exist`);
  // Empty the prefix but keep the folder (and its registration).
  for (const entry of await fsp.readdir(target)) {
    await fsp.rm(path.join(target, entry), { recursive: true, force: true });
  }
}

/** Resolve a configured runner (binary, Proton script or tool directory). */
export function resolveRunnerToolPath(runnerPath: string): string {
  try {
    if (fs.statSync(runnerPath).isDirectory()) {
      const candidates = [
        path.join(runnerPath, "proton"),
        path.join(runnerPath, "files", "bin", "proton"),
        path.join(runnerPath, "bin", "wine"),
        path.join(runnerPath, "bin", "wine64"),
        path.join(runnerPath, "files", "bin", "wine"),
        path.join(runnerPath, "files", "bin", "wine64"),
      ];
      for (const candidate of candidates) {
        if (exists(candidate)) return candidate;
      }
    }
  } catch {
    /* not a directory: keep the path/command as given */
  }
  return runnerPath;
}

export function runWineTool(
  prefixPath: string | null,
  runnerPath: string | null,
  tool: string,
  args: string[] | null,
  gameId?: string | null,
): void {
  if (!IS_LINUX) throw linuxOnlyError("Running a Wine tool");
  const settings = getCompatibilitySettings();
  let prefix = prefixPath?.trim() || "";
  if (!prefix && gameId) {
    const game = listGamesSummary().find((row) => row.id === gameId);
    prefix = game?.compatibility?.customWinePrefix?.trim() || "";
    if (!prefix) prefix = path.join(prefixBaseDir(), gameId);
  }
  if (!prefix) prefix = settings.defaultPrefix?.trim() || path.join(defaultPrefixBase(), "default");
  const runner = resolveRunnerToolPath(
    runnerPath?.trim() || settings.defaultRunnerPath?.trim() || "wine",
  );
  fs.mkdirSync(prefix, { recursive: true });

  const normalizedTool = tool.trim();
  const extra = args ?? [];
  let command: string;
  let commandArgs: string[];

  if (normalizedTool === "kill" || normalizedTool === "wineserver") {
    command = "wineserver";
    commandArgs = ["-k"];
  } else if (/\.exe$/i.test(normalizedTool)) {
    command = runner;
    commandArgs = [normalizedTool, ...extra];
  } else if (["winecfg", "regedit", "explorer", "control"].includes(normalizedTool)) {
    command = runner;
    commandArgs = [`${normalizedTool}.exe`, ...extra];
  } else {
    command = normalizedTool;
    commandArgs = extra;
  }

  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WINEPREFIX: prefix,
      ...(settings.wineDebug ? { WINEDEBUG: settings.wineDebug } : {}),
    },
  });
  child.unref();
}
