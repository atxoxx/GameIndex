import type { Game, SizeUnit } from "../../types/game";
import { formatSize } from "../../types/game";
import { mountPointOf } from "./mounts";

// ─── Tabs, filters, columns ────────────────────────────────────────────────

/** Top-level views of the Storage page. */
export type StorageTab = "overview" | "games" | "health" | "emulators";

export const STORAGE_TABS: StorageTab[] = ["overview", "games", "health", "emulators"];

/** Status chips above the game table. Ids match the existing i18n keys
 *  (`storage.{id}` / `storage.filter.{id}`). */
export type StorageFilter =
  | "all"
  | "sized"
  | "missing"
  | "stale"
  | "hasMods"
  | "massive"
  | "large"
  | "small";

/** Optional columns, toggled from the toolbar's column picker. Name and size
 *  are always present. */
export type TableColumn = "platform" | "drive" | "mods" | "lastPlayed" | "measuredAt";

export const TABLE_COLUMNS: TableColumn[] = [
  "platform",
  "drive",
  "mods",
  "lastPlayed",
  "measuredAt",
];

export const DEFAULT_COLUMNS: TableColumn[] = [
  "platform",
  "drive",
  "mods",
  "lastPlayed",
  "measuredAt",
];

/** Columns the table can sort by. */
export type StorageSortColumn =
  | "name"
  | "platform"
  | "drive"
  | "size"
  | "mods"
  | "measuredAt"
  | "lastPlayed";

export type SortDirection = "asc" | "desc";

export interface StorageSort {
  column: StorageSortColumn;
  direction: SortDirection;
}

/** Largest first — the question people actually open this page with. */
export const DEFAULT_SORT: StorageSort = { column: "size", direction: "desc" };

/** Name and platform read best A→Z; every measurement is a "show me the big
 *  end first" column. */
export function defaultDirection(column: StorageSortColumn): SortDirection {
  return column === "name" || column === "platform" || column === "drive" ? "asc" : "desc";
}

/** Clicking the active column flips it; clicking a new one starts at its
 *  natural direction. */
export function nextSort(current: StorageSort, column: StorageSortColumn): StorageSort {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: defaultDirection(column) };
}

