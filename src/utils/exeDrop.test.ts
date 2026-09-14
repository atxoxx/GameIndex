import { describe, it, expect } from "vitest";
import {
  commonParentDir,
  isImportableExecutablePath,
  parentDirOf,
} from "./exeDrop";

describe("isImportableExecutablePath", () => {
  it("accepts game executables regardless of extension casing", () => {
    expect(isImportableExecutablePath("C:\\Games\\Foo\\foo.exe")).toBe(true);
    expect(isImportableExecutablePath("C:\\Games\\Foo\\FOO.EXE")).toBe(true);
    expect(isImportableExecutablePath("/home/u/games/foo.exe")).toBe(true);
    expect(isImportableExecutablePath("/home/u/games/run.bat")).toBe(true);
    expect(isImportableExecutablePath("/home/u/games/launch.sh")).toBe(true);
    expect(isImportableExecutablePath("/home/u/App/Game.AppImage")).toBe(true);
    expect(isImportableExecutablePath("/home/u/games/game.x86_64")).toBe(true);
  });

  it("rejects archives, artwork, folders and extension-less binaries", () => {
    expect(isImportableExecutablePath("/home/u/games/pack.zip")).toBe(false);
    expect(isImportableExecutablePath("/home/u/games/cover.png")).toBe(false);
    expect(isImportableExecutablePath("/home/u/games/GameFolder")).toBe(false);
    expect(isImportableExecutablePath("/home/u/games/.hidden")).toBe(false);
  });
});

describe("parentDirOf", () => {
  it("strips the file name from Windows paths", () => {
    expect(parentDirOf("C:\\Games\\Foo\\foo.exe")).toBe("C:\\Games\\Foo");
  });

  it("strips the file name from POSIX paths and keeps the root", () => {
    expect(parentDirOf("/home/u/games/foo.exe")).toBe("/home/u/games");
    expect(parentDirOf("/foo.exe")).toBe("/");
  });
});

describe("commonParentDir", () => {
  it("returns the containing folder for a single file", () => {
    expect(commonParentDir(["C:\\Games\\Foo\\foo.exe"])).toBe("C:\\Games\\Foo");
    expect(commonParentDir(["/home/u/games/foo.exe"])).toBe("/home/u/games");
  });

  it("returns the shared root of executables from different game folders", () => {
    expect(
      commonParentDir(["C:\\Games\\Foo\\foo.exe", "C:\\Games\\Bar\\bar.exe"])
    ).toBe("C:\\Games");
    expect(
      commonParentDir(["/home/u/games/foo/foo.exe", "/home/u/games/bar/bar.exe"])
    ).toBe("/home/u/games");
  });

  it("returns an empty root when paths share nothing", () => {
    expect(commonParentDir(["C:\\Foo\\foo.exe", "D:\\Bar\\bar.exe"])).toBe("");
    expect(commonParentDir([])).toBe("");
  });
});
