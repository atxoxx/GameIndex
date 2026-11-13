/**
 * Steam-owned launches: persist Wine/Proton flags as per-app Steam launch
 * options so `steam://run/<appid>` applies them.
 *
 * Steam launches the game itself, so GameIndex's process environment is not
 * inherited. The only supported hand-off is the app's `LaunchOptions` string in
 * `localconfig.vdf`: Steam splices it around `%command%`. This module builds
 * that string from the global/per-game compatibility settings and edits only
 * the one value, preserving the rest of the file byte-for-byte.
 */
import fs from "node:fs";
import path from "node:path";
import { getAppSetting } from "../../state/appSettings";
import {
  deleteDocument,
  readDocumentText,
  writeDocumentText,
} from "../../state/db/documents";
import { mangohudLogDir } from "../telemetry/linux";
import { splitLaunchArgs } from "../launch/scripts";
import { commandAvailable, steamRoots } from "./platform";
import { DEFAULT_COMPATIBILITY_SETTINGS, getCompatibilitySettings } from "./settings";
import { gamescopeTokens, type CompatProfile } from "./launch";
import { specificGpuEnv, specificGpuSelection, type GpuSelection } from "./gpuSelection";
import {
  mergeSteamLaunchOptions,
  quoteLaunchEnvValue,
  readSteamLaunchOptions,
  setSteamLaunchOptions,
} from "./steamConfig";
import type { CompatibilitySettings } from "./types";

function pick<T>(value: T | null | undefined, fallback: T): T {
  return typeof value === "boolean" ? (value as T) : fallback;
}

/** True unless hardware monitoring or FPS capture is explicitly disabled. */
function fpsCaptureEnabled(): boolean {
  const raw = getAppSetting("metrics_config");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
  const config = raw as Record<string, unknown>;
  return config.enabled !== false && config.captureFps !== false;
}

function dllOverrideString(map: Record<string, string>): string {
  return Object.keys(map)
    .sort()
    .map((key) => `${key}=${map[key]}`)
    .join(";");
}

/**
 * Environment assignments + wrapper commands for a Steam launch.
 *
 * Deliberately excludes `WINEPREFIX`, `PROTONPATH` and `STEAM_COMPAT_DATA_PATH`:
 * Steam owns those. Everything else follows the direct launcher.
 */
export function buildSteamLaunchPrefix(
  settings: CompatibilitySettings,
  profile: CompatProfile | null,
  options: { gameId: string; protonLogDir?: string | null },
): string {
  const env: Record<string, string> = {};

  if (profile?.arch) env.WINEARCH = profile.arch;
  env.WINEESYNC = pick(profile?.enableEsync, settings.enableEsync) ? "1" : "0";
  env.WINEFSYNC = pick(profile?.enableFsync, settings.enableFsync) ? "1" : "0";
  if (pick(profile?.enableNtsync, settings.enableNtsync)) {
    env.WINESYNC = "1";
    env.WINENTSYNC = "1";
  }
  if (pick(profile?.enableDxvkNvapi, settings.enableDxvkNvapi)) env.DXVK_ENABLE_NVAPI = "1";
  if (pick(profile?.enableDxvkAsync, settings.enableDxvkAsync)) env.DXVK_ASYNC = "1";
  if (pick(profile?.enableWayland, settings.enableWayland)) {
    env.WINE_ENABLE_WAYLAND = "1";
    env.PROTON_ENABLE_WAYLAND = "1";
  }
  if (pick(profile?.enableWow64, settings.enableWow64)) {
    env.WINE_NEW_WOW64 = "1";
    env.PROTON_USE_WOW64 = "1";
  }
  if (pick(profile?.enableLargeAddressAware, settings.enableLargeAddressAware)) {
    env.WINE_LARGE_ADDRESS_AWARE = "1";
  }
  if (pick(profile?.enableControllerSupport, settings.enableControllerSupport)) {
    env.PROTON_PREFER_SDL = "1";
  }
  if (pick(profile?.enableAnticheatSupport, settings.enableAnticheatSupport)) {
    const root = path.join(
      process.env.XDG_CONFIG_HOME?.trim() ||
        path.join(process.env.HOME || "", ".config"),
      "GameIndex",
      "anticheat",
    );
    if (fs.existsSync(path.join(root, "easyanticheat"))) {
      env.PROTON_EAC_RUNTIME = path.join(root, "easyanticheat");
    }
    if (fs.existsSync(path.join(root, "battleye"))) {
      env.PROTON_BATTLEYE_RUNTIME = path.join(root, "battleye");
    }
  }

  const wineDebug = profile?.wineDebug ?? settings.wineDebug;
  if (wineDebug) env.WINEDEBUG = wineDebug;
  const audioDriver = profile?.audioDriver ?? settings.audioDriver;
  if (audioDriver && audioDriver !== "auto") env.WINEAUDIODRIVER = audioDriver;
  if (profile?.dxvkHud?.trim()) env.DXVK_HUD = profile.dxvkHud.trim();

  const enableDxvk = pick(profile?.enableDxvk, settings.enableDxvk);
  const enableVkd3d = pick(profile?.enableVkd3d, settings.enableVkd3d);
  const enableVkd3dHeap = pick(
    profile?.enableVkd3dDescriptorHeap,
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
    env.PROTON_VKD3D_HEAP = "1";
    env.VKD3D_CONFIG = "descriptor_heap";
  }
  if (Object.keys(dllMap).length > 0) env.WINEDLLOVERRIDES = dllOverrideString(dllMap);

  if (pick(profile?.primeRenderOffload, settings.primeRenderOffload)) {
    env.DRI_PRIME = "1";
    env.__NV_PRIME_RENDER_OFFLOAD = "1";
    env.__GLX_VENDOR_LIBRARY_NAME = "nvidia";
    env.__VK_LAYER_NV_optimus = "NVIDIA_only";
  }

  const gpu: GpuSelection | null = specificGpuSelection(
    settings,
    profile,
    null,
  );
  if (gpu) {
    for (const [key, value] of specificGpuEnv(gpu)) env[key] = value;
  }

  const excludedEnv = new Set(profile?.excludedGlobalEnv ?? []);
  for (const key of Object.keys(settings.customEnvironmentVariables ?? {}).sort()) {
    if (!excludedEnv.has(key)) env[key] = settings.customEnvironmentVariables[key];
  }
  for (const [key, value] of Object.entries(profile?.environmentVariables ?? {})) {
    if (typeof value === "string") env[key] = value;
  }

  const mangoWanted = pick(profile?.enableMangoHud, settings.enableMangoHud);
  const useMango = commandAvailable("mangohud") && (mangoWanted || fpsCaptureEnabled());
  if (useMango) {
    const logDir = mangohudLogDir(options.gameId);
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      /* best effort */
    }
    env.MANGOHUD = "1";
    const pieces = [
      "read_cfg",
      "log_interval=1000",
      `output_folder=${logDir}`,
      "autostart_log=1",
    ];
    if (env.MANGOHUD_CONFIG?.trim()) pieces.push(env.MANGOHUD_CONFIG.trim());
    if (!mangoWanted || pick(profile?.mangohudHidden, settings.mangohudHidden)) {
      pieces.push("no_display");
    }
    env.MANGOHUD_CONFIG = pieces.join(",");
  }

  if (options.protonLogDir) {
    env.PROTON_LOG = "1";
    env.PROTON_LOG_DIR = options.protonLogDir;
  }

  const parts: string[] = [];
  for (const key of Object.keys(env).sort()) {
    parts.push(`${key}=${quoteLaunchEnvValue(env[key])}`);
  }

  const wrappers: string[] = [];
  wrappers.push(...gamescopeTokens(settings, profile));
  if (pick(profile?.enableGameMode, settings.enableGameMode) && commandAvailable("gamemoderun")) {
    wrappers.push("gamemoderun");
  }
  if (profile?.preLaunchWrapper?.trim()) {
    wrappers.unshift(...splitLaunchArgs(profile.preLaunchWrapper));
  }
  return [...parts, ...wrappers].join(" ").trim();
}

