/**
 * Wine / Proton game launching (Linux).
 *
 * Ported from `src-tauri/src/compatibility/launch.rs`. The `launch_game`
 * command spawns executables directly, which on Linux only works for native
 * ELF binaries: a `.exe` needs a runner. This module builds the command chain
 * the Rust launcher used:
 *
 *   [gamescope … --] [gamemoderun] [mangohud] [umu-run | runner [run]]
 *   [explorer.exe /desktop=…] <exe> <launch arguments>
 *
 * with the per-game `CompatibilityProfile` overriding the global
 * `CompatibilitySettings` field by field, the WINEPREFIX resolved the same way
 * (custom → default prefix → default base dir/<gameId>), and the full env
 * matrix (sync primitives, DXVK/VKD3D, NVAPI, Wayland/WoW64, DLL overrides,
 * Proton compat vars, user variables). Output is appended to
 * `<userData>/wine-logs/<gameId>.log`, which Settings → Compatibility shows.
 *
 * Everything here is Linux-only and returns a clear error on other platforms;
 * Windows launches keep spawning the game directly.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { getGame } from "../../state/libraryStore";
import { userDataPath } from "../../lib/paths";
import { splitLaunchArgs } from "../launch/scripts";
import { wineLogPathForGame } from "./logs";
import {
  commandAvailable,
  defaultPrefixBase,
  IS_LINUX,
  listRunners,
  steamRoots,
  umuRunPath,
} from "./platform";
import { getCompatibilitySettings } from "./settings";
import type { CompatibilitySettings } from "./types";

/**
 * The subset of the renderer's `CompatibilityProfile` (`Game.compatibility`)
 * the launcher reads. Unknown keys are ignored so older/newer renderers cannot
 * break a launch.
 */
export interface CompatProfile {
  enabled?: boolean;
  runnerType?: "default" | "proton" | "wine" | "custom";
  customRunnerPath?: string;
  customWinePrefix?: string;
  arch?: "win64" | "win32";
  workingDir?: string;
  enableDxvk?: boolean | null;
  enableVkd3d?: boolean | null;
  enableVkd3dDescriptorHeap?: boolean | null;
  enableEsync?: boolean | null;
  enableFsync?: boolean | null;
  enableNtsync?: boolean | null;
  enableDxvkNvapi?: boolean | null;
  enableDxvkAsync?: boolean | null;
  dxvkHud?: string;
  enableWayland?: boolean | null;
  enableWow64?: boolean | null;
  enableLargeAddressAware?: boolean | null;
  wineDebug?: string | null;
  audioDriver?: string | null;
  virtualDesktop?: boolean | null;
  virtualDesktopRes?: string | null;
  enableMangoHud?: boolean | null;
  enableUmuLauncher?: boolean | null;
  enableControllerSupport?: boolean | null;
  enableAnticheatSupport?: boolean | null;
  enableGameMode?: boolean | null;
  enableGamescope?: boolean | null;
  gamescopeMode?: string | null;
  gamescopeGameWidth?: number | null;
  gamescopeGameHeight?: number | null;
  gamescopeWindowWidth?: number | null;
  gamescopeWindowHeight?: number | null;
  gamescopeFilter?: string | null;
  gamescopeFsrSharpness?: number | null;
  gamescopeFpsLimit?: number | null;
  gamescopeRefreshRate?: number | null;
  gamescopeAdaptiveSync?: boolean | null;
  gamescopeHdr?: boolean | null;
  gamescopeStretch?: boolean | null;
  gamescopeForceWindowsFullscreen?: boolean | null;
  gamescopeArgs?: string | null;
  primeRenderOffload?: boolean | null;
  environmentVariables?: Record<string, string>;
  dllOverrides?: Record<string, string>;
  excludedGlobalEnv?: string[];
  excludedGlobalDlls?: string[];
}

export interface CompatibilityLaunchInput {
  gameId: string;
  gameName: string;
  exePath: string;
  workingDir: string;
  launchArguments: string | null;
  profile: CompatProfile | null;
  steamAppId?: number | null;
}

export interface CompatibilityLaunchResult {
  pid: number;
  command: string;
  logPath: string;
}

function pick<T>(value: T | null | undefined, fallback: T): T {
  return typeof value === "boolean" ? (value as T) : fallback;
}

function profileString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Read the per-game compatibility profile stored on the library row. */
export function gameCompatibilityProfile(gameId: string): CompatProfile | null {
  try {
    const game = getGame(gameId);
    const profile = (game as { compatibility?: unknown } | null)?.compatibility;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    return profile as CompatProfile;
  } catch {
    return null;
  }
}

