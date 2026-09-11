import { describe, expect, it, vi } from "vitest";
import type { SplashRecord } from "../context/SplashContext";
import type { Game } from "../types/game";
import { mergeSplashRecord, type LaunchSplashState } from "./LaunchSplashWindow";

const game: Game = {
  id: "game-1",
  name: "Half-Life",
  path: "C:\\Games\\hl.exe",
  platform: "Steam",
  installed: true,
  playTime: "10h",
  addedAt: 0,
};

function snapshot(overrides: Partial<LaunchSplashState> = {}): LaunchSplashState {
  return {
    gameId: "game-1",
    status: "launching",
    errorMessage: null,
    startedAt: 1000,
    payload: game,
    ...overrides,
  };
}

function record(overrides: Partial<SplashRecord> = {}): SplashRecord {
  return {
    game,
    status: "launching",
    startedAt: 1000,
    launchStep: 0,
    errorMessage: null,
    ...overrides,
  };
}

describe("mergeSplashRecord", () => {
  it("builds a fresh record from the initial snapshot (happy path)", () => {
    const retry = vi.fn();
    const merged = mergeSplashRecord(null, snapshot(), retry);

    expect(merged.game).toBe(game);
    expect(merged.status).toBe("launching");
    expect(merged.startedAt).toBe(1000);
    expect(merged.launchStep).toBe(0);
    expect(merged.errorMessage).toBeNull();
    expect(merged.retry).toBeUndefined();
  });

  it("keeps the animated step and exposes retry on a same-launch error", () => {
    const retry = vi.fn();
    const merged = mergeSplashRecord(
      record({ launchStep: 3 }),
      snapshot({ status: "error", errorMessage: "boom" }),
      retry
    );

    expect(merged.status).toBe("error");
    expect(merged.errorMessage).toBe("boom");
    expect(merged.launchStep).toBe(3);
    expect(merged.retry).toBe(retry);
  });

  it("does not rewind a finished splash when a stale snapshot arrives (error path)", () => {
    const prev = record({ status: "started" });
    const merged = mergeSplashRecord(prev, snapshot({ status: "launching" }), vi.fn());
    expect(merged).toBe(prev);

    const staleFetch = mergeSplashRecord(prev, snapshot({ startedAt: 500 }), vi.fn());
    expect(staleFetch).toBe(prev);
  });

  it("resets the step sequence for a new launch", () => {
    const merged = mergeSplashRecord(
      record({ startedAt: 1000, launchStep: 5, status: "started" }),
      snapshot({ startedAt: 2000 }),
      vi.fn()
    );

    expect(merged.startedAt).toBe(2000);
    expect(merged.launchStep).toBe(0);
    expect(merged.status).toBe("launching");
    expect(merged.retry).toBeUndefined();
  });
});
