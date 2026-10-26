import { describe, expect, it } from "vitest";
import { buildActivityCsv, buildActivityExportPayload } from "./export";
import type { Game, GameSession } from "../../types/game";

function game(): Game {
  return {
    id: "g1",
    name: "Elden Ring",
    displayName: "Elden Ring: Deluxe",
    path: "",
    platform: "Steam",
    installed: true,
    playTime: "10h",
    addedAt: 1,
  } as Game;
}

function session(): GameSession {
  return {
    id: "s1",
    gameId: "g1",
    gameName: "Elden Ring",
    date: "2026-08-30T23:10:00",
    durationMin: 90,
  };
}

describe("buildActivityCsv", () => {
  it("quotes values and escapes embedded quotes", () => {
    const csv = buildActivityCsv([session()], [game()], {
      s1: { note: 'A "quoted", note', tags: ["tag"] },
    });
    const lines = csv.split("\n");
    expect(lines[0]).toContain("session_id");
    expect(lines[1]).toContain('"Elden Ring: Deluxe"');
    expect(lines[1]).toContain('"A ""quoted"", note"');
  });

  it("keeps the header for an empty export", () => {
    expect(buildActivityCsv([], [])).toContain("session_id");
    expect(buildActivityCsv([], []).split("\n")).toHaveLength(1);
  });
});

describe("buildActivityExportPayload", () => {
  it("carries the range, display name, platform and notes", () => {
    const payload = buildActivityExportPayload(
      [session()],
      [game()],
      { s1: { note: "memorable", tags: [] } },
      { key: "custom", startDate: "2026-08-01", endDate: "2026-08-31" },
    );
    expect(payload.range).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(payload.totalSessions).toBe(1);
    expect(payload.sessions[0]).toMatchObject({
      gameName: "Elden Ring: Deluxe",
      platform: "Steam",
      notes: { note: "memorable", tags: [] },
    });
  });
});
