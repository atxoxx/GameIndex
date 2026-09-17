import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { GameProvider, useGames } from "./GameContext";
import { useEnrich, enrichAttemptsThisSession } from "./game/useEnrich";
import type { Game, GameMetadataResult } from "../types/game";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
  Channel: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

const { showToastMock, splashMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  splashMock: {
    visible: false,
    inline: false,
    record: null,
    open: vi.fn(),
    updateStatus: vi.fn(),
    updateLaunchStep: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("./ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock("./SplashContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./SplashContext")>();
  return { ...actual, useSplash: () => splashMock };
});

const mockedInvoke = vi.mocked(invoke);

const SPLASH_KEY = "gamelib-show-splash";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-a",
    name: "Alpha",
    path: "C:/games/alpha.exe",
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 1_700_000_000_000,
    description: "Description",
    genres: ["Action", "RPG"],
    similarGames: [],
    metadataSource: "IGDB",
    ...overrides,
  };
}

function makeMeta(overrides: Partial<GameMetadataResult> = {}): GameMetadataResult {
  return {
    title: "Beta",
    description: "Enriched Beta",
    developer: "Dev",
    publisher: "Pub",
    releaseDate: null,
    genres: ["Action"],
    images: { icon: null, cover: null, hero: null, banner: null, logo: null },
    sourceUrl: "https://example.test/beta",
    sourceName: "IGDB",
    ...overrides,
  };
}

let loadedGames: Game[] = [];
let metadataResults: GameMetadataResult[] = [];
let metadataError: Error | null = null;
let launchHandler: () => Promise<unknown> = () => Promise.resolve("session-1");

function installInvokeMock() {
  mockedInvoke.mockImplementation((command: string) => {
    switch (command) {
      case "load_games":
        return Promise.resolve(loadedGames);
      case "launch_game":
        return launchHandler();
      case "search_game_metadata":
        return metadataError ? Promise.reject(metadataError) : Promise.resolve(metadataResults);
      case "get_igdb_game_by_id":
        return Promise.resolve(null);
      case "sgdb_get_assets":
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  });
}

function Probe() {
  const { games, runningGameIds, launchGame, enqueueEnrich } = useGames();
  const gameA = games.find((g) => g.id === "game-a");
  const gameB = games.find((g) => g.id === "game-b");
  return (
    <div>
      <span data-testid="count">{games.length}</span>
      <span data-testid="running">{runningGameIds.join(",")}</span>
      <span data-testid="last-played">{String(gameA?.lastPlayed ?? "")}</span>
      <span data-testid="desc-a">{gameA?.description ?? ""}</span>
      <span data-testid="dev-b">{gameB?.developer ?? ""}</span>
      <button onClick={() => gameA && void launchGame(gameA)}>launch</button>
      <button onClick={() => gameB && enqueueEnrich({ id: gameB.id, name: gameB.name })}>
        enrich-b
      </button>
    </div>
  );
}

async function flush(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("GameProvider launch flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Keep the launch path focused: splash off unless a test turns it on.
    localStorage.setItem(SPLASH_KEY, "false");
    loadedGames = [];
    metadataResults = [];
    metadataError = null;
    launchHandler = () => Promise.resolve("session-1");
    showToastMock.mockReset();
    splashMock.open.mockReset();
    splashMock.updateStatus.mockReset();
    enrichAttemptsThisSession.clear();
    mockedInvoke.mockReset();
    installInvokeMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("invokes launch_game with the full payload and marks the game running (happy path)", async () => {
    loadedGames = [makeGame()];
    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    await flush();

    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("running")).toHaveTextContent("");

    fireEvent.click(screen.getByText("launch"));
    await flush();

    expect(mockedInvoke).toHaveBeenCalledWith("launch_game", {
      gameId: "game-a",
      gameName: "Alpha",
      gamePath: "C:/games/alpha.exe",
      platform: "Local",
      steamAppId: null,
      gpuId: null,
      gpuName: null,
      gpuSelection: null,
      launchArguments: null,
      runAsAdmin: null,
      showSteamLaunchSelection: null,
      preLaunchScript: null,
      preLaunchAdmin: null,
      postExitScript: null,
      postExitAdmin: null,
      companionApps: null,
    });

    // The game is registered as running with a fresh lastPlayed stamp.
    expect(screen.getByTestId("running")).toHaveTextContent("game-a");
    expect(Number(screen.getByTestId("last-played").textContent)).toBeGreaterThan(0);
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("surfaces a launch_game rejection and does not leave the game stuck running (error path)", async () => {
    loadedGames = [makeGame({ lastPlayed: 1_600_000_000_000 })];
    localStorage.setItem(SPLASH_KEY, "true");
    launchHandler = () => Promise.reject(new Error("spawn failed"));

    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    await flush();
    fireEvent.click(screen.getByText("launch"));
    await flush();

    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining("spawn failed"),
      "error",
    );
    expect(splashMock.updateStatus).toHaveBeenCalledWith("error", "Error: spawn failed");
    expect(screen.getByTestId("running")).toHaveTextContent("");
    // A failed launch must not bump the game in the "Continue Playing" rail.
    expect(screen.getByTestId("last-played")).toHaveTextContent("1600000000000");

    // A second launch must actually reach the backend instead of bailing out
    // on a stale "already running" flag.
    launchHandler = () => Promise.resolve("session-2");
    showToastMock.mockClear();
    fireEvent.click(screen.getByText("launch"));
    await flush();

    const launchCalls = mockedInvoke.mock.calls.filter((c) => c[0] === "launch_game");
    expect(launchCalls).toHaveLength(2);
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "success");
    expect(screen.getByTestId("running")).toHaveTextContent("game-a");
  });
});

