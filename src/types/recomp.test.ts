import { describe, it, expect } from "vitest";
import { gameIsRecomp, type Game } from "./game";

function makeGame(overrides: Partial<Game> & { name: string }): Game {
  return {
    ...overrides,
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name,
    path: overrides.path ?? `C:\\Games\\${overrides.name}\\game.exe`,
    platform: overrides.platform ?? "Steam",
    installed: overrides.installed ?? true,
    playTime: overrides.playTime ?? "0h",
    addedAt: overrides.addedAt ?? 0,
  };
}

describe("gameIsRecomp", () => {
  it("reads the tri-state flag", () => {
    expect(gameIsRecomp(makeGame({ name: "Port", recomp: true }))).toBe(true);
    expect(gameIsRecomp(makeGame({ name: "Port", recomp: false }))).toBe(false);
  });

  it("treats an undecided game as not a recomp", () => {
    expect(gameIsRecomp(makeGame({ name: "Hades" }))).toBe(false);
  });

  it("does not infer from the name", () => {
    // No heuristics: a port-sounding title stays undecided until tagged.
    expect(gameIsRecomp(makeGame({ name: "Ocarina of Time Recomp" }))).toBe(false);
  });
});
