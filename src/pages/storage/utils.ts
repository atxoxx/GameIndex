import type { Game, SizeUnit } from "../../types/game";
import { formatSize } from "../../types/game";

// ─── Sort ──────────────────────────────────────────────────────────────────

/** Active sort key on the Storage page. */
export type SortKey =
  | "size:desc"
  | "size:asc"
  | "name:asc"
  | "name:desc"
  | "platform:asc"
  | "detectedAt:desc"
  | "mods:desc";

export const DEFAULT_SORT: SortKey = "size:desc";

/** Sort comparator factory for a given SortKey. Pure — no UI state. */
export function compareGames(sort: SortKey): (a: Game, b: Game) => number {
  switch (sort) {
    case "size:desc":
      return (a, b) => gameTotalBytes(b) - gameTotalBytes(a);
    case "size:asc":
      return (a, b) => gameTotalBytes(a) - gameTotalBytes(b);
    case "name:asc":
      return (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "name:desc":
      return (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    case "platform:asc":
      return (a, b) =>
        (a.platform || "Unknown").localeCompare(b.platform || "Unknown", undefined, { sensitivity: "base" });
    case "detectedAt:desc":
      return (a, b) => {
        const aT = a.sizeDetectedAt ? Date.parse(a.sizeDetectedAt) : Number.NEGATIVE_INFINITY;
        const bT = b.sizeDetectedAt ? Date.parse(b.sizeDetectedAt) : Number.NEGATIVE_INFINITY;
        return bT - aT;
      };
    case "mods:desc":
      return (a, b) => (b.modsSizeBytes ?? 0) - (a.modsSizeBytes ?? 0);
  }
}

export function sortGames(games: Game[], sort: SortKey): Game[] {
  return [...games].sort(compareGames(sort));
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
 *  - Windows: `"C:\Games\Foo\bin.exe"            -> "C:"`
 *  - Unix:    `"/mnt/games/Foo/bin.exe"          -> "/mnt/games"`
 *  - Fallback: "Unknown" (no path, weird format) */
export function driveOf(rootPath: string | undefined | null): string {
  if (!rootPath) return "Unknown";
  const norm = rootPath.replace(/\\/g, "/");
  const winMatch = norm.match(/^([a-zA-Z]):/);
  if (winMatch) {
    return `${winMatch[1].toUpperCase()}:`;
  }
  const parts = norm.split("/").filter(Boolean);
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
