/**
 * In-app updates for the Electron build.
 *
 * Two update channels exist because the app ships two shapes with different
 * capabilities:
 *
 *  • NSIS installers and Linux AppImages are handled by `electron-updater`,
 *    which reads the `app-update.yml` embedded by electron-builder and consumes
 *    the `latest*.yml` feed served from the rolling `electron-latest` release.
 *  • The Windows portable `.exe` cannot be replaced by an installer, so it
 *    uses the same "download the new portable binary, swap it, relaunch"
 *    contract the Tauri build had. GitHub exposes a sha256 digest for every
 *    release asset, which is verified before the staged file is applied.
 *
 * The renderer never talks to `electron-updater` directly: it calls the
 * `updater_*` commands and listens for `updater-progress` events.
 */
import { app } from "electron";
import { autoUpdater, type UpdateInfo as ElectronUpdateInfo } from "electron-updater";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { emit } from "../../ipc";
import {
  digestToSha256,
  isNewerVersion,
  portableVersionFromName,
} from "./version";

export type UpdaterMode = "nsis" | "portable" | "appimage" | "deb" | "dev" | "unsupported";

export interface UpdaterInstallInfo {
  mode: UpdaterMode;
  /** `latest.json` platform key the renderer should request (null = none). */
  target: string | null;
  currentVersion: string;
  /** Whether this build can install an update in place. */
  supported: boolean;
}

export interface PortableArtifact {
  url: string;
  sha256: string | null;
  sizeBytes: number | null;
  fileName: string | null;
}

export interface UpdaterCheckResult {
  available: boolean;
  version?: string;
  body?: string;
  date?: string;
  /** Set for the portable channel; electron-updater handles the rest. */
  portable?: PortableArtifact;
  target?: string | null;
}

const WINDOWS_PORTABLE_TARGET = "windows-x86_64";
const WINDOWS_NSIS_TARGET = "windows-x86_64-nsis";
const LINUX_APPIMAGE_TARGET = "linux-x86_64";
const LINUX_DEB_TARGET = "linux-x86_64-deb";

const GITHUB_CHANNEL_RELEASE_URL =
  "https://api.github.com/repos/atxoxx/GameIndex/releases/tags/electron-latest";
/** GitHub allows 60 unauthenticated requests/hour; one check per 10 min is plenty. */
const CHECK_CACHE_MS = 10 * 60_000;

/** The Windows portable wrapper sets these next to the original `.exe`. */
function portableExecutablePath(): string | null {
  if (process.platform !== "win32") return null;
  const file = process.env.PORTABLE_EXECUTABLE_FILE;
  if (file) return path.resolve(file);
  const dir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (dir) {
    const name = path.basename(process.execPath);
    return path.join(path.resolve(dir), name);
  }
  return null;
}

export function getUpdaterInstallInfo(): UpdaterInstallInfo {
  const version = app.getVersion();
  if (!app.isPackaged) {
    return { mode: "dev", target: null, currentVersion: version, supported: false };
  }
  if (portableExecutablePath()) {
    return {
      mode: "portable",
      target: WINDOWS_PORTABLE_TARGET,
      currentVersion: version,
      supported: true,
    };
  }
  if (process.platform === "win32") {
    return {
      mode: "nsis",
      target: WINDOWS_NSIS_TARGET,
      currentVersion: version,
      supported: true,
    };
  }
  if (process.platform === "linux") {
    if (process.env.APPIMAGE) {
      return {
        mode: "appimage",
        target: LINUX_APPIMAGE_TARGET,
        currentVersion: version,
        supported: true,
      };
    }
    return {
      mode: "deb",
      target: LINUX_DEB_TARGET,
      currentVersion: version,
      supported: true,
    };
  }
  return { mode: "unsupported", target: null, currentVersion: version, supported: false };
}

// ── Version helpers ──────────────────────────────────────────────────────────

