import type { Game } from "../../types/game";

// ─── Sort ──────────────────────────────────────────────────────────────────

/** Active sort key on the Storage page. The locked default is
 *  `size:desc` per spec (no persistence between sessions). */
export type SortKey =
  | "size:desc"
  | "name:asc"
  | "platform:asc"
  | "detectedAt:desc";

export const DEFAULT_SORT: SortKey = "size:desc";

/** Sort comparator factory for a given SortKey. Pure — no UI state. */
export function compareGames(sort: SortKey): (a: Game, b: Game) => number {
  switch (sort) {
    case "size:desc":
      return (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
    case "name:asc":
      return (a, b) => a.name.localeCompare(b.name);
    case "platform:asc":
      return (a, b) =>
        (a.platform || "Unknown").localeCompare(b.platform || "Unknown");
    case "detectedAt:desc":
      // `sizeDetectedAt` is a string ISO-8601 timestamp OR undefined.
      // For the desc sort, undefined values map to -Infinity so they
      // sink to the bottom of the list.
      return (a, b) => {
        const aT = a.sizeDetectedAt
          ? Date.parse(a.sizeDetectedAt)
          : Number.NEGATIVE_INFINITY;
        const bT = b.sizeDetectedAt
          ? Date.parse(b.sizeDetectedAt)
          : Number.NEGATIVE_INFINITY;
        return bT - aT;
      };
  }
}

export function sortGames(games: Game[], sort: SortKey): Game[] {
  return [...games].sort(compareGames(sort));
}

// ─── Drive extraction ──────────────────────────────────────────────────────

/** Best-effort "drive bucket" label for a `sizeRootPath`:
 *
 *  - Windows: `"C:\Games\Foo\bin.exe"            -> "C:"`
 *  - Unix:    `"/mnt/games/Foo/bin.exe"          -> "/mnt/games"`
 *             (we strip the file basename so the bucket spans the mount)
 *  - Fallback: "Unknown" (no path, weird format) */
export function driveOf(rootPath: string | undefined | null): string {
  if (!rootPath) return "Unknown";
  // Normalize separators to forward slash so Windows + Unix share the
  // same downstream splitter.
  const norm = rootPath.replace(/\\/g, "/");
  const winMatch = norm.match(/^([a-zA-Z]):/);
  if (winMatch) {
    return `${winMatch[1].toUpperCase()}:`;
  }
  // Unix: take the first two non-empty segments so "/mnt/games" stays
  // its own bucket even when individual game folders beneath differ.
  const parts = norm.split("/").filter(Boolean);
  if (parts.length >= 2) return `/${parts[0]}/${parts[1]}`;
  if (parts.length === 1) return `/${parts[0]}`;
  return "Unknown";
}

// ─── Aggregation ────────────────────────────────────────────────────────────

/** Active grouping dimension for the Storage game list. The user picks one
 *  from the "Group by" control to reorganise the list into collapsible
 *  sections; `none` keeps the flat sorted list. */
export type GroupKey = "none" | "platform" | "emulator" | "drive";

/** A collapsible section in the grouped Storage view. */
export interface GameSection {
  /** Stable key (platform name, emulator id, or drive prefix). */
  key: string;
  /** Display label shown in the section header. */
  label: string;
  /** Games belonging to this section (already search/sort filtered). */
  games: Game[];
  /** Sum of every game's total footprint (game + mods) in this section. */
  bytes: number;
}

/** A game's full on-disk footprint: the install size plus any linked mods
 *  folder. Used everywhere the Storage tab reports "total" so mods are never
 *  silently dropped from the accounting. */
export function gameTotalBytes(g: Game): number {
  return (g.sizeBytes ?? 0) + (g.modsSizeBytes ?? 0);
}

/** Total bytes across every game, counting mods folders. Skips games with no
 *  measured footprint (game + mods == 0). */
export function totalBytesWithMods(games: Game[]): number {
  let total = 0;
  for (const g of games) {
    const t = gameTotalBytes(g);
    if (t > 0) total += t;
  }
  return total;
}

/** Group already-filtered games into collapsible sections by the chosen
 *  dimension. `resolveGroup` maps a game to its section label (already
 *  localised) — the page owns emulator-name / "Other" resolution so this
 *  helper stays free of i18n + emulator lookups.
 *
 *  Sections are returned sorted by descending total footprint so the
 *  biggest buckets surface first; `none` yields a single synthetic section. */
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

/** A single bar in the Storage header breakdown lists. */
export interface StorageBucket {
  /** Display label (platform name or drive prefix). */
  label: string;
  /** Sum of sizeBytes across this bucket's games. */
  bytes: number;
  /** Number of sized games counted into this bucket. */
  count: number;
}

/** Group sized games by `game.platform` (or "Unknown" when empty). Mods
 *  folders are folded into each game's footprint so the breakdown reflects
 *  the true game + mods size. */
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

/** Group sized games by the drive prefix of `sizeRootPath`. Mods folders are
 *  folded into each game's footprint (see `gameTotalBytes`). */
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

/** Total bytes across every sized game (skips games whose sizeBytes is
 *  undefined or <= 0). */
export function totalBytes(games: Game[]): number {
  let total = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) total += g.sizeBytes;
  }
  return total;
}

/** How many sized games vs unsized games exist — used to label the
 *  total/totals card so the user sees the coverage at a glance. */
export function sizeCoverage(games: Game[]): { sized: number; unsized: number } {
  let sized = 0;
  let unsized = 0;
  for (const g of games) {
    if (g.sizeBytes != null && g.sizeBytes > 0) sized += 1;
    else unsized += 1;
  }
  return { sized, unsized };
}

// ─── Path relocation ───────────────────────────────────────────────────────

/** Recompute an executable's path after its install folder has moved.
 *
 *  `oldExe` is the previous `game.path` (e.g. `D:\Games\Foo\Bin\foo.exe`),
 *  `oldRoot` is the previously-measured install folder (`sizeRootPath`,
 *  e.g. `D:\Games\Foo`), and `newRoot` is where that folder was copied to
 *  (e.g. `E:\Library\Foo`). We keep the relative structure under the new
 *  root so the launcher still finds the exe.
 *
 *  Falls back to just the file name when `oldExe` doesn't sit beneath
 *  `oldRoot` (defensive — should not happen for a correctly measured game). */
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
