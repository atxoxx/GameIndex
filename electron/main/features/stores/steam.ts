/**
 * Steam local-install detection.
 *
 * Port of `src-tauri/src/steam_game_watcher.rs` (install-root discovery +
 * VDF parsing), `src-tauri/src/steam/sync.rs` (manifest scan) and
 * `src-tauri/src/steam/dlc.rs` (installed DLC ids on a manifest).
 *
 * Detection priority, exactly like Rust:
 *   1. registry `HKCU\Software\Valve\Steam\SteamPath`
 *   2. registry `HKLM\…\Valve\Steam\InstallPath`
 *   3. the two classic default folders, verified by `steam.exe`
 *
 * Library folders come from `steamapps/libraryfolders.vdf` (modern nested and
 * legacy flat shapes). When a library has no manifests at all — Steam's
 * "registered elsewhere" case, or a library restored from a backup — the
 * scanner falls back to `steamapps/common/<dir>` plus a sibling
 * `steam_appid.txt`, which is the only manifest-less identity Steam leaves
 * behind.
 */
import fs from "node:fs";
import path from "node:path";
import { isWindows, programFilesX86, regQueryValues } from "./proc";
import { parseAppManifest, parseLibraryFolders, type SteamAppManifest } from "./vdf";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

export interface SteamLibrary {
  /** Library root (`…\SteamLibrary`), not the `steamapps` child. */
  root: string;
  steamApps: string;
}

interface SteamRoots {
  root: string | null;
  probed: string[];
}

/** Locate the primary Steam install root. */
export async function findSteamRoot(): Promise<SteamRoots> {
  const probed: string[] = [];

  if (isWindows) {
    const hkcu = "HKCU\\Software\\Valve\\Steam";
    probed.push(`${hkcu}\\SteamPath`);
    const hkcuValues = await regQueryValues(hkcu);
    const fromHkcu = hkcuValues.SteamPath?.replace(/\//g, "\\");
    if (fromHkcu && (await hasSteamApps(fromHkcu))) {
      return { root: path.normalize(fromHkcu), probed };
    }

    for (const key of [
      "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
      "HKLM\\SOFTWARE\\Valve\\Steam",
    ]) {
      probed.push(`${key}\\InstallPath`);
      const values = await regQueryValues(key);
      const value = values.InstallPath ?? values.InstallPath32;
      if (value && (await hasSteamApps(value))) {
        return { root: path.normalize(value), probed };
      }
    }
  }

  const defaults = [
    path.join(programFilesX86(), "Steam"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Steam"),
    "C:\\Steam",
  ];
  for (const candidate of defaults) {
    probed.push(candidate);
    if (fs.existsSync(path.join(candidate, "steam.exe"))) {
      return { root: candidate, probed };
    }
  }
  // A Steam install without steam.exe (half-installed, or a Wine layout) is
  // still useful when it carries steamapps data.
  for (const candidate of defaults) {
    if (await hasSteamApps(candidate)) return { root: candidate, probed };
  }

  return { root: null, probed };
}

async function hasSteamApps(root: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(path.join(root, "steamapps"))).isDirectory();
  } catch {
    return false;
  }
}

/** Every library root, primary install first, de-duplicated. */
export async function steamLibraries(root: string): Promise<SteamLibrary[]> {
  const libraries: SteamLibrary[] = [{ root, steamApps: path.join(root, "steamapps") }];
  const seen = new Set([path.resolve(root).toLowerCase()]);

  const vdfPath = path.join(root, "steamapps", "libraryfolders.vdf");
  let raw = "";
  try {
    raw = await fs.promises.readFile(vdfPath, "utf8");
  } catch {
    raw = "";
  }

  for (const folder of parseLibraryFolders(raw)) {
    const resolved = path.resolve(folder.path);
    if (seen.has(resolved.toLowerCase())) continue;
    seen.add(resolved.toLowerCase());
    libraries.push({ root: resolved, steamApps: path.join(resolved, "steamapps") });
  }

  return libraries;
}

