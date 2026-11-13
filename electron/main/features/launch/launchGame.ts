/**
 * `launch_game` — spawn a game, or hand off to its store's URI handler.
 *
 * Ported from `src-tauri/src/launcher.rs` (`launch_game`). Behaviour kept:
 *
 *  • Emits the same `launch-progress` steps the splash animates
 *    (resolvingPaths → preLaunchScript → elevating/compatibilityRunner →
 *    startingGame → loadingAssets → companionApps → launching).
 *  • Refuses an elevation request when Settings → "Disable UAC elevation
 *    prompts" is on, with the same user-facing wording.
 *  • Runs the pre-launch script before spawning and the post-exit script after
 *    the process is gone (owned by the session lifecycle).
 *  • Steam without a local exe launches `steam://run/<appid>` (or the
 *    `steam://launch/<appid>/dialog` picker) and registers a *pending* session;
 *    Ubisoft uses `uplay://launch/<id>`; Epic uses its launcher URI; a game
 *    whose `gamePath` is itself a URI is opened directly.
 *  • Registers the session with the watcher, which owns start/exit events.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { emit } from "../../ipc";
import { getAppSetting } from "../../state/appSettings";
import { getGameRootDir } from "./paths";
import { registerLaunchedSession } from "./sessions";
import { runScriptBlocking, spawnCompanion, splitLaunchArgs } from "./scripts";
import { steamGameInstallPath, steamLaunchUrl } from "./steam";
import {
  gameCompatibilityProfile,
  launchWithCompatibility,
  shouldUseCompatibility,
} from "../compatibility/launch";
import type { GpuSelection } from "../compatibility/gpuSelection";
import { applySteamLaunchOptions, steamLaunchPrefixForGame } from "../compatibility/steamLaunchOptions";
import { deriveSteamAppId } from "../compatibility/steamConfig";
import { steamWineLogDirForGame } from "../compatibility/logs";
import { resolveGameExe } from "./exeResolve";
import type { CompanionApp, LaunchProgressPayload } from "./types";

const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";

const ELEVATION_BLOCKED_RUN_AS_ADMIN =
  'Launch with admin elevation is blocked by Settings → Disable UAC elevation prompts. ' +
  'Enable the setting or unset "Run as administrator" on the game to launch.';

const ELEVATION_BLOCKED_PRE_LAUNCH =
  "Pre-launch script requires admin elevation but Settings → Disable UAC elevation prompts is on.";

const ELEVATION_BLOCKED_IMPLICIT =
  'Game requires administrator privileges and Settings → Disable UAC elevation prompts is on. ' +
  'Enable the setting or unset "Run as administrator" on the game to launch.';

function emitProgress(gameId: string, step: string): void {
  const payload: LaunchProgressPayload = { gameId, step };
  emit("launch-progress", payload);
}

function readString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readBoolean(args: Record<string, unknown>, key: string): boolean {
  return Boolean(args[key]);
}

function readNumber(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readGpuSelection(value: unknown): GpuSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const str = (key: string): string | null =>
    typeof record[key] === "string" && (record[key] as string).trim()
      ? (record[key] as string).trim()
      : null;
  const index = record.vulkanIndex;
  return {
    pciId: str("pciId"),
    pciSlot: str("pciSlot"),
    vulkanUuid: str("vulkanUuid"),
    vulkanIndex:
      typeof index === "number" && Number.isInteger(index) ? index : null,
    vendor: str("vendor"),
    nvidiaProvider: str("nvidiaProvider"),
  };
}

function readCompanions(value: unknown): CompanionApp[] {  if (!Array.isArray(value)) return [];
  const apps: CompanionApp[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const target = typeof record.path === "string" ? record.path.trim() : "";
    if (!target) continue;
    const delayMs = Number(record.delayMs ?? 0);
    apps.push({
      path: target,
      arguments: typeof record.arguments === "string" ? record.arguments : null,
      delayMs: Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0,
      runAsAdmin: Boolean(record.runAsAdmin),
    });
  }
  return apps;
}

function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isElevationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  const errno = (error as NodeJS.ErrnoException).errno;
  const message = describeError(error).toLowerCase();
  if (code === "EACCES" || code === "EPERM") return true;
  if (errno === 740) return true;
  return message.includes("elevation") || message.includes("740");
}

function quoteForVerbatim(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

/** Build the argv for `spawn` (scripts are routed through their interpreter). */
function buildSpawnArgs(exePath: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    const ext = path.extname(exePath).toLowerCase();
    if (ext === ".bat" || ext === ".cmd") {
      return { file: "cmd.exe", args: ["/C", quoteForVerbatim(exePath)] };
    }
    if (ext === ".ps1") {
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", quoteForVerbatim(exePath)],
      };
    }
  }
  return { file: exePath, args: [] };
}

