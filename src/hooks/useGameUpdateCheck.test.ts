import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../types/game";
import type { DownloadSearchResult } from "../types/plugins";
import { searchDownloads } from "../context/SourceContext";
import { deriveUpdateStatus, useGameUpdateCheck } from "./useGameUpdateCheck";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../context/SourceContext", () => ({ searchDownloads: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const mockedSearch = vi.mocked(searchDownloads);

/** localStorage key duplicated from the hook — kept private there. */
const UPDATE_CACHE_KEY = "gamelib_game_updates_v1";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    name: "Test Game",
    path: "C:/Games/Test/Test.exe",
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function makeResult(title: string): DownloadSearchResult {
  return {
    sourceName: "TestSource",
    sourceId: "test",
    title,
    fileSize: "1 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 1,
    isNew: false,
    provider: "source",
  } as DownloadSearchResult;
}

describe("deriveUpdateStatus", () => {
  it("reports update-available when the sources carry a newer build", () => {
    expect(deriveUpdateStatus("1.2.0", "1.3.0")).toBe("update-available");
    expect(deriveUpdateStatus("1.9", "1.10")).toBe("update-available");
  });

  it("reports up-to-date when the installed version is current", () => {
    expect(deriveUpdateStatus("1.2.0", "1.2.0")).toBe("up-to-date");
    // Installed newer than anything in the sources is still "current".
    expect(deriveUpdateStatus("1.4.0", "1.2.0")).toBe("up-to-date");
  });

  it("reports unknown when either version is missing", () => {
    expect(deriveUpdateStatus(null, "1.2.0")).toBe("unknown");
    expect(deriveUpdateStatus("1.2.0", null)).toBe("unknown");
    expect(deriveUpdateStatus(null, null)).toBe("unknown");
  });

  it("reports unknown for non-numeric installed versions instead of a false up-to-date", () => {
    // Unreal/Unity exes tag strings like "UE5-CL-0" — not comparable.
    expect(deriveUpdateStatus("UE5-CL-0", "1.2.0")).toBe("unknown");
    expect(deriveUpdateStatus("discovery_11.06.x_ue57-CL-1355454", "1.2.0")).toBe("unknown");
    expect(deriveUpdateStatus("1.2.0", "not-a-version")).toBe("unknown");
  });
});