export interface SteamManifestInfo extends SteamAppManifest {
  manifestPath: string;
  libraryRoot: string;
  installPath: string;
}

function appIdFromManifestName(name: string): number | null {
  const match = name.match(/^appmanifest_(\d+)\.acf$/i);
  return match ? Number(match[1]) : null;
}

/**
 * Presence-only manifest map (`appid → path`), the primitive the transfer
 * watcher and uninstall detection use. Returns `null` when no Steam install
 * exists so callers can tell "not installed" from "zero games".
 */
export async function steamManifestPaths(
  rootOverride?: string,
): Promise<Map<number, string> | null> {
  const root = rootOverride ?? (await findSteamRoot()).root;
  if (!root) return null;

  const paths = new Map<number, string>();
  for (const library of await steamLibraries(root)) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(library.steamApps, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const appId = appIdFromManifestName(entry.name);
      if (appId === null) continue;
      paths.set(appId, path.join(library.steamApps, entry.name));
    }
  }
  return paths;
}

/** Read and parse every manifest. Unreadable manifests are skipped. */
export async function scanSteamManifests(): Promise<{
  manifests: SteamManifestInfo[];
  probed: string[];
  errors: string[];
}> {
  const manifests: SteamManifestInfo[] = [];
  const errors: string[] = [];
  const roots = await findSteamRoot();
  const probed = [...roots.probed];

  if (!roots.root) {
    return { manifests, probed, errors };
  }

  for (const library of await steamLibraries(roots.root)) {
    probed.push(library.steamApps);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(library.steamApps, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors.push(`steam: cannot read ${library.steamApps} (${code ?? "error"})`);
      }
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const appId = appIdFromManifestName(entry.name);
      if (appId === null) continue;
      const manifestPath = path.join(library.steamApps, entry.name);
      try {
        const raw = await fs.promises.readFile(manifestPath, "utf8");
        const parsed = parseAppManifest(raw, appId);
        if (!parsed) {
          errors.push(`steam: unparseable manifest ${entry.name}`);
          continue;
        }
        manifests.push({
          ...parsed,
          appId: parsed.appId || appId,
          manifestPath,
          libraryRoot: library.root,
          installPath: path.join(library.steamApps, "common", parsed.installDir),
        });
      } catch (error) {
        errors.push(
          `steam: cannot read ${entry.name} (${
            error instanceof Error ? error.message : String(error)
          })`,
        );
      }
    }
  }

  return { manifests, probed, errors };
}

/**
 * Manifest-less fallback: `steamapps/common/<dir>` folders. Identity comes
 * from a `steam_appid.txt` inside the folder (or one level down), which is
 * what Steam itself and most shipped builds use. Folders with no appid are
 * still reported with a synthesised id so a game is not silently lost.
 */