function measuredAtValue(game: Game): number {
  if (!game.sizeDetectedAt) return 0;
  const parsed = Date.parse(game.sizeDetectedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Comparator for one column, before direction is applied. Unmeasured games
 *  always sort below measured ones so an empty value never wins a "largest"
 *  sort. */
function compareColumn(column: StorageSortColumn): (a: Game, b: Game) => number {
  switch (column) {
    case "name":
      return (a, b) =>
        (a.displayName || a.name).localeCompare(b.displayName || b.name, undefined, {
          sensitivity: "base",
        });
    case "platform":
      return (a, b) =>
        (a.platform || "").localeCompare(b.platform || "", undefined, { sensitivity: "base" });
    case "drive":
      return (a, b) => {
        const aDrive = a.sizeRootPath ? driveOf(a.sizeRootPath) : "";
        const bDrive = b.sizeRootPath ? driveOf(b.sizeRootPath) : "";
        return aDrive.localeCompare(bDrive, undefined, { sensitivity: "base" });
      };
    case "mods":
      return (a, b) => (a.modsSizeBytes ?? 0) - (b.modsSizeBytes ?? 0);
    case "measuredAt":
      return (a, b) => measuredAtValue(a) - measuredAtValue(b);
    case "lastPlayed":
      return (a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0);
    case "size":
    default:
      return (a, b) => gameTotalBytes(a) - gameTotalBytes(b);
  }
}

/** Stable, pure sort for the game table. */
export function sortGamesByColumn(games: Game[], sort: StorageSort): Game[] {
  const compare = compareColumn(sort.column);
  const sign = sort.direction === "asc" ? 1 : -1;

  const measure = (game: Game) =>
    sort.column === "mods" ? game.modsSizeBytes ?? 0 : gameTotalBytes(game);

  return [...games].sort((a, b) => {
    // Unmeasured games sink to the bottom whichever way the column points.
    if (sort.column === "size" || sort.column === "mods") {
      const aSize = measure(a);
      const bSize = measure(b);
      if (aSize === 0 && bSize > 0) return 1;
      if (bSize === 0 && aSize > 0) return -1;
    }
    return sign * compare(a, b) || (a.displayName || a.name).localeCompare(b.displayName || b.name);
  });
}

/** Does a game pass the active status chip? `stale` is supplied separately
 *  because staleness is resolved by a filesystem probe, not stored on the
 *  game. */
export function matchesStorageFilter(
  game: Game,
  filter: StorageFilter,
  stale: boolean,
): boolean {
  const bytes = gameTotalBytes(game);
  switch (filter) {
    case "sized":
      return bytes > 0;
    case "missing":
      return bytes <= 0;
    case "stale":
      return stale;
    case "hasMods":
      return (game.modsSizeBytes ?? 0) > 0;
    case "massive":
      return getSizeTier(game) === "massive";
    case "large":
      return getSizeTier(game) === "large";
    case "small": {
      const tier = getSizeTier(game);
      return tier === "small" || tier === "medium";
    }
    case "all":
    default:
      return true;
  }
}

/** Serialise the table sort for persistence. */
export function serializeSort(sort: StorageSort): string {
  return `${sort.column}:${sort.direction}`;
}

/** Read a persisted sort back, falling back on the default for anything
 *  unrecognised (old keys, hand-edited localStorage). */
export function parseSort(value: string | null | undefined): StorageSort {
  if (!value) return DEFAULT_SORT;
  const [column, direction] = value.split(":");
  const validColumn = [
    "name",
    "platform",
    "drive",
    "size",
    "mods",
    "measuredAt",
    "lastPlayed",
  ].includes(column);
  if (!validColumn || (direction !== "asc" && direction !== "desc")) return DEFAULT_SORT;
  return { column: column as StorageSortColumn, direction };
}

export const SORT_OPTION_VALUES = [
  "name:asc",
  "name:desc",
  "platform:asc",
  "platform:desc",
  "drive:asc",
  "drive:desc",
  "size:asc",
  "size:desc",
  "mods:asc",
  "mods:desc",
  "measuredAt:asc",
  "measuredAt:desc",
  "lastPlayed:asc",
  "lastPlayed:desc",
];

/** "3 days ago" / "today" / "never" for the table's date cells. Uses
 *  `Intl.RelativeTimeFormat`, so the wording follows the user's locale instead
 *  of hardcoding English units. */
export function formatRelativeDay(
  value: string | number | undefined | null,
  neverLabel: string,
  now: number = Date.now(),
  locale?: string,
): string {
  if (value == null || value === "") return neverLabel;
  const at = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(at)) return neverLabel;

  const days = Math.floor((now - at) / 86_400_000);
  if (days < 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "day");
  if (days < 30) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  if (days < 365) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.round(days / 30), "month");
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.round(days / 365), "year");
}

// ─── Size Tiers ────────────────────────────────────────────────────────────

export type SizeTier = "massive" | "large" | "medium" | "small" | "unmeasured";

const GB = 1024 * 1024 * 1024;

export function getSizeTier(game: Game): SizeTier {
  const bytes = gameTotalBytes(game);
  if (bytes <= 0) return "unmeasured";
  if (bytes >= 50 * GB) return "massive";
  if (bytes >= 15 * GB) return "large";
  if (bytes >= 5 * GB) return "medium";
  return "small";
}

// ─── Drive extraction ──────────────────────────────────────────────────────

/** Best-effort "drive bucket" label for a `sizeRootPath`:
 *
 *  - Resolved mount point when `resolve_mounts` has populated the cache
 *    (accurate on Linux, where `/run/media/<user>/diskA` and `diskB` are
 *    distinct disks).
 *  - Windows:   `"C:\Games\Foo\bin.exe"            -> "C:"`
 *  - Linux:     `"/run/media/u/disk1/Foo/bin"      -> "/run/media/u/disk1"`
 *  - Fallback:  "Unknown" (no path, weird format) */
export function driveOf(rootPath: string | undefined | null): string {
  if (!rootPath) return "Unknown";
  const resolved = mountPointOf(rootPath);
  if (resolved) return resolved;
  const norm = rootPath.replace(/\\/g, "/");
  const winMatch = norm.match(/^([a-zA-Z]):/);
  if (winMatch) {
    return `${winMatch[1].toUpperCase()}:`;
  }
  const parts = norm.split("/").filter(Boolean);
  // Linux removable-media layouts: every volume under these roots is a
  // separate mount, so keep one segment more than the generic fallback.
  if (parts[0] === "run" && parts[1] === "media" && parts.length >= 4) {
    return `/${parts.slice(0, 4).join("/")}`;
  }
  if (parts[0] === "media" && parts.length >= 3) {
    return `/${parts.slice(0, 3).join("/")}`;
  }
  if ((parts[0] === "mnt" || parts[0] === "Volumes") && parts.length >= 2) {
    return `/${parts.slice(0, 2).join("/")}`;
  }
  if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `/${parts[0]}`;
  return "Unknown";
}

