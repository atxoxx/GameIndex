import { describe, it, expect } from "vitest";
import type { Game } from "../../types/game";
import {
  computeHealthScore,
  countIssues,
  findBacklogIssues,
  findDuplicates,
  findMetadataIssues,
  findSizeIssues,
  findStalePaths,
  HUGE_UNPLAYED_BYTES,
  STALE_SIZE_DAYS,
  type HealthCounts,
} from "./health";

function game(partial: Partial<Game> = {}): Game {
  return {
    id: "g1",
    name: "Game One",
    path: "C:/Games/GameOne/game.exe",
    platform: "Local",
    installed: true,
    playTime: "0",
    addedAt: 0,
    ...partial,
  };
}

describe("findStalePaths", () => {
  it("reports games whose recorded folders are missing", () => {
    const games = [
      game({ id: "a", name: "A", sizeRootPath: "C:/Games/A" }),
      game({ id: "b", name: "B", path: "C:/Games/B/b.exe" }),
    ];
    const presence = new Map([
      ["a", { sizeRootPath: false }],
      ["b", { path: false, sizeRootPath: true }],
    ]);
    const issues = findStalePaths(games, presence);
    expect(issues).toHaveLength(2);
    expect(issues.find((i) => i.gameId === "a")?.field).toBe("sizeRootPath");
    expect(issues.find((i) => i.gameId === "b")?.field).toBe("path");
  });

  it("ignores games that were never checked", () => {
    const games = [game({ id: "c", sizeRootPath: "C:/Games/C" })];
    expect(findStalePaths(games, new Map())).toEqual([]);
  });
});

describe("findDuplicates", () => {
  it("groups rows that share an install path and keeps the healthiest copy", () => {
    const weak = game({ id: "weak", sizeRootPath: "C:/Games/Same", installed: false });
    const strong = game({
      id: "strong",
      sizeRootPath: "C:\\Games\\same\\",
      installed: true,
      coverArtUrl: "asset://cover",
      description: "desc",
    });
    const groups = findDuplicates([weak, strong]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("samePath");
    expect(groups[0].keepId).toBe("strong");
    expect(groups[0].removeIds).toEqual(["weak"]);
  });

  it("falls back to normalized titles but ignores store protocol paths", () => {
    const first = game({ id: "1", name: "Portal 2", path: "steam://rungameid/620" });
    const second = game({ id: "2", name: "Portal  2", path: "steam://rungameid/620" });
    const third = game({ id: "3", name: "Portal 2", path: "steam://rungameid/620" });
    const groups = findDuplicates([first, second, third]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("sameName");
    expect(groups[0].games).toHaveLength(3);
  });
});

describe("findMetadataIssues", () => {
  it("collects missing metadata and art gaps", () => {
    const complete = game({
      id: "ok",
      description: "d",
      developer: "dev",
      publisher: "pub",
      genres: ["Action"],
      coverArtUrl: "asset://c",
      iconUrl: "asset://i",
      bannerUrl: "asset://b",
      logoUrl: "asset://l",
    });
    const sparse = game({ id: "sparse", name: "Sparse" });
    const issues = findMetadataIssues([complete, sparse]);
    expect(issues).toHaveLength(1);
    expect(issues[0].gameId).toBe("sparse");
    expect(issues[0].metadataGaps).toContain("description");
    expect(issues[0].artGaps).toContain("cover");
  });
});

describe("findSizeIssues", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("flags never-measured, undated, and old measurements", () => {
    const games = [
      game({ id: "never", installed: true }),
      game({ id: "undated", installed: true, sizeBytes: 10 }),
      game({
        id: "old",
        installed: true,
        sizeBytes: 10,
        sizeDetectedAt: new Date(now - (STALE_SIZE_DAYS + 5) * 86_400_000).toISOString(),
      }),
      game({ id: "fresh", installed: true, sizeBytes: 10, sizeDetectedAt: new Date(now).toISOString() }),
      game({ id: "uninstalled", installed: false }),
    ];
    const issues = findSizeIssues(games, now);
    expect(issues.map((i) => i.gameId).sort()).toEqual(["never", "old", "undated"]);
    expect(issues.find((i) => i.gameId === "old")?.reason).toBe("oldMeasurement");
  });
});

describe("findBacklogIssues", () => {
  it("splits large unplayed installs from the long tail and skips tracked/store play", () => {
    const games = [
      game({ id: "huge", sizeBytes: HUGE_UNPLAYED_BYTES + 1 }),
      game({ id: "small", sizeBytes: 1024 }),
      game({ id: "played", lastPlayed: 123 }),
      game({ id: "steamSynced", steamPlaytime: 600 }),
      game({ id: "imported", playTime: "3h 15m" }),
      game({ id: "untracked", untracked: true, sizeBytes: HUGE_UNPLAYED_BYTES + 1 }),
    ];
    const issues = findBacklogIssues(games);
    expect(issues.map((i) => i.gameId)).toEqual(["huge", "small"]);
    expect(issues[0].reason).toBe("hugeUnplayed");
    expect(issues[1].reason).toBe("neverPlayed");
  });
});

describe("aggregation", () => {
  it("totals categories and derives a banded score", () => {
    const counts = countIssues({
      stalePaths: [{} as never, {} as never],
      duplicateGroups: [{} as never],
      metadataIssues: [],
      orphanArtwork: [],
      sizeIssues: [],
      backlogIssues: [],
    });
    expect(counts.total).toBe(3);

    const clean: HealthCounts = {
      paths: 0,
      duplicates: 0,
      metadata: 0,
      artwork: 0,
      sizes: 0,
      backlog: 0,
      total: 0,
    };
    expect(computeHealthScore(clean, 50).band).toBe("optimal");

    const broken = { ...clean, paths: 40, total: 40 };
    expect(computeHealthScore(broken, 50).band).toBe("critical");
  });
});
