/**
 * Steam install-location resolution.
 *
 * Ported from `src-tauri/src/steam_game_watcher.rs` (install-path half only):
 *
 *   1. Resolve the Steam root (`HKCU\Software\Valve\Steam` → `SteamPath`, then
 *      the classic default folders).
 *   2. Parse `steamapps\libraryfolders.vdf` for every library disk.
 *   3. Read `steamapps\appmanifest_<appid>.acf` to lift `installdir`.
 *   4. Compose `<library>\steamapps\common\<installdir>`.
 *
 * Results are cached for 60 s so a watcher-index rebuild does not re-read every
 * manifest. The periodic install/uninstall monitor (`steam-install-changed`)
 * belongs to the store-sync workstream and is not ported here.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";
const MANIFEST_CACHE_TTL_MS = 60_000;

export interface SteamAppManifest {
  appId: number;
  name: string;
  installDir: string;
  libraryRoot: string;
  stateFlags: number | null;
  installed: boolean;
}

let cachedRoot: { value: string | null; at: number } | null = null;
const manifestCache = new Map<number, { value: SteamAppManifest | null; at: number }>();

function readRegistrySteamPath(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    execFile(
      "reg.exe",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { windowsHide: true, timeout: 5_000, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const match = /SteamPath\s+REG_SZ\s+(.+)$/m.exec(String(stdout ?? ""));
        if (!match) {
          resolve(null);
          return;
        }
        const candidate = match[1].trim().replace(/"/g, "").replace(/\//g, "\\");
        try {
          if (candidate && fs.existsSync(path.join(candidate, "steamapps"))) {
            resolve(candidate);
            return;
          }
        } catch {
          /* unreadable — fall through */
        }
        resolve(null);
      },
    );
  });
}

/** Locate the local Steam install root, or `null` when Steam is absent. */
export async function findSteamInstallDir(): Promise<string | null> {
  const now = Date.now();
  if (cachedRoot && now - cachedRoot.at < MANIFEST_CACHE_TTL_MS) return cachedRoot.value;

  let found = await readRegistrySteamPath();
  if (!found && IS_WINDOWS) {
    const candidates = ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(path.join(candidate, "steam.exe"))) {
          found = candidate;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!found && !IS_WINDOWS) {
    const home = process.env.HOME ?? "";
    const candidates = home
      ? [
          path.join(home, ".local/share/Steam"),
          path.join(home, ".steam/steam"),
          path.join(home, ".steam/root"),
        ]
      : [];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(path.join(candidate, "steamapps"))) {
          found = candidate;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

  cachedRoot = { value: found, at: now };
  return found;
}

function isAbsolutePathString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  if (trimmed.startsWith("\\\\")) return true;
  return trimmed.startsWith("/");
}

/**
 * Every library root declared by `libraryfolders.vdf`.
 *
 * The file is KeyValues: `"LibraryFolders" { "1" "D:\\SteamLibrary" … }`.
 * Modern Steam also nests a `path` key per index, so both shapes are accepted.
 */
export function parseLibraryFolders(raw: string): string[] {
  const roots: string[] = [];
  const parts = raw.split('"');
  for (let i = 1; i + 2 < parts.length; i += 2) {
    const key = parts[i];
    const value = parts[i + 2];
    if (key !== "path" && !/^\d+$/.test(key)) continue;
    if (!isAbsolutePathString(value)) continue;
    const cleaned = value.replace(/\\\\/g, "\\");
    if (!roots.includes(cleaned)) roots.push(cleaned);
  }
  return roots;
}

export interface AppManifestFields {
  appId: number;
  name: string;
  installDir: string;
  stateFlags: number | null;
}

/** Parse `appmanifest_<appid>.acf` (Valve KeyValues) into the fields we need. */
export function parseAppManifest(raw: string, fallbackAppId: number): AppManifestFields | null {
  const text = raw.replace(/^\uFEFF/, "");
  const parts = text.split('"');
  let appId = fallbackAppId;
  let name = "";
  let installDir = "";
  let stateFlags: number | null = null;
  for (let i = 1; i + 2 < parts.length; i += 2) {
    const key = parts[i];
    const value = parts[i + 2];
    switch (key) {
      case "appid": {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed)) appId = parsed;
        break;
      }
      case "name":
        name = value;
        break;
      case "installdir":
        installDir = value;
        break;
      case "StateFlags": {
        const parsed = Number.parseInt(value.trim(), 10);
        stateFlags = Number.isFinite(parsed) ? parsed : null;
        break;
      }
      default:
        break;
    }
  }
  if (!installDir) return null;
  return { appId, name, installDir, stateFlags };
}

function isFullyInstalled(manifest: AppManifestFields): boolean {
  if (manifest.stateFlags === null) return true;
  return (manifest.stateFlags & 4) !== 0;
}

async function findAppManifestUncached(appId: number): Promise<SteamAppManifest | null> {
  const primary = await findSteamInstallDir();
  if (!primary) return null;

  const libraries = [primary];
  try {
    const vdf = await fs.promises.readFile(
      path.join(primary, "steamapps", "libraryfolders.vdf"),
      "utf8",
    );
    for (const root of parseLibraryFolders(vdf)) {
      if (!libraries.includes(root)) libraries.push(root);
    }
  } catch {
    /* no secondary libraries */
  }

  for (const root of libraries) {
    const manifestPath = path.join(root, "steamapps", `appmanifest_${appId}.acf`);
    let raw: string;
    try {
      raw = await fs.promises.readFile(manifestPath, "utf8");
    } catch {
      continue;
    }
    const fields = parseAppManifest(raw, appId);
    if (!fields) continue;
    const installRoot = path.join(root, "steamapps", "common", fields.installDir);
    let installDirExists = false;
    try {
      installDirExists = (await fs.promises.stat(installRoot)).isDirectory();
    } catch {
      installDirExists = false;
    }
    if (!isFullyInstalled(fields) && !installDirExists) continue;
    return {
      appId: fields.appId,
      name: fields.name,
      installDir: fields.installDir,
      libraryRoot: root,
      stateFlags: fields.stateFlags,
      installed: isFullyInstalled(fields),
    };
  }
  return null;
}

/** Cached manifest lookup for one AppID. */
export async function findAppManifest(appId: number): Promise<SteamAppManifest | null> {
  const now = Date.now();
  const cached = manifestCache.get(appId);
  if (cached && now - cached.at < MANIFEST_CACHE_TTL_MS) return cached.value;
  const value = await findAppManifestUncached(appId);
  manifestCache.set(appId, { value, at: now });
  return value;
}

/** `<library>\steamapps\common\<installdir>` for an AppID, or `null`. */
export async function steamGameInstallPath(appId: number): Promise<string | null> {
  const manifest = await findAppManifest(appId);
  if (!manifest) return null;
  return path.join(manifest.libraryRoot, "steamapps", "common", manifest.installDir);
}

/** Steam's client URL for an app (`dialog` pops the launch-action picker). */
export function steamLaunchUrl(appId: number, showSelection: boolean): string {
  return showSelection ? `steam://launch/${appId}/dialog` : `steam://run/${appId}`;
}

/** Test hook: drop the install-root + manifest caches. */
export function resetSteamCaches(): void {
  cachedRoot = null;
  manifestCache.clear();
}
