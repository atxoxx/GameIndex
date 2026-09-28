import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENT_DETAILS_CACHE_MAX,
  putAchievementDetail,
} from "./achievementDetailCache";
import type { GameAchievementData } from "../types/game";

function payload(steamAppId: number): GameAchievementData {
  return { steamAppId, achievements: [], total: 0, unlocked: 0, locked: 0 };
}

describe("putAchievementDetail", () => {
  it("adds the payload for a game", () => {
    const next = putAchievementDetail({}, "a", payload(1), 3);
    expect(Object.keys(next)).toEqual(["a"]);
    expect(next.a.steamAppId).toBe(1);
  });

  it("does not mutate the input map", () => {
    const original: Record<string, GameAchievementData> = {};
    putAchievementDetail(original, "a", payload(1), 3);
    expect(original).toEqual({});
  });

  it("evicts the least-recently-used entries past the cap", () => {
    let map: Record<string, GameAchievementData> = {};
    map = putAchievementDetail(map, "a", payload(1), 3);
    map = putAchievementDetail(map, "b", payload(2), 3);
    map = putAchievementDetail(map, "c", payload(3), 3);
    map = putAchievementDetail(map, "d", payload(4), 3);

    expect(Object.keys(map)).toEqual(["b", "c", "d"]);
    expect(map.a).toBeUndefined();
  });

  it("refreshes recency when an existing game is re-inserted", () => {
    let map: Record<string, GameAchievementData> = {};
    map = putAchievementDetail(map, "a", payload(1), 3);
    map = putAchievementDetail(map, "b", payload(2), 3);
    map = putAchievementDetail(map, "c", payload(3), 3);
    // Touching "a" must make it the most recent, so "b" is evicted next.
    map = putAchievementDetail(map, "a", payload(10), 3);
    map = putAchievementDetail(map, "d", payload(4), 3);

    expect(Object.keys(map)).toEqual(["c", "a", "d"]);
    expect(map.b).toBeUndefined();
    expect(map.a.steamAppId).toBe(10);
  });

  it("keeps every entry when the map is at or below the cap", () => {
    let map: Record<string, GameAchievementData> = {};
    for (let i = 0; i < ACHIEVEMENT_DETAILS_CACHE_MAX; i++) {
      map = putAchievementDetail(map, `game-${i}`, payload(i), ACHIEVEMENT_DETAILS_CACHE_MAX);
    }
    expect(Object.keys(map)).toHaveLength(ACHIEVEMENT_DETAILS_CACHE_MAX);
  });
});
