/**
 * Compatibility layer commands (Proton/Wine runners, prefixes, logs).
 *
 * Workstream: `compat`. Windows-first rule: on Windows these return honest
 * "not supported here" states instead of rejecting; on Linux they read real
 * runner/prefix data. Runner installation is still a gap in this build on both
 * platforms and says so.
 *
 * Reference: `git show HEAD:src-tauri/src/compatibility/`.
 */
import { shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerCommands, type CommandArgs, type CommandHandler } from "../ipc";
import {
  IS_LINUX,
  clearPrefix,
  commandAvailable,
  createPrefix,
  defaultPrefixBase,
  deletePrefix,
  duplicatePrefix,
  linuxOnlyError,
  listPrefixes,
  listRunners,
  runWineTool,
  systemStatus,
} from "../features/compatibility/platform";
import {
  clearGameWineLogs,
  getGameWineLogs,
} from "../features/compatibility/logs";
import { detectOnlineFix } from "../features/compatibility/onlineFix";
import {
  cancelRunnerInstall,
  fetchAvailableRunners,
  installCompatibilityRunner,
  installRunnerFromArchive,
} from "../features/compatibility/runners";
import {
  getCompatibilitySettings,
  normalizeCompatibilitySettings,
  registerCustomPrefix,
  setCompatibilitySettings,
  unregisterCustomPrefix,
} from "../features/compatibility/settings";

