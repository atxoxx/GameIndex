import { describe, expect, it } from "vitest";
import { buildActivityRecap } from "./recap";
import { buildActivitySummaryText } from "./summary";
import type { Game, GameSession } from "../../types/game";

function game(id: string, name: string): Game {
  return {
    id,
    name,
    path: "",
    platform: "Steam",
    installed: true,
    playTime: "0h",
    addedAt: 1,
  } as Game;
}

function session(id: string, gameId: string, date: string, durationMin: number): GameSession {
  return { id, gameId, gameName: gameId, date, durationMin };
}

const games = [game("elden", "Elden Ring"), game("hades", "Hades II"), game("bg3", "Baldur's Gate 3")];
const sessions = [
  session("1", "elden", "2026-08-01T22:00:00", 60),
  session("2", "elden", "2026-08-02T22:00:00", 120),
  session("3", "hades", "2026-08-03T21:00:00", 45),
  session("4", "bg3", "2026-08-04T21:00:00", 30),
  session("5", "removed", "2026-08-05T21:00:00", 10),
];
const range = { key: "custom" as const, startDate: "2026-08-01", endDate: "2026-08-10" };

describe("buildActivityRecap", () => {
  it("ranks the top three games and carries range figures", () => {
    const recap = buildActivityRecap(sessions, games, range);
    expect(recap.minutes).toBe(265);
    expect(recap.sessionCount).toBe(5);
    expect(recap.gameCount).toBe(4);
    expect(recap.topGames.map((entry) => entry.name)).toEqual([
      "Elden Ring",
      "Hades II",
      "Baldur's Gate 3",
    ]);
    expect(recap.heatmap).toHaveLength(10);
    expect(recap.longestStreak).toBe(5);
  });

  it("caps the heatmap for long ranges but keeps the totals", () => {
    const recap = buildActivityRecap(
      [session("1", "elden", "2026-08-01T22:00:00", 60)],
      games,
      { key: "all", startDate: "2024-01-01", endDate: "2026-08-30" },
    );
    expect(recap.heatmap.length).toBeLessThanOrEqual(120);
    expect(recap.minutes).toBe(60);
  });

  it("survives an empty range", () => {
    const recap = buildActivityRecap([], games, range);
    expect(recap.minutes).toBe(0);
    expect(recap.topGames).toEqual([]);
    expect(recap.heatmap).toHaveLength(10);
  });
});

describe("buildActivitySummaryText", () => {
  it("renders the figures, top games and footer", () => {
    const recap = buildActivityRecap(sessions, games, range);
    const text = buildActivitySummaryText({
      rangeLabel: "1 Aug – 10 Aug 2026",
      recap,
      labels: {
        title: "Activity",
        sessions: "sessions",
        games: "games",
        topGames: "Top games",
        footer: "GameIndex",
        streakText: "5-day streak",
        activeDaysText: "5 active days",
      },
    });
    expect(text).toContain("1 Aug – 10 Aug 2026");
    expect(text).toContain("Elden Ring (3h)");
    expect(text).toContain("GameIndex");
  });
});
