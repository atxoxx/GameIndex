import { describe, it, expect } from "vitest";
import { detectVr, gameIsVr, type Game } from "./game";

function makeGame(overrides: Partial<Game> & { name: string }): Game {
  return {
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name,
    path: overrides.path ?? `C:\\Games\\${overrides.name}\\game.exe`,
    platform: overrides.platform ?? "Steam",
    installed: overrides.installed ?? true,
    playTime: overrides.playTime ?? "0h",
    addedAt: overrides.addedAt ?? 0,
    ...overrides,
  };
}

describe("detectVr", () => {
  it("matches a standalone VR token in the title", () => {
    expect(detectVr(makeGame({ name: "Skyrim VR" }))).toBe(true);
    expect(detectVr(makeGame({ name: "Fallout 4 VR" }))).toBe(true);
    expect(detectVr(makeGame({ name: "VR Chat" }))).toBe(true);
  });

  it("matches Steam VR category strings carried in genres", () => {
    expect(detectVr(makeGame({ name: "Beat Saber", genres: ["VR Support"] }))).toBe(true);
    expect(detectVr(makeGame({ name: "Half-Life: Alyx", genres: ["Action", "VR Only"] }))).toBe(true);
  });

  it("ignores vr when it only appears inside an ordinary word", () => {
    expect(detectVr(makeGame({ name: "Overwatch" }))).toBe(false);
    expect(detectVr(makeGame({ name: "Vroom Racing" }))).toBe(false);
    expect(detectVr(makeGame({ name: "Elden Ring", genres: ["Action", "RPG"] }))).toBe(false);
  });
});

describe("gameIsVr", () => {
  it("prefers the persisted flag over the heuristic", () => {
    // Detection would say true from the name, but the user cleared it.
    expect(gameIsVr(makeGame({ name: "Skyrim VR", isVr: false }))).toBe(false);
    // Detection would say false, but the user (or metadata) marked it VR.
    expect(gameIsVr(makeGame({ name: "Beat Saber", isVr: true }))).toBe(true);
  });

  it("falls back to detection when no flag is set", () => {
    expect(gameIsVr(makeGame({ name: "Fallout 4 VR" }))).toBe(true);
    expect(gameIsVr(makeGame({ name: "Hades", genres: ["Roguelike"] }))).toBe(false);
  });
});
