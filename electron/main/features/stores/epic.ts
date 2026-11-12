/**
 * Epic Games Store local-install detection.
 *
 * Port of `src-tauri/src/store_installs/epic.rs` (manifest location + fields)
 * and the installed-half of `epic/sync.rs`. Epic writes one
 * `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests\*.item` per installed
 * app. The launcher's own dependencies (Unreal Engine, Quixel, Fab plugins)
 * write the same files under the `ue` namespace, so they must be filtered out
 * or the library fills with engine components.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

export interface EpicManifest {
  file: string;
  appName: string;
  displayName: string;
  installLocation: string | null;
  launchExecutable: string | null;
  catalogNamespace: string | null;
  catalogItemId: string | null;
  incomplete: boolean;
  installSize: number | null;
  appCategories: string[];
  stagingLocation: string | null;
  modifiedMs: number;
  size: number;
}

export function epicManifestsDir(): string {
  const programData =
    process.env.ProgramData ?? process.env.PROGRAMDATA ?? "C:\\ProgramData";
  return path.join(
    programData,
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests",
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Parse one `.item` manifest. Returns `null` for torn/unreadable files. */
export function parseEpicItem(raw: string, file: string): EpicManifest | null {
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    json = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const appName = asString(json.AppName);
  const displayName = asString(json.DisplayName) ?? appName;
  if (!appName || !displayName) return null;

  const installSizeRaw = Number(json.InstallSize);
  return {
    file,
    appName,
    displayName,
    installLocation: asString(json.InstallLocation),
    launchExecutable: asString(json.LaunchExecutable),
    catalogNamespace: asString(json.CatalogNamespace),
    catalogItemId: asString(json.CatalogItemId),
    incomplete: json.bIsIncompleteInstall === true,
    installSize: Number.isFinite(installSizeRaw) && installSizeRaw > 0 ? installSizeRaw : null,
    appCategories: asStringArray(json.AppCategories),
    stagingLocation: asString(json.StagingLocation),
    modifiedMs: 0,
    size: 0,
  };
}

/**
 * True when the manifest describes a game rather than an engine component.
 * Epic tags real games with a `games`/`games/…` category; engine and plugin
 * installs live under `engines/…` or `plugins/…` and share the `ue`
 * namespace.
 */
export function isGameManifest(manifest: EpicManifest): boolean {
  const namespace = (manifest.catalogNamespace ?? "").toLowerCase();
  if (namespace === "ue") return false;
  const categories = manifest.appCategories.map((category) => category.toLowerCase());
  if (categories.some((category) => category.startsWith("plugins") || category.startsWith("engines"))) {
    return false;
  }
  if (categories.length > 0) {
    return categories.some(
      (category) => category === "games" || category.startsWith("games/"),
    );
  }
  // Older manifests omit `AppCategories`; a non-engine namespace is the best
  // remaining signal.
  return true;
}

/** Read every manifest file (unsorted). */
export async function readEpicManifests(): Promise<{
  manifests: EpicManifest[];
  probed: string[];
  errors: string[];
}> {
  const dir = epicManifestsDir();
  const probed = [dir];
  const manifests: EpicManifest[] = [];
  const errors: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      errors.push(`epic: cannot read ${dir} (${code ?? "error"})`);
    }
    return { manifests, probed, errors };
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".item")) continue;
    const file = path.join(dir, entry.name);
    try {
      const [raw, stat] = await Promise.all([
        fs.promises.readFile(file, "utf8"),
        fs.promises.stat(file),
      ]);
      const manifest = parseEpicItem(raw, file);
      if (!manifest) {
        errors.push(`epic: unparseable manifest ${entry.name}`);
        continue;
      }
      manifest.modifiedMs = stat.mtimeMs;
      manifest.size = stat.size;
      manifests.push(manifest);
    } catch (error) {
      errors.push(
        `epic: cannot read ${entry.name} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  return { manifests, probed, errors };
}

export async function scanEpic(): Promise<StoreScanResult> {
  const { manifests, probed, errors } = await readEpicManifests();
  const installs: DetectedInstall[] = [];

  for (const manifest of manifests) {
    if (!isGameManifest(manifest)) continue;
    const installLocation = manifest.installLocation;
    let installed = Boolean(installLocation);
    if (installLocation) {
      try {
        installed = (await fs.promises.stat(installLocation)).isDirectory();
      } catch {
        installed = false;
      }
    }
    if (manifest.incomplete && !installed) continue;

    installs.push({
      store: "epic",
      storeId: manifest.appName,
      name: manifest.displayName,
      installDir: installed ? installLocation : null,
      exePath: installed
        ? await resolveExecutable(
            installLocation,
            manifest.displayName,
            manifest.launchExecutable,
          )
        : null,
      sizeBytes: manifest.installSize ?? undefined,
      namespace: manifest.catalogNamespace ?? undefined,
      catalogItemId: manifest.catalogItemId ?? undefined,
      installed,
      extra: {
        appName: manifest.appName,
        incomplete: manifest.incomplete,
      },
    });
  }

  return {
    store: "epic",
    available: fs.existsSync(epicManifestsDir()),
    installs,
    probed,
    errors,
  };
}
