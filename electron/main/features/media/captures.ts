/**
 * Capture scanning: the Gallery's folder list, deletion, and the Steam /
 * system screenshot-folder detectors.
 *
 * Ported from `src-tauri/src/media.rs` (`list_media_files`,
 * `collect_media_files`, `delete_media_file`,
 * `detect_steam_screenshot_folders`) and
 * `src-tauri/src/system_screenshots.rs`.
 *
 * The scans are async and yield between directories so a large custom folder
 * cannot stall the main process. Results are newest-first with the path as a
 * stable tie-breaker, matching the Rust ordering the Gallery caches.
 */
import { app } from "electron";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertListableFolder,
  isCaptureExtension,
  registerMediaRoot,
  resolveCaptureFile,
  type MediaFileRef,
} from "./paths";

const MAX_LISTED_FILES = 20_000;
const MAX_STEAM_APP_FOLDERS = 5_000;

export interface SteamScreenshotFolder {
  appId: number;
  gameName: string;
  folderPath: string;
  screenshots: MediaFileRef[];
}

export interface SystemScreenshotFolder {
  source: string;
  gameName: string;
  folderPath: string;
  screenshots: MediaFileRef[];
}

function sortMedia(files: MediaFileRef[]): MediaFileRef[] {
  files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
  return files;
}

/**
 * Recursively collect image/video captures below `dir`.
 *
 * Symlinks are skipped (a link could point outside the scanned root), entries
 * that vanish during the walk are ignored, and the result is capped so a
 * pathological folder cannot exhaust memory.
 */
export async function collectMediaFiles(
  dir: string,
  includeVideo = true,
  recursive = true,
): Promise<MediaFileRef[]> {
  const files: MediaFileRef[] = [];
  let visited = 0;

  const walk = async (current: string): Promise<void> => {
    if (files.length >= MAX_LISTED_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_LISTED_FILES) return;
      visited += 1;
      if (visited % 200 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name);
      if (!isCaptureExtension(extension, includeVideo)) continue;
      let modifiedAt = 0;
      try {
        const stat = await fsp.stat(full);
        modifiedAt = Math.floor(stat.mtimeMs / 1000);
      } catch {
        /* file raced away — keep it with an unknown timestamp */
      }
      files.push({ path: full, modifiedAt });
    }
  };

  await walk(dir);
  return sortMedia(files);
}

/** `list_media_files` — scan a user-selected folder, registering it as a root. */
export async function listMediaFiles(folderPath: string): Promise<MediaFileRef[]> {
  const root = assertListableFolder(folderPath);
  registerMediaRoot(root);
  return collectMediaFiles(root, true, true);
}

