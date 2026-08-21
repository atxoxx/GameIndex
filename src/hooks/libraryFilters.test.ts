import { describe, it, expect } from "vitest";
import {
  filterGames,
  sortGames,
  gameMatchesFilters,
  EMPTY_LIBRARY_FILTERS,
  parseReleaseYear,
} from "./libraryFilters";
import type { Game } from "../types/game";

function makeGame(overrides: Partial<Game> & { name: string }): Game {
  const base: Game = {
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name,
    path: overrides.path ?? `C:\\Games\\${overrides.name}\\game.exe`,
    platform: overrides.platform ?? "Local",
    installed: overrides.installed ?? true,
    playTime: overrides.playTime ?? "0h",
    addedAt: overrides.addedAt ?? Date.now(),
  };
  return { ...base, ...overrides };
}

describe("parseReleaseYear", () => {
  it("extracts year from ISO date", () => {
    expect(parseReleaseYear("2023-05-15")).toBe(2023);
  });
  it("returns null for missing or malformed", () => {
    expect(parseReleaseYear(null)).toBeNull();
    expect(parseReleaseYear("")).toBeNull();
    expect(parseReleaseYear("not-a-date")).toBeNull();
  });
  it("rejects out-of-range years", () => {
    expect(parseReleaseYear("1800-01-01")).toBeNull();
    expect(parseReleaseYear("2200-01-01")).toBeNull();
  });
});

describe("gameMatchesFilters", () => {
  const games = [
    makeGame({ name: "Elden Ring", platform: "Steam", genres: ["RPG", "Action"], releaseDate: "2022-02-25", igdbRating: 95 }),
    makeGame({ name: "Hades", platform: "Steam", genres: ["Roguelike"], releaseDate: "2020-09-17", igdbRating: 92, installed: false }),
    makeGame({ name: "Stardew Valley", platform: "GOG", genres: ["Simulation", "RPG"], releaseDate: "2016-02-26", igdbRating: 89 }),
  ];

  it("matches substring search case-insensitive", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, search: "elden" };
    expect(gameMatchesFilters(games[0], filters)).toBe(true);
    expect(gameMatchesFilters(games[1], filters)).toBe(false);
  });

  it("trims search query", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, search: "  HADES  " };
    expect(gameMatchesFilters(games[1], filters)).toBe(true);
  });

  it("filters by genre OR", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, genres: ["RPG"] };
    expect(gameMatchesFilters(games[0], filters)).toBe(true);
    expect(gameMatchesFilters(games[1], filters)).toBe(false);
    expect(gameMatchesFilters(games[2], filters)).toBe(true);
  });

  it("filters by platform exact match", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, platforms: ["GOG"] };
    expect(gameMatchesFilters(games[2], filters)).toBe(true);
    expect(gameMatchesFilters(games[0], filters)).toBe(false);
  });

  it("filters by status installed", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, status: "installed" as const };
    expect(gameMatchesFilters(games[0], filters)).toBe(true);
    expect(gameMatchesFilters(games[1], filters)).toBe(false);
  });

  it("filters by playStatus", () => {
    const g = makeGame({ name: "Test", playStatus: "playing" });
    expect(gameMatchesFilters(g, { ...EMPTY_LIBRARY_FILTERS, playStatus: "playing" })).toBe(true);
    expect(gameMatchesFilters(g, { ...EMPTY_LIBRARY_FILTERS, playStatus: "completed" })).toBe(false);
  });
});

describe("filterGames", () => {
  const games = [
    makeGame({ name: "Alpha", platform: "Steam", genres: ["RPG"] }),
    makeGame({ name: "Beta", platform: "GOG", genres: ["Action"] }),
    makeGame({ name: "Gamma", platform: "Steam", genres: ["RPG"] }),
  ];

  it("returns all games when no active filters", () => {
    expect(filterGames(games, EMPTY_LIBRARY_FILTERS)).toHaveLength(3);
  });

  it("narrows by search", () => {
    const result = filterGames(games, { ...EMPTY_LIBRARY_FILTERS, search: "alpha" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha");
  });

  it("narrows by genre", () => {
    const result = filterGames(games, { ...EMPTY_LIBRARY_FILTERS, genres: ["RPG"] });
    expect(result).toHaveLength(2);
  });
});

describe("sortGames", () => {
  it("sorts alphabetically", () => {
    const games = [makeGame({ name: "Zeta" }), makeGame({ name: "Alpha" }), makeGame({ name: "Mid" })];
    const sorted = sortGames(games, "alphabetical");
    expect(sorted.map((g) => g.name)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("sorts by most_played descending", () => {
    const games = [
      makeGame({ name: "A", playTime: "10h" }),
      makeGame({ name: "B", playTime: "50h" }),
      makeGame({ name: "C", playTime: "2h" }),
    ];
    const sorted = sortGames(games, "most_played");
    expect(sorted.map((g) => g.name)).toEqual(["B", "A", "C"]);
  });

  it("sorts by rating descending", () => {
    const games = [
      makeGame({ name: "Low", igdbRating: 60 }),
      makeGame({ name: "High", igdbRating: 95 }),
      makeGame({ name: "Mid", igdbRating: 80 }),
    ];
    const sorted = sortGames(games, "rating");
    expect(sorted.map((g) => g.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts by date_added newest first", () => {
    const now = Date.now();
    const games = [
      makeGame({ name: "Old", addedAt: now - 10000 }),
      makeGame({ name: "New", addedAt: now }),
      makeGame({ name: "Mid", addedAt: now - 5000 }),
    ];
    const sorted = sortGames(games, "date_added");
    expect(sorted.map((g) => g.name)).toEqual(["New", "Mid", "Old"]);
  });
});