async function scanCommonFolders(
  libraries: SteamLibrary[],
  probed: string[],
  known: Set<number>,
): Promise<Array<{ appId: string; name: string; installPath: string; fromManifest: boolean }>> {
  const out: Array<{
    appId: string;
    name: string;
    installPath: string;
    fromManifest: boolean;
  }> = [];

  for (const library of libraries) {
    const commonDir = path.join(library.steamApps, "common");
    probed.push(commonDir);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(commonDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const installPath = path.join(commonDir, entry.name);
      const appId = await readSteamAppIdFile(installPath);
      if (appId !== null && known.has(appId)) continue;
      out.push({
        appId: appId !== null ? String(appId) : `dir:${entry.name.toLowerCase()}`,
        name: entry.name,
        installPath,
        fromManifest: false,
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return out;
}

async function readSteamAppIdFile(dir: string): Promise<number | null> {
  const candidates = [
    path.join(dir, "steam_appid.txt"),
    path.join(dir, "Steam_appid.txt"),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await fs.promises.readFile(candidate, "utf8");
      const id = Number(raw.trim().split(/\s+/)[0]);
      if (Number.isFinite(id) && id > 0) return id;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Steam ships tools alongside games: the redistributable depot, SteamVR, the
 * Linux runtimes and Proton all have manifests under `steamapps/common` and
 * are "fully installed". They are not games and must not enter the library.
 */
export function isSteamTool(name: string, installDir: string): boolean {
  const haystack = `${name} ${installDir}`.toLowerCase();
  return (
    haystack.includes("proton") ||
    haystack.includes("steamworks") ||
    haystack.includes("steamvr") ||
    haystack.includes("steam linux runtime") ||
    haystack.includes("steamlinuxruntime") ||
    haystack.includes("steam controller") ||
    haystack.includes("steam link")
  );
}

/** Full Steam scan: manifests first, `common/` fallback when none are usable. */
export async function scanSteam(): Promise<StoreScanResult> {
  const { manifests, probed, errors } = await scanSteamManifests();
  const roots = await findSteamRoot();
  const installs: DetectedInstall[] = [];

  const libraries = roots.root ? await steamLibraries(roots.root) : [];
  const known = new Set(manifests.map((manifest) => manifest.appId));

  const accepted: Array<{ manifest: (typeof manifests)[number]; installDir: string }> = [];
  for (const manifest of manifests) {
    let installDirExists = false;
    try {
      installDirExists = (await fs.promises.stat(manifest.installPath)).isDirectory();
    } catch {
      installDirExists = false;
    }
    // Rust accepts a manifest that claims "fully installed" OR whose composed
    // install directory exists (StateFlags can lag reality).
    if (!manifest.fullyInstalled && !installDirExists) continue;
    const name = manifest.name || path.basename(manifest.installPath);
    if (isSteamTool(name, manifest.installDir)) continue;
    accepted.push({
      manifest,
      installDir: installDirExists ? manifest.installPath : "",
    });
  }

  // Exe resolution is the only expensive part of a Steam scan (it stats a
  // bounded slice of each install), so fan it out over four workers instead of
  // charging the whole scan serially.
  const resolved = new Array<string | null>(accepted.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= accepted.length) return;
      const entry = accepted[index];
      const name = entry.manifest.name || path.basename(entry.manifest.installPath);
      resolved[index] = entry.installDir
        ? await resolveExecutable(entry.installDir, name)
        : null;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, Math.max(1, accepted.length)) }, () => worker()),
  );

  for (let index = 0; index < accepted.length; index += 1) {
    const { manifest, installDir } = accepted[index];
    const name = manifest.name || path.basename(manifest.installPath);
    installs.push({
      store: "steam",
      storeId: String(manifest.appId),
      name,
      installDir: installDir || null,
      exePath: resolved[index],
      sizeBytes: manifest.sizeOnDisk ?? undefined,
      installed: true,
      extra: { appId: manifest.appId },
    });
  }

  // The classic Rust path only ever looks at manifests. A library that has
  // none but does have `common/` folders is the "Steam is not managing this
  // install" case; recovering those is the documented fallback.
  if (installs.length === 0 && libraries.length > 0) {
    for (const folder of await scanCommonFolders(libraries, probed, known)) {
      const exe = await resolveExecutable(folder.installPath, folder.name);
      installs.push({
        store: "steam",
        storeId: folder.appId,
        name: folder.name,
        installDir: folder.installPath,
        exePath: exe,
        installed: true,
        extra: folder.appId.startsWith("dir:") ? { unregistered: true } : undefined,
      });
    }
  }

  return {
    store: "steam",
    available: roots.root !== null,
    installs,
    probed,
    errors,
  };
}

/** Map an appid to its install directory, using the manifest scan. */
export async function steamInstallDir(appId: number): Promise<string | null> {
  const { manifests } = await scanSteamManifests();
  const manifest = manifests.find((entry) => entry.appId === appId);
  if (!manifest) return null;
  try {
    if (fs.statSync(manifest.installPath).isDirectory()) return manifest.installPath;
  } catch {
    return null;
  }
  return null;
}

export async function steamManifestFor(appId: number): Promise<SteamManifestInfo | null> {
  const { manifests } = await scanSteamManifests();
  return manifests.find((entry) => entry.appId === appId) ?? null;
}
