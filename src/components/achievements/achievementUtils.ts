import {
  type Achievement,
  type AchievementRarity,
  type GameAchievementData,
  getAchievementRarity,
} from "../../types/game";

/** Gamerscore / Rarity points weighting per rarity tier */
export const RARITY_POINTS: Record<AchievementRarity, number> = {
  ultra_rare: 100, // < 5% global unlock
  rare: 50,        // 5% - 20%
  uncommon: 25,    // 20% - 50%
  common: 10,      // >= 50%
};

/** Get points awarded for an achievement */
export function getAchievementPoints(percent: number): number {
  const rarity = getAchievementRarity(percent);
  return RARITY_POINTS[rarity];
}

/** Calculate Gamerscore earned and total possible for a list of achievements */
export function calculateGameGamerscore(achievements: Achievement[]): {
  earned: number;
  total: number;
  pct: number;
} {
  let earned = 0;
  let total = 0;

  for (const a of achievements) {
    const pts = getAchievementPoints(a.percent);
    total += pts;
    if (a.achieved) {
      earned += pts;
    }
  }

  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { earned, total, pct };
}

/** Calculate Gamerscore across all cached games in the library */
export function calculateLibraryGamerscore(
  gamesData: Record<string, GameAchievementData>
): { earned: number; total: number; pct: number } {
  let earned = 0;
  let total = 0;

  for (const data of Object.values(gamesData)) {
    for (const a of data.achievements ?? []) {
      const pts = getAchievementPoints(a.percent);
      total += pts;
      if (a.achieved) {
        earned += pts;
      }
    }
  }

  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { earned, total, pct };
}

export interface MonthlyActivityItem {
  monthKey: string; // YYYY-MM
  label: string;    // e.g. "Jan 2026"
  shortLabel: string; // e.g. "Jan"
  count: number;
  points: number;
}

/** Aggregate monthly unlock history over the last N months (default 6) */
export function getMonthlyUnlockActivity(
  gamesData: Record<string, GameAchievementData>,
  monthsCount = 6
): MonthlyActivityItem[] {
  const now = new Date();
  const months: MonthlyActivityItem[] = [];

  // Generate recent N months buckets
  for (let i = monthsCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const monthKey = `${year}-${month}`;
    const label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const shortLabel = d.toLocaleDateString(undefined, { month: "short" });

    months.push({
      monthKey,
      label,
      shortLabel,
      count: 0,
      points: 0,
    });
  }

  const monthMap = new Map<string, MonthlyActivityItem>();
  for (const m of months) {
    monthMap.set(m.monthKey, m);
  }

  // Populate unlock counts from achievements
  for (const data of Object.values(gamesData)) {
    for (const a of data.achievements ?? []) {
      if (a.achieved && a.unlockTime > 0) {
        const unlockDate = new Date(a.unlockTime * 1000);
        const year = unlockDate.getFullYear();
        const month = String(unlockDate.getMonth() + 1).padStart(2, "0");
        const key = `${year}-${month}`;

        const entry = monthMap.get(key);
        if (entry) {
          entry.count++;
          entry.points += getAchievementPoints(a.percent);
        }
      }
    }
  }

  return months;
}

/** Format timestamp (seconds) into human-readable date */
export function formatUnlockDate(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Format timestamp (seconds) into detailed date + time */
export function formatUnlockDateTime(ts: number): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format relative time (e.g. "2 hours ago", "yesterday", "3 days ago") */
export function formatRelativeTime(ts: number): string {
  if (!ts) return "";
  const now = Math.floor(Date.now() / 1000);
  const diffSec = now - ts;

  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return `${mins}m ago`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours}h ago`;
  }
  if (diffSec < 86400 * 30) {
    const days = Math.floor(diffSec / 86400);
    return `${days}d ago`;
  }
  if (diffSec < 86400 * 365) {
    const months = Math.floor(diffSec / (86400 * 30));
    return `${months}mo ago`;
  }
  const years = Math.floor(diffSec / (86400 * 365));
  return `${years}y ago`;
}

export interface TimelineGroup {
  dateKey: string;
  dateLabel: string;
  items: Achievement[];
}

/** Group unlocked achievements chronologically for the Journey / Story view */
export function groupAchievementsByDate(achievements: Achievement[]): TimelineGroup[] {
  const unlocked = achievements
    .filter((a) => a.achieved && a.unlockTime > 0)
    .sort((a, b) => b.unlockTime - a.unlockTime);

  const groups: TimelineGroup[] = [];
  const groupMap = new Map<string, TimelineGroup>();

  for (const a of unlocked) {
    const date = new Date(a.unlockTime * 1000);
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const dateLabel = date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    let group = groupMap.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        dateLabel,
        items: [],
      };
      groupMap.set(dateKey, group);
      groups.push(group);
    }
    group.items.push(a);
  }

  return groups;
}
