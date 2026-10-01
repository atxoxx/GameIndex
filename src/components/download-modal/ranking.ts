// Composite "recommended" ranking for download results.
//
// The raw match score says how confidently a title is the requested game;
// it says nothing about whether the release will actually download well.
// This blends match confidence with source reliability, swarm health, and
// recency so the top row is the release most likely to succeed, and marks
// it as the default selection ("smart defaults").

import type { DownloadSearchResult } from "../../types/plugins";

export interface RecommendationContext {
  /** Source success rate 0–1, or null when the sample is too small. */
  reliability?: number | null;
  /** Current time in ms (injectable for tests). */
  now?: number;
}

const WEIGHTS = {
  match: 0.6,
  reliability: 0.18,
  swarm: 0.12,
  recency: 0.1,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Swarm health 0–1, or null when the result has no swarm data. */
function swarmScore(match: DownloadSearchResult): number | null {
  if (match.seeds == null && match.peers == null) return null;
  const seeds = match.seeds ?? 0;
  const peers = match.peers ?? 0;
  return clamp01((seeds * 0.8 + peers * 0.2) / 25);
}

/** Recency 0–1 from the upload date, or null when unknown. */
function recencyScore(
  uploadDate: string | null | undefined,
  now: number,
): number | null {
  if (!uploadDate) return null;
  const parsed = Date.parse(uploadDate);
  if (Number.isNaN(parsed)) return null;
  const ageDays = Math.max(0, (now - parsed) / DAY_MS);
  // Exponential decay with a one-year time constant.
  return clamp01(Math.exp(-ageDays / 365));
}

/**
 * Composite recommendation score 0–1. Missing signals are dropped and the
 * remaining weights renormalised, so a result without reliability data is
 * neither penalised nor boosted relative to a known-good source.
 */
export function recommendationScore(
  match: DownloadSearchResult,
  ctx: RecommendationContext = {},
): number {
  const parts: Array<[number, number]> = [[WEIGHTS.match, clamp01(match.matchScore)]];

  if (ctx.reliability != null) {
    parts.push([WEIGHTS.reliability, clamp01(ctx.reliability)]);
  }
  const swarm = swarmScore(match);
  if (swarm != null) parts.push([WEIGHTS.swarm, swarm]);
  const recency = recencyScore(match.uploadDate, ctx.now ?? Date.now());
  if (recency != null) parts.push([WEIGHTS.recency, recency]);

  const totalWeight = parts.reduce((sum, [weight]) => sum + weight, 0);
  const weighted = parts.reduce((sum, [weight, value]) => sum + weight * value, 0);
  const base = totalWeight > 0 ? weighted / totalWeight : 0;
  const verifiedBonus = match.verified ? 0.03 : 0;
  return clamp01(base + verifiedBonus);
}

/**
 * Rank a list by recommendation score, best first. Ties fall back to the
 * raw match score so ordering stays deterministic.
 */
export function rankByRecommendation<T extends DownloadSearchResult>(
  matches: T[],
  ctxFor: (match: T) => RecommendationContext,
): T[] {
  return [...matches].sort((a, b) => {
    const diff = recommendationScore(b, ctxFor(b)) - recommendationScore(a, ctxFor(a));
    if (diff !== 0) return diff;
    return b.matchScore - a.matchScore;
  });
}