describe("useEnrich isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    loadedGames = [];
    metadataResults = [];
    metadataError = null;
    launchHandler = () => Promise.resolve("session-1");
    showToastMock.mockReset();
    enrichAttemptsThisSession.clear();
    mockedInvoke.mockReset();
    installInvokeMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("patches only the enriched game and leaves the other game untouched", async () => {
    const alpha = makeGame({ id: "game-a", name: "Alpha" });
    const beta = makeGame({ id: "game-b", name: "Beta", description: "" });
    const gamesRef = { current: [alpha, beta] };
    const updateGame = vi.fn();
    metadataResults = [makeMeta()];

    const { result } = renderHook(() => useEnrich({ gamesRef, updateGame }));
    await act(async () => {
      await result.current.enrichGameMetadata("game-b", "Beta");
    });

    expect(updateGame).toHaveBeenCalledTimes(1);
    expect(updateGame.mock.calls[0][0]).toBe("game-b");
    expect(updateGame.mock.calls[0][1].developer).toBe("Dev");
    expect(updateGame.mock.calls.some((c) => c[0] === "game-a")).toBe(false);
    // The source array still carries the original Alpha record.
    expect(gamesRef.current[0]).toBe(alpha);
    expect(alpha.description).toBe("Description");
  });

  it("background enrichment of one game does not clobber another through GameProvider", async () => {
    loadedGames = [
      makeGame({ id: "game-a", name: "Alpha" }),
      makeGame({ id: "game-b", name: "Beta", description: "Original B" }),
    ];
    metadataResults = [makeMeta({ description: "Enriched Beta" })];

    render(
      <GameProvider>
        <Probe />
      </GameProvider>,
    );
    await flush();
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(screen.getByTestId("desc-a")).toHaveTextContent("Description");

    fireEvent.click(screen.getByText("enrich-b"));
    await flush(400);

    expect(screen.getByTestId("dev-b")).toHaveTextContent("Dev");
    expect(screen.getByTestId("desc-a")).toHaveTextContent("Description");
  });

  it("leaves both games untouched when the metadata search rejects (error path)", async () => {
    const alpha = makeGame({ id: "game-a", name: "Alpha" });
    const beta = makeGame({ id: "game-b", name: "Beta", description: "" });
    const gamesRef = { current: [alpha, beta] };
    const updateGame = vi.fn();
    metadataError = new Error("igdb down");

    const { result } = renderHook(() => useEnrich({ gamesRef, updateGame }));
    await act(async () => {
      await result.current.enrichGameMetadata("game-b", "Beta");
    });

    expect(updateGame).not.toHaveBeenCalled();
    expect(gamesRef.current[0]).toBe(alpha);
    expect(gamesRef.current[1]).toBe(beta);
  });
});
