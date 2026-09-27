import { describe, expect, it } from "vitest";
import { planGameSave } from "./savePlanner";
import type { Game } from "../../types/game";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    name: "Game One",
    path: "/games/one.exe",
    platform: "Local",
    installed: true,
    playTime: "0h",
    addedAt: 1,
    ...overrides,
  };
}

describe("planGameSave", () => {
  it("writes every row when there is no previous snapshot", () => {
    const game = makeGame();
    expect(planGameSave(null, [game])).toEqual({
      kind: "rows",
      rows: [game],
      removedIds: [],
    });
  });

  it("skips when there is no previous snapshot and nothing to write", () => {
    expect(planGameSave(null, [])).toEqual({ kind: "skip" });
  });

  it("skips when the array is unchanged by reference", () => {
    const games = [makeGame()];
    expect(planGameSave(games, games)).toEqual({ kind: "skip" });
  });

  it("skips when every row is unchanged by reference", () => {
    const games = [makeGame()];
    expect(planGameSave([...games], [...games])).toEqual({ kind: "skip" });
  });

  it("targets exactly the row whose reference changed", () => {
    const before = makeGame();
    const after = makeGame({ name: "Renamed" });
    expect(planGameSave([before], [after])).toEqual({
      kind: "rows",
      rows: [after],
      removedIds: [],
    });
  });

  it("treats a pure reorder as no work", () => {
    const a = makeGame({ id: "a" });
    const b = makeGame({ id: "b" });
    expect(planGameSave([a, b], [b, a])).toEqual({ kind: "skip" });
  });

  it("targets only the added row when the length grows", () => {
    const a = makeGame({ id: "a" });
    const b = makeGame({ id: "b" });
    expect(planGameSave([a], [a, b])).toEqual({
      kind: "rows",
      rows: [b],
      removedIds: [],
    });
  });

  it("reports removed ids when the length shrinks", () => {
    const a = makeGame({ id: "a" });
    const b = makeGame({ id: "b" });
    expect(planGameSave([a, b], [a])).toEqual({
      kind: "rows",
      rows: [],
      removedIds: ["b"],
    });
  });

  it("targets every changed row", () => {
    const before = Array.from({ length: 8 }, (_, i) => makeGame({ id: `g${i}` }));
    const after = before.map((g) => ({ ...g, name: `${g.name}!` }));
    expect(planGameSave(before, after)).toEqual({
      kind: "rows",
      rows: after,
      removedIds: [],
    });
  });
});
