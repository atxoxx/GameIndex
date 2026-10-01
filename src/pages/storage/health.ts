import type { Game } from "../../types/game";
import { parsePlayTime, slugify } from "../../types/game";
import { gameTotalBytes } from "./utils";

// ─── Tunables ──────────────────────────────────────────────────────────────
//
// Exported so the UI can explain the thresholds it applied and so tests can
// pin them. Kept deliberately conservative: a health scan that cries wolf
// gets ignored, which is worse than missing a mild issue.

/** A game this large that has never been launched is a strong "do I still
 *  want this installed?" candidate (matches the Storage "large" tier). */
export const HUGE_UNPLAYED_BYTES = 15 * 1024 ** 3;

/** A size measurement older than this is treated as stale — drives
 *  changed, patches landed, DLC shipped — and worth re-measuring. */
export const STALE_SIZE_DAYS = 180;

/** Severity weights behind the 0-100 library health score. */
const SCORE_WEIGHTS = {
  paths: 12,
  duplicates: 6,
  metadata: 2,
  artwork: 1,
  sizes: 1.5,
  backlog: 2,
} as const;

// ─── Types ─────────────────────────────────────────────────────────────────

export type HealthCategory =
  | "paths"
  | "duplicates"
  | "metadata"
  | "artwork"
  | "sizes"
  | "backlog";

export type HealthSeverity = "critical" | "warning" | "info";

/** Whether each recorded folder for one game still exists on disk. */
export interface PathPresence {
  path?: boolean;
  sizeRootPath?: boolean;
}

export interface StalePathIssue {
  gameId: string;
  field: "path" | "sizeRootPath";
  path: string;
  installed: boolean;
}

export interface DuplicateGroup {
  key: string;
  reason: "samePath" | "sameName";
  games: Game[];
  /** The entry the scan recommends keeping. */
  keepId: string;
  removeIds: string[];
}

export type MetadataGap = "description" | "developer" | "publisher" | "genres";
export type ArtGap = "cover" | "icon" | "banner" | "logo";

export interface MetadataIssue {
  gameId: string;
  metadataGaps: MetadataGap[];
  artGaps: ArtGap[];
}

export type SizeIssueReason = "neverMeasured" | "missingTimestamp" | "oldMeasurement";

export interface SizeIssue {
  gameId: string;
  reason: SizeIssueReason;
  /** Present for `oldMeasurement`. */
  ageDays?: number;
}

export interface BacklogIssue {
  gameId: string;
  reason: "hugeUnplayed" | "neverPlayed";
  sizeBytes: number;
  /** Unix ms of the last session, when the game has ever been played. */
  lastPlayed?: number;
}

export interface OrphanArtwork {
  relativePath: string;
  gameId: string;
  slot: string;
  sizeBytes: number;
  reason: "unreferencedGame" | "unreferencedSlot";
  modifiedAt?: number;
}

export interface HealthCounts {
  paths: number;
  duplicates: number;
  metadata: number;
  artwork: number;
  sizes: number;
  backlog: number;
  total: number;
}

export interface HealthScore {
  score: number;
  band: "optimal" | "good" | "attention" | "critical";
}

// ─── Detectors ─────────────────────────────────────────────────────────────

/** Games whose recorded `path` and/or `sizeRootPath` is gone. `presence`
 *  is keyed by game id and comes from the batched `check_paths_exist`
 *  sweep; a missing entry is treated as "not checked" and ignored. */
export function findStalePaths(
  games: Game[],
  presence: Map<string, PathPresence>
): StalePathIssue[] {
  const out: StalePathIssue[] = [];
  for (const game of games) {
    const state = presence.get(game.id);
    if (!state) continue;
    if (game.sizeRootPath?.trim() && state.sizeRootPath === false) {
      out.push({
        gameId: game.id,
        field: "sizeRootPath",
        path: game.sizeRootPath,
        installed: game.installed,
      });
    }
    // Skip `path` when it merely repeats the measured root.
    if (
      game.path?.trim() &&
      game.path !== game.sizeRootPath &&
      state.path === false
    ) {
      out.push({
        gameId: game.id,
        field: "path",
        path: game.path,
        installed: game.installed,
      });
    }
  }
  return out;
}

function normalizedFsPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Store protocols (`steam://…`, `goggalaxy://…`) are shared by every
  // game in that store and would look like hundreds of duplicates.
  if (trimmed.includes("://")) return null;
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Rank how "complete" an entry is so the scan keeps the healthiest copy
 *  of a duplicate and offers the rest for removal. */
function duplicateRank(game: Game): number {
  let score = 0;
  if (game.installed) score += 8;
  if (game.coverArtUrl) score += 2;
  if (game.description) score += 1;
  if (game.metadataSource) score += 1;
  if (game.lastPlayed) score += 2;
  if (game.sizeBytes && game.sizeBytes > 0) score += 1;
  return score;
}

/** Group near-identical library rows. Exact install-path matches are
 *  reported as `samePath` (almost always a real duplicate import); rows
 *  that only share a normalized title are `sameName` and should be
 *  reviewed before removal because sequels/DLC collide. */
export function findDuplicates(games: Game[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const claimed = new Set<string>();

  const byPath = new Map<string, Game[]>();
  for (const game of games) {
    const key = normalizedFsPath(game.sizeRootPath) ?? normalizedFsPath(game.path);
    if (!key) continue;
    const list = byPath.get(key);
    if (list) list.push(game);
    else byPath.set(key, [game]);
  }
  for (const [key, list] of byPath) {
    if (list.length < 2) continue;
    list.forEach((g) => claimed.add(g.id));
    const sorted = [...list].sort((a, b) => duplicateRank(b) - duplicateRank(a));
    groups.push({
      key,
      reason: "samePath",
      games: sorted,
      keepId: sorted[0].id,
      removeIds: sorted.slice(1).map((g) => g.id),
    });
  }

  const byName = new Map<string, Game[]>();
  for (const game of games) {
    if (claimed.has(game.id)) continue;
    const key = slugify(game.name);
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(game);
    else byName.set(key, [game]);
  }
  for (const [key, list] of byName) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => duplicateRank(b) - duplicateRank(a));
    groups.push({
      key,
      reason: "sameName",
      games: sorted,
      keepId: sorted[0].id,
      removeIds: sorted.slice(1).map((g) => g.id),
    });
  }

  return groups;
}

const METADATA_GAPS: { field: MetadataGap; has: (g: Game) => boolean }[] = [
  { field: "description", has: (g) => !!g.description?.trim() },
  { field: "developer", has: (g) => !!g.developer?.trim() },
  { field: "publisher", has: (g) => !!g.publisher?.trim() },
  { field: "genres", has: (g) => !!g.genres && g.genres.length > 0 },
];

const ART_GAPS: { field: ArtGap; has: (g: Game) => boolean }[] = [
  { field: "cover", has: (g) => !!g.coverArtUrl },
  { field: "icon", has: (g) => !!g.iconUrl },
  { field: "banner", has: (g) => !!g.bannerUrl },
  { field: "logo", has: (g) => !!g.logoUrl },
];

/** Entries with gaps in fetched metadata and/or primary artwork. A game
 *  that has full metadata and a cover is omitted even if a secondary slot
 *  (logo/banner/icon) is absent — those are cosmetic, and listing every
 *  one of them would bury the real gaps. */
export function findMetadataIssues(games: Game[]): MetadataIssue[] {
  const out: MetadataIssue[] = [];
  for (const game of games) {
    const metadataGaps = METADATA_GAPS.filter((m) => !m.has(game)).map((m) => m.field);
    const artGaps = ART_GAPS.filter((a) => !a.has(game)).map((a) => a.field);
    const missingCover = !game.coverArtUrl;
    const noArt = artGaps.length === ART_GAPS.length;
    if (metadataGaps.length === 0 && !missingCover && !noArt) continue;
    out.push({ gameId: game.id, metadataGaps, artGaps });
  }
  return out;
}

/** Installed games with no footprint, no measurement timestamp, or a
 *  measurement older than {@link STALE_SIZE_DAYS}. */
