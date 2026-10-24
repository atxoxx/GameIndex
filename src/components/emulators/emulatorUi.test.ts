import { describe, expect, it } from "vitest";
import type { Emulator } from "../../types/emulator";
import type { Game } from "../../types/game";
import {
  biosBoardStatus,
  biosBoardTotals,
  computeEmulatorKpis,
  emulatorSetupSteps,
  filterAndSortRoms,
  groupMultiDiscRoms,
  isEmulatorReady,
  matchesStatusFilter,
  setupProgress,
} from "./emulatorUi";
import type { BiosBoardEntry } from "../../types/emulator";

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

describe("groupMultiDiscRoms", () => {
  const single = makeRom({ name: "Sonic", id: "single" });
  const disc1 = makeRom({ name: "FF VII Disc 1", id: "d1", romGroup: "Final Fantasy VII", romDisc: 1 });
  const disc2 = makeRom({ name: "FF VII Disc 2", id: "d2", romGroup: "Final Fantasy VII", romDisc: 2 });
  const disc3 = makeRom({ name: "FF VII Disc 3", id: "d3", romGroup: "final fantasy vii", romDisc: 3 });

  it("collapses a disc set to its first disc and keeps singles", () => {
    const grouped = groupMultiDiscRoms([single, disc2, disc1, disc3]);
    expect(grouped.games.map((g) => g.id)).toEqual(["single", "d1"]);
    expect(grouped.discCounts.d1).toBe(3);
    expect(grouped.groups.get("d1")?.map((g) => g.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("prefers an .m3u playlist as the card", () => {
    const playlist = makeRom({
      name: "Final Fantasy VII",
      id: "m3u",
      romGroup: "Final Fantasy VII",
      romPath: "C:/roms/Final Fantasy VII.m3u",
    });
    const grouped = groupMultiDiscRoms([disc1, disc2, playlist]);
    expect(grouped.games).toHaveLength(1);
    expect(grouped.games[0].id).toBe("m3u");
    expect(grouped.discCounts.m3u).toBe(3);
  });

  it("does not group two unrelated ROMs and never mutates the input", () => {
    const input = [single, makeRom({ name: "Other", id: "other" })];
    const before = [...input];
    const grouped = groupMultiDiscRoms(input);
    expect(grouped.games.map((g) => g.id)).toEqual(["single", "other"]);
    expect(Object.keys(grouped.discCounts)).toHaveLength(0);
    expect(input).toEqual(before);
  });
});
describe("biosBoardStatus / biosBoardTotals", () => {
  const entry = (over: Partial<BiosBoardEntry> = {}): BiosBoardEntry => ({
    emulatorId: "e1",
    emulatorName: "PPSSPP",
    platform: "PSP",
    ready: true,
    check: {
      platform: "PSP",
      configured: true,
      requirements: [{ name: "ppsspp.zip", found: true, mandatory: true }],
      missing: [],
    },
    ...over,
  });

  it("classifies configured+ready as ready", () => {
    expect(biosBoardStatus(entry())).toBe("ready");
  });

  it("classifies configured but incomplete as missing", () => {
    const e = entry({ ready: false });
    e.check.missing = ["dc_boot.bin"];
    expect(biosBoardStatus(e)).toBe("missing");
  });

  it("classifies no BIOS folder as unconfigured", () => {
    const e = entry();
    e.check.configured = false;
    expect(biosBoardStatus(e)).toBe("unconfigured");
  });

  it("totals each verdict", () => {
    const missingEntry = entry({ emulatorId: "e3", ready: false });
    missingEntry.check.missing = ["a.bin"];
    const unconfiguredEntry = entry({ emulatorId: "e4" });
    unconfiguredEntry.check.configured = false;
    expect(
      biosBoardTotals([entry(), entry({ emulatorId: "e2" }), missingEntry, unconfiguredEntry])
    ).toEqual({ ready: 2, missing: 1, unconfigured: 1 });
  });
});
