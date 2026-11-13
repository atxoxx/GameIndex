/**
 * Online-Fix / FreeTP layout detection.
 *
 * These releases ship a Steam emulator/fix next to the game: a Steam AppID
 * file, Goldberg `steam_settings`, `onlinefix.ini`, a native `winmm`/steamfix
 * DLL or a ColdClient loader. Detection is read-only — the option only
 * prepares the launch environment, it never patches game files.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export interface OnlineFixInfo {
  detected: boolean;
  /** AppID from the nearest `steam_appid.txt`, when present. */
  appId: number | null;
  /** Detected marker names, relative to the directory that held them. */
  markers: string[];
  /** Directory the markers/AppID came from, or the exe directory. */
  root: string | null;
}

const STRONG_MARKERS = new Set([
  "steam_appid.txt",
  "onlinefix.ini",
  "onlinefix.dll",
  "onlinefix64.dll",
  "winmm.dll",
  "winmm64.dll",
  "steamfix.dll",
  "steamfix64.dll",
  "coldclientloader.ini",
  "coldclientloader.exe",
  "steamclient_loader_x64.exe",
  "steamclient_loader_x86.exe",
  "freetp.ini",
  "freetp.url",
  "freetp.txt",
  "steam_settings",
]);

/** Folders that may hold the fix above the executable (binaries/Win64 etc.). */
function candidateDirs(exePath: string): string[] {
  const start = path.dirname(exePath);
  const dirs: string[] = [start];
  let current = start;
  for (let depth = 0; depth < 2; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    dirs.push(parent);
    current = parent;
  }
  return dirs;
}

export function readOnlineFixAppId(exePath: string): number | null {
  for (const dir of candidateDirs(exePath)) {
    try {
      const raw = fs.readFileSync(path.join(dir, "steam_appid.txt"), "utf8");
      const match = /^\s*(\d{1,10})\s*$/m.exec(raw);
      if (match) {
        const id = Number.parseInt(match[1], 10);
        if (Number.isFinite(id) && id > 0) return id;
      }
    } catch {
      /* try the next parent */
    }
  }
  return null;
}

export function detectOnlineFix(exePath: string): OnlineFixInfo {
  const trimmed = exePath.trim();
  if (!trimmed) return { detected: false, appId: null, markers: [], root: null };
  const appId = readOnlineFixAppId(trimmed);
  const markers: string[] = [];
  let root: string | null = null;

  for (const dir of candidateDirs(trimmed)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = entry.name.toLowerCase();
      const isDir = entry.isDirectory();
      if (name === "steam_settings" && isDir) {
        markers.push(entry.name);
        root ??= dir;
        continue;
      }
      if (!STRONG_MARKERS.has(name) || isDir) continue;
      markers.push(entry.name);
      root ??= dir;
    }
    if (markers.length > 0) break;
  }

  // A bare steam_api64/steam_api is normal in Steam games; only count it when
  // another fix marker is present.
  if (markers.length > 0) {
    for (const dir of candidateDirs(trimmed)) {
      for (const name of ["steam_api.dll", "steam_api64.dll"]) {
        if (fs.existsSync(path.join(dir, name))) {
          if (!markers.includes(name)) markers.push(name);
        }
      }
    }
  }

  return {
    detected: markers.length > 0,
    appId,
    markers,
    root: root ?? path.dirname(trimmed),
  };
}

/** True when a Steam client process is visible in /proc. */
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
      /* process vanished */
    }
  }
  return false;
}

/**
 * Online-Fix needs the Steam client running (the fix talks to Steam's local
 * API). Start it when closed and wait for it to come up.
 */
export async function ensureSteamRunning(timeoutMs = 30_000): Promise<void> {
  if (process.platform !== "linux") return;
  if (steamClientRunning()) return;
  try {
    const child = spawn("steam", [], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    child.unref();
  } catch (error) {
    throw new Error(
      `Steam must be running for Online-Fix/FreeTP mode, and starting it failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (steamClientRunning()) return;
  }
  throw new Error(
    "Steam did not start in time. Open Steam, wait until you are signed in, then launch the game again.",
  );
}

