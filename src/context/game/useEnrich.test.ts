import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  useEnrich,
  enrichAttemptsThisSession,
  fetchAllImages,
  gameNeedsEnrichment,
  metadataUrlDisagreesWithName,
} from "./useEnrich";
import type { Game, GameMetadataResult } from "../../types/game";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => p,
}));

const mockedInvoke = vi.mocked(invoke);

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g",
    name: "G",
    path: "C:/g/g.exe",
    platform: "PC",
    installed: true,
    playTime: "0h",
    addedAt: 1,
    coverArtUrl: "asset://localhost/old-cover.png",
    description: "Old description",
    genres: ["Action"],
    similarGames: [],
    ...overrides,
  } as Game;
}

function makeMeta(images: GameMetadataResult["images"]): GameMetadataResult {
  return {
    title: "G",
    description: "Enriched description",
    developer: "Dev",
    publisher: "Pub",
    releaseDate: null,
    genres: ["Action"],
    images,
    sourceUrl: "https://example.test/g",
    sourceName: "IGDB",
  };
}

describe("metadata identity detection", () => {
  it("flags a stored IGDB URL for a different game", () => {
    const game = makeGame({
      name: "Star Citizen",
      platform: "Local",
      steamAppId: 2442460,
      igdbId: 252853,
      metadataUrl: "https://www.igdb.com/games/citizen-sleeper-2-starward-vector",
    });
    expect(metadataUrlDisagreesWithName(game)).toBe(true);
    expect(gameNeedsEnrichment(game)).toBe(true);
  });

  it("leaves a matching IGDB URL alone", () => {
    const game = makeGame({
      name: "Star Citizen",
      platform: "Local",
      steamAppId: 1595,
      igdbId: 1595,
      metadataUrl: "https://www.igdb.com/games/star-citizen",
      description: "A space sim",
      genres: ["Simulator", "Shooter"],
      similarGames: [],
      collection: "Star Citizen",
      franchise: "Star Citizen",
    });
    expect(metadataUrlDisagreesWithName(game)).toBe(false);
    expect(gameNeedsEnrichment(game)).toBe(false);
  });

  it("does not flag edition or punctuation variants", () => {
    expect(
      metadataUrlDisagreesWithName(
        makeGame({
          name: "Need for Speed: Shift 2 Unleashed",
          metadataUrl: "https://www.igdb.com/games/shift-2-unleashed",
        }),
      ),
    ).toBe(false);
    expect(
      metadataUrlDisagreesWithName(
        makeGame({
          name: "DOOM + DOOM II",
          metadataUrl: "https://www.igdb.com/games/doom-doom-ii",
        }),
      ),
    ).toBe(false);
  });
});

