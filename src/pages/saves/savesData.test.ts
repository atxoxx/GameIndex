import { describe, expect, it } from "vitest";
import type { Game } from "../../types/game";
import type { SaveBackup, SaveLocation } from "../../types/saves";
import {
  STALE_BACKUP_MS,
  buildSavesOverview,
  filterSnapshots,
  filterTrackedGames,
  groupSnapshotsByDay,
  protectionRank,
} from "./savesData";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

function game(id: string, name: string, installed = true): Game {
  return {
    id,
    name,
    path: `C:/Games/${id}.exe`,
    platform: "Local",
    installed,
  } as Game;
}

function location(id: string, gameId: string, include = true, path = `C:/Saves/${id}`): SaveLocation {
  return {
    id,
    gameId,
    path,
    label: id,
    kind: "dir",
    source: "curated",
    include,
    createdAt: 0,
    updatedAt: 0,
  };
}

function backup(
  id: string,
  gameId: string,
  createdAt: number,
  extra: Partial<SaveBackup> = {},
): SaveBackup {
  return {
    id,
    gameId,
    gameName: gameId,
    createdAt,
    kind: "manual",
    note: "",
    locationCount: 1,
    fileCount: 2,
    totalBytes: 1024,
    status: "complete",
    rootPath: "",
    manifestPath: "",
    ...extra,
  };
}

describe("buildSavesOverview", () => {
  it("derives protection state from snapshots, age and path health", () => {
    const games = [game("fresh", "Fresh"), game("stale", "Stale"), game("never", "Never")];
    const locations = [
      location("fresh-loc", "fresh"),
      location("stale-loc", "stale"),
      location("never-loc", "never"),
    ];
    const backups = [
      backup("fresh-bak", "fresh", NOW - 60_000),
      backup("stale-bak", "stale", NOW - STALE_BACKUP_MS - 60_000),
    ];
    const health = [
      { id: "fresh-loc", exists: true },
      { id: "stale-loc", exists: true },
      { id: "never-loc", exists: true },
    ];

    const overview = buildSavesOverview({ games, locations, backups, health, now: NOW });

    expect(overview.byId.get("fresh")?.state).toBe("protected");
    expect(overview.byId.get("stale")?.state).toBe("stale");
    expect(overview.byId.get("never")?.state).toBe("never");
    expect(overview.counts).toMatchObject({
      all: 3,
      protected: 1,
      needsBackup: 2,
      issues: 0,
      attention: 2,
    });
  });

  it("treats only an explicit missing path as an issue, not unknown health", () => {
    const games = [game("missing", "Missing"), game("unknown", "Unknown")];
    const locations = [
      location("missing-loc", "missing"),
      location("unknown-loc", "unknown"),
    ];

    const overview = buildSavesOverview({
      games,
      locations,
      backups: [backup("missing-bak", "missing", NOW - 60_000)],
      health: [{ id: "missing-loc", exists: false }],
      now: NOW,
    });

    expect(overview.byId.get("missing")?.state).toBe("missing");
    expect(overview.byId.get("missing")?.missingCount).toBe(1);
    expect(overview.byId.get("unknown")?.state).toBe("never");
    expect(overview.byId.get("unknown")?.missingCount).toBe(0);
    expect(overview.counts.issues).toBe(1);
  });

  it("keeps orphaned snapshots visible when their game left the library", () => {
    const overview = buildSavesOverview({
      games: [],
      locations: [],
      backups: [backup("orphan-bak", "removed", NOW - 60_000, { gameName: "Removed Game" })],
      health: [],
      now: NOW,
    });

    expect(overview.tracked).toHaveLength(1);
    expect(overview.tracked[0].name).toBe("Removed Game");
    expect(overview.tracked[0].installed).toBe(false);
    expect(overview.tracked[0].state).toBe("excluded");
  });

  it("counts a game with all locations excluded as excluded, not protected", () => {
    const overview = buildSavesOverview({
      games: [game("excluded", "Excluded")],
      locations: [location("excluded-loc", "excluded", false)],
      backups: [backup("excluded-bak", "excluded", NOW - 60_000)],
      health: [{ id: "excluded-loc", exists: false }],
      now: NOW,
    });

    expect(overview.byId.get("excluded")?.state).toBe("excluded");
    expect(overview.byId.get("excluded")?.missingCount).toBe(0);
    expect(overview.counts.issues).toBe(0);
  });
});