/**
 * Prefix folders this game may launch with: the per-game override, the global
 * default, then the generated `<base>/<gameId>` folder. Used by save detection
 * so a Wine/Proton title's saves are found outside Steam's compatdata.
 */
export function compatibilityPrefixCandidates(gameId: string): string[] {
  const settings = getCompatibilitySettings();
  const profile = gameCompatibilityProfile(gameId);
  const candidates: string[] = [];
  const add = (value: string | null | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };
  add(profile?.customWinePrefix);
  add(settings.defaultPrefix);
  const base = settings.defaultPrefixBaseDir?.trim() || defaultPrefixBase();
  add(path.join(base, gameId));
  return candidates;
}

/**
 * True when a launch should go through Wine/Proton: Linux, and either the
 * executable is a Windows binary, the game names a custom runner, or the
 * profile explicitly enables the layer. An explicit `enabled: false` wins so a
 * user can opt out (for example for a native wrapper they configured).
 */
export function shouldUseCompatibility(exePath: string, profile: CompatProfile | null): boolean {
  if (!IS_LINUX) return false;
  if (profile?.enabled === false) return false;
  if (profile?.enabled === true) return true;
  if (profileString(profile?.customRunnerPath)) return true;
  return exePath.toLowerCase().endsWith(".exe");
}

/**
 * Drop AppImage mount paths from the runner environment.
 *
 * AppRun exports `PYTHONHOME`/`PYTHONPATH` pointing at the ephemeral mount and
 * prepends it to `LD_LIBRARY_PATH`; Proton's Python launcher then aborts with
 * "Failed to import encodings module". Only entries under `APPDIR` are dropped,
 * so a user's own paths survive.
 */
export function stripAppImageEnv(env: NodeJS.ProcessEnv): void {
  const appDir = process.env.APPDIR;
  if (!appDir) return;
  for (const key of ["PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"]) {
    const value = env[key];
    if (!value) continue;
    const entries = value.split(":");
    if (!entries.some((entry) => entry === appDir || entry.startsWith(`${appDir}/`))) continue;
    const kept = entries.filter(
      (entry) => entry && !(entry === appDir || entry.startsWith(`${appDir}/`)),
    );
    if (kept.length > 0) env[key] = kept.join(":");
    else delete env[key];
  }
}

/**
 * The Proton install folder for a runner path - the directory that contains
 * the `proton` script (umu's `PROTONPATH` expects the folder, not the script).
 * Returns null for plain Wine binaries.
 */
export function protonFolderForRunner(runnerPath: string): string | null {
  try {
    if (fs.statSync(runnerPath).isDirectory()) {
      return fs.existsSync(path.join(runnerPath, "proton")) ? runnerPath : null;
    }
  } catch {
    /* missing path - fall through to the heuristic */
  }
  const parent = path.dirname(runnerPath);
  return fs.existsSync(path.join(parent, "proton")) ? parent : null;
}

function isProtonRunner(runnerPath: string): boolean {
  if (protonFolderForRunner(runnerPath)) return true;
  const lower = runnerPath.toLowerCase();
  return lower.includes("proton") && !lower.endsWith("wine");
}

/** `<dir>/proton` for a compat-tool folder, otherwise the path as given. */
function runnerExecutable(runnerPath: string): string {
  try {
    if (fs.statSync(runnerPath).isDirectory()) {
      const script = path.join(runnerPath, "proton");
      return fs.existsSync(script) ? script : runnerPath;
    }
  } catch {
    /* not a directory */
  }
  return runnerPath;
}

function resolvePrefix(
  settings: CompatibilitySettings,
  profile: CompatProfile | null,
  gameId: string,
): string {
  const custom = profileString(profile?.customWinePrefix);
  if (custom) return custom;
  const configured = profileString(settings.defaultPrefix);
  if (configured) return configured;
  const base = profileString(settings.defaultPrefixBaseDir) ?? defaultPrefixBase();
  return path.join(base, gameId);
}

async function resolveRunner(
  settings: CompatibilitySettings,
  profile: CompatProfile | null,
): Promise<string> {
  const custom = profileString(profile?.customRunnerPath);
  if (custom) return custom;
  const configured = profileString(settings.defaultRunnerPath);
  if (configured) return configured;
  try {
    const runners = await listRunners();
    const preferred = runners.find((runner) => runner.isProton) ?? runners[0];
    if (preferred) return preferred.path;
  } catch {
    /* detection failed - fall back to PATH */
  }
  return "wine";
}

