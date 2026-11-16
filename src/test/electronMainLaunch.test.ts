import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filePathFromAssetUrl } from "../../electron/main/lib/assetPath";
import { pickWineExeArg } from "../../electron/main/features/launch/processes";
import { buildSpawnPlan } from "../../electron/main/features/launch/spawnPlan";

const isWindows = process.platform === "win32";

const tempRoot = path.join(os.tmpdir(), `gameindex-launch-test-${process.pid}`);

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("giasset path resolution", () => {
  it("keeps artwork paths absolute", () => {
    expect(
      filePathFromAssetUrl("giasset://local/%2Fhome%2Fseth%2F.config%2FGameIndex%2Fartwork%2Fg1%2Fhero.jpg"),
    ).toBe(path.normalize("/home/seth/.config/GameIndex/artwork/g1/hero.jpg"));
  });

  it("decodes spaces and Windows drive paths", () => {
    expect(filePathFromAssetUrl("giasset://local/%2Fhome%2Fa%20b%2Fcover.png")).toBe(
      path.normalize("/home/a b/cover.png"),
    );
    expect(filePathFromAssetUrl("giasset://local/C%3A%5CUsers%5Cseth%5Ccover.png")).toBe(
      path.normalize("C:\\Users\\seth\\cover.png"),
    );
  });

  it("ignores an empty path", () => {
    expect(filePathFromAssetUrl("giasset://local/")).toBeNull();
  });
});

describe("Wine argv executable detection", () => {
  it("prefers an existing host .exe over a Windows/relative argument", async () => {
    await fs.mkdir(tempRoot, { recursive: true });
    const real = path.join(tempRoot, "KSA.exe");
    await fs.writeFile(real, "MZ");

    const picked = pickWineExeArg(
      ["proton", "run", "Z:\\game\\KSA.exe", real],
      tempRoot,
    );
    expect(picked).toBe(real);
  });

  it("resolves a relative .exe against the process cwd", async () => {
    await fs.mkdir(tempRoot, { recursive: true });
    const real = path.join(tempRoot, "Game.exe");
    await fs.writeFile(real, "MZ");
    expect(pickWineExeArg(["wine", "Game.exe", "-windowed"], tempRoot)).toBe(real);
  });

  it("falls back to the last .exe argument when nothing exists on disk", () => {
    expect(
      pickWineExeArg(["proton", "run", "Z:\\game\\Explorer.exe", "Z:\\game\\Game.exe"], null),
    ).toBe("Z:\\game\\Game.exe");
    expect(pickWineExeArg(["wine", "wineserver"], null)).toBeNull();
  });
});

describe("spawn plan", () => {
  it.runIf(isWindows)("never uses verbatim mode for an executable path with spaces", () => {
    const plan = buildSpawnPlan("F:\\SteamLibrary\\beaming data\\BeamNG.Earth-1.10.1-beta.exe", null);
    expect(plan.verbatim).toBe(false);
    expect(plan.file).toContain("beaming data");
    expect(plan.args).toEqual([]);
  });

  it.runIf(isWindows)("splits arguments normally when the executable path has spaces", () => {
    const plan = buildSpawnPlan("F:\\My Games\\companion.exe", "-windowed -res 1920x1080");
    expect(plan.verbatim).toBe(false);
    expect(plan.args).toEqual(["-windowed", "-res", "1920x1080"]);
  });

  it.runIf(isWindows)("keeps the raw argument string for space-free paths", () => {
    const plan = buildSpawnPlan("C:\\games\\game.exe", '-windowed -save "C:\\my saves"');
    expect(plan.verbatim).toBe(true);
    expect(plan.args).toEqual(['-windowed -save "C:\\my saves"']);
  });

  it.runIf(isWindows)("routes a spaced .bat through cmd with verbatim quoting", () => {
    const plan = buildSpawnPlan("F:\\My Games\\start game.bat", null);
    expect(plan.file).toBe("cmd.exe");
    expect(plan.verbatim).toBe(true);
    expect(plan.args).toContain('"F:\\My Games\\start game.bat"');
  });

  it.runIf(!isWindows)("splits the argument string", () => {
    const plan = buildSpawnPlan("/games/a b/game", "-windowed -res 1920x1080");
    expect(plan.args).toEqual(["-windowed", "-res", "1920x1080"]);
  });
});
