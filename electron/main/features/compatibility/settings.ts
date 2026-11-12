/**
 * Compatibility settings persistence.
 *
 * The Rust build stored one JSON blob in `compatibility.db`. This port keeps
 * the same document in `compatibility.db` (`compatibility_settings` rows) plus
 * the custom prefix list the settings tab registers.
 */
import { compatibilityCodec } from "../../state/db/codecs";
import { createSqliteStore } from "../../state/sqliteStore";
import type { CompatibilitySettings } from "./types";

export const DEFAULT_COMPATIBILITY_SETTINGS: CompatibilitySettings = {
  defaultRunnerPath: null,
  defaultPrefixBaseDir: null,
  defaultPrefix: null,
  enableDxvk: true,
  enableVkd3d: true,
  enableVkd3dDescriptorHeap: true,
  enableEsync: true,
  enableFsync: true,
  enableDxvkNvapi: false,
  enableMangoHud: false,
  enableGameMode: false,
  enableGamescope: false,
  gamescopeArgs: "-w 1920 -h 1080 -F fsr -f",
  primeRenderOffload: false,
  useSpecificGpu: false,
  specificGpuId: null,
  customEnvironmentVariables: {},
  customDllOverrides: {},
  winetricksPath: null,
  enableNtsync: false,
  enableDxvkAsync: false,
  enableWayland: false,
  enableWow64: false,
  enableLargeAddressAware: false,
  wineDebug: "-all",
  audioDriver: null,
  virtualDesktop: false,
  virtualDesktopRes: "1920x1080",
  enableUmuLauncher: false,
  mangohudHidden: false,
  enableControllerSupport: false,
  enableAnticheatSupport: false,
  gamescopeMode: "fullscreen",
  gamescopeGameWidth: 1920,
  gamescopeGameHeight: 1080,
  gamescopeWindowWidth: null,
  gamescopeWindowHeight: null,
  gamescopeFilter: "fsr",
  gamescopeFsrSharpness: 5,
  gamescopeFpsLimit: null,
  gamescopeRefreshRate: null,
  gamescopeAdaptiveSync: false,
  gamescopeHdr: false,
  gamescopeStretch: false,
  gamescopeForceWindowsFullscreen: false,
};

