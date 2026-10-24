import { describe, expect, it } from "vitest";
import type { Game } from "../../types/game";
import {
  BIG_UNPLAYED_BYTES,
  LOW_SPACE_PCT,
  MODS_BLOAT_BYTES,
  buildRecommendations,
  reclaimableBytes,
} from "./recommendations";

const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 9, 24);
const DAY = 86_400_000;

function game(overrides: Partial<Game>): Game {
  return {
    id: "g1",
    name: "Portal",
    platform: "Steam",
    installed: true,
    playTime: "0h",
    ...overrides,
  } as Game;
}

describe("buildRecommendations", () => {
  it("returns nothing for an empty, healthy library", () => {
    expect(
      buildRecommendations({ games: [], staleMap: new Map(), now: NOW }),
    ).toEqual([]);
  });

  it("surfaces broken install paths first", () => {
    const staleMap = new Map([["a", true]]);
    const recs = buildRecommendations({
      games: [
        game({ id: "a", sizeBytes: 40 * GB }),
        game({ id: "b", sizeBytes: 2 * GB, sizeDetectedAt: new Date(NOW).toISOString() }),
      ],
      staleMap,
      now: NOW,
    });

    expect(recs[0].id).toBe("stale");
    expect(recs[0].tone).toBe("danger");
    expect(recs[0].count).toBe(1);
    expect(recs[0].bytes).toBe(40 * GB);
    expect(recs[0].gameIds).toEqual(["a"]);
  });

  it("flags games that were never measured", () => {
    const recs = buildRecommendations({
      games: [game({ id: "a", sizeBytes: 0 }), game({ id: "b" })],
      staleMap: new Map(),
      now: NOW,
    });
    const unmeasured = recs.find((rec) => rec.id === "unmeasured");
    expect(unmeasured?.count).toBe(2);
    expect(unmeasured?.gameIds).toEqual(["a", "b"]);
  });

  it("only recommends large games whose last session is old", () => {
    const recs = buildRecommendations({
      games: [
        game({ id: "big-old", sizeBytes: BIG_UNPLAYED_BYTES, lastPlayed: NOW - 400 * DAY }),
        game({ id: "big-recent", sizeBytes: BIG_UNPLAYED_BYTES, lastPlayed: NOW - 10 * DAY }),
        game({ id: "small-old", sizeBytes: 3 * GB, lastPlayed: NOW - 400 * DAY }),
      ],
      staleMap: new Map(),
      now: NOW,
    });
    const rec = recs.find((entry) => entry.id === "bigUnplayed");
    expect(rec?.gameIds).toEqual(["big-old"]);
  });

  it("counts a game with no lastPlayed as unplayed", () => {
    const recs = buildRecommendations({
      games: [game({ id: "a", sizeBytes: BIG_UNPLAYED_BYTES })],
      staleMap: new Map(),
      now: NOW,
    });
    expect(recs.some((rec) => rec.id === "bigUnplayed")).toBe(true);
  });

  it("reports mods only past the bloat threshold", () => {
    const recs = buildRecommendations({
      games: [
        game({ id: "a", sizeBytes: 10 * GB, modsSizeBytes: MODS_BLOAT_BYTES - 1 }),
        game({ id: "b", sizeBytes: 10 * GB, modsSizeBytes: MODS_BLOAT_BYTES }),
      ],
      staleMap: new Map(),
      now: NOW,
    });
    expect(recs.find((rec) => rec.id === "modsBloat")?.gameIds).toEqual(["b"]);
  });

  it("flags drives below the low-space threshold", () => {
    const recs = buildRecommendations({
      games: [game({ id: "a", sizeBytes: 1 * GB })],
      staleMap: new Map(),
      driveUsage: new Map([
        ["C:", { total: 1000, available: 400 }],
        ["D:", { total: 1000, available: 10 }],
      ]),
      now: NOW,
    });
    const low = recs.find((rec) => rec.id === "lowSpace");
    expect(low?.count).toBe(1);
    expect(low?.gameIds).toEqual([]);
    expect(LOW_SPACE_PCT).toBeGreaterThan(1);
  });

  it("includes leftover folders reported by the scan", () => {
    const recs = buildRecommendations({
      games: [game({ id: "a", sizeBytes: 1 * GB })],
      staleMap: new Map(),
      leftover: { count: 3, bytes: 12 * GB },
      now: NOW,
    });
    expect(recs.find((rec) => rec.id === "leftovers")?.bytes).toBe(12 * GB);
  });

  it("orders danger before warning before info", () => {
    const recs = buildRecommendations({
      games: [
        game({ id: "stale", sizeBytes: 1 * GB }),
        game({ id: "unmeasured" }),
        game({ id: "mods", sizeBytes: 1 * GB, modsSizeBytes: MODS_BLOAT_BYTES }),
      ],
      staleMap: new Map([["stale", true]]),
      now: NOW,
    });
    const tones = recs.map((rec) => rec.tone);
    expect(tones.indexOf("warning")).toBeLessThan(tones.indexOf("info"));
    expect(reclaimableBytes(recs)).toBeGreaterThan(0);
  });
});
