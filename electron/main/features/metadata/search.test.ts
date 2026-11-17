import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MetadataResult } from "./igdb";

const mocks = vi.hoisted(() => ({
  fetchIgdbGameBySteamAppid: vi.fn(),
  fetchIgdbGameById: vi.fn(),
  searchIgdb: vi.fn(),
  searchSteam: vi.fn(),
  fetchSteamGameByAppId: vi.fn(),
  fetchSteamGenresAndTags: vi.fn(),
  fetchTimeToBeat: vi.fn(),
}));

vi.mock("./igdb", () => ({
  fetchIgdbGameBySteamAppid: mocks.fetchIgdbGameBySteamAppid,
  fetchIgdbGameById: mocks.fetchIgdbGameById,
  searchIgdb: mocks.searchIgdb,
}));
vi.mock("./steam", () => ({
  searchSteam: mocks.searchSteam,
  fetchSteamGameByAppId: mocks.fetchSteamGameByAppId,
  fetchSteamGenresAndTags: mocks.fetchSteamGenresAndTags,
}));
vi.mock("./hltb", () => ({ fetchTimeToBeat: mocks.fetchTimeToBeat }));

import { getIgdbGameById, searchGameMetadata } from "./search";
import { titleMatchesGame } from "./text";

function metadata(title: string, igdbId = 1): MetadataResult {
  return {
    title,
    description: null,
    developer: null,
    publisher: null,
    releaseDate: null,
    genres: [],
    images: { icon: null, cover: null, hero: null, banner: null, logo: null },
    sourceUrl: `https://www.igdb.com/games/${igdbId}`,
    sourceName: "IGDB",
    igdbId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchSteamGenresAndTags.mockResolvedValue([]);
  mocks.fetchTimeToBeat.mockResolvedValue(null);
  mocks.searchSteam.mockResolvedValue(null);
  mocks.fetchSteamGameByAppId.mockResolvedValue(null);
});

describe("titleMatchesGame", () => {
  it("accepts the same game and edition subtitles", () => {
    expect(titleMatchesGame("Star Citizen", "Star Citizen")).toBe(true);
    expect(
      titleMatchesGame("Citizen Sleeper 2", "Citizen Sleeper 2: Starward Vector"),
    ).toBe(true);
    // Local folders often carry a longer name than the IGDB/Steam title.
    expect(
      titleMatchesGame("Need for Speed: Shift 2 Unleashed", "Shift 2: Unleashed"),
    ).toBe(true);
  });

  it("rejects a game that only shares one word", () => {
    expect(titleMatchesGame("Star Citizen", "Citizen Sleeper 2: Starward Vector")).toBe(
      false,
    );
  });
});

describe("searchGameMetadata appid validation", () => {
  it("ignores a stored appid that names a different game and searches by title", async () => {
    // Regression: Star Citizen carried Steam appid 2442460 (Citizen Sleeper 2)
    // from the old substring-based lookup, so every refresh pinned the wrong
    // IGDB game instead of searching for Star Citizen.
    mocks.fetchIgdbGameBySteamAppid.mockResolvedValue(
      metadata("Citizen Sleeper 2: Starward Vector", 252853),
    );
    mocks.searchIgdb.mockResolvedValue([metadata("Star Citizen", 1595)]);

    const results = await searchGameMetadata("Star Citizen", 2442460);

    expect(results.map((result) => result.title)).toEqual(["Star Citizen"]);
    expect(results[0].steamAppIdMismatch).toBe(true);
    expect(mocks.searchIgdb).toHaveBeenCalledWith("Star Citizen");
  });

  it("keeps an appid whose IGDB title matches", async () => {
    mocks.fetchIgdbGameBySteamAppid.mockResolvedValue(metadata("Star Citizen", 1595));

    const results = await searchGameMetadata("Star Citizen", 1595);

    expect(results.map((result) => result.title)).toEqual(["Star Citizen"]);
    expect(results[0].steamAppIdMismatch).toBeUndefined();
    expect(mocks.searchIgdb).not.toHaveBeenCalled();
  });

  it("keeps the pin when the title search finds nothing", async () => {
    mocks.fetchIgdbGameBySteamAppid.mockResolvedValue(
      metadata("Grand Theft Auto V", 1029),
    );
    mocks.searchIgdb.mockResolvedValue([]);

    const results = await searchGameMetadata("GTA V", 271590);

    expect(results.map((result) => result.title)).toEqual(["Grand Theft Auto V"]);
    expect(results[0].steamAppIdMismatch).toBeUndefined();
  });
});

describe("getIgdbGameById name guard", () => {
  it("rejects a stored id that points at a different game", async () => {
    mocks.fetchIgdbGameById.mockResolvedValue(
      metadata("Citizen Sleeper 2: Starward Vector", 252853),
    );

    const game = await getIgdbGameById(252853, "Star Citizen");

    expect(game).toBeNull();
  });

  it("keeps the id when the name matches or is omitted", async () => {
    mocks.fetchIgdbGameById.mockResolvedValue(metadata("Star Citizen", 1595));

    expect((await getIgdbGameById(1595, "Star Citizen"))?.title).toBe("Star Citizen");
    expect((await getIgdbGameById(1595))?.title).toBe("Star Citizen");
  });
});