/** Most recently written account localconfig, across every Steam root. */
export function activeLocalconfigPath(): string | null {
  let best: { file: string; mtime: number } | null = null;
  for (const root of steamRoots()) {
    const userdata = path.join(root, "userdata");
    let accounts: fs.Dirent[] = [];
    try {
      accounts = fs.readdirSync(userdata, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const account of accounts) {
      if (!account.isDirectory() || !/^\d+$/.test(account.name)) continue;
      const file = path.join(userdata, account.name, "config", "localconfig.vdf");
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && (!best || stat.mtimeMs > best.mtime)) {
          best = { file, mtime: stat.mtimeMs };
        }
      } catch {
        /* no config for this account */
      }
    }
  }
  return best?.file ?? null;
}

function backupOnce(file: string): void {
  const backup = `${file}.gameindex.bak`;
  if (fs.existsSync(backup)) return;
  try {
    fs.copyFileSync(file, backup);
  } catch {
    /* backup is best effort; the atomic write still protects the original */
  }
}

function writeFileAtomic(file: string, content: string): void {
  const temp = `${file}.gameindex.tmp`;
  fs.writeFileSync(temp, content, "utf8");
  try {
    fs.chmodSync(temp, fs.statSync(file).mode);
  } catch {
    /* keep default mode */
  }
  fs.renameSync(temp, file);
}

function markerKey(appId: number | string): string {
  return `steam.launch-options.${appId}`;
}

/**
 * Apply (or clear) the managed launch options for one Steam app.
 * Returns false when there is no writable Steam config or nothing changed.
 */
export function applySteamLaunchOptions(appId: number | string, prefix: string): boolean {
  const file = activeLocalconfigPath();
  if (!file) return false;
  const previous = readDocumentText("kv", markerKey(appId), "");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const existing = readSteamLaunchOptions(text, appId);
  const merged = mergeSteamLaunchOptions(existing, previous, prefix);
  if (merged === existing) {
    if (!prefix) deleteDocument("kv", markerKey(appId));
    return false;
  }
  const updated = setSteamLaunchOptions(text, appId, merged);
  if (updated === null) return false;
  try {
    backupOnce(file);
    writeFileAtomic(file, updated);
  } catch (error) {
    console.warn("[steam] could not write launch options:", error);
    return false;
  }
  if (prefix) writeDocumentText("kv", markerKey(appId), prefix);
  else deleteDocument("kv", markerKey(appId));
  return true;
}

/** Clear managed options using the default settings (used when disabling). */
export function defaultSteamLaunchPrefix(gameId: string): string {
  return buildSteamLaunchPrefix(DEFAULT_COMPATIBILITY_SETTINGS, null, { gameId });
}

/** Current settings and per-game profile, plus the Steam prefix to persist. */
export function steamLaunchPrefixForGame(
  gameId: string,
  profile: CompatProfile | null,
  protonLogDir: string | null,
): string {
  return buildSteamLaunchPrefix(getCompatibilitySettings(), profile, {
    gameId,
    protonLogDir,
  });
}

/** True when Steam's client process is running (Linux). */
export function steamClientRunning(): boolean {
  if (process.platform !== "linux") return false;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const comm = fs.readFileSync(`/proc/${entry}/comm`, "utf8").trim().toLowerCase();
      if (comm === "steam" || comm === "steamwebhelper") return true;
    } catch {
      /* gone */
    }
  }
  return false;
}
