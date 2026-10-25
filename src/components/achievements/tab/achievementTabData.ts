import {
  type Achievement,
  type AchievementRarity,
  getAchievementRarity,
} from "../../../types/game";

export type AchievementFilter = "all" | "unlocked" | "locked" | "secret";
export type AchievementSort =
  | "default"
  | "rarity_rare_first"
  | "rarity_common_first"
  | "unlockDate"
  | "name";
export type AchievementView = "grid" | "list" | "timeline";

export interface RarityBreakdown {
  total: Record<AchievementRarity, number>;
  unlocked: Record<AchievementRarity, number>;
}

export const RARITY_TIERS: AchievementRarity[] = [
  "ultra_rare",
  "rare",
  "uncommon",
  "common",
];

export function computeRarityBreakdown(
  achievements: Achievement[],
): RarityBreakdown {
  const total: Record<AchievementRarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    ultra_rare: 0,
  };
  const unlocked: Record<AchievementRarity, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    ultra_rare: 0,
  };
  for (const achievement of achievements) {
    const tier = getAchievementRarity(achievement.percent);
    total[tier] += 1;
    if (achievement.achieved) unlocked[tier] += 1;
  }
  return { total, unlocked };
}

export function filterAchievementsForTab(
  achievements: Achievement[],
  options: {
    filter: AchievementFilter;
    rarityFilter: "all" | AchievementRarity;
    searchQuery: string;
    sort: AchievementSort;
  },
): Achievement[] {
  const { filter, rarityFilter, searchQuery, sort } = options;
  let list = [...achievements];

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    list = list.filter(
      (achievement) =>
        achievement.displayName.toLowerCase().includes(query) ||
        achievement.description.toLowerCase().includes(query),
    );
  }

  if (filter === "unlocked") list = list.filter((a) => a.achieved);
  if (filter === "locked") list = list.filter((a) => !a.achieved);
  if (filter === "secret") {
    list = list.filter(
      (a) => !a.achieved && a.description.toLowerCase().includes("hidden"),
    );
  }

  if (rarityFilter !== "all") {
    list = list.filter((a) => getAchievementRarity(a.percent) === rarityFilter);
  }

  if (sort === "name") {
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } else if (sort === "rarity_rare_first") {
    list.sort((a, b) => a.percent - b.percent);
  } else if (sort === "rarity_common_first") {
    list.sort((a, b) => b.percent - a.percent);
  } else if (sort === "unlockDate") {
    list.sort((a, b) => {
      if (a.achieved && !b.achieved) return -1;
      if (!a.achieved && b.achieved) return 1;
      return b.unlockTime - a.unlockTime;
    });
  }

  return list;
}

export type AlmostDoneMode = "finish" | "likely";

/**
 * Choose the "almost done" shelf.
 *
 * Per-achievement progress (2/10 kills) is not exposed by the achievement
 * sources this app reads, so "almost done" is honest about what it can know:
 * a game with at most three unlocks left gets a finish-line shelf; otherwise
 * the shelf shows the most commonly unlocked achievements still missing —
 * statistically the easiest next unlocks.
 */
export function pickAlmostDone(
  achievements: Achievement[],
  limit = 4,
): { items: Achievement[]; mode: AlmostDoneMode } {
  const locked = achievements.filter((achievement) => !achievement.achieved);
  if (locked.length === 0) return { items: [], mode: "likely" };
  const mode: AlmostDoneMode = locked.length <= 3 ? "finish" : "likely";
  const sorted = locked.sort((a, b) => b.percent - a.percent);
  return {
    items: sorted.slice(0, mode === "finish" ? 3 : limit),
    mode,
  };
}

export function countSecrets(achievements: Achievement[]): number {
  return achievements.filter(
    (achievement) =>
      !achievement.achieved &&
      achievement.description.toLowerCase().includes("hidden"),
  ).length;
}
