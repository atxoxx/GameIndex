import { describe, expect, it } from "vitest";
import type { Mo2Instance } from "../types/mo2";
import {
  mergeMo2Instances,
  resolveMo2Selection,
  selectMo2Instance,
} from "./mo2Selection";

function instance(overrides: Partial<Mo2Instance> = {}): Mo2Instance {
  return {
    id: "mo2-test",
    name: "Test Instance",
    instancePath: "C:/MO2/Test",
    isPortable: true,
    modsDir: "C:/MO2/Test/mods",
    profilesDir: "C:/MO2/Test/profiles",
    overwriteDir: "C:/MO2/Test/overwrite",
    selectedProfile: "Default",
    profiles: ["Default", "Hardcore"],
    customExecutables: [],
    relevance: 0,
    ...overrides,
  };
}

describe("selectMo2Instance", () => {
  it("prefers the saved instance path regardless of casing", () => {
    const wanted = instance({ instancePath: "C:/MO2/Skyrim", relevance: 0 });
    const relevant = instance({ instancePath: "C:/MO2/Other", relevance: 100 });

    expect(selectMo2Instance([relevant, wanted], "c:/mo2/skyrim")).toBe(wanted);
  });

  it("falls back to the most relevant instance", () => {
    const unrelated = instance({ instancePath: "C:/MO2/Unrelated" });
    const relevant = instance({ instancePath: "C:/MO2/Skyrim", relevance: 80 });

    expect(selectMo2Instance([unrelated, relevant])).toBe(relevant);
  });

  it("refuses an unrelated-only list unless a fallback is allowed", () => {
    const unrelated = instance();

    expect(selectMo2Instance([unrelated])).toBeNull();
    expect(
      selectMo2Instance([unrelated], null, { allowUnrelatedFallback: true })
    ).toBe(unrelated);
  });
});

describe("resolveMo2Selection", () => {
  it("never adopts another instance's profile or executable", () => {
    const target = instance({
      profiles: ["Default", "Survival"],
      selectedProfile: "Default",
      customExecutables: [{ title: "Fallout4", path: "C:/Games/Fallout4/Fallout4.exe" }],
    });

    const selection = resolveMo2Selection([target], {
      instancePath: target.instancePath,
      profile: "Only-On-Other-Instance",
      executable: "OtherGame.exe",
      gamePath: "C:/Games/Fallout4/Fallout4.exe",
    });

    expect(selection).not.toBeNull();
    expect(selection?.profile).toBe("Default");
    expect(selection?.executable).toBe("Fallout4");
  });

  it("keeps a path-shaped executable that is not registered in MO2", () => {
    const target = instance();
    const selection = resolveMo2Selection([target], {
      instancePath: target.instancePath,
      executable: "D:/Games/Game/bin/game.exe",
    });

    expect(selection?.executable).toBe("D:/Games/Game/bin/game.exe");
  });

  it("matches a custom executable by the game's exe file name", () => {
    const target = instance({
      customExecutables: [
        { title: "LOOT", path: "C:/MO2/Tools/LOOT.exe" },
        { title: "SKSE", path: "C:/Games/Skyrim/skse64_loader.exe" },
      ],
    });

    const selection = resolveMo2Selection([target], {
      instancePath: target.instancePath,
      gamePath: "C:/Games/Skyrim/skse64_loader.exe",
    });

    expect(selection?.executable).toBe("SKSE");
  });

  it("returns null when nothing relates to the game", () => {
    expect(
      resolveMo2Selection([instance()], { gamePath: "C:/Games/Other/game.exe" })
    ).toBeNull();
  });
});

describe("mergeMo2Instances", () => {
  it("dedupes by path, keeps the highest relevance and sorts best first", () => {
    const stale = instance({ instancePath: "C:/MO2/A", relevance: 0, name: "Stale" });
    const fresh = instance({ instancePath: "c:/mo2/a", relevance: 70, name: "Fresh" });
    const other = instance({ instancePath: "C:/MO2/B", relevance: 20, name: "Other" });

    const merged = mergeMo2Instances([stale, other], [fresh]);

    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe("Fresh");
    expect(merged[1].name).toBe("Other");
  });
});
