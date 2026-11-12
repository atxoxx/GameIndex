/**
 * Cross-game achievement overview.
 *
 * Port of `src-tauri/src/achievement_stats.rs` (`build_overview`). The
 * renderer never holds the whole cache: it asks for this compact document,
 * which carries per-game summaries plus the bounded showcase lists the
 * Achievements page renders.
 *
 * The scoring rules mirror `achievementUtils.ts` exactly (see `util.ts`), and
 * the monthly window is the same six trailing local-calendar months the Rust
 * builder produced.
 */
import type {
  Achievement,
  AchievementCompletionEntry,
  AchievementLibraryStats,
  AchievementMonthlyPoint,
  AchievementOverview,
  AchievementRarity,
  AchievementSource,
  AchievementSummary,
  AchievementUnlockRecord,
  AchievementYearlyPoint,
  GameAchievementData,
} from "../../../../src/types/game";
import {
  achievementPoints,
  normalizeLastSynced,
  nowSeconds,
  rarityOf,
} from "./util";

/** Number of entries shipped for the recent-unlocks feed. */
const RECENT_LIMIT = 50;
/** Number of entries in the rarest-achievements showcase. */
const RAREST_LIMIT = 10;
/** Number of games in the near-completion list. */
const NEAR_COMPLETION_LIMIT = 8;
/** Monthly-activity window, in months. */
const MONTHS = 6;

const RARITY_KEYS: readonly AchievementRarity[] = [
  "common",
  "uncommon",
  "rare",
  "ultra_rare",
];

const SOURCE_KEYS: readonly AchievementSource[] = ["steam", "retro", "manual", "gog", "epic"];

type RarityCounts = Record<AchievementRarity, number>;

function emptyRarity(): RarityCounts {
  return { common: 0, uncommon: 0, rare: 0, ultra_rare: 0 };
}

