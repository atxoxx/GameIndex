import { describe, expect, it } from "vitest";
import {
  capHistory,
  pendingFlush,
  saveableSnapshot,
  type OverlaySample,
} from "./overlayHistory";

const samples: OverlaySample[] = [{ fps: 60 }, { fps: 59 }, { fps: 61 }];

describe("pendingFlush", () => {
  it("flushes the previous game's window when the session moves on", () => {
    const flush = pendingFlush("game-a", "game-b", samples);
    expect(flush).toEqual({ gameId: "game-a", samples });
  });

  it("never flushes the active game's own samples", () => {
    expect(pendingFlush("game-a", "game-a", samples)).toBeNull();
  });

  it("does nothing while there is no owner yet", () => {
    expect(pendingFlush(null, "game-a", samples)).toBeNull();
    expect(pendingFlush(null, null, samples)).toBeNull();
  });

  it("wraps up when the session idles out without samples", () => {
    // The window was already cleared; a flush would just rewrite nothing.
    expect(pendingFlush("game-a", null, [])).toBeNull();
  });
});

describe("saveableSnapshot", () => {
  it("persists a window owned by the active game", () => {
    expect(saveableSnapshot("game-a", "game-a", samples)).toEqual({
      gameId: "game-a",
      samples,
    });
  });

  it("refuses to relabel a stale window under the new game", () => {
    // This is the bug the ownership rule exists for: samples arriving in the
    // same commit as the session switch must not be written as game-b data.
    expect(saveableSnapshot("game-a", "game-b", samples)).toBeNull();
  });

  it("refuses to persist while idle or empty", () => {
    expect(saveableSnapshot(null, null, samples)).toBeNull();
    expect(saveableSnapshot("game-a", "game-a", [])).toBeNull();
  });
});

describe("capHistory", () => {
  it("keeps the newest samples once the window overflows", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ i }));
    const capped = capHistory(many, 60);
    expect(capped).toHaveLength(60);
    expect(capped[0]).toEqual({ i: 10 });
  });

  it("leaves a short window untouched", () => {
    expect(capHistory(samples, 60)).toBe(samples);
  });
});
