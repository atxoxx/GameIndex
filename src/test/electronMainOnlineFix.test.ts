import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  detectOnlineFix,
  readOnlineFixAppId,
} from "../../electron/main/features/compatibility/onlineFix";

const root = path.join(os.tmpdir(), `gameindex-onlinefix-${process.pid}`);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(relative: string, content = "x"): Promise<string> {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return file;
}

describe("Online-Fix / FreeTP detection", () => {
  it("detects an Online-Fix layout and reads steam_appid.txt", async () => {
    const exe = await write("Game/Game.exe", "MZ");
    await write("Game/steam_appid.txt", "2420110\n");
    await write("Game/winmm.dll", "MZ");
    await write("Game/steam_api64.dll", "MZ");

    const info = detectOnlineFix(exe);
    expect(info.detected).toBe(true);
    expect(info.appId).toBe(2420110);
    expect(info.markers).toEqual(expect.arrayContaining(["steam_appid.txt", "winmm.dll"]));
  });

  it("detects FreeTP/Goldberg steam_settings in a parent folder", async () => {
    const exe = await write("Game/Binaries/Win64/Game.exe", "MZ");
    await write("Game/steam_settings/configs.app.ini", "x");
    await write("Game/Binaries/Win64/steam_api64.dll", "MZ");

    const info = detectOnlineFix(exe);
    expect(info.detected).toBe(true);
    expect(info.markers).toContain("steam_settings");
  });

  it("does not flag a normal Steam game that only ships steam_api64.dll", async () => {
    const exe = await write("Normal/Normal.exe", "MZ");
    await write("Normal/steam_api64.dll", "MZ");
    expect(detectOnlineFix(exe).detected).toBe(false);
  });

  it("returns no AppID when steam_appid.txt is absent or malformed", async () => {
    const exe = await write("NoApp/NoApp.exe", "MZ");
    await write("NoApp/steam_appid.txt", "not-an-id");
    expect(readOnlineFixAppId(exe)).toBeNull();
    expect(detectOnlineFix(exe).appId).toBeNull();
  });
});