function releaseNotesToText(info: ElectronUpdateInfo | null | undefined): string | undefined {
  const notes = info?.releaseNotes;
  if (!notes) return undefined;
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === "string") return entry;
        return entry?.note ?? "";
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return undefined;
}

// ── electron-updater (NSIS / AppImage) ──────────────────────────────────────

let updaterConfigured = false;

function configureUpdater(): void {
  if (updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message?: unknown) => console.info("[updater]", message),
    warn: (message?: unknown) => console.warn("[updater]", message),
    error: (message?: unknown) => console.error("[updater]", message),
    debug: (message?: unknown) => console.debug("[updater]", message),
  } as unknown as typeof autoUpdater.logger;
  autoUpdater.on("download-progress", (progress) => {
    emit("updater-progress", {
      event: "Progress",
      data: {
        downloaded: Math.round(progress.transferred ?? 0),
        total: Math.round(progress.total ?? 0),
        percent: progress.percent ?? 0,
        bytesPerSecond: Math.round(progress.bytesPerSecond ?? 0),
      },
    });
  });
  autoUpdater.on("update-downloaded", () => {
    emit("updater-progress", { event: "Finished", data: null });
  });
  autoUpdater.on("error", (error) => {
    console.error("[updater] electron-updater error:", error);
  });
}

/** True when the error means "the feed has no release yet", not a real failure. */
function isMissingFeedError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("no published") ||
    (message.includes("latest.yml") && message.includes("unable")) ||
    (message.includes("cannot find") && message.includes("app-update.yml"))
  );
}

async function checkInstalledBuild(): Promise<UpdaterCheckResult> {
  configureUpdater();
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) return { available: false, target: getUpdaterInstallInfo().target };
    const info = result.updateInfo;
    if (!isNewerVersion(info.version, app.getVersion())) {
      return { available: false, target: getUpdaterInstallInfo().target };
    }
    return {
      available: true,
      version: info.version,
      body: releaseNotesToText(info),
      date: info.releaseDate,
      target: getUpdaterInstallInfo().target,
    };
  } catch (error) {
    if (isMissingFeedError(error)) return { available: false, target: getUpdaterInstallInfo().target };
    throw error;
  }
}

// ── Portable channel (GitHub releases) ──────────────────────────────────────

interface GithubAsset {
  name?: string;
  size?: number;
  digest?: string | null;
  browser_download_url?: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GithubAsset[];
}

let channelCache: { at: number; release: GithubRelease | null } | null = null;

/**
 * The rolling `electron-latest` prerelease is the updater feed: the release
 * workflow uploads every installer plus `latest*.yml` there, so this stays a
 * stable, public URL even while the versioned release is still a draft.
 */
async function fetchChannelRelease(): Promise<GithubRelease | null> {
  if (channelCache && Date.now() - channelCache.at < CHECK_CACHE_MS) {
    return channelCache.release;
  }
  const response = await fetch(GITHUB_CHANNEL_RELEASE_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `GameIndex/${app.getVersion()}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    channelCache = { at: Date.now(), release: null };
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub release request failed (${response.status})`);
  }
  const release = (await response.json()) as GithubRelease;
  channelCache = { at: Date.now(), release: release ?? null };
  return release ?? null;
}

async function checkPortableBuild(): Promise<UpdaterCheckResult> {
  const current = app.getVersion();
  const release = await fetchChannelRelease();
  if (!release) return { available: false, target: WINDOWS_PORTABLE_TARGET };

  // Multiple versions can linger in the rolling release during a transition;
  // pick the highest one and ignore anything not newer than this build.
  const candidates = (release.assets ?? [])
    .filter((asset) => /_portable\.exe$/i.test(asset.name ?? ""))
    .map((asset) => ({ asset, version: portableVersionFromName(asset.name) }))
    .filter(
      (entry): entry is { asset: GithubAsset; version: string } =>
        Boolean(entry.version) && isNewerVersion(entry.version as string, current),
    )
    .sort((a, b) => (isNewerVersion(a.version, b.version) ? -1 : 1));

  const newest = candidates[0];
  if (!newest?.asset.browser_download_url) {
    return { available: false, target: WINDOWS_PORTABLE_TARGET };
  }

  return {
    available: true,
    version: newest.version,
    body: release.body ?? undefined,
    date: release.published_at ?? undefined,
    target: WINDOWS_PORTABLE_TARGET,
    portable: {
      url: newest.asset.browser_download_url,
      sha256: digestToSha256(newest.asset.digest),
      sizeBytes: typeof newest.asset.size === "number" ? newest.asset.size : null,
      fileName: newest.asset.name ?? null,
    },
  };
}

