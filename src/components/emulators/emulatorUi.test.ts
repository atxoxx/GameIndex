import { describe, expect, it } from "vitest";
import type { Emulator } from "../../types/emulator";
import type { Game } from "../../types/game";
import {
  computeEmulatorKpis,
  emulatorSetupSteps,
  filterAndSortRoms,
  isEmulatorReady,
  matchesStatusFilter,
  setupProgress,
} from "./emulatorUi";

function makeEmulator(overrides: Partial<Emulator> = {}): Emulator {
  return {
    id: "emu-1",
    name: "Dolphin",
    platform: "GameCube",
    executablePath: "/usr/bin/dolphin-emu",
    argumentsTemplate: '"%ROM%"',
    romFolder: "/home/user/ROMs",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeRom(overrides: Partial<Game> & { name: string }): Game {
  const base: Game = {
    id: overrides.id ?? `id-${overrides.name}`,
    name: overrides.name,
    path: `C:\\roms\\${overrides.name}.iso`,
    platform: overrides.platform ?? "GameCube",
    installed: true,
    playTime: overrides.playTime ?? "0h",
    addedAt: overrides.addedAt ?? 0,
  };
  return { ...base, ...overrides };
}

describe("isEmulatorReady", () => {
  it("is ready when executable and ROM folder are set", () => {
    expect(isEmulatorReady(makeEmulator())).toBe(true);
  });

  it("is not ready when the executable is missing", () => {
    expect(isEmulatorReady(makeEmulator({ executablePath: "" }))).toBe(false);
  });

  it("is not ready when the ROM folder is blank", () => {
    expect(isEmulatorReady(makeEmulator({ romFolder: "   " }))).toBe(false);
  });
});

describe("matchesStatusFilter", () => {
  const ready = makeEmulator({ id: "ready" });
  const pending = makeEmulator({ id: "pending", romFolder: "" });

  it("matches all, ready and needsSetup appropriately", () => {
    expect(matchesStatusFilter(ready, "all")).toBe(true);
    expect(matchesStatusFilter(pending, "all")).toBe(true);
    expect(matchesStatusFilter(ready, "ready")).toBe(true);
    expect(matchesStatusFilter(pending, "ready")).toBe(false);
    expect(matchesStatusFilter(pending, "needsSetup")).toBe(true);
    expect(matchesStatusFilter(ready, "needsSetup")).toBe(false);
  });
});

describe("emulatorSetupSteps / setupProgress", () => {
  it("marks executable and ROM folder, scan only with ROMs", () => {
    const steps = emulatorSetupSteps(makeEmulator(), 0);
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["executable", true],
      ["romFolder", true],
      ["scan", false],
    ]);
    expect(setupProgress(steps)).toEqual({ done: 2, total: 3 });
  });

  it("reports a fully configured emulator as complete", () => {
    const steps = emulatorSetupSteps(makeEmulator(), 12);
    expect(setupProgress(steps)).toEqual({ done: 3, total: 3 });
  });

  it("flags every step for an empty emulator", () => {
    const steps = emulatorSetupSteps(
      makeEmulator({ executablePath: "", romFolder: "" }),
      0
    );
    expect(setupProgress(steps)).toEqual({ done: 0, total: 3 });
  });
});

describe("computeEmulatorKpis", () => {
  it("counts systems, ready emulators and games", () => {
    const emulators = [
      makeEmulator({ id: "a" }),
      makeEmulator({ id: "b", executablePath: "" }),
    ];
    const kpis = computeEmulatorKpis(emulators, { a: 4, b: 2 }, 1024);
    expect(kpis).toEqual({
      systems: 2,
      ready: 1,
      games: 6,
      totalSizeBytes: 1024,
    });
  });
});

describe("filterAndSortRoms", () => {
  const games: Game[] = [
    makeRom({ name: "Zelda", sizeBytes: 300, playTime: "12h", addedAt: 2, favorite: true, romRegion: "USA" }),
    makeRom({ name: "Mario", sizeBytes: 100, playTime: "not-a-number", addedAt: 1, romRegion: "EUR", romLanguage: "En" }),
    makeRom({ name: "Metroid", sizeBytes: 200, playTime: "5h", addedAt: 3 }),
  ];

  it("filters by search and never mutates the input", () => {
    const original = [...games];
    const result = filterAndSortRoms(games, { search: "m" }, "name", "asc");
    expect(result.map((g) => g.name)).toEqual(["Mario", "Metroid"]);
    expect(games).toEqual(original);
  });

  it("filters by favorites, region and language", () => {
    expect(
      filterAndSortRoms(games, { favoritesOnly: true }, "name", "asc").map(
        (g) => g.name
      )
    ).toEqual(["Zelda"]);
    expect(
      filterAndSortRoms(games, { region: "EUR" }, "name", "asc").map(
        (g) => g.name
      )
    ).toEqual(["Mario"]);
    expect(
      filterAndSortRoms(games, { language: "En" }, "name", "asc").map(
        (g) => g.name
      )
    ).toEqual(["Mario"]);
  });

  it("sorts by name ascending and descending", () => {
    expect(
      filterAndSortRoms(games, {}, "name", "asc").map((g) => g.name)
    ).toEqual(["Mario", "Metroid", "Zelda"]);
    expect(
      filterAndSortRoms(games, {}, "name", "desc").map((g) => g.name)
    ).toEqual(["Zelda", "Metroid", "Mario"]);
  });

  it("sorts by size and date added", () => {
    expect(
      filterAndSortRoms(games, {}, "size", "asc").map((g) => g.name)
    ).toEqual(["Mario", "Metroid", "Zelda"]);
    expect(
      filterAndSortRoms(games, {}, "dateAdded", "desc").map((g) => g.name)
    ).toEqual(["Metroid", "Zelda", "Mario"]);
  });

  it("treats an unparseable playtime as zero", () => {
    const result = filterAndSortRoms(games, {}, "playtime", "asc");
    expect(result[0].name).toBe("Mario");
    expect(result[result.length - 1].name).toBe("Zelda");
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterAndSortRoms(games, { search: "nope" }, "name", "asc")).toEqual(
      []
    );
  });
});
