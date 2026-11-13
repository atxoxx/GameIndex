/**
 * Save-location detection (ported from `src-tauri/src/saves/detect.rs`).
 *
 * Four complementary strategies, all best-effort and safe to re-run:
 *
 *   1. **Curated registry** — exact templates for known titles (`registry.ts`).
 *   2. **Steam Cloud** — `steamapps/../userdata/<account>/<appid>` folders,
 *      resolved from the game's install path when it lives inside a Steam
 *      library.
 *   3. **Store / Wine hints** — Unreal's `Saved/SaveGames` layout, GOG install
 *      folders that keep saves next to the game, and Proton/Wine prefixes
 *      (`compatdata/<appid>/pfx/...` and `~/.wine`) when they exist.
 *   4. **Heuristic name scan** — folders named after the game under
 *      `Documents`, `Documents/My Games`, `Saved Games`, `%APPDATA%`,
 *      `%LOCALAPPDATA%`, `LocalLow`, `~/.config`, …
 *
 * Detection never deletes anything: results are merged into the stored
 * locations (case-insensitively de-duped) by the command layer.
 */
import fs from "node:fs";
import path from "node:path";
import type { Game } from "../../../../src/types/game";
import { compatibilityPrefixCandidates } from "../compatibility/launch";
import { lookupCurated, normalizeName } from "./registry";
import type { DetectedLocation } from "./types";

/** Known save roots for the host. Every field is optional. */
export interface SaveRoots {
  home: string | null;
  appdata: string | null;
  localAppData: string | null;
  localLow: string | null;
  documents: string | null;
  savedGames: string | null;
  programData: string | null;
}

function envPath(key: string): string | null {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function isDir(target: string | null): target is string {
  if (!target) return false;
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Resolve the host's standard folders from the environment. */
export function resolveRoots(): SaveRoots {
  const home = envPath("HOME") ?? envPath("USERPROFILE");
  const appdata = envPath("APPDATA") ?? (home ? path.join(home, ".config") : null);
  const localAppData =
    envPath("LOCALAPPDATA") ?? (home ? path.join(home, ".local", "share") : null);
  const localLow =
    localAppData && isDir(path.join(path.dirname(localAppData), "LocalLow"))
      ? path.join(path.dirname(localAppData), "LocalLow")
      : null;
  // OneDrive redirects `Documents` on many Windows installs; prefer the real
  // user folder and fall back to the synced one when it is absent.
  const userProfile = envPath("USERPROFILE") ?? home;
  const plainDocuments = userProfile ? path.join(userProfile, "Documents") : null;
  const oneDriveDocuments = userProfile
    ? path.join(userProfile, "OneDrive", "Documents")
    : null;
  const documents =
    plainDocuments && isDir(plainDocuments)
      ? plainDocuments
      : oneDriveDocuments && isDir(oneDriveDocuments)
        ? oneDriveDocuments
        : plainDocuments;
  const savedGames = userProfile ? path.join(userProfile, "Saved Games") : null;
  const programData = envPath("PROGRAMDATA") ?? (process.platform === "win32" ? "C:/ProgramData" : null);
  return { home, appdata, localAppData, localLow, documents, savedGames, programData };
}

/** Context used to expand registry templates. */
export interface TemplateContext {
  roots: SaveRoots;
  appId: number | null;
  installDir: string | null;
}

/**
 * Expand a `<token>/…` template into an absolute path, or `null` when a token
 * has no meaning on this host.
 */
export function resolveTemplate(template: string, context: TemplateContext): string | null {
  const segments = template.split("/");
  const head = segments.shift();
  if (!head) return null;
  const base = (() => {
    switch (head) {
      case "<winAppData>":
        return context.roots.appdata;
      case "<winLocalAppData>":
        return context.roots.localAppData;
      case "<winLocalLow>":
        return context.roots.localLow;
      case "<winDocuments>":
        return context.roots.documents;
      case "<winSavedGames>":
        return context.roots.savedGames;
      case "<winProgramData>":
        return context.roots.programData;
      case "<home>":
        return context.roots.home;
      case "<base>":
      case "<path-to-game>":
      case "{{p|game}}":
        return context.installDir;
      default:
        return null;
    }
  })();
  if (!base) return null;

  let resolved = base;
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "<storeAppId>") {
      if (context.appId === null) return null;
      resolved = path.join(resolved, String(context.appId));
      continue;
    }
    if (segment === "<osUserName>") {
      const user = process.env.USERNAME ?? process.env.USER;
      if (!user) return null;
      resolved = path.join(resolved, user);
      continue;
    }
    resolved = path.join(resolved, segment);
  }
  return resolved;
}

