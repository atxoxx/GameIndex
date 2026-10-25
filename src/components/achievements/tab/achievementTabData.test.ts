import { describe, expect, it } from "vitest";
import type { Achievement } from "../../../types/game";
import {
  computeRarityBreakdown,
  filterAchievementsForTab,
  pickAlmostDone,
} from "./achievementTabData";

function achievement(
  apiName: string,
  percent: number,
  achieved = false,
): Achievement {
  return {
    apiName,
    displayName: apiName,
    description: "Do the thing",
    icon: "",
    iconGray: "",
    achieved,
    unlockTime: achieved ? 1_700_000_000 : 0,
    percent,
  };
}

const list = [
  achievement("Common", 80),
  achievement("Uncommon", 30),
  achievement("Rare", 8),
  achievement("Ultra", 2),
  achievement("Done", 70, true),
];

describe("achievementTabData", () => {
  it("filters by status and rarity and searches descriptions", () => {
    expect(
      filterAchievementsForTab(list, {
        filter: "locked",
        rarityFilter: "all",
        searchQuery: "",
        sort: "default",
      }).length
    ).toBe(4);
    expect(
      filterAchievementsForTab(list, {
        filter: "all",
        rarityFilter: "ultra_rare",
        searchQuery: "",
        sort: "default",
      }).map((a) => a.apiName)
    ).toEqual(["Ultra"]);
    expect(
      filterAchievementsForTab(list, {
        filter: "all",
        rarityFilter: "all",
        searchQuery: "thing",
        sort: "name",
      }).length
    ).toBe(5);
  });

  it("builds a rarity breakdown", () => {
    const breakdown = computeRarityBreakdown(list);
    expect(breakdown.total.common).toBe(2);
    expect(breakdown.unlocked.common).toBe(1);
    expect(breakdown.total.ultra_rare).toBe(1);
  });

  it("uses the finish-line mode when at most three unlocks remain", () => {
    const result = pickAlmostDone([
      achievement("A", 10),
      achievement("B", 50),
      achievement("C", 90, true),
    ]);
    expect(result.mode).toBe("finish");
    expect(result.items.map((a) => a.apiName)).toEqual(["B", "A"]);
  });

  it("uses the likely-next mode for a longer backlog, common first", () => {
    const result = pickAlmostDone(list);
    expect(result.mode).toBe("likely");
    expect(result.items.length).toBe(4);
    expect(result.items[0].apiName).toBe("Common");
    expect(result.items.some((a) => a.achieved)).toBe(false);
  });

  it("returns an empty shelf for a completed game", () => {
    expect(
      pickAlmostDone([achievement("Done", 70, true), achievement("Also", 20, true)])
    ).toEqual({ items: [], mode: "likely" });
  });
});