export function findSizeIssues(games: Game[], now: number = Date.now()): SizeIssue[] {
  const out: SizeIssue[] = [];
  for (const game of games) {
    if (!game.installed) continue;
    if (game.sizeBytes == null || game.sizeBytes <= 0) {
      out.push({ gameId: game.id, reason: "neverMeasured" });
      continue;
    }
    if (!game.sizeDetectedAt) {
      out.push({ gameId: game.id, reason: "missingTimestamp" });
      continue;
    }
    const measured = Date.parse(game.sizeDetectedAt);
    if (Number.isNaN(measured)) {
      out.push({ gameId: game.id, reason: "missingTimestamp" });
      continue;
    }
    const ageDays = Math.floor((now - measured) / 86_400_000);
    if (ageDays > STALE_SIZE_DAYS) {
      out.push({ gameId: game.id, reason: "oldMeasurement", ageDays });
    }
  }
  return out;
}

/** Installed games that have never been launched — split into the ones
 *  large enough to be worth uninstalling and the long tail. Untracked
 *  games are skipped: their playtime is deliberately not recorded, so
 *  "never played" would be a false positive. Store-reported playtime also
 *  counts as played even when GameIndex never launched the title. */
export function findBacklogIssues(games: Game[]): BacklogIssue[] {
  const out: BacklogIssue[] = [];
  for (const game of games) {
    if (!game.installed || game.untracked) continue;
    if (hasPlayHistory(game)) continue;
    const sizeBytes = gameTotalBytes(game);
    out.push({
      gameId: game.id,
      reason: sizeBytes >= HUGE_UNPLAYED_BYTES ? "hugeUnplayed" : "neverPlayed",
      sizeBytes,
      lastPlayed: game.lastPlayed,
    });
  }
  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

/** True when the game has any evidence of being played: a tracked session
 *  or a non-zero store-reported playtime. */
function hasPlayHistory(game: Game): boolean {
  if (game.lastPlayed) return true;
  if ((game.steamPlaytime ?? 0) > 0) return true;
  if ((game.gogPlaytime ?? 0) > 0) return true;
  return parsePlayTime(game.playTime || "") > 0;
}

// ─── Aggregation ───────────────────────────────────────────────────────────

export function countIssues(input: {
  stalePaths: StalePathIssue[];
  duplicateGroups: DuplicateGroup[];
  metadataIssues: MetadataIssue[];
  orphanArtwork: OrphanArtwork[];
  sizeIssues: SizeIssue[];
  backlogIssues: BacklogIssue[];
}): HealthCounts {
  const counts: HealthCounts = {
    paths: input.stalePaths.length,
    duplicates: input.duplicateGroups.length,
    metadata: input.metadataIssues.length,
    artwork: input.orphanArtwork.length,
    sizes: input.sizeIssues.length,
    backlog: input.backlogIssues.length,
    total: 0,
  };
  counts.total =
    counts.paths +
    counts.duplicates +
    counts.metadata +
    counts.artwork +
    counts.sizes +
    counts.backlog;
  return counts;
}

/** Fold weighted issue counts into a 0-100 score. The denominator floors
 *  at ten games so a tiny library with one real problem still lands in a
 *  meaningful band instead of always reading zero. */
export function computeHealthScore(counts: HealthCounts, librarySize: number): HealthScore {
  const weighted =
    counts.paths * SCORE_WEIGHTS.paths +
    counts.duplicates * SCORE_WEIGHTS.duplicates +
    counts.metadata * SCORE_WEIGHTS.metadata +
    counts.artwork * SCORE_WEIGHTS.artwork +
    counts.sizes * SCORE_WEIGHTS.sizes +
    counts.backlog * SCORE_WEIGHTS.backlog;
  const denominator = Math.max(librarySize, 10) * 6;
  const score = Math.max(0, Math.min(100, Math.round(100 - (weighted / denominator) * 100)));
  const band: HealthScore["band"] =
    score >= 95 ? "optimal" : score >= 80 ? "good" : score >= 60 ? "attention" : "critical";
  return { score, band };
}
