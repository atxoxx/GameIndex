import type {
  HltbStats,
  MetacriticScore,
  SteamGameReviews,
} from "../../../types/game";

/** Tabs the sheet can show. Empty tabs are filtered out before rendering. */
export type RatingsTabId = "overview" | "critics" | "community";

/** Tone shared by score badges, scoreboard cells and distribution segments. */
export type ScoreTone = "success" | "warning" | "danger";

export type DistributionTone = "positive" | "mixed" | "negative";

export interface DistributionRow {
  key: DistributionTone;
  label: string;
  count: number;
  tone: DistributionTone;
}

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Semantic tone for a score on a 100-point scale. User scores arrive on a
 * 10-point scale and are normalized first. Returns `null` when there is no
 * score, so callers can render a neutral cell instead of a red one.
 */
export function scoreTone(
  value: number | null | undefined,
  scale: 100 | 10 = 100
): ScoreTone | null {
  if (value == null) return null;
  const normalized = scale === 10 ? value * 10 : value;
  if (normalized >= 75) return "success";
  if (normalized >= 50) return "warning";
  return "danger";
}

const SENTIMENT_KEYS: Array<{ min: number; key: string }> = [
  { min: 90, key: "ratings.sentiment.universalAcclaim" },
  { min: 75, key: "ratings.sentiment.generallyFavorable" },
  { min: 50, key: "ratings.sentiment.mixedAverage" },
  { min: 20, key: "ratings.sentiment.generallyUnfavorable" },
  { min: 0, key: "ratings.sentiment.overwhelmingDislike" },
];

/**
 * Metacritic sends English sentiment strings. Map the numeric score back to
 * a label so every locale reads naturally instead of leaking scrape copy.
 */
export function sentimentKey(
  value: number | null | undefined,
  scale: 100 | 10 = 100
): string | null {
  if (value == null) return null;
  const normalized = scale === 10 ? value * 10 : value;
  return SENTIMENT_KEYS.find((entry) => normalized >= entry.min)?.key ?? null;
}

export function scorePercent(
  value: number | null | undefined,
  scale: 100 | 10 = 100
): number | null {
  if (value == null) return null;
  return Math.max(0, Math.min(100, Math.round(scale === 10 ? value * 10 : value)));
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

export function criticRows(
  score: MetacriticScore | null | undefined,
  t: Translate
): DistributionRow[] {
  return [
    {
      key: "positive",
      label: t("ratings.positive"),
      count: score?.positiveCount ?? 0,
      tone: "positive",
    },
    {
      key: "mixed",
      label: t("ratings.mixed"),
      count: score?.neutralCount ?? 0,
      tone: "mixed",
    },
    {
      key: "negative",
      label: t("ratings.negative"),
      count: score?.negativeCount ?? 0,
      tone: "negative",
    },
  ];
}

export function userRows(
  score: MetacriticScore | null | undefined,
  t: Translate
): DistributionRow[] {
  return [
    {
      key: "positive",
      label: t("ratings.positive"),
      count: score?.userPositiveCount ?? 0,
      tone: "positive",
    },
    {
      key: "mixed",
      label: t("ratings.mixed"),
      count: score?.userNeutralCount ?? 0,
      tone: "mixed",
    },
    {
      key: "negative",
      label: t("ratings.negative"),
      count: score?.userNegativeCount ?? 0,
      tone: "negative",
    },
  ];
}

export function steamRows(
  reviews: SteamGameReviews | null | undefined,
  t: Translate
): DistributionRow[] {
  return [
    {
      key: "positive",
      label: t("ratings.positive"),
      count: reviews?.totalPositive ?? 0,
      tone: "positive",
    },
    {
      key: "negative",
      label: t("ratings.negative"),
      count: reviews?.totalNegative ?? 0,
      tone: "negative",
    },
  ];
}

export function steamPositivePercent(
  reviews: SteamGameReviews | null | undefined
): number | null {
  if (!reviews || reviews.totalReviews <= 0) return null;
  return Math.round((reviews.totalPositive / reviews.totalReviews) * 100);
}

export function rowsTotal(rows: DistributionRow[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

export function hasRows(rows: DistributionRow[]): boolean {
  return rowsTotal(rows) > 0;
}

/** Steam store page for an app id. */
export function steamStoreUrl(appId: number | null | undefined): string | null {
  return appId ? `https://store.steampowered.com/app/${appId}/` : null;
}

/** True when HowLongToBeat returned anything worth showing in the sheet. */
export function hasHltbCommunity(stats: HltbStats | null | undefined): boolean {
  if (!stats) return false;
  const community = stats.community;
  return Boolean(
    community &&
      (community.playing != null ||
        community.backlog != null ||
        community.completed != null ||
        community.replays != null ||
        community.retired != null ||
        community.reviews != null ||
        community.total != null ||
        community.reviewScore != null ||
        (stats.reviewHistogram ?? []).length > 0),
  );
}