function gamescopeTokens(
  settings: CompatibilitySettings,
  profile: CompatProfile | null,
): string[] {
  const enabled = pick(profile?.enableGamescope, settings.enableGamescope);
  if (!enabled || !commandAvailable("gamescope")) return [];

  const mode = profile?.gamescopeMode ?? settings.gamescopeMode;
  const gameWidth = profile?.gamescopeGameWidth ?? settings.gamescopeGameWidth;
  const gameHeight = profile?.gamescopeGameHeight ?? settings.gamescopeGameHeight;
  const windowWidth = profile?.gamescopeWindowWidth ?? settings.gamescopeWindowWidth;
  const windowHeight = profile?.gamescopeWindowHeight ?? settings.gamescopeWindowHeight;
  const filter = profile?.gamescopeFilter ?? settings.gamescopeFilter;
  const sharpness = profile?.gamescopeFsrSharpness ?? settings.gamescopeFsrSharpness;
  const fpsLimit = profile?.gamescopeFpsLimit ?? settings.gamescopeFpsLimit;
  const refresh = profile?.gamescopeRefreshRate ?? settings.gamescopeRefreshRate;
  const adaptiveSync = pick(profile?.gamescopeAdaptiveSync, settings.gamescopeAdaptiveSync);
  const hdr = pick(profile?.gamescopeHdr, settings.gamescopeHdr);
  const stretch = pick(profile?.gamescopeStretch, settings.gamescopeStretch);
  const forceWindowsFullscreen = pick(profile?.gamescopeForceWindowsFullscreen,
    settings.gamescopeForceWindowsFullscreen,
  );
  const extra = profile?.gamescopeArgs ?? settings.gamescopeArgs;

  const tokens: string[] = ["gamescope"];
  if (mode === "fullscreen") tokens.push("-f");
  else if (mode === "borderless") tokens.push("-b");
  if (gameWidth && gameHeight) tokens.push("-w", String(gameWidth), "-h", String(gameHeight));
  if (windowWidth && windowHeight) tokens.push("-W", String(windowWidth), "-H", String(windowHeight));
  if (filter) {
    if (filter === "integer") tokens.push("-i");
    else tokens.push("-F", filter);
  }
  if (sharpness != null) tokens.push("--fsr-sharpness", String(sharpness));
  if (fpsLimit != null) tokens.push("-r", String(fpsLimit));
  if (refresh != null) tokens.push("-o", String(refresh));
  if (adaptiveSync) tokens.push("--adaptive-sync");
  if (hdr) tokens.push("--hdr-enabled");
  if (stretch) tokens.push("-s");
  if (forceWindowsFullscreen) tokens.push("--force-windows-fullscreen");
  if (extra?.trim()) tokens.push(...splitLaunchArgs(extra));
  tokens.push("--");
  return tokens;
}

/** Column-before-row order so the resulting string is deterministic. */
export function dllOverrideString(map: Record<string, string>): string {
  return Object.keys(map)
    .sort()
    .map((key) => `${key}=${map[key]}`)
    .join(";");
}

/**
 * Launch a Windows executable through the configured runner.
 *
 * Throws when no runner can be resolved or the spawn fails; the caller shows
 * that message in the launch splash.
 */
