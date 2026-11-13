import { describe, expect, it } from "vitest";
import {
  deriveSteamAppId,
  mergeSteamLaunchOptions,
  quoteLaunchEnvValue,
  readSteamLaunchOptions,
  setSteamLaunchOptions,
} from "../../electron/main/features/compatibility/steamConfig";

const VDF = `"UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"2420110"
					{
						"LaunchOptions"		"-dx11 %command% -fullscreen"
					}
				}
			}
		}
	}
}
`;

describe("Steam AppID derivation", () => {
  it("reads legacy ids and steam:// paths", () => {
    expect(deriveSteamAppId("steam-2420110", "")).toBe(2420110);
    expect(deriveSteamAppId("steam:2420110", "")).toBe(2420110);
    expect(deriveSteamAppId("game-1", "steam://run/2420110")).toBe(2420110);
    expect(deriveSteamAppId("game-1", "steam://launch/42/dialog")).toBe(42);
    expect(deriveSteamAppId("game-1", "/games/Game.exe")).toBeNull();
  });
});

describe("Steam localconfig launch options", () => {
  it("reads and replaces only the app's LaunchOptions value", () => {
    expect(readSteamLaunchOptions(VDF, 2420110)).toBe("-dx11 %command% -fullscreen");
    const updated = setSteamLaunchOptions(VDF, 2420110, 'WINEDEBUG=-all %command% -windowed');
    expect(updated).not.toBeNull();
    expect(readSteamLaunchOptions(updated ?? "", 2420110)).toBe(
      "WINEDEBUG=-all %command% -windowed",
    );
    expect(updated).toContain('"apps"');
    expect(updated).toContain('"Steam"');
  });

  it("inserts an app entry / LaunchOptions when missing", () => {
    const noOptions = VDF.replace('\t\t\t\t\t\t"LaunchOptions"\t\t"-dx11 %command% -fullscreen"\n', "");
    const inserted = setSteamLaunchOptions(noOptions, 2420110, "KEY=value %command% --arg");
    expect(readSteamLaunchOptions(inserted ?? "", 2420110)).toBe("KEY=value %command% --arg");

    const another = setSteamLaunchOptions(VDF, 108600, "FOO=bar %command%");
    expect(readSteamLaunchOptions(another ?? "", 108600)).toBe("FOO=bar %command%");
    // Existing app remains untouched.
    expect(readSteamLaunchOptions(another ?? "", 2420110)).toBe(
      "-dx11 %command% -fullscreen",
    );
  });

  it("returns null when the value is unchanged or the layout is missing", () => {
    expect(setSteamLaunchOptions(VDF, 2420110, "-dx11 %command% -fullscreen")).toBeNull();
    expect(setSteamLaunchOptions("not a config", 1, "x")).toBeNull();
  });
});

describe("Steam launch option merging", () => {
  it("keeps the user's post-command arguments and replaces the managed prefix", () => {
    expect(
      mergeSteamLaunchOptions(
        "OLD=1 %command% -fullscreen -novid",
        "OLD=1",
        "WINEDEBUG=-all DXVK_HUD=fps",
      ),
    ).toBe("WINEDEBUG=-all DXVK_HUD=fps %command% -fullscreen -novid");
  });

  it("strips the managed prefix when settings return to defaults", () => {
    expect(
      mergeSteamLaunchOptions("OLD=1 %command% -windowed", "OLD=1", ""),
    ).toBe("-windowed");
  });

  it("quotes only values Steam's parser cannot take bare", () => {
    expect(quoteLaunchEnvValue("WINEDEBUG=-all")).toBe("WINEDEBUG=-all");
    expect(quoteLaunchEnvValue("/home/seth/My Games")).toBe("'/home/seth/My Games'");
    expect(quoteLaunchEnvValue("it's")).toBe("'it'\\''s'");
  });
});
