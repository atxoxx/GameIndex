import { describe, it, expect } from "vitest";
import {
  slugify,
  parsePlayTime,
  formatPlayTime,
  formatSize,
  addSessionTime,
  gameNameFromPath,
  extractSteamAppId,
  extractSteamAppIdFromWebsites,
  resolveSteamAppId,
  dedupeGamesById,
} from "../types/game";

describe("dedupeGamesById", () => {
  it("keeps the first record for repeated library ids", () => {
    const first = { id: "epic-ns-wwz", name: "World War Z", path: "", platform: "Epic", installed: false, playTime: "0h", addedAt: 1 };
    const duplicate = { ...first, coverArtUrl: "duplicate-art" };
    const other = { ...first, id: "epic-ns-other", name: "Other Game" };

    expect(dedupeGamesById([first, duplicate, other])).toEqual([first, other]);
  });

  it("does not merge different game ids with the same title", () => {
    const base = { name: "World War Z", path: "", platform: "Epic", installed: false, playTime: "0h", addedAt: 1 };
    const one = { ...base, id: "epic-ns-one" };
    const two = { ...base, id: "epic-ns-two" };

    expect(dedupeGamesById([one, two])).toHaveLength(2);
  });
});

describe("slugify", () => {
  it("creates kebab slug", () => {
    expect(slugify("Elden Ring")).toBe("elden-ring");
  });
  it("handles special chars", () => {
    expect(slugify("Hades™")).toBe("hades");
    expect(slugify("A & B")).toBe("a-and-b");
  });
  it("returns empty for empty", () => {
    expect(slugify("")).toBe("");
  });
});

describe("parsePlayTime / formatPlayTime / addSessionTime", () => {
  it("parses hours and minutes", () => {
    expect(parsePlayTime("2h 30m")).toBe(150);
    expect(parsePlayTime("45m")).toBe(45);
    expect(parsePlayTime("10h")).toBe(600);
    expect(parsePlayTime("0h")).toBe(0);
  });
  it("formats minutes", () => {
    expect(formatPlayTime(150)).toBe("2h 30m");
    expect(formatPlayTime(45)).toBe("45m");
    expect(formatPlayTime(60)).toBe("1h");
    expect(formatPlayTime(0)).toBe("0h");
  });
  it("adds session time", () => {
    expect(addSessionTime("1h", 1800)).toBe("1h 30m"); // 30 min
    expect(addSessionTime("0h", 3600)).toBe("1h");
  });
});

describe("formatSize", () => {
  it("formats GB", () => {
    expect(formatSize(1_000_000_000, "gb")).toBe("1.0 GB");
    expect(formatSize(1_500_000_000, "gb")).toBe("1.5 GB");
  });
  it("formats GiB", () => {
    expect(formatSize(1_073_741_824, "gib")).toBe("1.0 GiB");
  });
  it("handles zero / null", () => {
    expect(formatSize(0, "gb")).toBe("0.0 GB");
    expect(formatSize(null, "gb")).toBe("0.0 GB");
    expect(formatSize(undefined, "gib")).toBe("0.0 GiB");
  });
});

describe("gameNameFromPath / extractSteamAppId", () => {
  it("extracts name from path", () => {
    expect(gameNameFromPath("C:\\Games\\EldenRing\\eldenring.exe")).toBe("eldenring");
    expect(gameNameFromPath("/usr/games/hades")).toBe("hades");
  });
  it("extracts steam app id", () => {
    expect(extractSteamAppId("steam://run/12345")).toBe(12345);
    expect(extractSteamAppId("C:\\games\\fake\\12345\\game.exe")).toBeNull();
    expect(extractSteamAppId("")).toBeNull();
  });
  it("extracts from websites", () => {
    expect(extractSteamAppIdFromWebsites(["https://store.steampowered.com/app/570/Dota_2/"])).toBe(570);
    expect(extractSteamAppIdFromWebsites(["https://example.com"])).toBeNull();
    expect(extractSteamAppIdFromWebsites(null)).toBeNull();
  });
  it("resolveSteamAppId prefers steamAppId", () => {
    const game = {
      id: "1",
      name: "Test",
      path: "steam://run/999",
      platform: "Steam",
      installed: true,
      playTime: "0h",
      addedAt: 0,
      steamAppId: 123,
      websites: ["https://store.steampowered.com/app/456/"],
    } as unknown as import("../types/game").Game;
    expect(resolveSteamAppId(game)).toBe(123);
  });
});
