import { describe, it, expect } from "vitest";
import {
  buildCustomThemeCss,
  buildThemeTokens,
  createCustomThemeId,
  dedupeThemeName,
  detectMode,
  normalizeHexInput,
  parseThemeImport,
  sanitizeCustomThemeColors,
  seedContrastRatio,
  serializeThemeExport,
  slugifyThemeName,
  validateThemeName,
  DEFAULT_DARK_COLORS,
  DEFAULT_LIGHT_COLORS,
  QUICK_COLOR_SWATCHES,
  type CustomThemeColors,
} from "./customTheme";

const NAME_THEMES = [
  { id: "custom-ember", meta: { name: "Ember", isCustom: true } },
  { id: "dark", meta: { name: "Default Dark" } },
];

describe("normalizeHexInput", () => {
  it("expands shorthand and lowercases full hex", () => {
    expect(normalizeHexInput("#ABC")).toBe("#aabbcc");
    expect(normalizeHexInput("ff8800")).toBe("#ff8800");
    expect(normalizeHexInput("  #A1B2C3  ")).toBe("#a1b2c3");
  });

  it("rejects malformed input", () => {
    expect(normalizeHexInput("#12345")).toBeNull();
    expect(normalizeHexInput("nope")).toBeNull();
    expect(normalizeHexInput("")).toBeNull();
  });
});

describe("detectMode", () => {
  it("reads dark and light backgrounds from luminance", () => {
    expect(detectMode(DEFAULT_DARK_COLORS)).toBe("dark");
    expect(detectMode(DEFAULT_LIGHT_COLORS)).toBe("light");
  });
});

describe("id and slug helpers", () => {
  it("slugifies names and avoids id collisions", () => {
    expect(slugifyThemeName("Midnight Ember!")).toBe("midnight-ember");
    expect(createCustomThemeId("Ember", [])).toBe("custom-ember");
    expect(createCustomThemeId("Ember", ["custom-ember"])).toBe("custom-ember-2");
    expect(createCustomThemeId("Ember", ["custom-ember", "custom-ember-2"])).toBe(
      "custom-ember-3"
    );
  });
});

describe("validateThemeName", () => {
  it("flags empty, duplicate and overly long names", () => {
    expect(validateThemeName("", NAME_THEMES, null)).toBe("required");
    expect(validateThemeName("ember", NAME_THEMES, null)).toBe("duplicate");
    expect(validateThemeName("a".repeat(41), NAME_THEMES, null)).toBe("tooLong");
  });

  it("accepts a fresh name and lets a theme keep its own name", () => {
    expect(validateThemeName("Aurora Pine", NAME_THEMES, null)).toBeNull();
    expect(validateThemeName("Ember", NAME_THEMES, "custom-ember")).toBeNull();
  });
});

describe("sanitizeCustomThemeColors", () => {
  it("normalizes a complete palette", () => {
    const result = sanitizeCustomThemeColors({ ...DEFAULT_DARK_COLORS, accent: "#ABC" });
    expect(result?.accent).toBe("#aabbcc");
    expect(result?.bgPrimary).toBe("#08090c");
  });

  it("returns null when a seed is missing or invalid", () => {
    expect(sanitizeCustomThemeColors({ ...DEFAULT_DARK_COLORS, accent: "nope" })).toBeNull();
    const { danger: _danger, ...incomplete } = DEFAULT_DARK_COLORS;
    expect(sanitizeCustomThemeColors(incomplete)).toBeNull();
    expect(sanitizeCustomThemeColors(null)).toBeNull();
  });
});

describe("buildThemeTokens", () => {
  it("derives extra tokens and picks the dark ladder", () => {
    const tokens = buildThemeTokens(DEFAULT_DARK_COLORS, "dark");
    expect(tokens["color-scheme"]).toBe("dark");
    expect(tokens["--color-accent"]).toBe("#635bff");
    expect(tokens["--color-accent-contrast"]).toBe("#ffffff");
    expect(tokens["--color-text-inverse"]).toBe(DEFAULT_DARK_COLORS.bgPrimary);
    expect(tokens["--color-border"]).toContain("color-mix");
    expect(tokens["--color-bg-active"]).toContain("color-mix");
    expect(tokens["--color-scrim"]).toBeUndefined();
  });

  it("adds the light scrim/elevation ladder for light palettes", () => {
    const tokens = buildThemeTokens(DEFAULT_LIGHT_COLORS, "light");
    expect(tokens["color-scheme"]).toBe("light");
    expect(tokens["--color-accent-contrast"]).toBe("#ffffff");
    expect(tokens["--color-scrim"]).toBeDefined();
    expect(tokens["--elevation-1"]).toBeDefined();
    expect(tokens["--accent-hover-mix"]).toBe("black");
  });
});

