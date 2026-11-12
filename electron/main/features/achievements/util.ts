/**
 * Small shared helpers for the achievement providers.
 *
 * The rarity/gamerscore rules and the achievement ordering mirror
 * `src/components/achievements/achievementUtils.ts` and the Rust
 * `achievements.rs` / `achievement_stats.rs` one-for-one — the overview
 * builder and the frontend must agree on the numbers they show.
 */
import type { Achievement, AchievementRarity } from "../../../../src/types/game";

/** Unix seconds. Unlock times are stored in seconds everywhere (Steam, RA). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Unix milliseconds — `lastSynced` is milliseconds everywhere in the UI. */
export function nowMillis(): number {
  return Date.now();
}

/**
 * Rows written before the unit fix stored `lastSynced` in seconds; without
 * this they render as 1970 dates and sort as the oldest entries.
 */
export function normalizeLastSynced(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return ts < 100_000_000_000 ? Math.trunc(ts) * 1000 : Math.trunc(ts);
}

/** Global unlock percentage, coerced to a finite 0–100 number. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Rarity tier from a global unlock percentage (mirrors `getAchievementRarity`). */
export function rarityOf(percent: number): AchievementRarity {
  if (percent >= 50) return "common";
  if (percent >= 20) return "uncommon";
  if (percent >= 5) return "rare";
  return "ultra_rare";
}

/** Gamerscore weight for a rarity tier (mirrors `RARITY_POINTS`). */
export function achievementPoints(percent: number): number {
  switch (rarityOf(percent)) {
    case "common":
      return 10;
    case "uncommon":
      return 25;
    case "rare":
      return 50;
    default:
      return 100;
  }
}

/**
 * Unlocked first (newest unlock first), then locked by rarity (rarest first).
 * Shared by the Steam, local and RetroAchievements paths.
 */
export function sortAchievements(list: Achievement[]): Achievement[] {
  return list.sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? -1 : 1;
    if (a.achieved) return b.unlockTime - a.unlockTime;
    return b.percent - a.percent;
  });
}

/** Uppercased api name is the join key between providers and local unlock files. */
export function apiNameKey(apiName: string): string {
  return apiName.trim().toUpperCase();
}
