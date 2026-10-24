import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SORT,
  driveOf,
  formatRelativeDay,
  libraryRoots,
  matchesStorageFilter,
  nextSort,
  parseSort,
  serializeSort,
  sortGamesByColumn,
} from "./utils";
import { publishMounts, mountPointOf, type MountUsage } from "./mounts";
import type { Game } from "../../types/game";

function mount(mountPoint: string, path = mountPoint): MountUsage {
  return {
    path,
    mountPoint,
    device: "/dev/sda1",
    fileSystem: "ext4",
    total: 100,
    free: 50,
    available: 40,
  };
}

describe("driveOf with resolved mounts", () => {
  beforeEach(() => publishMounts([]));

  it("keeps disks under the same parent distinct on Linux", () => {
    publishMounts([
      mount("/run/media/seth/diskA"),
      mount("/run/media/seth/diskB"),
    ]);

    expect(driveOf("/run/media/seth/diskA/Games/Foo")).toBe(
      "/run/media/seth/diskA"
    );
    expect(driveOf("/run/media/seth/diskB/Games/Bar")).toBe(
      "/run/media/seth/diskB"
    );
  });

  it("prefers the longest mount point when mounts nest", () => {
    publishMounts([mount("/"), mount("/home", "/home/seth/Games")]);

    expect(mountPointOf("/home/seth/Games/Foo")).toBe("/home");
    expect(mountPointOf("/opt/games/Foo")).toBe("/");
  });

  it("does not confuse sibling mount prefixes", () => {
    publishMounts([mount("/mnt/data")]);
    expect(mountPointOf("/mnt/data2/game")).toBeNull();
  });
});

describe("driveOf fallback heuristic", () => {
  beforeEach(() => publishMounts([]));

  it("extracts each removable volume on Linux", () => {
    expect(driveOf("/run/media/seth/disk1/Games/Foo")).toBe(
      "/run/media/seth/disk1"
    );
    expect(driveOf("/media/seth/disk2/Games/Foo")).toBe("/media/seth/disk2");
    expect(driveOf("/mnt/data/Games/Foo")).toBe("/mnt/data");
    expect(driveOf("/Volumes/GameDisk/Foo")).toBe("/Volumes/GameDisk");
  });

  it("keeps Windows drive letters", () => {
    expect(driveOf("C:\\Games\\Foo\\bin.exe")).toBe("C:");
    expect(driveOf("d:/steam/foo")).toBe("D:");
  });

  it("returns Unknown for missing paths", () => {
    expect(driveOf(undefined)).toBe("Unknown");
    expect(driveOf("")).toBe("Unknown");
  });
});

const GB = 1024 ** 3;

function game(overrides: Partial<Game>): Game {
  return {
    id: "g",
    name: "Game",
    platform: "Steam",
    installed: true,
    playTime: "0h",
    ...overrides,
  } as Game;
}

describe("table sorting", () => {
  const games = [
    game({ id: "small", name: "Aaa", sizeBytes: 2 * GB }),
    game({ id: "big", name: "Zzz", sizeBytes: 60 * GB }),
    game({ id: "none", name: "Mmm" }),
  ];

  it("sorts by size descending by default", () => {
    expect(sortGamesByColumn(games, DEFAULT_SORT).map((g) => g.id)).toEqual([
      "big",
      "small",
      "none",
    ]);
  });

  it("keeps unmeasured games last even ascending", () => {
    const order = sortGamesByColumn(games, { column: "size", direction: "asc" }).map((g) => g.id);
    expect(order).toEqual(["small", "big", "none"]);
  });

  it("toggles direction when the same column is clicked twice", () => {
    const once = nextSort(DEFAULT_SORT, "size");
    expect(once).toEqual({ column: "size", direction: "asc" });
    const twice = nextSort(once, "size");
    expect(twice).toEqual({ column: "size", direction: "desc" });
  });

  it("starts a new text column ascending", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("round-trips through persistence values", () => {
    expect(parseSort(serializeSort({ column: "mods", direction: "asc" }))).toEqual({
      column: "mods",
      direction: "asc",
    });
  });

  it("falls back to the default for junk", () => {
    expect(parseSort("nonsense")).toEqual(DEFAULT_SORT);
    expect(parseSort(null)).toEqual(DEFAULT_SORT);
    expect(parseSort("size:sideways")).toEqual(DEFAULT_SORT);
  });
});

describe("matchesStorageFilter", () => {
  const measured = game({ sizeBytes: 60 * GB, modsSizeBytes: GB });

  it("matches every game for the all filter", () => {
    expect(matchesStorageFilter(measured, "all", true)).toBe(true);
  });

  it("separates sized from missing", () => {
    expect(matchesStorageFilter(measured, "sized", false)).toBe(true);
    expect(matchesStorageFilter(measured, "missing", false)).toBe(false);
    expect(matchesStorageFilter(game({}), "missing", false)).toBe(true);
  });

  it("reads staleness from the caller", () => {
    expect(matchesStorageFilter(measured, "stale", true)).toBe(true);
    expect(matchesStorageFilter(measured, "stale", false)).toBe(false);
  });
});

describe("libraryRoots", () => {
  it("ignores a lone game in a bare drive root", () => {
    const roots = libraryRoots([game({ sizeRootPath: "C:\\Program Files\\Solo" })]);
    expect(roots).toEqual([]);
  });

  it("keeps a folder that holds several installs", () => {
    const roots = libraryRoots([
      game({ id: "a", sizeRootPath: "D:\\Games\\Alpha" }),
      game({ id: "b", sizeRootPath: "D:\\Games\\Beta" }),
    ]);
    expect(roots).toEqual(["D:/Games"]);
  });

  it("keeps a folder whose name reads like a library", () => {
    const roots = libraryRoots([game({ sizeRootPath: "E:\\SteamLibrary\\steamapps\\common\\Solo" })]);
    expect(roots).toEqual(["E:/SteamLibrary/steamapps/common"]);
  });

  it("ignores games that are not installed", () => {
    const roots = libraryRoots([
      game({ id: "a", installed: false, sizeRootPath: "D:\\Games\\Alpha" }),
      game({ id: "b", installed: false, sizeRootPath: "D:\\Games\\Beta" }),
    ]);
    expect(roots).toEqual([]);
  });
});

describe("formatRelativeDay", () => {
  const now = Date.UTC(2026, 9, 24);

  it("falls back for an empty value", () => {
    expect(formatRelativeDay(undefined, "Never", now)).toBe("Never");
    expect(formatRelativeDay("nope", "Never", now)).toBe("Never");
  });

  it("formats recent and old timestamps", () => {
    expect(formatRelativeDay(now - 3 * 86_400_000, "Never", now, "en")).toBe("3 days ago");
    expect(formatRelativeDay(now - 400 * 86_400_000, "Never", now, "en")).toContain("year");
  });
});
