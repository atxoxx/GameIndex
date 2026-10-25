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

describe("presets", () => {
  it("ships five layouts with unique ids and labels", () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      "xbox",
      "steam",
      "playstation",
      "switch",
      "classic",
    ]);
    expect(new Set(PRESETS.map((preset) => preset.labelKey)).size).toBe(
      PRESETS.length,
    );
  });

  it("keeps the side rail exclusive to the Steam layout", () => {
    for (const preset of PRESETS) {
      expect(preset.placement).toBe(preset.id === "steam" ? "side" : "top");
    }
  });

  it("cycles and wraps through every preset", () => {
    expect(nextPreset("xbox")).toBe("steam");
    expect(nextPreset(PRESET_CYCLE[PRESET_CYCLE.length - 1])).toBe(DEFAULT_PRESET);
  });

  it("never trusts an unknown persisted preset", () => {
    expect(isPresetId("nintendo")).toBe(false);
    expect(coercePreset("nintendo")).toBe(DEFAULT_PRESET);
    expect(coercePreset(undefined)).toBe(DEFAULT_PRESET);
    expect(getPreset("unknown" as never).id).toBe(DEFAULT_PRESET);
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