function text(args: CommandArgs, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function optionalText(args: CommandArgs, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function textList(args: CommandArgs, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function requireLinux(action: string): void {
  if (!IS_LINUX) throw linuxOnlyError(action);
}

/** Prefixes this build refuses to delete wholesale (too destructive). */
function isSafePrefixTarget(prefixPath: string): boolean {
  const target = path.resolve(prefixPath).toLowerCase();
  const forbidden = new Set([
    path.resolve("/").toLowerCase(),
    path.resolve(os.homedir()).toLowerCase(),
    path.resolve(defaultPrefixBase()).toLowerCase(),
    ...(IS_LINUX ? [] : [path.resolve(process.env.USERPROFILE ?? os.homedir()).toLowerCase()]),
  ]);
  const settings = getCompatibilitySettings();
  if (settings.defaultPrefixBaseDir) {
    forbidden.add(path.resolve(settings.defaultPrefixBaseDir).toLowerCase());
  }
  return !forbidden.has(target);
}

/** Every runner root GameIndex may remove a folder from. */
function isManagedRunner(runnerPath: string): boolean {
  const home = process.env.HOME ?? os.homedir();
  const roots = [
    path.join(home, ".local", "share", "GameIndex", "runners"),
    path.join(home, ".steam", "root", "compatibilitytools.d"),
    path.join(home, ".local", "share", "Steam", "compatibilitytools.d"),
    path.join(home, ".steam", "steam", "compatibilitytools.d"),
    path.join(
      home,
      ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam", "compatibilitytools.d",
    ),
  ].map((entry) => entry.toLowerCase());
  const target = runnerPath.toLowerCase();
  return roots.some((root) => target.startsWith(`${root}${path.sep}`));
}

function prefixSubdir(prefixPath: string, subdir: string): string {
  const normalized = subdir.trim().toLowerCase();
  if (!normalized || normalized === "root") return prefixPath;
  if (normalized === "drive_c" || normalized === "c") {
    const proton = path.join(prefixPath, "pfx", "drive_c");
    return fs.existsSync(proton) ? proton : path.join(prefixPath, "drive_c");
  }
  const protonChild = path.join(prefixPath, "pfx", subdir);
  if (fs.existsSync(protonChild)) return protonChild;
  return path.join(prefixPath, subdir);
}

export const compatibilityCommands: Record<string, CommandHandler> = {
  get_compatibility_settings: () => getCompatibilitySettings(),

  set_compatibility_settings: (args) => {
    const raw = args.settings;
    if (!raw || typeof raw !== "object") {
      throw new Error("set_compatibility_settings needs a settings object");
    }
    setCompatibilitySettings(
      normalizeCompatibilitySettings(raw as Record<string, unknown>),
    );
    return null;
  },

  get_compatibility_system_status: () => systemStatus(),

  list_compatibility_runners: () => listRunners(),

  detect_online_fix: (args) => {
    const exePath = text(args, "exePath");
    if (!exePath) throw new Error("A game executable path is required");
    return detectOnlineFix(exePath);
  },

  list_wine_prefixes: () => listPrefixes(),

  get_game_wine_logs: (args) => {
    const gameId = text(args, "gameId");
    if (!gameId) throw new Error("A game id is required to read its Wine log");
    return getGameWineLogs(gameId);
  },

  clear_game_wine_logs: (args) => {
    const gameId = text(args, "gameId");
    if (!gameId) throw new Error("A game id is required to clear its Wine log");
    clearGameWineLogs(gameId);
    return null;
  },

  // ── Runner installation ───────────────────────────────────────────
  fetch_available_runners: (args) => {
    const source = text(args, "source");
    const forceRefresh = Boolean(args.forceRefresh ?? args.force_refresh);
    if (!source) throw new Error("A runner source is required");
    return fetchAvailableRunners(source, forceRefresh);
  },

  install_compatibility_runner: (args) => {
    requireLinux("Installing a compatibility runner");
    return installCompatibilityRunner({
      downloadUrl: text(args, "downloadUrl"),
      filename: text(args, "filename"),
      runnerName: text(args, "runnerName"),
      targetType: text(args, "targetType") || "proton",
    });
  },

  cancel_runner_install: (args) => {
    requireLinux("Cancelling a runner install");
    return cancelRunnerInstall(text(args, "runnerName"));
  },

  install_runner_from_archive: (args) => {
    requireLinux("Installing a runner from an archive");
    return installRunnerFromArchive(
      text(args, "archivePath"),
      text(args, "targetType") || "proton",
    );
  },

  delete_compatibility_runner: async (args) => {
    requireLinux("Deleting a compatibility runner");
    const runnerId = text(args, "runnerId");
    const requested = optionalText(args, "path");
    const runners = await listRunners();
    const runner = runners.find(
      (entry) => entry.id === runnerId || entry.path === requested || entry.installDir === requested,
    );
    if (runner && runner.isDeletable === false) {
      throw new Error(`"${runner.path}" is managed by Steam or the system and is not managed by GameIndex`);
    }
    const target = (requested ?? runner?.installDir ?? runner?.path ?? "").trim();
    if (!target) throw new Error("A runner path is required");
    if (!isManagedRunner(target)) {
      throw new Error(`"${target}" is a system runner and is not managed by GameIndex`);
    }
    if (!fs.existsSync(target)) throw new Error(`Runner folder not found: ${target}`);
    fs.rmSync(target, { recursive: true, force: true });
    const settings = getCompatibilitySettings();
    if (settings.defaultRunnerPath === target || settings.defaultRunnerPath === runner?.path) {
      setCompatibilitySettings({ ...settings, defaultRunnerPath: null });
    }
    return null;
  },

  // ── Prefixes ──────────────────────────────────────────────────────
  create_wine_prefix: (args) => {
    requireLinux("Creating a Wine prefix");
    return createPrefix(
      text(args, "name"),
      optionalText(args, "customPath"),
      optionalText(args, "arch") ?? "win64",
    );
  },

  delete_wine_prefix: async (args) => {
    requireLinux("Deleting a Wine prefix");
    const target = text(args, "path");
    if (!isSafePrefixTarget(target)) {
      throw new Error(`Refusing to delete "${target}" — that is a shared system folder`);
    }
    await deletePrefix(target);
    unregisterCustomPrefix(target);
    return null;
  },

  clear_wine_prefix: async (args) => {
    requireLinux("Clearing a Wine prefix");
    await clearPrefix(text(args, "path"));
    return null;
  },

  duplicate_wine_prefix: async (args) => {
    requireLinux("Duplicating a Wine prefix");
    return duplicatePrefix(
      text(args, "sourcePath"),
      text(args, "newName"),
      optionalText(args, "targetPath"),
    );
  },

  register_custom_prefix: (args) => {
    const prefixPath = text(args, "path").trim();
    if (!prefixPath) throw new Error("A prefix path is required");
    if (!fs.existsSync(prefixPath) || !fs.statSync(prefixPath).isDirectory()) {
      throw new Error(`"${prefixPath}" is not a folder`);
    }
    registerCustomPrefix(prefixPath);
    return null;
  },

  unregister_custom_prefix: (args) => {
    unregisterCustomPrefix(text(args, "path"));
    return null;
  },

  open_prefix_directory: async (args) => {
    const prefixPath = text(args, "prefixPath");
    const subdir = optionalText(args, "targetSubdir") ?? "";
    const target = prefixSubdir(prefixPath, subdir);
    if (!fs.existsSync(target)) {
      throw new Error(`Folder not found: ${target}`);
    }
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
    return null;
  },

  // ── Tools ─────────────────────────────────────────────────────────
  run_wine_tool: (args) => {
    requireLinux("Running a Wine tool");
    runWineTool(
      optionalText(args, "prefixPath"),
      optionalText(args, "runnerPath"),
      text(args, "tool"),
      Array.isArray(args.args) ? textList(args, "args") : null,
      optionalText(args, "gameId"),
    );
    return null;
  },

  install_winetricks_verb: (args) => {
    requireLinux("Installing a winetricks verb");
    if (!commandAvailable("winetricks")) {
      throw new Error(
        "winetricks was not found on PATH — install winetricks or set its path in Settings → Compatibility.",
      );
    }
    const prefixPath = text(args, "prefixPath").trim();
    const verb = text(args, "verb").trim();
    if (!verb) throw new Error("A winetricks verb is required");
    const settings = getCompatibilitySettings();
    const winetricks = settings.winetricksPath?.trim() || "winetricks";
    const child = spawn(winetricks, ["-q", verb], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, WINEPREFIX: prefixPath },
    });
    child.unref();
    return null;
  },

  install_anticheat_runtimes: () => {
    requireLinux("Installing anti-cheat runtimes");
    throw new Error(
      "Anti-cheat runtime installation is not available in the Electron build yet — Steam installs the EAC/BattlEye runtimes on demand.",
    );
  },
};

export function registerCompatibilityCommands(): void {
  registerCommands(compatibilityCommands, { override: true });
}