describe("useEnrich concurrent edits", () => {
  beforeEach(() => {
    enrichAttemptsThisSession.clear();
    mockedInvoke.mockReset();
  });

  it("does not clobber a cover the user replaced while enrichment was in flight", async () => {
    const initial = makeGame();
    const userEdited = makeGame({
      coverArtUrl: "asset://localhost/user-new-cover.png",
    });
    const gamesRef = { current: [initial] as Game[] };
    const updateGame = vi.fn();

    let resolveMeta!: (v: GameMetadataResult[]) => void;
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_game_metadata") {
        return new Promise<GameMetadataResult[]>((res) => {
          resolveMeta = res;
        });
      }
      return Promise.resolve(null);
    });

    const loadGameDetail = vi
      .fn()
      .mockImplementation(async (id: string) => gamesRef.current.find((g) => g.id === id) ?? null);

    const { result } = renderHook(() =>
      useEnrich({ gamesRef, updateGame, loadGameDetail })
    );

    await act(async () => {
      const promise = result.current.enrichGameMetadata("g", "G");
      // Let the detail load settle so the metadata fetch is actually in flight.
      await Promise.resolve();
      await Promise.resolve();
      // The user picks a new cover while the metadata fetch is in flight.
      gamesRef.current = [userEdited];
      resolveMeta([
        makeMeta({ icon: null, cover: "https://remote/cover.png", hero: null, banner: null, logo: null }),
      ]);
      await promise;
    });

    const saveCall = mockedInvoke.mock.calls.find((c) => c[0] === "save_game");
    expect(saveCall).toBeTruthy();
    const savedGame = (saveCall?.[1] as { game: Game }).game;
    expect(savedGame.coverArtUrl).toBe("asset://localhost/user-new-cover.png");
  });

  it("clears a stale appid when the metadata result says it named another game", async () => {
    const game = makeGame({
      name: "Star Citizen",
      steamAppId: 2442460,
      igdbId: undefined,
      metadataSource: "IGDB",
      bannerUrl: "asset://localhost/citizen-sleeper-hero.png",
      logoUrl: "asset://localhost/citizen-sleeper-logo.png",
    });
    const gamesRef = { current: [game] };
    const updateGame = vi.fn();

    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "search_game_metadata") {
        return Promise.resolve([
          {
            ...makeMeta({ icon: null, cover: null, hero: null, banner: null, logo: null }),
            title: "Star Citizen",
            igdbId: 1595,
            steamAppIdMismatch: true,
            websites: ["https://robertsspaceindustries.com/star-citizen/"],
          },
        ]);
      }
      if (cmd === "sgdb_get_assets") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const loadGameDetail = vi.fn().mockResolvedValue(game);
    const { result } = renderHook(() =>
      useEnrich({ gamesRef, updateGame, loadGameDetail })
    );

    await act(async () => {
      await result.current.enrichGameMetadata("g", "Star Citizen", 2442460);
    });

    const saveCall = mockedInvoke.mock.calls.find((c) => c[0] === "save_game");
    expect(saveCall).toBeTruthy();
    const savedGame = (saveCall?.[1] as { game: Game }).game;
    expect(savedGame.steamAppId).toBe(0);
    expect(savedGame.igdbId).toBe(1595);
    expect(savedGame.metadataUrl).toBe("https://example.test/g");
    // The old logo/hero came from the wrong game and must not survive the
    // identity repair when the new result has no replacement.
    expect(savedGame.logoUrl).toBe("");
    expect(savedGame.bannerUrl).toBe("");
  });

  it("persists HowLongToBeat stats through patch_game without a full-row write", async () => {
    const game = makeGame({ timeToBeat: undefined });
    const gamesRef = { current: [game] };
    const updateGame = vi.fn();

    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "fetch_hltb_stats") {
        return Promise.resolve({ normally: 3600 });
      }
      return Promise.resolve(null);
    });

    const loadGameDetail = vi.fn().mockResolvedValue(game);
    const { result } = renderHook(() =>
      useEnrich({ gamesRef, updateGame, loadGameDetail })
    );

    await act(async () => {
      await result.current.fetchGameHltb("g", "G");
    });

    expect(mockedInvoke).toHaveBeenCalledWith(
      "patch_game",
      expect.objectContaining({
        id: "g",
        patch: expect.objectContaining({ timeToBeat: expect.any(Object) }),
      })
    );
    // A full-row save from the pre-fetch snapshot could roll back artwork the
    // user changed while HLTB was loading.
    expect(mockedInvoke).not.toHaveBeenCalledWith("save_game", expect.anything());
  });
});

describe("fetchAllImages logoSourceUrl", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === "download_image") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it("keeps the original public https URL for Discord presence", async () => {
    const images = await fetchAllImages({ logo: "https://cdn.example/logo.png" });
    expect(images.logoSourceUrl).toBe("https://cdn.example/logo.png");
    expect(images.logoUrl).toBe("https://cdn.example/logo.png");
  });

  it("drops a non-https logo source instead of leaking a data URI", async () => {
    const images = await fetchAllImages({ logo: "data:image/png;base64,AAAA" });
    expect(images.logoSourceUrl).toBeUndefined();
  });
});