// ── Public API (commands) ───────────────────────────────────────────────────

export async function checkForUpdates(): Promise<UpdaterCheckResult> {
  const info = getUpdaterInstallInfo();
  switch (info.mode) {
    case "portable":
      return checkPortableBuild();
    case "nsis":
    case "appimage":
      return checkInstalledBuild();
    default:
      return { available: false, target: info.target };
  }
}

export async function downloadUpdate(): Promise<void> {
  const info = getUpdaterInstallInfo();
  if (info.mode !== "nsis" && info.mode !== "appimage") {
    throw new Error(`This build updates through a different channel (${info.mode})`);
  }
  configureUpdater();
  emit("updater-progress", { event: "Started", data: { contentLength: 0 } });
  await autoUpdater.downloadUpdate();
}

export function installUpdate(): void {
  const info = getUpdaterInstallInfo();
  if (info.mode !== "nsis" && info.mode !== "appimage") {
    throw new Error(`This build updates through a different channel (${info.mode})`);
  }
  // `isSilent = false` keeps the installer UI, `isForceRunAfter = true`
  // relaunches GameIndex when it finishes.
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}

function escapeCmd(value: string): string {
  // Windows paths cannot contain a quote; drop any instead of trying to
  // escape it, which cmd would not understand anyway.
  return value.replace(/"/g, "");
}

/**
 * Replace the running portable executable with the staged one and relaunch it.
 *
 * The script waits for this process to exit first (Windows locks a running
 * image), retries the copy briefly, then starts the new binary. It deletes
 * itself afterwards.
 */
export async function applyPortableUpdate(stagedPath: string, relaunch = true): Promise<void> {
  const target = portableExecutablePath();
  if (!target) throw new Error("This build is not a portable executable");
  if (!stagedPath) throw new Error("No staged update file");
  if (!fs.existsSync(stagedPath)) throw new Error(`Staged update is missing: ${stagedPath}`);
  if (process.platform !== "win32") throw new Error("Portable updates are Windows-only");

  const scriptPath = path.join(path.dirname(stagedPath), "apply-gameindex-update.cmd");
  const lines = [
    "@echo off",
    "setlocal",
    `set "SRC=${escapeCmd(stagedPath)}"`,
    `set "DST=${escapeCmd(target)}"`,
    `set "PID=${process.pid}"`,
    ":wait",
    'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul',
    "if not errorlevel 1 (",
    "  timeout /t 1 /nobreak >nul",
    "  goto wait",
    ")",
    "set /a tries=0",
    ":copy",
    'copy /Y "%SRC%" "%DST%" >nul 2>&1',
    "if errorlevel 1 (",
    "  set /a tries+=1",
    "  if %tries% GEQ 10 goto failed",
    "  timeout /t 1 /nobreak >nul",
    "  goto copy",
    ")",
    relaunch ? 'start "" "%DST%"' : "rem relaunch disabled",
    'del "%~f0"',
    "exit /b 0",
    ":failed",
    'del "%~f0"',
    "exit /b 1",
  ];

  await fsp.writeFile(scriptPath, `${lines.join("\r\n")}\r\n`, "utf8");
  const child = spawn("cmd.exe", ["/c", scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  // Give the helper a moment to start before this process releases the image.
  setTimeout(() => app.quit(), 250);
}

/** Test seam: clears the GitHub release cache. */
export function resetUpdaterCache(): void {
  channelCache = null;
}
