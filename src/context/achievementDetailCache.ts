import type { GameAchievementData } from "../types/game";

/**
 * Cap on the lazily-loaded per-game achievement payloads kept in memory.
 *
 * Each payload carries a game's full achievement list (names,
 * descriptions, icon URLs), so a whole-library sync would otherwise pin
 * every game's detail in the webview heap for the life of the session.
 * The backend stays the source of truth; a game that falls out of the
 * map is re-read on demand.
 */
export const ACHIEVEMENT_DETAILS_CACHE_MAX = 48;

/**
 * Insert one game's payload as most-recently-used and evict the
 * least-recently-used entries past `max`.
 *
 * Object key order is insertion order, so deleting a key and reassigning
 * it moves it to the end of the iteration order — that is the recency
 * signal used for eviction.
 */
export function putAchievementDetail(
  map: Record<string, GameAchievementData>,
  gameId: string,
  data: GameAchievementData,
  max: number = ACHIEVEMENT_DETAILS_CACHE_MAX
): Record<string, GameAchievementData> {
  const next: Record<string, GameAchievementData> = { ...map };
  delete next[gameId];
  next[gameId] = data;

  const keys = Object.keys(next);
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) {
      delete next[keys[i]];
    }
  }
  return next;
}
