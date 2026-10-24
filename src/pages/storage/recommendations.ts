import type { Game } from "../../types/game";
import { gameTotalBytes } from "./utils";

/** A cleanup opportunity the Storage page can act on. */
export type RecommendationId =
  | "stale"
  | "unmeasured"
  | "bigUnplayed"
  | "modsBloat"
  | "lowSpace"
  | "leftovers";

export type RecommendationTone = "danger" | "warning" | "info";

export interface Recommendation {
  id: RecommendationId;
  tone: RecommendationTone;
  /** Number of items the recommendation covers (games, drives, folders). */
  count: number;
  /** Bytes the recommendation could plausibly free. */
  bytes: number;
  /** Games the "review" action should select. Empty for drive/folder items. */
  gameIds: string[];
}

export interface DriveUsageLike {
  total: number;
  available: number;
}

export interface RecommendationInput {
  games: Game[];
  staleMap: Map<string, boolean>;
  driveUsage?: Map<string, DriveUsageLike>;
  leftover?: { count: number; bytes: number } | null;
  now?: number;
}

const GB = 1024 ** 3;
const DAY_MS = 86_400_000;

/** A game this large that nobody has touched in a long time is the single
 *  best candidate for reclaiming space. */
export const BIG_UNPLAYED_BYTES = 20 * GB;
export const BIG_UNPLAYED_DAYS = 180;

/** Mods below this are normal for a modded title; above it they are worth a
 *  look on their own. */
export const MODS_BLOAT_BYTES = 2 * GB;

/** Warn when a drive has less than this share of its capacity free. */
export const LOW_SPACE_PCT = 12;

const TONE_ORDER: Record<RecommendationTone, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

/**
 * Derive the ranked cleanup list shown above the games table.
 *
 * Pure: every input is passed in, so the same library always produces the
 * same list and the ordering is testable without a DOM.
 */
export function buildRecommendations({
  games,
  staleMap,
  driveUsage,
  leftover,
  now = Date.now(),
}: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = [];

  const stale = games.filter((g) => staleMap.get(g.id) === true);
  if (stale.length > 0) {
    recs.push({
      id: "stale",
      tone: "danger",
      count: stale.length,
      bytes: stale.reduce((sum, g) => sum + gameTotalBytes(g), 0),
      gameIds: stale.map((g) => g.id),
    });
  }

  const unmeasured = games.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0);
  if (unmeasured.length > 0) {
    recs.push({
      id: "unmeasured",
      tone: "warning",
      count: unmeasured.length,
      bytes: 0,
      gameIds: unmeasured.map((g) => g.id),
    });
  }

  const staleCutoff = now - BIG_UNPLAYED_DAYS * DAY_MS;
  const bigUnplayed = games.filter((g) => {
    if (gameTotalBytes(g) < BIG_UNPLAYED_BYTES) return false;
    if (staleMap.get(g.id) === true) return false;
    return g.lastPlayed == null || g.lastPlayed < staleCutoff;
  });
  if (bigUnplayed.length > 0) {
    recs.push({
      id: "bigUnplayed",
      tone: "warning",
      count: bigUnplayed.length,
      bytes: bigUnplayed.reduce((sum, g) => sum + gameTotalBytes(g), 0),
      gameIds: bigUnplayed.map((g) => g.id),
    });
  }

  const modsBloat = games.filter((g) => (g.modsSizeBytes ?? 0) >= MODS_BLOAT_BYTES);
  if (modsBloat.length > 0) {
    recs.push({
      id: "modsBloat",
      tone: "info",
      count: modsBloat.length,
      bytes: modsBloat.reduce((sum, g) => sum + (g.modsSizeBytes ?? 0), 0),
      gameIds: modsBloat.map((g) => g.id),
    });
  }

  if (driveUsage) {
    let count = 0;
    let bytes = 0;
    for (const usage of driveUsage.values()) {
      if (usage.total <= 0) continue;
      const freePct = (usage.available / usage.total) * 100;
      if (freePct >= LOW_SPACE_PCT) continue;
      count += 1;
      bytes += usage.available;
    }
    if (count > 0) {
      recs.push({ id: "lowSpace", tone: "danger", count, bytes, gameIds: [] });
    }
  }

  if (leftover && leftover.count > 0) {
    recs.push({
      id: "leftovers",
      tone: "warning",
      count: leftover.count,
      bytes: leftover.bytes,
      gameIds: [],
    });
  }

  return recs.sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.bytes - a.bytes,
  );
}

/** Total bytes a set of recommendations could reclaim. */
export function reclaimableBytes(recs: Recommendation[]): number {
  return recs.reduce((sum, rec) => sum + rec.bytes, 0);
}
