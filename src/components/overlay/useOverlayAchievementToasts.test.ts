import { describe, expect, it } from "vitest";
import {
  appendNotices,
  noticesFromPayload,
  type OverlayAchievementNotice,
} from "./useOverlayAchievementToasts";

function notice(overrides: Partial<OverlayAchievementNotice>): OverlayAchievementNotice {
  return {
    id: "g1:First Steps:0",
    gameId: "g1",
    gameName: "Test Game",
    displayName: "First Steps",
    description: "Finish the tutorial.",
    icon: "https://example.test/icon.png",
    percent: 42,
    isRare: false,
    ...overrides,
  };
}

describe("overlay achievement toasts", () => {
  it("maps backend notices and keeps description/rarity", () => {
    const notices = noticesFromPayload({
      gameId: "g1",
      gameName: "Test Game",
      achievements: [
        { displayName: "First Steps", description: "Finish it", icon: "i", percent: 4, isRare: true },
        { displayName: "" },
      ],
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      gameId: "g1",
      gameName: "Test Game",
      displayName: "First Steps",
      description: "Finish it",
      percent: 4,
      isRare: true,
    });
  });

  it("dedupes repeated ids and keeps the newest five", () => {
    const existing = [notice({ id: "a" }), notice({ id: "b" })];
    const next = appendNotices(existing, [notice({ id: "b" }), notice({ id: "c" })]);
    expect(next.map((entry) => entry.id)).toEqual(["a", "b", "c"]);

    const capped = appendNotices(
      existing,
      Array.from({ length: 8 }, (_, index) => notice({ id: `n${index}` })),
      5,
    );
    expect(capped.map((entry) => entry.id)).toEqual(["n3", "n4", "n5", "n6", "n7"]);
  });

  it("marks a low global percentage as rare when the source omits the flag", () => {
    const [rare] = noticesFromPayload({
      gameId: "g1",
      gameName: "Game",
      achievements: [{ displayName: "Deep Cut", percent: 2.5 }],
    });
    expect(rare.isRare).toBe(true);
  });
});