export interface CompatibilityDocument {
  settings: CompatibilitySettings;
  /** Prefix paths imported by the user (survive restarts). */
  customPrefixes: string[];
  updatedAt: number;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Merge a stored/partial object over the defaults, accepting legacy keys. */
export function normalizeCompatibilitySettings(
  raw: Record<string, unknown> | null | undefined,
): CompatibilitySettings {
  const value = raw ?? {};
  const d = DEFAULT_COMPATIBILITY_SETTINGS;
  return {
    defaultRunnerPath: asString(value.defaultRunnerPath),
    defaultPrefixBaseDir: asString(value.defaultPrefixBaseDir),
    defaultPrefix: asString(value.defaultPrefix),
    enableDxvk: asBoolean(value.enableDxvk, d.enableDxvk),
    enableVkd3d: asBoolean(value.enableVkd3d, d.enableVkd3d),
    enableVkd3dDescriptorHeap: asBoolean(
      value.enableVkd3dDescriptorHeap,
      d.enableVkd3dDescriptorHeap,
    ),
    enableEsync: asBoolean(value.enableEsync, d.enableEsync),
    enableFsync: asBoolean(value.enableFsync, d.enableFsync),
    enableDxvkNvapi: asBoolean(value.enableDxvkNvapi, d.enableDxvkNvapi),
    enableMangoHud: asBoolean(value.enableMangoHud ?? value.enableMangohud, d.enableMangoHud),
    enableGameMode: asBoolean(value.enableGameMode ?? value.enableGamemode, d.enableGameMode),
    enableGamescope: asBoolean(value.enableGamescope, d.enableGamescope),
    gamescopeArgs: asString(value.gamescopeArgs),
    primeRenderOffload: asBoolean(value.primeRenderOffload, d.primeRenderOffload),
    useSpecificGpu: asBoolean(value.useSpecificGpu, d.useSpecificGpu),
    specificGpuId: asString(value.specificGpuId),
    customEnvironmentVariables: asStringMap(value.customEnvironmentVariables),
    customDllOverrides: asStringMap(value.customDllOverrides),
    winetricksPath: asString(value.winetricksPath),
    enableNtsync: asBoolean(value.enableNtsync, d.enableNtsync),
    enableDxvkAsync: asBoolean(value.enableDxvkAsync, d.enableDxvkAsync),
    enableWayland: asBoolean(value.enableWayland, d.enableWayland),
    enableWow64: asBoolean(value.enableWow64, d.enableWow64),
    enableLargeAddressAware: asBoolean(value.enableLargeAddressAware, d.enableLargeAddressAware),
    wineDebug: asString(value.wineDebug),
    audioDriver: asString(value.audioDriver),
    virtualDesktop: asBoolean(value.virtualDesktop, d.virtualDesktop),
    virtualDesktopRes: asString(value.virtualDesktopRes),
    enableUmuLauncher: asBoolean(value.enableUmuLauncher, d.enableUmuLauncher),
    mangohudHidden: asBoolean(value.mangohudHidden, d.mangohudHidden),
    enableControllerSupport: asBoolean(value.enableControllerSupport, d.enableControllerSupport),
    enableAnticheatSupport: asBoolean(value.enableAnticheatSupport, d.enableAnticheatSupport),
    gamescopeMode: asString(value.gamescopeMode),
    gamescopeGameWidth: asNumber(value.gamescopeGameWidth),
    gamescopeGameHeight: asNumber(value.gamescopeGameHeight),
    gamescopeWindowWidth: asNumber(value.gamescopeWindowWidth),
    gamescopeWindowHeight: asNumber(value.gamescopeWindowHeight),
    gamescopeFilter: asString(value.gamescopeFilter),
    gamescopeFsrSharpness: asNumber(value.gamescopeFsrSharpness),
    gamescopeFpsLimit: asNumber(value.gamescopeFpsLimit),
    gamescopeRefreshRate: asNumber(value.gamescopeRefreshRate),
    gamescopeAdaptiveSync: asBoolean(value.gamescopeAdaptiveSync, d.gamescopeAdaptiveSync),
    gamescopeHdr: asBoolean(value.gamescopeHdr, d.gamescopeHdr),
    gamescopeStretch: asBoolean(value.gamescopeStretch, d.gamescopeStretch),
    gamescopeForceWindowsFullscreen: asBoolean(
      value.gamescopeForceWindowsFullscreen,
      d.gamescopeForceWindowsFullscreen,
    ),
  };
}

function emptyDocument(): CompatibilityDocument {
  return {
    settings: { ...DEFAULT_COMPATIBILITY_SETTINGS },
    customPrefixes: [],
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

function normalizeDocument(value: CompatibilityDocument): CompatibilityDocument {
  return {
    settings: normalizeCompatibilitySettings(
      (value.settings ?? {}) as unknown as Record<string, unknown>,
    ),
    customPrefixes: Array.isArray(value.customPrefixes)
      ? value.customPrefixes.filter((entry): entry is string => typeof entry === "string")
      : [],
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

export const compatibilityStore = createSqliteStore<CompatibilityDocument>({
  domain: "compatibility",
  document: "compatibility",
  createDefault: emptyDocument,
  normalize: normalizeDocument,
  codec: compatibilityCodec,
});

export function getCompatibilitySettings(): CompatibilitySettings {
  return compatibilityStore.read().settings;
}

export function setCompatibilitySettings(settings: CompatibilitySettings): CompatibilitySettings {
  const normalized = normalizeCompatibilitySettings(
    settings as unknown as Record<string, unknown>,
  );
  compatibilityStore.update((doc) => ({
    ...doc,
    settings: normalized,
    updatedAt: Math.floor(Date.now() / 1000),
  }));
  return normalized;
}

export function customPrefixes(): string[] {
  return compatibilityStore.read().customPrefixes.slice();
}

export function registerCustomPrefix(prefixPath: string): void {
  const normalized = prefixPath.trim();
  if (!normalized) throw new Error("A prefix path is required");
  compatibilityStore.update((doc) => ({
    ...doc,
    customPrefixes: doc.customPrefixes.includes(normalized)
      ? doc.customPrefixes
      : [...doc.customPrefixes, normalized],
    updatedAt: Math.floor(Date.now() / 1000),
  }));
}

export function unregisterCustomPrefix(prefixPath: string): void {
  compatibilityStore.update((doc) => ({
    ...doc,
    customPrefixes: doc.customPrefixes.filter((entry) => entry !== prefixPath),
    updatedAt: Math.floor(Date.now() / 1000),
  }));
}
