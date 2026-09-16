import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "../../types/game";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "steam-1",
    name: "Game One",
    path: "/games/one.exe",
    platform: "Steam",
    installed: true,
    playTime: "0h",
    addedAt: 1,
    steamAppId: 1,
    ...overrides,
  };
}

/** Reset the module-level fingerprint cache so each test starts clean. */
async function loadSync() {
  vi.resetModules();
  const { syncWatcherIndex } = await import("./watcherIndexSync");
  return syncWatcherIndex;
}

describe("syncWatcherIndex", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("pushes the index on the first call and skips an identical repeat", async () => {
    const syncWatcherIndex = await loadSync();
    const games = [makeGame()];

    syncWatcherIndex(games);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("rebuild_watcher_index", {
      games: expect.any(Array),
    });

    syncWatcherIndex(games);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("re-pushes when an exe path changes", async () => {
    const syncWatcherIndex = await loadSync();
    syncWatcherIndex([makeGame()]);
    syncWatcherIndex([makeGame({ path: "/games/one-moved.exe" })]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("re-pushes when a steam app id changes", async () => {
    const syncWatcherIndex = await loadSync();
    syncWatcherIndex([makeGame()]);
    syncWatcherIndex([makeGame({ steamAppId: 2 })]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("re-pushes when the game set changes", async () => {
    const syncWatcherIndex = await loadSync();
    syncWatcherIndex([makeGame()]);
    syncWatcherIndex([makeGame(), makeGame({ id: "steam-2", name: "Game Two" })]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("retries a rejected push on the next call", async () => {
    invokeMock.mockRejectedValueOnce(new Error("backend down"));
    const syncWatcherIndex = await loadSync();
    const games = [makeGame()];

    syncWatcherIndex(games);
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // The failure cleared the cached fingerprint, so the same refs must be
    // pushed again rather than deduped into a permanently stale Rust index.
    syncWatcherIndex(games);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("dedupes an unchanged fingerprint after a successful push", async () => {
    const syncWatcherIndex = await loadSync();
    const games = [makeGame()];

    syncWatcherIndex(games);
    await Promise.resolve();
    syncWatcherIndex(games);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