/** `delete_media_file` — permanently remove one scanned capture. */
export function deleteMediaFile(filePath: string): null {
  const file = resolveCaptureFile(filePath);
  try {
    fs.rmSync(file.absolutePath, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete capture — ${message}`);
  }
  return null;
}

// ── Steam install root ──────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";

function readRegistrySteamPath(): Promise<string | null> {
  if (!IS_WINDOWS) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "reg.exe",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { windowsHide: true, timeout: 5_000, encoding: "utf8" },
      (error, stdout) => {
        if (error) return resolve(null);
        const match = /SteamPath\s+REG_SZ\s+(.+)$/m.exec(String(stdout ?? ""));
        if (!match) return resolve(null);
        const candidate = match[1].trim().replace(/"/g, "").replace(/\//g, "\\");
        try {
          if (candidate && fs.existsSync(path.join(candidate, "steamapps"))) {
            return resolve(candidate);
          }
        } catch {
          /* unreadable — fall through */
        }
        resolve(null);
      },
    );
  });
}

async function findSteamRoot(): Promise<string | null> {
  const fromRegistry = await readRegistrySteamPath();
  if (fromRegistry) return fromRegistry;
  const candidates: string[] = [];
  if (IS_WINDOWS) {
    candidates.push(
      "C:\\Program Files (x86)\\Steam",
      "C:\\Program Files\\Steam",
      path.join(os.homedir(), "Steam"),
    );
  } else {
    candidates.push(
      path.join(os.homedir(), ".steam", "steam"),
      path.join(os.homedir(), ".local", "share", "Steam"),
    );
  }
  for (const candidate of candidates) {
    try {
      const marker = IS_WINDOWS
        ? path.join(candidate, "steam.exe")
        : path.join(candidate, "steamapps");
      if (fs.existsSync(marker)) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function subdirectories(dir: string): Promise<fs.Dirent[]> {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

/**
 * `detect_steam_screenshot_folders` — every account's
 * `userdata/<id>/760/remote/<appid>/screenshots`, deduplicated by appid.
 */
export async function detectSteamScreenshotFolders(): Promise<SteamScreenshotFolder[]> {
  const steamRoot = await findSteamRoot();
  if (!steamRoot) return [];
  const userdataRoot = path.join(steamRoot, "userdata");
  const users = await subdirectories(userdataRoot);
  const results: SteamScreenshotFolder[] = [];
  const seen = new Set<number>();
  let examined = 0;

  for (const user of users) {
    const remoteRoot = path.join(userdataRoot, user.name, "760", "remote");
    for (const appFolder of await subdirectories(remoteRoot)) {
      examined += 1;
      if (examined % 200 === 0) await new Promise((resolve) => setImmediate(resolve));
      if (results.length >= MAX_STEAM_APP_FOLDERS) break;
      const appId = Number.parseInt(appFolder.name, 10);
      if (!Number.isFinite(appId) || appId <= 0 || seen.has(appId)) continue;
      const appPath = path.join(remoteRoot, appFolder.name);
      const screenshotsDir = path.join(appPath, "screenshots");
      let target = screenshotsDir;
      let captures: MediaFileRef[];
      try {
        const stat = await fsp.stat(screenshotsDir);
        captures = stat.isDirectory() ? await collectMediaFiles(screenshotsDir, true, false) : [];
      } catch {
        captures = [];
        target = appPath;
      }
      if (captures.length === 0) {
        target = appPath;
        captures = await collectMediaFiles(appPath, true, false);
      }
      if (captures.length === 0) continue;
      seen.add(appId);
      registerMediaRoot(target);
      results.push({
        appId,
        gameName: `Unknown Game (${appId})`,
        folderPath: target,
        screenshots: captures,
      });
    }
    if (results.length >= MAX_STEAM_APP_FOLDERS) break;
  }

  results.sort((a, b) => a.appId - b.appId);
  return results;
}

// ── System screenshot folders ───────────────────────────────────────────

function safePath(getter: () => string, fallback: string): string {
  try {
    return getter();
  } catch {
    return fallback;
  }
}

async function pushFolder(
  results: SystemScreenshotFolder[],
  source: string,
  gameName: string,
  folderPath: string,
  seen: Set<string>,
): Promise<void> {
  const key = folderPath.toLowerCase();
  if (seen.has(key)) return;
  const captures = await collectMediaFiles(folderPath, true, false);
  if (captures.length === 0) return;
  seen.add(key);
  registerMediaRoot(folderPath);
  results.push({ source, gameName, folderPath, screenshots: captures });
}

async function detectWindowsFolders(): Promise<SystemScreenshotFolder[]> {
  const home = os.homedir();
  const videos = safePath(() => app.getPath("videos"), path.join(home, "Videos"));
  const pictures = safePath(() => app.getPath("pictures"), path.join(home, "Pictures"));
  const results: SystemScreenshotFolder[] = [];
  const seen = new Set<string>();

  // NVIDIA ShadowPlay / GeForce Experience per-game folders under Videos.
  for (const entry of await subdirectories(videos)) {
    const lower = entry.name.toLowerCase();
    if (lower === "desktop" || lower === "captures" || lower === "radeon relive" || lower === "obs") {
      continue;
    }
    await pushFolder(results, "nvidia", entry.name, path.join(videos, entry.name), seen);
  }

  // Windows Game Bar / Xbox captures (per-game folders + loose files).
  const capturesRoot = path.join(videos, "Captures");
  for (const entry of await subdirectories(capturesRoot)) {
    await pushFolder(results, "windows", entry.name, path.join(capturesRoot, entry.name), seen);
  }
  await pushFolder(results, "windows", "Xbox Game Bar", capturesRoot, seen);

  // Explicit Pictures/Screenshots (some tools and power users use it).
  await pushFolder(results, "windows", "Screenshots", path.join(pictures, "Screenshots"), seen);

  // AMD Radeon ReLive.
  const amdRoot = path.join(videos, "Radeon ReLive");
  let foundAmd = false;
  for (const entry of await subdirectories(amdRoot)) {
    const before = results.length;
    await pushFolder(results, "amd", entry.name, path.join(amdRoot, entry.name), seen);
    if (results.length > before) foundAmd = true;
  }
  if (!foundAmd) {
    await pushFolder(results, "amd", "AMD ReLive", amdRoot, seen);
  }

  // OBS Studio.
  const obsRoot = path.join(videos, "OBS");
  const beforeObs = results.length;
  for (const entry of await subdirectories(obsRoot)) {
    await pushFolder(results, "obs", entry.name, path.join(obsRoot, entry.name), seen);
  }
  if (results.length === beforeObs) {
    await pushFolder(results, "obs", "OBS Studio", obsRoot, seen);
  }

  return results;
}

async function detectPosixFolders(): Promise<SystemScreenshotFolder[]> {
  const home = os.homedir();
  const pictures = safePath(
    () => app.getPath("pictures"),
    process.env.XDG_PICTURES_DIR?.trim() || path.join(home, "Pictures"),
  );
  const videos = safePath(
    () => app.getPath("videos"),
    process.env.XDG_VIDEOS_DIR?.trim() || path.join(home, "Videos"),
  );
  const results: SystemScreenshotFolder[] = [];
  const seen = new Set<string>();

  await pushFolder(results, "obs", "OBS", path.join(videos, "OBS"), seen);
  await pushFolder(results, "linux", "Screenshots", path.join(pictures, "Screenshots"), seen);
  await pushFolder(results, "linux", "Screenshots", path.join(videos, "Screenshots"), seen);

  const skipped = new Set([
    "desktop",
    "captures",
    "radeon relive",
    "obs",
    "recordings",
    "screenshots",
    "template",
    "templates",
    "wallpapers",
    "webcam",
  ]);
  for (const root of [pictures, videos]) {
    for (const entry of await subdirectories(root)) {
      if (skipped.has(entry.name.toLowerCase())) continue;
      await pushFolder(results, "linux", entry.name, path.join(root, entry.name), seen);
    }
  }
  return results;
}

/** `detect_system_screenshot_folders` — NVIDIA/AMD/OBS/Game Bar capture folders. */
export async function detectSystemScreenshotFolders(): Promise<SystemScreenshotFolder[]> {
  return IS_WINDOWS ? detectWindowsFolders() : detectPosixFolders();
}