// ─── Aggregation & Grouping ────────────────────────────────────────────────

export type GroupKey = "none" | "drive" | "platform" | "sizeTier" | "emulator" | "status";

export interface GameSection {
  key: string;
  label: string;
  games: Game[];
  bytes: number;
}

export function gameTotalBytes(g: Game): number {
  return (g.sizeBytes ?? 0) + (g.modsSizeBytes ?? 0);
}

export function totalBytesWithMods(games: Game[]): number {
  let total = 0;
  for (const g of games) {
    const t = gameTotalBytes(g);
    if (t > 0) total += t;
  }
  return total;
}

export function buildSections(
  games: Game[],
  groupBy: GroupKey,
  resolveGroup: (g: Game) => string
): GameSection[] {
  if (groupBy === "none") {
    return [
      {
        key: "__all",
        label: "",
        games,
        bytes: totalBytesWithMods(games),
      },
    ];
  }
  const m = new Map<string, Game[]>();
  for (const g of games) {
    const key = resolveGroup(g);
    const cur = m.get(key);
    if (cur) cur.push(g);
    else m.set(key, [g]);
  }
  return Array.from(m, ([key, gs]) => ({
    key,
    label: key,
    games: gs,
    bytes: totalBytesWithMods(gs),
  })).sort((a, b) => b.bytes - a.bytes);
}

export interface StorageBucket {
  label: string;
  bytes: number;
  count: number;
}

export function platformBuckets(games: Game[]): StorageBucket[] {
  const m = new Map<string, { bytes: number; count: number }>();
  for (const g of games) {
    const bytes = gameTotalBytes(g);
    if (bytes <= 0) continue;
    const key = g.platform || "Unknown";
    const cur = m.get(key) ?? { bytes: 0, count: 0 };
    cur.bytes += bytes;
    cur.count += 1;
    m.set(key, cur);
  }
  return Array.from(m, ([label, v]) => ({ label, ...v })).sort(
    (a, b) => b.bytes - a.bytes
  );
}

export function driveBuckets(games: Game[]): StorageBucket[] {
  const m = new Map<string, { bytes: number; count: number }>();
  for (const g of games) {
    const bytes = gameTotalBytes(g);
    if (bytes <= 0) continue;
    const key = driveOf(g.sizeRootPath);
    const cur = m.get(key) ?? { bytes: 0, count: 0 };
    cur.bytes += bytes;
    cur.count += 1;
    m.set(key, cur);
  }
  return Array.from(m, ([label, v]) => ({ label, ...v })).sort(
    (a, b) => b.bytes - a.bytes
  );
}

export function totalBytes(games: Game[]): number {
  let total = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) total += g.sizeBytes;
  }
  return total;
}

export function sizeCoverage(games: Game[]): { sized: number; unsized: number } {
  let sized = 0;
  let unsized = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) sized += 1;
    else unsized += 1;
  }
  return { sized, unsized };
}

export function getLargestGame(games: Game[]): Game | null {
  let maxGame: Game | null = null;
  let maxBytes = 0;
  for (const g of games) {
    const b = gameTotalBytes(g);
    if (b > maxBytes) {
      maxBytes = b;
      maxGame = g;
    }
  }
  return maxGame;
}

export function getStorageHealth(
  games: Game[],
  staleMap: Map<string, boolean>
): { score: number; staleCount: number; unsizedCount: number; statusText: "optimal" | "good" | "needsAttention" } {
  if (games.length === 0) {
    return { score: 100, staleCount: 0, unsizedCount: 0, statusText: "optimal" };
  }
  let staleCount = 0;
  let unsizedCount = 0;
  for (const g of games) {
    if (staleMap.get(g.id) === true) staleCount += 1;
    if (g.sizeBytes == null || g.sizeBytes <= 0) unsizedCount += 1;
  }
  // Penalize unmeasured games and broken paths
  const penalty = (unsizedCount * 10 + staleCount * 25) / games.length;
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  const statusText = score >= 90 ? "optimal" : score >= 70 ? "good" : "needsAttention";
  return { score, staleCount, unsizedCount, statusText };
}

