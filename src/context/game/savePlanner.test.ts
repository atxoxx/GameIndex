import { describe, expect, it } from "vitest";
import { MAX_TARGETED_ROWS, planGameSave } from "./savePlanner";
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
  it("returns full when there is no previous snapshot", () => {
    expect(planGameSave(null, [makeGame()])).toEqual({ kind: "full" });
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
    expect(planGameSave([before], [after])).toEqual({ kind: "rows", rows: [after] });
  });

  it("returns full on an identity shift at a changed index", () => {
    const a = makeGame({ id: "a" });
    const b = makeGame({ id: "b" });
    expect(planGameSave([a, b], [b, a])).toEqual({ kind: "full" });
  });

  it("returns full when the length changes", () => {
    const a = makeGame({ id: "a" });
    const b = makeGame({ id: "b" });
    expect(planGameSave([a], [a, b])).toEqual({ kind: "full" });
  });

  it("returns full when more than the targeted limit changed", () => {
    const before = Array.from({ length: MAX_TARGETED_ROWS + 1 }, (_, i) =>
      makeGame({ id: `g${i}` })
    );
    const after = before.map((g) => ({ ...g, name: `${g.name}!` }));
    expect(planGameSave(before, after)).toEqual({ kind: "full" });
  });

  it("targets every changed row when at the limit", () => {
    const before = Array.from({ length: MAX_TARGETED_ROWS }, (_, i) =>
      makeGame({ id: `g${i}` })
    );
    const after = before.map((g) => ({ ...g, name: `${g.name}!` }));
    expect(planGameSave(before, after)).toEqual({ kind: "rows", rows: after });
  });
});