async function spawnProgram(
  exePath: string,
  launchArguments: string | null,
  cwd: string | null,
): Promise<ChildProcess> {
  const { file, args } = buildSpawnArgs(exePath);
  const spawnArgs = [...args];
  if (launchArguments) {
    if (IS_WINDOWS) {
      // A raw argument string, exactly like Rust's `raw_arg`: the OS parses it.
      spawnArgs.push(launchArguments);
    } else {
      spawnArgs.push(...splitLaunchArgs(launchArguments));
    }
  }

  return await new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn(file, spawnArgs, {
      cwd: cwd ?? undefined,
      stdio: "ignore",
      windowsHide: false,
      windowsVerbatimArguments: IS_WINDOWS,
      detached: false,
    });
    child.once("error", (error) => reject(error));
    child.once("spawn", () => resolve(child));
  });
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCapture(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      reject(new Error(`${file} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

/**
 * Launch with the Windows `runas` verb (UAC). Returns the new PID when
 * PowerShell can report it, `0` when the process started but no handle was
 * available (the watcher then attaches by exe/install-dir matching).
 */
async function launchElevated(
  exePath: string,
  cwd: string | null,
  launchArguments: string | null,
): Promise<number> {
  if (!IS_WINDOWS) {
    throw new Error("Running as administrator is only supported on Windows");
  }
  const escape = (value: string): string => value.replace(/'/g, "''");
  let command =
    "$ErrorActionPreference='Stop'; " +
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    `$p = Start-Process -FilePath '${escape(exePath)}'`;
  if (cwd) command += ` -WorkingDirectory '${escape(cwd)}'`;
  if (launchArguments) command += ` -ArgumentList '${escape(launchArguments)}'`;
  command += " -Verb RunAs -PassThru; if ($p) { $p.Id }";

  let result: CommandResult;
  try {
    result = await runCapture(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      180_000,
    );
  } catch (error) {
    throw new Error(`Failed to launch game with elevation: ${describeError(error)}`);
  }

  if (result.code !== 0) {
    const text = `${result.stderr}`.trim();
    if (/cancel|annul|1223/i.test(text)) {
      throw new Error(
        "Failed to launch game with elevation: The operation was cancelled by the user",
      );
    }
    throw new Error(
      `Failed to launch game with elevation: ${text || `powershell exited with ${result.code}`}`,
    );
  }

  const pid = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : 0;
}

async function openProtocol(url: string, label: string): Promise<void> {
  try {
    await shell.openExternal(url);
  } catch (error) {
    throw new Error(`Failed to open ${label} URL: ${describeError(error)}`);
  }
}

function requireSteamAppId(steamAppId: number | null): number {
  if (!steamAppId || steamAppId <= 0) {
    throw new Error("Steam games require a steamAppId");
  }
  return steamAppId;
}

/** Derive Epic's launcher URL from an `epic-<namespace>-<catalogId>` game id. */
function epicLaunchUrl(gameId: string): string | null {
  const prefix = "epic-";
  if (!gameId.startsWith(prefix)) return null;
  const rest = gameId.slice(prefix.length);
  const match = /^([0-9a-fA-F]{32})-([0-9a-fA-F]{32})$/.exec(rest);
  if (!match) return null;
  return `com.epicgames.launcher://apps/${match[1]}-${match[2]}?action=launch&silent=true`;
}

/**
 * Launch a game. Returns the user-facing message the renderer shows in its
 * success toast (same strings the Rust command produced).
 */
export async function launchGame(args: Record<string, unknown>): Promise<string> {
  const gameId = readString(args, "gameId");
  if (!gameId) throw new Error("launch_game requires a gameId");
  const gameName = readString(args, "gameName") ?? "Game";
  const gamePath = readString(args, "gamePath") ?? "";
  const platform = readString(args, "platform") ?? "";
  const steamAppId =
    readNumber(args, "steamAppId") ?? deriveSteamAppId(gameId, gamePath);
  const launchArguments = readString(args, "launchArguments");
  const runAsAdmin = readBoolean(args, "runAsAdmin");
  const preLaunchScript = readString(args, "preLaunchScript");
  const preLaunchAdmin = readBoolean(args, "preLaunchAdmin");
  const postExitScript = readString(args, "postExitScript");
  const postExitAdmin = readBoolean(args, "postExitAdmin");
  const companionApps = readCompanions(args.companionApps);
  const gpuSelection = readGpuSelection(args.gpuSelection);
  const showSteamSelection = readBoolean(args, "showSteamLaunchSelection");
  const disableElevation = Boolean(getAppSetting("disable_elevation_prompts"));

  emitProgress(gameId, "resolvingPaths");

  if (disableElevation && runAsAdmin) {
    throw new Error(ELEVATION_BLOCKED_RUN_AS_ADMIN);
  }

  // ── Pre-launch script (awaited, before any process spawn) ──────────
  if (preLaunchScript) {
    if (disableElevation && preLaunchAdmin) {
      throw new Error(ELEVATION_BLOCKED_PRE_LAUNCH);
    }
    emitProgress(gameId, "preLaunchScript");
    await runScriptBlocking(preLaunchScript, preLaunchAdmin);
  }

  let initialPid = 0;
  let exePath: string | null = gamePath || null;

  if (platform !== "Steam" && gamePath && isUri(gamePath)) {
    // A game whose path is already a protocol URL (custom launcher, GOG, …).
    await openProtocol(gamePath, "launcher");
    exePath = null;
  } else if (platform === "Steam" && steamAppId) {
    const appId = requireSteamAppId(steamAppId);

    // Steam owns the launch, so Wine/Proton settings are persisted as the
    // app's Steam launch options (`%command%` prefix) rather than inherited.
    if (IS_LINUX) {
      try {
        const logDir = steamWineLogDirForGame(gameId);
        // Start every launch with a fresh Proton log so Settings → Logs shows
        // only the current run.
        fs.rmSync(logDir, { recursive: true, force: true });
        fs.mkdirSync(logDir, { recursive: true });
        const profile = gameCompatibilityProfile(gameId);
        const prefix =
          profile?.enabled === false
            ? ""
            : steamLaunchPrefixForGame(gameId, profile, logDir);
        applySteamLaunchOptions(appId, prefix);
      } catch (error) {
        console.warn("[launch] could not apply Steam launch options:", error);
      }
    }

    // Resolve the installed exe before Steam starts so the watcher can attach
    // to the real process without waiting for a path sweep.
    if (!exePath || !fs.existsSync(exePath)) {
      try {
        const installDir = await steamGameInstallPath(appId);
        if (installDir) exePath = await resolveGameExe(installDir, gameName);
      } catch {
        /* keep the stored path */
      }
    }

    await openProtocol(steamLaunchUrl(appId, showSteamSelection), "Steam");
  } else if (platform === "Ubisoft" && !gamePath) {
    const uplayId = gameId.startsWith("uplay-") ? gameId.slice("uplay-".length) : "";
    if (!uplayId) throw new Error("Ubisoft games require a uplay-<id> game id");
    await openProtocol(`uplay://launch/${uplayId}`, "Ubisoft");
    exePath = null;
  } else if (platform === "Epic" && (!gamePath || !fs.existsSync(gamePath))) {
    const url = epicLaunchUrl(gameId);
    if (!url) {
      throw new Error(
        "Epic games need an installed executable or an epic-<namespace>-<catalogId> game id to launch",
      );
    }
    await openProtocol(url, "Epic");
    exePath = null;
  } else {
    // Direct executable spawn.
    if (!fs.existsSync(gamePath)) {
      throw new Error(`Game executable not found: ${gamePath}`);
    }
    const cwd = path.dirname(gamePath);

    // Linux: a Windows executable (or a game that names a runner) goes through
    // Wine/Proton instead of being spawned directly. Windows keeps the direct
    // spawn below. `shouldUseCompatibility` is null-safe: a game with no saved
    // profile still gets the global compatibility settings, and an explicit
    // per-game `enabled: false` opts out.
    const compatProfile = IS_WINDOWS ? null : gameCompatibilityProfile(gameId);
    if (!IS_WINDOWS && shouldUseCompatibility(gamePath, compatProfile)) {
      emitProgress(gameId, "compatibilityRunner");
      const result = await launchWithCompatibility({
        gameId,
        gameName,
        exePath: gamePath,
        workingDir: cwd,
        launchArguments,
        profile: compatProfile,
        steamAppId,
        gpuSelection,
      });
      initialPid = result.pid;
    } else if (runAsAdmin) {
      emitProgress(gameId, "elevating");
      initialPid = await launchElevated(gamePath, cwd, launchArguments);
    } else {
      try {
        const child = await spawnProgram(gamePath, launchArguments, cwd);
        initialPid = child.pid ?? 0;
        // We never wait on the child: the watcher polls the real lifecycle so
        // a launcher that exits before the game keeps the session alive.
        child.on("error", (error) => {
          console.error(`[launch] ${gameName} exited with an error:`, error);
        });
      } catch (error) {
        if (isElevationError(error)) {
          if (disableElevation) throw new Error(ELEVATION_BLOCKED_IMPLICIT);
          emitProgress(gameId, "elevating");
          initialPid = await launchElevated(gamePath, cwd, launchArguments);
        } else {
          throw new Error(`Failed to launch game: ${describeError(error)}`);
        }
      }
    }
  }

  // ── Register with the watcher (session row + game-started) ──────────
  emitProgress(gameId, "startingGame");

  let installDir: string | null = null;
  if (platform === "Steam" && steamAppId) {
    try {
      installDir = await steamGameInstallPath(steamAppId);
    } catch {
      installDir = null;
    }
  }
  if (!installDir && exePath) installDir = getGameRootDir(exePath);

  registerLaunchedSession({
    gameId,
    gameName,
    platform,
    exePath,
    installDir,
    pid: initialPid,
    postExitScript: postExitScript ? { script: postExitScript, admin: postExitAdmin } : null,
  });

  emitProgress(gameId, "loadingAssets");

  // ── Companion apps (delayed, fire-and-forget) ──────────────────────
  if (companionApps.length > 0) {
    emitProgress(gameId, "companionApps");
    for (const app of companionApps) spawnCompanion(app);
  }

  emitProgress(gameId, "launching");

  if (platform === "Steam" && showSteamSelection) {
    return `Launched ${gameName} via Steam (launch picker)`;
  }
  if (platform === "Steam" && initialPid === 0) {
    return `Launched ${gameName} via Steam (tracking via process watcher)`;
  }
  return `Launched: ${gamePath}`;
}

/** Test hook: expose the spawn argv builder without launching anything. */
export const __test = { buildSpawnArgs, epicLaunchUrl };