describe("useGameUpdateCheck", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
    mockedSearch.mockReset();
  });

  it("serves a fresh cached result without re-running the check", async () => {
    const game = makeGame();
    localStorage.setItem(
      UPDATE_CACHE_KEY,
      JSON.stringify({
        [game.id]: {
          status: "up-to-date",
          installedVersion: "1.2.0",
          latestVersion: "1.2.0",
          checkedAt: Date.now(),
        },
      })
    );

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("up-to-date"));

    expect(result.current.installedVersion).toBe("1.2.0");
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("refresh clears the cache entry and re-runs the check", async () => {
    const game = makeGame();
    localStorage.setItem(
      UPDATE_CACHE_KEY,
      JSON.stringify({
        [game.id]: {
          status: "up-to-date",
          installedVersion: "1.3.0",
          latestVersion: "1.3.0",
          checkedAt: Date.now(),
        },
      })
    );

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("up-to-date"));
    expect(mockedInvoke).not.toHaveBeenCalled();

    mockedInvoke.mockResolvedValue("1.3.0");
    mockedSearch.mockResolvedValue([makeResult("Test Game v1.4.0 [Repack]")]);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("update-available"));

    expect(result.current.installedVersion).toBe("1.3.0");
    expect(result.current.latestVersion).toBe("1.4.0");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("detect_game_version", {
      query: {
        gameId: game.id,
        path: game.path,
        detectedExe: undefined,
        installDir: undefined,
        platform: game.platform,
        steamAppId: game.steamAppId,
      },
    });
    expect(mockedSearch).toHaveBeenCalledWith(game.name, game.steamAppId);
  });

  it("refresh on one instance re-checks every mounted instance for the game", async () => {
    const game = makeGame();
    localStorage.setItem(
      UPDATE_CACHE_KEY,
      JSON.stringify({
        [game.id]: {
          status: "up-to-date",
          installedVersion: "1.3.0",
          latestVersion: "1.3.0",
          checkedAt: Date.now(),
        },
      })
    );

    // Two consumers for the same game (hero DownloadButton + Info card).
    const first = renderHook(() => useGameUpdateCheck(game));
    const second = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(first.result.current.status).toBe("up-to-date"));
    await waitFor(() => expect(second.result.current.status).toBe("up-to-date"));

    mockedInvoke.mockResolvedValue("1.3.0");
    mockedSearch.mockResolvedValue([makeResult("Test Game v1.5.0")]);

    act(() => first.result.current.refresh());
    await waitFor(() => expect(first.result.current.status).toBe("update-available"));
    await waitFor(() => expect(second.result.current.status).toBe("update-available"));

    // The source search fires once for both consumers.
    expect(first.result.current.latestVersion).toBe("1.5.0");
    expect(second.result.current.latestVersion).toBe("1.5.0");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedSearch).toHaveBeenCalledTimes(1);
  });

  it("reads the installed exe version and compares against the sources", async () => {
    const game = makeGame({ steamAppId: 42 });
    mockedInvoke.mockResolvedValue("2.1.0");
    mockedSearch.mockResolvedValue([makeResult("Test Game v2.1.0"), makeResult("Test Game v2.0.0")]);

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("up-to-date"));

    expect(result.current.installedVersion).toBe("2.1.0");
    expect(result.current.latestVersion).toBe("2.1.0");
  });

  it("degrades to unknown when the exe version cannot be read", async () => {
    const game = makeGame();
    mockedInvoke.mockResolvedValue(null);
    mockedSearch.mockResolvedValue([makeResult("Test Game v2.1.0")]);

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("unknown"));

    expect(result.current.installedVersion).toBeNull();
    expect(result.current.latestVersion).toBe("2.1.0");
  });

  it("skips the check entirely for games without an exe path", async () => {
    const game = makeGame({ installed: true, path: "" });

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("unknown"));

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("stays idle for games that are not installed", async () => {
    const game = makeGame({ installed: false });

    const { result } = renderHook(() => useGameUpdateCheck(game));
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("instantly updates status and installed version without re-searching when explicit game version changes", async () => {
    const game = makeGame({ version: "1.0.0" });
    localStorage.setItem(
      UPDATE_CACHE_KEY,
      JSON.stringify({
        [game.id]: {
          status: "update-available",
          installedVersion: "1.0.0",
          latestVersion: "1.2.0",
          checkedAt: Date.now(),
        },
      })
    );

    const { result, rerender } = renderHook(
      (g: Game) => useGameUpdateCheck(g),
      { initialProps: game }
    );
    await waitFor(() => expect(result.current.status).toBe("update-available"));
    expect(result.current.installedVersion).toBe("1.0.0");
    expect(result.current.latestVersion).toBe("1.2.0");

    // Simulate changing version in settings to 1.2.0 (matches latest)
    rerender(makeGame({ version: "1.2.0" }));

    // Status is immediately re-derived as up-to-date in 0ms without running network search
    expect(result.current.installedVersion).toBe("1.2.0");
    expect(result.current.status).toBe("up-to-date");
    expect(mockedInvoke).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("surfaces locally detected installed version before searchDownloads completes", async () => {
    const game = makeGame();
    mockedInvoke.mockResolvedValue("2.0.0");

    // Create a delayed searchDownloads promise
    let resolveSearch: (res: DownloadSearchResult[]) => void;
    mockedSearch.mockImplementation(
      () =>
        new Promise<DownloadSearchResult[]>((resolve) => {
          resolveSearch = resolve;
        })
    );

    const { result } = renderHook(() => useGameUpdateCheck(game));

    // Local detection should surface 2.0.0 before search resolves
    await waitFor(() => expect(result.current.installedVersion).toBe("2.0.0"));
    expect(result.current.status).toBe("checking");

    // Later when search resolves, latestVersion and status update
    act(() => {
      resolveSearch!([makeResult("Test Game v2.1.0")]);
    });

    await waitFor(() => expect(result.current.status).toBe("update-available"));
    expect(result.current.installedVersion).toBe("2.0.0");
    expect(result.current.latestVersion).toBe("2.1.0");
  });
});