/** The install directory hint for a game (the folder holding its exe). */
export function installDirFor(game: Game): string | null {
  const measured = game.sizeRootPath?.trim();
  if (measured && isDir(measured)) return measured;
  if (!game.path || game.path.trim() === "") return null;
  return path.dirname(game.path);
}

/** Steam install root inferred from a game's install path. */
export function steamRootFromInstall(game: Game): string | null {
  const target = game.path ?? "";
  if (!target) return null;
  let current = path.dirname(target);
  for (;;) {
    if (path.basename(current).toLowerCase() === "steamapps") {
      return path.dirname(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Ordered, de-duplicated name variants matched against folder names. */
export function nameVariants(game: Game): string[] {
  const out = new Set<string>();
  for (const raw of [game.name, game.displayName]) {
    if (!raw) continue;
    const normalized = normalizeName(raw);
    if (normalized) out.add(normalized);
  }
  const stem = game.path ? path.basename(game.path, path.extname(game.path)) : "";
  const stemNormalized = normalizeName(stem);
  if (stemNormalized) out.add(stemNormalized);
  return [...out].sort();
}

/** Folder names to probe for store-specific layouts (not normalized). */
function folderNameCandidates(game: Game): string[] {
  const out = new Set<string>();
  for (const raw of [game.name, game.displayName]) {
    const trimmed = raw?.trim();
    if (trimmed) out.add(trimmed);
  }
  const install = installDirFor(game);
  if (install) {
    const base = path.basename(install).trim();
    if (base) out.add(base);
  }
  return [...out];
}

function toStoredPath(target: string): string {
  return target.replace(/\\/g, "/");
}

function samePath(a: string, b: string): boolean {
  return toStoredPath(a).toLowerCase() === toStoredPath(b).toLowerCase();
}

/** Collects matches with the engine's case-insensitive path de-dupe. */
class LocationCollector {
  readonly found: DetectedLocation[] = [];

  add(target: string, label: string, kind: string, source: string): void {
    let exists = false;
    try {
      const stat = fs.statSync(target);
      exists = kind === "file" ? stat.isFile() : stat.isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) return;
    if (this.found.some((entry) => samePath(entry.path, target))) return;
    this.found.push({
      path: toStoredPath(target),
      label,
      kind,
      source,
    });
  }
}

/** Walk `dir` up to `maxDepth`, adding children whose name matches a variant. */
function scanChildrenForNames(
  dir: string,
  variants: Set<string>,
  maxDepth: number,
  collector: LocationCollector,
): void {
  const walk = (current: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      const target = path.join(current, entry.name);
      if (variants.has(normalizeName(entry.name))) {
        collector.add(target, entry.name, "dir", "heuristic");
        continue;
      }
      // Only descend one extra level — `My Games/<Game>` and
      // `LocalLow/<Company>/<Game>` are the useful shapes.
      walk(target, depth + 1);
    }
  };
  walk(dir, 1);
}

/** Probe a Proton / Wine prefix for the game's folders. */
function scanWinePrefix(
  prefixRoot: string,
  candidates: string[],
  collector: LocationCollector,
): void {
  let users: fs.Dirent[];
  try {
    users = fs.readdirSync(prefixRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const user of users) {
    if (!user.isDirectory()) continue;
    const userRoot = path.join(prefixRoot, user.name);
    for (const relative of ["AppData/Roaming", "AppData/Local", "AppData/LocalLow"]) {
      for (const folder of candidates) {
        collector.add(
          path.join(userRoot, ...relative.split("/"), folder),
          folder,
          "dir",
          "heuristic",
        );
      }
    }
  }
}

/** Find a ROM's own save files next to the ROM (emulator heuristic). */
function detectRomSaves(game: Game, collector: LocationCollector): void {
  const romPath = game.romPath?.trim();
  if (!romPath) return;
  const dir = path.dirname(romPath);
  const stem = path.basename(romPath, path.extname(romPath));
  if (!stem) return;
  for (const extension of [".sav", ".srm", ".save", ".state", ".dsv", ".mcr"]) {
    const candidate = path.join(dir, `${stem}${extension}`);
    if (fs.existsSync(candidate)) {
      collector.add(candidate, path.basename(candidate), "file", "emulator");
    }
  }
}

export interface DetectOptions {
  /** Also look for emulator-owned save files next to the ROM. */
  includeEmulatorSaves?: boolean;
  roots?: SaveRoots;
}

/** Detect save locations for one game. */
export function detectForGame(game: Game, options: DetectOptions = {}): DetectedLocation[] {
  const roots = options.roots ?? resolveRoots();
  const appId =
    typeof game.steamAppId === "number" && Number.isFinite(game.steamAppId)
      ? game.steamAppId
      : null;
  const installDir = installDirFor(game);
  const collector = new LocationCollector();
  const variants = new Set(nameVariants(game));

  // 1. Curated registry.
  const curated = lookupCurated(appId, game.name ?? "");
  if (curated) {
    const context: TemplateContext = { roots, appId, installDir };
    for (const template of curated.paths) {
      const resolved = resolveTemplate(template, context);
      if (!resolved) continue;
      collector.add(resolved, path.basename(resolved) || "Saves", "dir", "curated");
    }
  }

  // 2. Steam Cloud userdata.
  const steamRoot = steamRootFromInstall(game);
  if (steamRoot && appId !== null) {
    const userdata = path.join(steamRoot, "userdata");
    try {
      for (const user of fs.readdirSync(userdata, { withFileTypes: true })) {
        if (!user.isDirectory()) continue;
        collector.add(
          path.join(userdata, user.name, String(appId)),
          "Steam Cloud",
          "dir",
          "steam",
        );
      }
    } catch {
      /* no userdata folder: not a Steam install */
    }
  }

  // 3. Store-specific layouts.
  const candidates = folderNameCandidates(game);
  if (roots.localAppData) {
    for (const folder of candidates) {
      // Unreal Engine keeps saves in `<Game>/Saved/SaveGames`.
      collector.add(
        path.join(roots.localAppData, folder, "Saved", "SaveGames"),
        "Epic/Unreal saves",
        "dir",
        "heuristic",
      );
      collector.add(
        path.join(roots.localAppData, folder, "Saved", "SaveData"),
        "Epic/Unreal saves",
        "dir",
        "heuristic",
      );
    }
  }
  if (installDir) {
    for (const folder of ["saves", "Saves", "SaveGames", "savegames", "SaveData"]) {
      collector.add(
        path.join(installDir, folder),
        "GOG saves",
        "dir",
        "heuristic",
      );
    }
  }

  // 4. Wine / Proton prefixes, when present.
  if (steamRoot && appId !== null) {
    scanWinePrefix(
      path.join(steamRoot, "steamapps", "compatdata", String(appId), "pfx", "drive_c", "users"),
      candidates,
      collector,
    );
  }
  if (roots.home) {
    const wineUsers = path.join(roots.home, ".wine", "drive_c", "users");
    if (isDir(wineUsers)) scanWinePrefix(wineUsers, candidates, collector);
  }
  // 4b. The prefix GameIndex launches this game with: a per-game override, the
  // global default, or the generated `<base>/<gameId>` folder. Steam's
  // compatdata above only covers titles Steam itself launched.
  for (const prefix of compatibilityPrefixCandidates(game.id)) {
    for (const users of [
      path.join(prefix, "pfx", "drive_c", "users"),
      path.join(prefix, "drive_c", "users"),
    ]) {
      if (isDir(users)) {
        scanWinePrefix(users, candidates, collector);
        break;
      }
    }
  }

  // 5. Heuristic name scan across the standard roots.
  if (variants.size > 0) {
    const scanRoots: string[] = [];
    if (roots.documents) {
      scanRoots.push(roots.documents);
      scanRoots.push(path.join(roots.documents, "My Games"));
    }
    for (const root of [roots.savedGames, roots.appdata, roots.localAppData, roots.localLow]) {
      if (root) scanRoots.push(root);
    }
    if (roots.home) scanRoots.push(path.join(roots.home, ".config"), path.join(roots.home, ".local", "share"));
    for (const root of scanRoots) {
      scanChildrenForNames(root, variants, 2, collector);
    }
  }

  // 6. Emulator ROM saves (per-file match, no emulator database required).
  if (options.includeEmulatorSaves !== false) {
    detectRomSaves(game, collector);
  }

  return collector.found;
}