// ─── Export Reports ────────────────────────────────────────────────────────

export function exportStorageReportCsv(games: Game[], unit: SizeUnit): string {
  const headers = [
    "Game ID",
    "Name",
    "Platform",
    "Size (Bytes)",
    "Size (Formatted)",
    "Mods (Bytes)",
    "Mods (Formatted)",
    "Total Footprint (Bytes)",
    "Drive",
    "Install Path",
    "Mods Path",
    "Last Detected",
  ];
  const rows = games.map((g) => {
    const s = g.sizeBytes ?? 0;
    const m = g.modsSizeBytes ?? 0;
    const tot = s + m;
    return [
      `"${g.id}"`,
      `"${(g.name || "").replace(/"/g, '""')}"`,
      `"${(g.platform || "").replace(/"/g, '""')}"`,
      s,
      `"${formatSize(s, unit)}"`,
      m,
      `"${formatSize(m, unit)}"`,
      tot,
      `"${driveOf(g.sizeRootPath)}"`,
      `"${(g.sizeRootPath || g.path || "").replace(/"/g, '""')}"`,
      `"${(g.modsFolder || "").replace(/"/g, '""')}"`,
      `"${g.sizeDetectedAt || ""}"`,
    ].join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

export function exportStorageReportJson(games: Game[]): string {
  const data = games.map((g) => ({
    id: g.id,
    name: g.name,
    platform: g.platform ?? "Unknown",
    sizeBytes: g.sizeBytes ?? null,
    modsSizeBytes: g.modsSizeBytes ?? null,
    totalBytes: gameTotalBytes(g),
    drive: driveOf(g.sizeRootPath),
    installPath: g.sizeRootPath || g.path || null,
    modsFolder: g.modsFolder || null,
    sizeDetectedAt: g.sizeDetectedAt || null,
  }));
  return JSON.stringify(data, null, 2);
}

// ─── Path helpers ──────────────────────────────────────────────────────────

/** Parent folder of a install root, normalised to forward slashes. */
export function parentDir(path: string): string {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const index = norm.lastIndexOf("/");
  return index > 0 ? norm.slice(0, index) : norm;
}

function isFilesystemRoot(path: string): boolean {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return norm === "" || /^[a-zA-Z]:$/.test(norm);
}

/** Folder names that read as a game library rather than a random directory. */
const LIBRARY_DIR = /(^|\/)(games?|game library|gamelib|library|common|steamapps|gog games|epic games|steam library|steamlibrary)$/i;

/**
 * Library roots worth scanning for leftovers.
 *
 * A parent folder qualifies when it holds at least two installed games (so it
 * is genuinely the user's library) or when its name reads like one. Bare
 * drive letters never qualify: scanning `C:\` would list Program Files and
 * every unrelated app on the machine.
 */
export function libraryRoots(games: Game[]): string[] {
  const counts = new Map<string, number>();
  for (const game of games) {
    if (!game.installed) continue;
    const root = game.sizeRootPath?.trim();
    if (!root) continue;
    const parent = parentDir(root);
    if (!parent || parent === root || isFilesystemRoot(parent)) continue;
    counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([parent, count]) => count >= 2 || LIBRARY_DIR.test(parent))
    .map(([parent]) => parent)
    .sort((a, b) => a.localeCompare(b));
}

// ─── Path relocation ───────────────────────────────────────────────────────

export function relocateExe(
  oldExe: string | undefined,
  oldRoot: string,
  newRoot: string
): string {
  if (!oldExe) return newRoot;
  const norm = (p: string) => p.replace(/\\/g, "/");
  const e = norm(oldExe);
  const r = norm(oldRoot);
  let rel = e;
  if (r && e.startsWith(r)) {
    rel = e.slice(r.length);
  } else {
    rel = e.split("/").pop() ?? "";
  }
  rel = rel.replace(/^\/+/, "");
  const sep = newRoot.includes("\\") ? "\\" : "/";
  const base = newRoot.endsWith(sep) ? newRoot : newRoot + sep;
  return base + rel;
}
