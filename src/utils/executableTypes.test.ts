import { describe, it, expect } from "vitest";
import {
  hasExecutableExtension,
  stripExecutableExtension,
} from "./executableTypes";

describe("hasExecutableExtension", () => {
  it("accepts native binaries and launch scripts", () => {
    for (const name of [
      "game.exe",
      "start.bat",
      "launch.cmd",
      "old.com",
      "run.ps1",
      "run.sh",
      "Game.AppImage",
      "game.x86_64",
    ]) {
      expect(hasExecutableExtension(name)).toBe(true);
    }
  });

  it("rejects non-program files", () => {
    expect(hasExecutableExtension("cover.png")).toBe(false);
    expect(hasExecutableExtension("data.zip")).toBe(false);
    expect(hasExecutableExtension("GameFolder")).toBe(false);
    expect(hasExecutableExtension(".hidden")).toBe(false);
  });
});

describe("stripExecutableExtension", () => {
  it("removes a known program extension", () => {
    expect(stripExecutableExtension("game.exe")).toBe("game");
    expect(stripExecutableExtension("start.bat")).toBe("start");
    expect(stripExecutableExtension("launch.ps1")).toBe("launch");
    expect(stripExecutableExtension("Game.AppImage")).toBe("Game");
  });

  it("keeps names without a program extension intact", () => {
    expect(stripExecutableExtension("game.v1.2")).toBe("game.v1.2");
    expect(stripExecutableExtension("Hades")).toBe("Hades");
  });
});
