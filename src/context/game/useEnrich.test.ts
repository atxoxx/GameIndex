import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useEnrich, enrichAttemptsThisSession } from "./useEnrich";
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