export async function launchWithCompatibility(
  input: CompatibilityLaunchInput,
): Promise<CompatibilityLaunchResult> {
  if (!IS_LINUX) {
    throw new Error("Wine/Proton launching is only available on Linux");
  }

  const settings = getCompatibilitySettings();
  const profile = input.profile;

  const runnerPath = await resolveRunner(settings, profile);
  if (!runnerPath) throw new Error("No Wine/Proton runner configured");
  const runner = runnerExecutable(runnerPath);
  const isProton = isProtonRunner(runner);
  // `wine` is the PATH fallback from resolveRunner; make it actionable when the
  // binary is not actually installed instead of failing after the log header.
  if (runner === "wine" && !commandAvailable("wine")) {
    throw new Error(
      "Wine is not installed. Install it with your package manager, or pick a Proton runner in Settings → Compatibility.",
    );
  }

  const umuRun = pick(profile?.enableUmuLauncher, settings.enableUmuLauncher)
    ? umuRunPath()
    : null;
  const protonFolder = protonFolderForRunner(runner);
  const useUmu = Boolean(umuRun && isProton && protonFolder);

  const prefix = resolvePrefix(settings, profile, input.gameId);
  try {
    fs.mkdirSync(prefix, { recursive: true });
  } catch (error) {
    throw new Error(
      `Could not create the Wine prefix at ${prefix}: ${error instanceof Error ? error.message : error}`,
    );
  }

  const logPath = wineLogPathForGame(input.gameId);
  const env: NodeJS.ProcessEnv = { ...process.env };
  stripAppImageEnv(env);
  // Snapshot of the inherited environment: the session log only needs the
  // variables this launcher sets, not the whole (possibly secret-bearing) env.
  const baseEnv: NodeJS.ProcessEnv = { ...env };
  env.WINEPREFIX = prefix;

  if (profile?.arch) env.WINEARCH = profile.arch;
  env.WINEESYNC = pick(profile?.enableEsync, settings.enableEsync) ? "1" : "0";
  env.WINEFSYNC = pick(profile?.enableFsync, settings.enableFsync) ? "1" : "0";
  if (pick(profile?.enableNtsync, settings.enableNtsync)) {
    env.WINESYNC = "1";
    env.WINENTSYNC = "1";
  }
  if (pick(profile?.enableDxvkNvapi, settings.enableDxvkNvapi)) {
    env.DXVK_ENABLE_NVAPI = "1";
  }
  if (pick(profile?.enableDxvkAsync, settings.enableDxvkAsync)) {
    env.DXVK_ASYNC = "1";
  }
  if (pick(profile?.enableWayland, settings.enableWayland)) {
    env.WINE_ENABLE_WAYLAND = "1";
  }
  if (pick(profile?.enableWow64, settings.enableWow64)) {
    env.WINE_NEW_WOW64 = "1";
  }
  if (pick(profile?.enableLargeAddressAware, settings.enableLargeAddressAware)) {
    env.WINE_LARGE_ADDRESS_AWARE = "1";
  }
  if (pick(profile?.enableControllerSupport, settings.enableControllerSupport)) {
    env.PROTON_PREFER_SDL = "1";
  }
  if (pick(profile?.enableAnticheatSupport, settings.enableAnticheatSupport)) {
    // Runtimes live under <userData>/anticheat when the user installed them;
    // Proton only reads the variables when the folder exists.
    const root = userDataPath("anticheat");
    const eac = path.join(root, "easyanticheat");
    const battleye = path.join(root, "battleye");
    if (fs.existsSync(eac)) env.PROTON_EAC_RUNTIME = eac;
    if (fs.existsSync(battleye)) env.PROTON_BATTLEYE_RUNTIME = battleye;
  }

  const wineDebug = profile?.wineDebug ?? settings.wineDebug;
  if (wineDebug) env.WINEDEBUG = wineDebug;
  const audioDriver = profile?.audioDriver ?? settings.audioDriver;
  if (audioDriver && audioDriver !== "auto") env.WINEAUDIODRIVER = audioDriver;
  if (profile?.dxvkHud?.trim()) env.DXVK_HUD = profile.dxvkHud.trim();

  const enableDxvk = pick(profile?.enableDxvk, settings.enableDxvk);
  const enableVkd3d = pick(profile?.enableVkd3d, settings.enableVkd3d);
  const enableVkd3dHeap = pick(profile?.enableVkd3dDescriptorHeap,
    settings.enableVkd3dDescriptorHeap,
  );

  const excludedDlls = new Set(profile?.excludedGlobalDlls ?? []);
  const dllMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings.customDllOverrides ?? {})) {
    if (!excludedDlls.has(key)) dllMap[key] = value;
  }
  for (const [key, value] of Object.entries(profile?.dllOverrides ?? {})) {
    if (typeof value === "string") dllMap[key] = value;
  }
  if (enableDxvk) {
    for (const dll of ["d3d11", "dxgi", "d3d10core", "d3d9"]) {
      if (!(dll in dllMap)) dllMap[dll] = "n,b";
    }
  }
  if (enableVkd3d && !("d3d12" in dllMap)) dllMap.d3d12 = "n,b";
  if (enableVkd3d && enableVkd3dHeap) {
    if (isProton) env.PROTON_VKD3D_HEAP = "1";
    else env.VKD3D_CONFIG = "descriptor_heap";
  }
  if (Object.keys(dllMap).length > 0) env.WINEDLLOVERRIDES = dllOverrideString(dllMap);

  if (pick(profile?.primeRenderOffload, settings.primeRenderOffload)) {
    env.DRI_PRIME = "1";
    env.__NV_PRIME_RENDER_OFFLOAD = "1";
    env.__GLX_VENDOR_LIBRARY_NAME = "nvidia";
    env.__VK_LAYER_NV_optimus = "NVIDIA_only";
  }

  const steamRoot = steamRoots()[0];
  if (isProton && !useUmu) {
    env.STEAM_COMPAT_DATA_PATH = prefix;
    if (steamRoot) env.STEAM_COMPAT_CLIENT_INSTALL_PATH = steamRoot;
  }
  if (useUmu) {
    env.GAMEID = `umu-${input.gameId}`;
    env.STORE = "none";
    if (protonFolder) env.PROTONPATH = protonFolder;
  }
  if (input.steamAppId) {
    env.SteamAppId = String(input.steamAppId);
    env.SteamGameId = String(input.steamAppId);
    if (steamRoot) env.SteamPath = steamRoot;
  }

  const excludedEnv = new Set(profile?.excludedGlobalEnv ?? []);
  for (const key of Object.keys(settings.customEnvironmentVariables ?? {}).sort()) {
    if (!excludedEnv.has(key)) env[key] = settings.customEnvironmentVariables[key];
  }
  for (const [key, value] of Object.entries(profile?.environmentVariables ?? {})) {
    if (typeof value === "string") env[key] = value;
  }

  const tokens: string[] = [];
  tokens.push(...gamescopeTokens(settings, profile));
  if (pick(profile?.enableGameMode, settings.enableGameMode) && commandAvailable("gamemoderun")) {
    tokens.push("gamemoderun");
  }
  if (pick(profile?.enableMangoHud, settings.enableMangoHud) && commandAvailable("mangohud")) {
    tokens.push("mangohud");
  }
  if (useUmu && umuRun) {
    tokens.push(umuRun);
  } else {
    tokens.push(runner);
    if (isProton) tokens.push("run");
  }

  if (pick(profile?.virtualDesktop, settings.virtualDesktop)) {
    tokens.push("explorer.exe");
    tokens.push(
      `/desktop=GameIndex,${profile?.virtualDesktopRes ?? settings.virtualDesktopRes ?? "1920x1080"}`,
    );
  }

  tokens.push(input.exePath);
  if (input.launchArguments?.trim()) {
    tokens.push(...splitLaunchArgs(input.launchArguments));
  }

  const [program, ...args] = tokens;
  const workingDir = profileString(profile?.workingDir) ?? input.workingDir;

  // Header first, then the process output is appended as it runs.
  const envLine = Object.entries(env)
    .filter(([key, value]) => baseEnv[key] !== value)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      [
        "==================================================",
        "GameIndex Compatibility Session Log",
        `Game: ${input.gameName} (${input.gameId})`,
        `Timestamp: ${new Date().toISOString()}`,
        `Executable: ${input.exePath}`,
        `Runner: ${runner}${isProton ? " (Proton)" : " (Wine)"}`,
        `Prefix: ${prefix}`,
        `UMU: ${useUmu}, GameMode: ${tokens.includes("gamemoderun")}, MangoHud: ${tokens.includes("mangohud")}`,
        "--- environment ---",
        envLine,
        "--- command ---",
        [program, ...args].map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" "),
        "==================================================",
        "",
      ].join("\n"),
      "utf8",
    );
  } catch (error) {
    console.warn("[compatibility] could not write the session log:", error);
  }

  let logFd: number | null = null;
  try {
    logFd = fs.openSync(logPath, "a");
    const child = spawn(program, args, {
      cwd: workingDir,
      env,
      stdio: ["ignore", logFd, logFd],
      windowsHide: false,
      detached: false,
    });

    // `spawn` reports a missing runner asynchronously; wait for the event so a
    // failed launch surfaces in the splash instead of silently reporting
    // success with pid 0.
    const pid = await new Promise<number>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off("error", onError);
        resolve(child.pid ?? 0);
      };
      const onError = (error: Error): void => {
        child.off("spawn", onSpawn);
        try {
          fs.appendFileSync(logPath, `\n[launcher] ${error.message}\n`);
        } catch {
          /* log already gone */
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          reject(
            new Error(
              `Wine/Proton runner not found: ${program}. Install Wine or pick a Proton build in Settings → Compatibility.`,
            ),
          );
          return;
        }
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    return {
      pid,
      command: [program, ...args].join(" "),
      logPath,
    };
  } finally {
    if (logFd !== null) {
      // The child has its own duplicate of the descriptor.
      try {
        fs.closeSync(logFd);
      } catch {
        /* ignore */
      }
    }
  }
}
