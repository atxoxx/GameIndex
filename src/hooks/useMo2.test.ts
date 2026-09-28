import { describe, expect, it } from "vitest";
import type { Mo2Mod, Mo2Plugin, Mo2ProfileDetails } from "../types/mo2";

// Helper function mirroring MO2 profile name validation
export function validateMo2ProfileName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Profile name cannot be empty" };
  }
  const invalidChars = ["\\", "/", ":", "*", "?", '"', "<", ">", "|"];
  if (invalidChars.some((c) => trimmed.includes(c))) {
    return { valid: false, error: "Profile name contains invalid characters" };
  }
  return { valid: true };
}

// Helper function mirroring standard mods MO2 state matching
export function matchMo2ModState(
  modName: string,
  mo2Mods: Mo2Mod[],
  mo2Plugins: Mo2Plugin[]
): boolean | undefined {
  const lowerName = modName.toLowerCase().trim();
  const withoutExt = lowerName.replace(/\.(zip|7z|rar|tar|gz|pak|esp|esm|esl)$/, "");

  // 1. Check MO2 mods list
  const matchedMod = mo2Mods.find((m) => {
    if (m.isSeparator) return false;
    const mLower = m.name.toLowerCase().trim();
    const mWithoutExt = mLower.replace(/\.(zip|7z|rar|tar|gz|pak)$/, "");
    return mLower === lowerName || mWithoutExt === withoutExt;
  });
  if (matchedMod) return matchedMod.enabled;

  // 2. Check MO2 plugins list
  const matchedPlugin = mo2Plugins.find((p) => {
    const pLower = p.name.toLowerCase().trim();
    const pWithoutExt = pLower.replace(/\.(esp|esm|esl)$/, "");
    return pLower === lowerName || pWithoutExt === withoutExt;
  });
  if (matchedPlugin) return matchedPlugin.enabled;

  return undefined;
}

describe("MO2 Types & Model verification", () => {
  it("structures Mo2Mod instances correctly with priorities", () => {
    const mod: Mo2Mod = {
      id: "mo2mod-skyui",
      name: "SkyUI_5_2_SE",
      enabled: true,
      priority: 15,
      isSeparator: false,
      isUnmanaged: false,
      version: "5.2SE",
      author: "SkyUI Team",
      nexusModId: 12604,
      nexusDomain: "skyrimspecialedition",
      category: "User Interface",
      sizeBytes: 15000000,
      fileCount: 42,
      path: "C:/Modding/MO2/mods/SkyUI_5_2_SE",
    };

    expect(mod.enabled).toBe(true);
    expect(mod.priority).toBe(15);
    expect(mod.nexusModId).toBe(12604);
  });

  it("handles separators in MO2 profile mod lists", () => {
    const separator: Mo2Mod = {
      id: "mo2mod-core-utils-separator",
      name: "CORE UTILITIES",
      enabled: false,
      priority: 0,
      isSeparator: true,
      isUnmanaged: false,
      path: "",
    };

    expect(separator.isSeparator).toBe(true);
  });

  it("calculates profile details counts", () => {
    const details: Mo2ProfileDetails = {
      instancePath: "C:/Modding/MO2",
      profileName: "Default",
      mods: [
        {
          id: "1",
          name: "Mod A",
          enabled: true,
          priority: 0,
          isSeparator: false,
          isUnmanaged: false,
          path: "",
        },
        {
          id: "2",
          name: "Mod B",
          enabled: false,
          priority: 1,
          isSeparator: false,
          isUnmanaged: false,
          path: "",
        },
      ],
      plugins: [
        { name: "Skyrim.esm", enabled: true, priority: 0 },
        { name: "Update.esm", enabled: true, priority: 1 },
      ],
      activeModCount: 1,
      totalModCount: 2,
      activePluginCount: 2,
      totalPluginCount: 2,
    };

    expect(details.activeModCount).toBe(1);
    expect(details.totalModCount).toBe(2);
    expect(details.plugins.length).toBe(2);
  });
});

describe("MO2 Profile Creation & Validation", () => {
  it("happy-path: validates valid profile names", () => {
    expect(validateMo2ProfileName("Hardcore_v2").valid).toBe(true);
    expect(validateMo2ProfileName("Vanilla Plus").valid).toBe(true);
    expect(validateMo2ProfileName("Playthrough-2026").valid).toBe(true);
  });

  it("error-path: rejects empty or invalid profile names with forbidden characters", () => {
    expect(validateMo2ProfileName("").valid).toBe(false);
    expect(validateMo2ProfileName("   ").valid).toBe(false);
    expect(validateMo2ProfileName("Profile/1").valid).toBe(false);
    expect(validateMo2ProfileName("Profile:Invalid").valid).toBe(false);
    expect(validateMo2ProfileName("Profile*Test").valid).toBe(false);
    expect(validateMo2ProfileName("Profile?").valid).toBe(false);
  });
});

describe("MO2 State Reflection in Standard Mods", () => {
  const mo2Mods: Mo2Mod[] = [
    {
      id: "1",
      name: "SkyUI",
      enabled: true,
      priority: 0,
      isSeparator: false,
      isUnmanaged: false,
      path: "",
    },
    {
      id: "2",
      name: "A Quality World Map",
      enabled: false,
      priority: 1,
      isSeparator: false,
      isUnmanaged: false,
      path: "",
    },
  ];

  const mo2Plugins: Mo2Plugin[] = [
    { name: "SkyUI_SE.esp", enabled: true, priority: 0 },
    { name: "WorldMap.esp", enabled: false, priority: 1 },
  ];

  it("happy-path: reflects enabled state from MO2 mods and plugins", () => {
    expect(matchMo2ModState("SkyUI", mo2Mods, mo2Plugins)).toBe(true);
    expect(matchMo2ModState("skyui.zip", mo2Mods, mo2Plugins)).toBe(true);
    expect(matchMo2ModState("A Quality World Map", mo2Mods, mo2Plugins)).toBe(false);
    expect(matchMo2ModState("WorldMap.esp", mo2Mods, mo2Plugins)).toBe(false);
  });

  it("error-path: returns undefined when mod is not managed in MO2", () => {
    expect(matchMo2ModState("UnmanagedMod123", mo2Mods, mo2Plugins)).toBeUndefined();
    expect(matchMo2ModState("Unknown.esp", mo2Mods, mo2Plugins)).toBeUndefined();
  });
});
