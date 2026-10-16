import { describe, it, expect } from "vitest";
import {
  filterGamesByShelf,
  gameMatchesShelfRules,
  rulesFromFilters,
  shelfRulesToFilters,
} from "./shelfRules";
import { EMPTY_LIBRARY_FILTERS } from "./libraryFilters";
import type { Game } from "../types/game";

function makeGame(overrides: Partial<Game> & { name: string }): Game {
  const base: Game = {
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name,
    path: `C:\\Games\\${overrides.name}\\game.exe`,
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 1_000_000,
  };
  return { ...base, ...overrides };
}

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("gameMatchesShelfRules", () => {
  const eldenRing = makeGame({
    name: "Elden Ring",
    platform: "Steam",
    genres: ["RPG", "Action"],
    gameModes: ["Single player", "Multiplayer"],
    playerPerspectives: ["Third person"],
    playTime: "120h",
    igdbRating: 95,
    releaseDate: "2022-02-25",
    lastPlayed: NOW - 5 * DAY,
    addedAt: NOW - 400 * DAY,
    timeToBeat: { normally: 55 * 3600 },
    playStatus: "playing",
  });
  const short = makeGame({
    name: "Short Indie",
    platform: "GOG",
    genres: ["Adventure"],
    gameModes: ["Single player", "Co-operative"],
    playTime: "0h",
    timeToBeat: { normally: 3 * 3600 },
    addedAt: NOW - 3 * DAY,
    playStatus: "backlog",
  });

  it("empty rules match everything", () => {
    expect(gameMatchesShelfRules(eldenRing, {})).toBe(true);
    expect(gameMatchesShelfRules(short, {})).toBe(true);
  });

  it("combines rules with AND across facets", () => {
    expect(gameMatchesShelfRules(short, { modes: ["Co-operative"], playtimeMaxHours: 0 })).toBe(true);
    // Elden Ring is multiplayer but not co-op → fails the mode rule.
    expect(gameMatchesShelfRules(eldenRing, { modes: ["Co-operative"] })).toBe(false);
    // Short is co-op but has 0h playtime; a min hours of 1 excludes it.
    expect(gameMatchesShelfRules(short, { modes: ["Co-operative"], playtimeMinHours: 1 })).toBe(false);
  });

  it("matches never-played via playtimeMaxHours 0", () => {
    expect(gameMatchesShelfRules(short, { playtimeMaxHours: 0 })).toBe(true);
    expect(gameMatchesShelfRules(eldenRing, { playtimeMaxHours: 0 })).toBe(false);
  });

  it("matches short games by main-story length", () => {
    expect(gameMatchesShelfRules(short, { storyMaxHours: 5 })).toBe(true);
    expect(gameMatchesShelfRules(eldenRing, { storyMaxHours: 5 })).toBe(false);
    // A game without HLTB data cannot satisfy a story-length rule.
    const unknown = makeGame({ name: "Unknown" });
    expect(gameMatchesShelfRules(unknown, { storyMaxHours: 5 })).toBe(false);
  });

  it("evaluates relative date windows against now", () => {
    expect(gameMatchesShelfRules(eldenRing, { lastPlayedWithinDays: 7 }, { now: NOW })).toBe(true);
    expect(gameMatchesShelfRules(eldenRing, { lastPlayedWithinDays: 3 }, { now: NOW })).toBe(false);
    expect(gameMatchesShelfRules(eldenRing, { lastPlayedBeforeDays: 30 }, { now: NOW })).toBe(false);
    expect(gameMatchesShelfRules(short, { addedWithinDays: 7 }, { now: NOW })).toBe(true);
  });

  it("gates completion-date rules on a supplied completion timestamp", () => {
    const rules = { completedFrom: NOW - 30 * DAY };
    expect(gameMatchesShelfRules(eldenRing, rules, { completedAt: NOW - 2 * DAY })).toBe(true);
    expect(gameMatchesShelfRules(eldenRing, rules, { completedAt: NOW - 90 * DAY })).toBe(false);
    // No known completion date → excluded.
    expect(gameMatchesShelfRules(eldenRing, rules, {})).toBe(false);
  });

  it("matches store source via the platform mapping", () => {
    expect(gameMatchesShelfRules(eldenRing, { sources: ["steam"] })).toBe(true);
    expect(gameMatchesShelfRules(eldenRing, { sources: ["gog"] })).toBe(false);
    expect(gameMatchesShelfRules(short, { sources: ["gog", "epic"] })).toBe(true);
  });

  it("treats arrays as OR within a facet", () => {
    expect(gameMatchesShelfRules(short, { genres: ["Adventure", "RPG"] })).toBe(true);
    expect(gameMatchesShelfRules(short, { genres: ["RPG", "Strategy"] })).toBe(false);
  });
});

describe("filterGamesByShelf", () => {
  const games = [
    makeGame({ id: "a", name: "A", playTime: "0h", installed: false }),
    makeGame({ id: "b", name: "B", playTime: "0h" }),
    makeGame({ id: "c", name: "C", playTime: "40h", timeToBeat: { normally: 2 * 3600 } }),
  ];

  it("filters never-played games", () => {
    const out = filterGamesByShelf(games, { playtimeMaxHours: 0 });
    expect(out.map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("passes completion lookups to completion rules", () => {
    const completedAtOf = (id: string) => (id === "c" ? NOW : undefined);
    const out = filterGamesByShelf(games, { completedFrom: NOW - DAY }, completedAtOf);
    expect(out.map((g) => g.id)).toEqual(["c"]);
  });
});

describe("rulesFromFilters / shelfRulesToFilters", () => {
  it("round-trips the expressible facet subset", () => {
    const rules = rulesFromFilters({
      ...EMPTY_LIBRARY_FILTERS,
      genres: ["RPG"],
      source: "steam",
      status: "installed",
      playStatus: "backlog",
      ratingMin: 80,
      vrOnly: true,
    });
    expect(rules).toMatchObject({
      genres: ["RPG"],
      sources: ["steam"],
      status: "installed",
      playStatus: "backlog",
      ratingMin: 80,
      vrOnly: true,
    });

    const back = shelfRulesToFilters(rules);
    expect(back.genres).toEqual(["RPG"]);
    expect(back.source).toBe("steam");
    expect(back.status).toBe("installed");
    expect(back.playStatus).toBe("backlog");
    expect(back.ratingMin).toBe(80);
    expect(back.vrOnly).toBe(true);
  });

  it("omits unconstrained facets", () => {
    const rules = rulesFromFilters(EMPTY_LIBRARY_FILTERS);
    expect(rules).toEqual({});
  });
});