function emptyStats(): AchievementLibraryStats {
  const bySource = {} as Record<AchievementSource, number>;
  for (const source of SOURCE_KEYS) bySource[source] = 0;
  return {
    total: 0,
    unlocked: 0,
    overallPct: 0,
    perfectGames: 0,
    gamesWithData: 0,
    avgCompletion: 0,
    gamerscoreEarned: 0,
    gamerscoreTotal: 0,
    bySource,
    rarityTotal: emptyRarity(),
    rarityUnlocked: emptyRarity(),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `YYYY-MM` key for a unix-seconds timestamp in local time. */
function monthKeyOf(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** Local calendar year for a unix-seconds timestamp. */
function yearOf(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

/** Buckets (`YYYY-MM`) oldest→newest for the trailing `months` months. */
function monthBuckets(months: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${date.getFullYear()}-${pad2(date.getMonth() + 1)}`);
  }
  return out;
}

/**
 * Build the cross-game overview from every cached payload.
 * Pure: no I/O, so it can be exercised by the harness.
 */
export function buildOverview(
  games: Record<string, GameAchievementData>,
): AchievementOverview {
  const summaries: Record<string, AchievementSummary> = {};
  const stats = emptyStats();
  const monthlyCounts = new Map<string, { count: number; points: number }>();
  for (const key of monthBuckets(MONTHS)) monthlyCounts.set(key, { count: 0, points: 0 });
  const yearlyCounts = new Map<number, { count: number; points: number }>();
  const completion: AchievementCompletionEntry[] = [];
  const recent: AchievementUnlockRecord[] = [];
  const rarest: AchievementUnlockRecord[] = [];

  const monthlyCutoff = nowSeconds() - (MONTHS + 1) * 31 * 24 * 3600;
  let completionSum = 0;

  for (const [gameId, data] of Object.entries(games)) {
    const achievements: Achievement[] = Array.isArray(data.achievements)
      ? data.achievements
      : [];
    const source: AchievementSource = (SOURCE_KEYS as readonly string[]).includes(
      data.source ?? "steam",
    )
      ? (data.source ?? "steam")
      : "steam";

    const rarityUnlocked = emptyRarity();
    const rarityTotal = emptyRarity();
    let unlocked = 0;
    let pointsEarned = 0;
    let pointsTotal = 0;
    let lastUnlockTime = 0;

    for (const achievement of achievements) {
      const points = achievementPoints(achievement.percent);
      const rarity = rarityOf(achievement.percent);
      rarityTotal[rarity] += 1;
      pointsTotal += points;

      if (achievement.achieved) {
        unlocked += 1;
        pointsEarned += points;
        rarityUnlocked[rarity] += 1;
        if (achievement.unlockTime > lastUnlockTime) lastUnlockTime = achievement.unlockTime;
        stats.bySource[source] += 1;
      }

      if (achievement.achieved && achievement.unlockTime > 0) {
        if (achievement.unlockTime >= monthlyCutoff) {
          const key = monthKeyOf(achievement.unlockTime);
          const bucket = key !== null ? monthlyCounts.get(key) : undefined;
          if (bucket) {
            bucket.count += 1;
            bucket.points += points;
          }
        }
        const year = yearOf(achievement.unlockTime);
        if (year !== null) {
          const bucket = yearlyCounts.get(year) ?? { count: 0, points: 0 };
          bucket.count += 1;
          bucket.points += points;
          yearlyCounts.set(year, bucket);
        }
      }

      if (achievement.achieved) {
        recent.push({ gameId, achievement });
        rarest.push({ gameId, achievement });
      }
    }

    const total = achievements.length;
    const lastSynced = normalizeLastSynced(data.lastSynced ?? 0);

    summaries[gameId] = {
      steamAppId: Math.max(0, Math.trunc(data.steamAppId || 0)),
      total,
      unlocked,
      lastSynced: lastSynced > 0 ? lastSynced : undefined,
      source,
      providerId: data.providerId,
      pointsEarned,
      pointsTotal,
      rarity: rarityUnlocked,
      lastUnlockTime,
    };

    for (const rarity of RARITY_KEYS) {
      stats.rarityUnlocked[rarity] += rarityUnlocked[rarity];
      stats.rarityTotal[rarity] += rarityTotal[rarity];
    }
    stats.gamerscoreEarned += pointsEarned;
    stats.gamerscoreTotal += pointsTotal;

    if (total > 0) {
      stats.gamesWithData += 1;
      stats.total += total;
      stats.unlocked += unlocked;
      completionSum += (unlocked / total) * 100;
      if (unlocked === total) stats.perfectGames += 1;
      completion.push({
        gameId,
        total,
        unlocked,
        percentage: Math.round((unlocked / total) * 100),
        lastUnlockTime,
      });
    }
  }

  recent.sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime);
  recent.splice(RECENT_LIMIT);

  // A missing/zero percent sorts last (the UI clamps it to 100), so it is never
  // shown ahead of a genuinely rare unlock.
  const rarestScore = (achievement: Achievement): number =>
    achievement.percent > 0 ? achievement.percent : 100;
  rarest.sort((a, b) => rarestScore(a.achievement) - rarestScore(b.achievement));
  rarest.splice(RAREST_LIMIT);

  stats.overallPct =
    stats.total > 0 ? Math.round((stats.unlocked / stats.total) * 100) : 0;
  stats.avgCompletion =
    stats.gamesWithData > 0 ? Math.round(completionSum / stats.gamesWithData) : 0;

  const perfectGames: AchievementCompletionEntry[] = completion
    .filter((entry) => entry.total > 0 && entry.unlocked === entry.total)
    .sort((a, b) => b.lastUnlockTime - a.lastUnlockTime);

  const nearCompletion: AchievementCompletionEntry[] = completion
    .filter((entry) => entry.total > 0 && entry.unlocked < entry.total && entry.percentage >= 50)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, NEAR_COMPLETION_LIMIT);

  const monthly: AchievementMonthlyPoint[] = [...monthlyCounts.entries()].map(
    ([monthKey, value]) => ({ monthKey, count: value.count, points: value.points }),
  );

  const yearly: AchievementYearlyPoint[] = [...yearlyCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ year, count: value.count, points: value.points }));

  return {
    summaries,
    stats,
    monthly,
    yearly,
    recentUnlocks: recent,
    rarestUnlocks: rarest,
    perfectGames,
    nearCompletion,
  };
}