describe("buildCustomThemeCss", () => {
  it("wraps every token under the theme selector", () => {
    const css = buildCustomThemeCss("custom-ember", DEFAULT_DARK_COLORS, "dark");
    expect(css.startsWith('[data-theme="custom-ember"] {')).toBe(true);
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("--color-bg-primary: #08090c;");
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });
});

describe("seedContrastRatio", () => {
  it("reports a high ratio for legible seed pairs", () => {
    expect(seedContrastRatio(DEFAULT_DARK_COLORS)).toBeGreaterThan(4.5);
    expect(seedContrastRatio(DEFAULT_LIGHT_COLORS)).toBeGreaterThan(4.5);
  });

  it("reports a low ratio for a deliberately unreadable pair", () => {
    const bad: CustomThemeColors = { ...DEFAULT_DARK_COLORS, textPrimary: "#0a0a0a" };
    expect(seedContrastRatio(bad)).toBeLessThan(4.5);
  });
});

describe("theme export/import", () => {
  it("round-trips a theme through the export envelope", () => {
    const text = serializeThemeExport({
      name: "Ember",
      colors: DEFAULT_DARK_COLORS,
      mode: "dark",
    });
    const result = parseThemeImport(text);
    expect(result.errors).toEqual([]);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0].name).toBe("Ember");
    expect(result.themes[0].colors).toEqual(DEFAULT_DARK_COLORS);
    expect(result.themes[0].mode).toBe("dark");
  });

  it("accepts bare themes, arrays and bundles", () => {
    const bare = JSON.stringify({ name: "Bare", colors: DEFAULT_DARK_COLORS, mode: "dark" });
    expect(parseThemeImport(bare).themes[0]?.name).toBe("Bare");

    const array = JSON.stringify([
      { name: "One", colors: DEFAULT_DARK_COLORS },
      { name: "Two", colors: DEFAULT_LIGHT_COLORS },
    ]);
    expect(parseThemeImport(array).themes).toHaveLength(2);

    const bundle = JSON.stringify({
      themes: [{ name: "Bundled", colors: DEFAULT_DARK_COLORS, mode: "light" }],
    });
    expect(parseThemeImport(bundle).themes[0]?.mode).toBe("light");
  });

  it("reports invalid JSON and empty bundles", () => {
    expect(parseThemeImport("{nope").errors[0]?.code).toBe("invalidJson");
    expect(parseThemeImport("[]").errors[0]?.code).toBe("noThemes");
  });

  it("keeps valid themes and flags the broken ones", () => {
    const mixed = JSON.stringify({
      themes: [
        { name: "Good", colors: DEFAULT_DARK_COLORS, mode: "dark" },
        { name: "Bad", colors: { accent: "#ffffff" }, mode: "dark" },
      ],
    });
    const result = parseThemeImport(mixed);
    expect(result.themes.map((theme) => theme.name)).toEqual(["Good"]);
    expect(result.errors).toEqual([{ code: "invalidTheme", detail: "Bad" }]);
  });

  it("derives the mode when it is omitted", () => {
    const result = parseThemeImport(
      JSON.stringify({ name: "Auto", colors: DEFAULT_LIGHT_COLORS })
    );
    expect(result.themes[0]?.mode).toBe("light");
  });
});

describe("dedupeThemeName", () => {
  it("suffixes until free, case-insensitively", () => {
    expect(dedupeThemeName("Ember", [])).toBe("Ember");
    expect(dedupeThemeName("Ember", ["ember"])).toBe("Ember (2)");
    expect(dedupeThemeName("Ember", ["Ember", "Ember (2)"])).toBe("Ember (3)");
  });
});

describe("QUICK_COLOR_SWATCHES", () => {
  it("only contains normalized full hex values", () => {
    for (const color of QUICK_COLOR_SWATCHES) {
      expect(normalizeHexInput(color)).toBe(color);
    }
  });
});