describe("filterTrackedGames", () => {
  const games = [game("a", "Alpha"), game("b", "Beta"), game("c", "Gamma")];
  const locations = [
    location("a-loc", "a"),
    location("b-loc", "b"),
    location("c-loc", "c"),
  ];
  const backups = [
    backup("a-bak", "a", NOW - 60_000),
    backup("b-bak", "b", NOW - 21 * 86_400_000),
  ];
  const overview = buildSavesOverview({
    games,
    locations,
    backups,
    health: [
      { id: "a-loc", exists: true },
      { id: "b-loc", exists: true },
      { id: "c-loc", exists: false },
    ],
    now: NOW,
  });

  it("filters by protection state and keeps counts intact", () => {
    const needs = filterTrackedGames(overview.tracked, {
      filter: "needsBackup",
      search: "",
      sort: "name",
    });
    expect(needs.map((entry) => entry.name)).toEqual(["Beta"]);

    const issues = filterTrackedGames(overview.tracked, {
      filter: "issues",
      search: "",
      sort: "name",
    });
    expect(issues.map((entry) => entry.name)).toEqual(["Gamma"]);
  });

  it("searches names case-insensitively and sorts by attention", () => {
    const sorted = filterTrackedGames(overview.tracked, {
      filter: "all",
      search: "",
      sort: "attention",
    });
    expect(sorted.map((entry) => entry.name)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(sorted.map((entry) => protectionRank(entry.state))).toEqual([0, 2, 4]);

    const searched = filterTrackedGames(overview.tracked, {
      filter: "all",
      search: "bet",
      sort: "name",
    });
    expect(searched.map((entry) => entry.name)).toEqual(["Beta"]);
  });
});

describe("snapshot filters and day grouping", () => {
  const backups = [
    backup("new", "a", NOW - 60_000, { totalBytes: 100, note: "Boss fight" }),
    backup("old", "b", NOW - 86_400_000, { totalBytes: 900, kind: "auto-exit" }),
    backup("older", "a", NOW - 3 * 86_400_000, { totalBytes: 500 }),
  ];

  it("filters by game, kind and note text", () => {
    expect(
      filterSnapshots(backups, { search: "boss", gameId: "all", kind: "all", sort: "newest" }),
    ).toHaveLength(1);
    expect(
      filterSnapshots(backups, { search: "", gameId: "a", kind: "all", sort: "newest" }),
    ).toHaveLength(2);
    expect(
      filterSnapshots(backups, { search: "", gameId: "all", kind: "auto-exit", sort: "newest" }),
    ).toHaveLength(1);
  });

  it("sorts by size and groups into local days", () => {
    const bySize = filterSnapshots(backups, {
      search: "",
      gameId: "all",
      kind: "all",
      sort: "size",
    });
    expect(bySize.map((entry) => entry.id)).toEqual(["old", "older", "new"]);

    const newest = filterSnapshots(backups, {
      search: "",
      gameId: "all",
      kind: "all",
      sort: "newest",
    });
    const grouped = groupSnapshotsByDay(newest);
    expect(grouped).toHaveLength(3);
    expect(grouped.map((group) => group.backups[0].id)).toEqual(["new", "old", "older"]);
    expect(grouped.every((group) => group.backups.length === 1)).toBe(true);
  });

  it("returns no groups for an empty archive", () => {
    expect(groupSnapshotsByDay([])).toEqual([]);
    expect(
      filterSnapshots([], { search: "", gameId: "all", kind: "all", sort: "newest" }),
    ).toEqual([]);
  });
});
