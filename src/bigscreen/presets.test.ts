import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET,
  PRESETS,
  PRESET_CYCLE,
  coercePreset,
  getPreset,
  isPresetId,
  nextPreset,
} from "./presets";
import { DEFAULT_PREFS, sanitizePrefs } from "./prefs";

describe("layout presets", () => {
  it("ships five layouts with unique ids and labels", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "gameindex",
      "xbox",
      "steam",
      "playstation",
      "switch",
    ]);
    expect(new Set(PRESETS.map((preset) => preset.labelKey)).size).toBe(
      PRESETS.length,
    );
  });

  it("gives every layout its own composition", () => {
    const homes = new Set(PRESETS.map((preset) => preset.home));
    const libraries = new Set(PRESETS.map((preset) => preset.library));
    const details = new Set(PRESETS.map((preset) => preset.detail));
    expect(homes.size).toBe(PRESETS.length);
    expect(libraries.size).toBe(PRESETS.length);
    expect(details.size).toBe(PRESETS.length);
  });

  it("keeps the side rail exclusive to the Steam layout", () => {
    for (const preset of PRESETS) {
      expect(preset.placement).toBe(
        preset.id === "steam" ? "side" : preset.id === "switch" ? "bottom" : "top",
      );
    }
  });

  it("cycles and wraps through every preset", () => {
    expect(nextPreset("gameindex")).toBe("xbox");
    expect(nextPreset(PRESET_CYCLE[PRESET_CYCLE.length - 1])).toBe(DEFAULT_PRESET);
  });

  it("never trusts an unknown persisted preset", () => {
    expect(isPresetId("nintendo")).toBe(false);
    expect(coercePreset("nintendo")).toBe(DEFAULT_PRESET);
    expect(coercePreset(undefined)).toBe(DEFAULT_PRESET);
    expect(getPreset("unknown" as never).id).toBe(DEFAULT_PRESET);
  });

  it("migrates the legacy classic id to the GameIndex layout", () => {
    expect(coercePreset("classic")).toBe("gameindex");
  });
});

describe("sanitizePrefs", () => {
  it("falls back to the shipped defaults for junk payloads", () => {
    for (const junk of [null, undefined, 42, "xbox", [], true]) {
      expect(sanitizePrefs(junk)).toEqual(DEFAULT_PREFS);
    }
  });

  it("keeps a valid preset and nav visibility", () => {
    expect(
      sanitizePrefs({ preset: "playstation", navVisibility: "auto" }),
    ).toEqual({ preset: "playstation", navVisibility: "auto" });
  });

  it("adopts the preset's own nav default when visibility is invalid", () => {
    expect(sanitizePrefs({ preset: "steam", navVisibility: "sometimes" })).toEqual({
      preset: "steam",
      navVisibility: getPreset("steam").navVisibility,
    });
  });

  it("repairs an unknown preset while keeping a valid visibility", () => {
    expect(sanitizePrefs({ preset: "sega", navVisibility: "always" })).toEqual({
      preset: DEFAULT_PRESET,
      navVisibility: "always",
    });
  });
});
