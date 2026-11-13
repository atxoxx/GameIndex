/**
 * Compatibility/Wine data shapes.
 *
 * `CompatibilitySettings` mirrors the renderer's `CompatibilitySettings`
 * (`src/pages/settings/CompatibilityTab.tsx`) and the retired Rust struct
 * (`src-tauri/src/compatibility/types.rs`), including the legacy aliases the
 * Rust reader accepted.
 */

export interface CompatibilitySettings {
  defaultRunnerPath: string | null;
  defaultPrefixBaseDir: string | null;
  defaultPrefix: string | null;
  enableDxvk: boolean;
  enableVkd3d: boolean;
  enableVkd3dDescriptorHeap: boolean;
  enableEsync: boolean;
  enableFsync: boolean;
  enableDxvkNvapi: boolean;
  enableMangoHud: boolean;
  enableGameMode: boolean;
  enableGamescope: boolean;
  gamescopeArgs: string | null;
  primeRenderOffload: boolean;
  useSpecificGpu: boolean;
  specificGpuId: string | null;
  customEnvironmentVariables: Record<string, string>;
  customDllOverrides: Record<string, string>;
  winetricksPath: string | null;
  enableNtsync: boolean;
  enableDxvkAsync: boolean;
  enableWayland: boolean;
  enableWow64: boolean;
  enableLargeAddressAware: boolean;
  wineDebug: string | null;
  audioDriver: string | null;
  virtualDesktop: boolean;
  virtualDesktopRes: string | null;
  enableUmuLauncher: boolean;
  mangohudHidden: boolean;
  enableControllerSupport: boolean;
  enableAnticheatSupport: boolean;
  gamescopeMode: string | null;
  gamescopeGameWidth: number | null;
  gamescopeGameHeight: number | null;
  gamescopeWindowWidth: number | null;
  gamescopeWindowHeight: number | null;
  gamescopeFilter: string | null;
  gamescopeFsrSharpness: number | null;
  gamescopeFpsLimit: number | null;
  gamescopeRefreshRate: number | null;
  gamescopeAdaptiveSync: boolean;
  gamescopeHdr: boolean;
  gamescopeStretch: boolean;
  gamescopeForceWindowsFullscreen: boolean;
}

export interface CompatibilityRunner {
  id: string;
  name: string;
  path: string;
  kind: string;
  version: string | null;
  isProton: boolean;
  sizeBytes?: number | null;
  isDeletable?: boolean;
  installDir?: string | null;
}

/** One downloadable release from a runner source (GitHub). */
export interface RemoteRunnerRelease {
  id: string;
  source: string;
  tag: string;
  name: string;
  releaseDate: string;
  publishedAt?: string;
  downloadUrl: string;
  filename: string;
  sizeBytes: number | null;
  targetType: "proton" | "wine";
  isInstalled: boolean;
  body: string | null;
  htmlUrl?: string;
}

/** Progress payload emitted as `runner-install-progress`. */
export interface RunnerInstallProgress {
  runnerName: string;
  status: "downloading" | "extracting" | "completed" | "failed" | "cancelled";
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number;
  speedBytesPerSec: number;
  error: string | null;
}

export interface WinePrefixInfo {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  isValid: boolean;
  isProton: boolean;
  arch: string;
  winVersion?: string | null;
  wineVersion?: string | null;
  associatedGames: Array<{ id: string; title: string }>;
  lastModified?: number | null;
  isDefaultBase: boolean;
  isCustom: boolean;
}

export interface LinuxSystemStatus {
  osName: string;
  kernelVersion: string;
  displayServer: string;
  vulkanSupport: boolean;
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  gamescopeAvailable: boolean;
  winetricksAvailable: boolean;
  umuAvailable: boolean;
  eacRuntimeAvailable: boolean;
  battleyeRuntimeAvailable: boolean;
}

export interface WineLogResult {
  gameId: string;
  logContent: string;
  exists: boolean;
  lastModified: number | null;
  sizeBytes: number;
  logPath: string;
}
