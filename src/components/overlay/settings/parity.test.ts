import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERLAY_SETTING_KEYS, QUICK_SETTING_KEYS } from "./keys";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The settings surfaces, read as source text so the test fails on drift
 * without needing to render either one (which would pull in Tauri wiring).
 *
 * The desktop page owns the complete set; the in-HUD widget only renders the
 * curated quick subset, with the full page one button away.
 */
const fullSurface = readFileSync(
  resolve(here, "../../../pages/settings/OverlayTab.tsx"),
  "utf8",
);
const quickSurface = readFileSync(
  resolve(here, "../widgets/SettingsWidget.tsx"),
  "utf8",
);

/** Match `settings.<key>` (reads) or `<key>:` (writes). */
function exposes(source: string, key: string) {
  return new RegExp(`settings\\.${key}\\b|\\b${key}:`).test(source);
}

describe("overlay settings surface parity", () => {
  it("exposes every setting in the desktop settings page", () => {
    for (const key of OVERLAY_SETTING_KEYS) {
      expect(
        exposes(fullSurface, key),
        `OverlayTab is missing the "${key}" setting`,
      ).toBe(true);
    }
  });

  it("exposes the curated quick subset in the HUD widget", () => {
    for (const key of QUICK_SETTING_KEYS) {
      expect(
        exposes(quickSurface, key),
        `SettingsWidget is missing the "${key}" setting`,
      ).toBe(true);
    }
  });

  it("keeps the quick subset inside the full set", () => {
    const full = new Set<string>(OVERLAY_SETTING_KEYS);
    for (const key of QUICK_SETTING_KEYS) {
      expect(full.has(key), `${key} is not in OVERLAY_SETTING_KEYS`).toBe(true);
    }
  });

  it("keeps the accessibility fields in both surfaces", () => {
    for (const [name, source] of [
      ["OverlayTab", fullSurface],
      ["SettingsWidget", quickSurface],
    ] as const) {
      expect(source, `${name} is missing high contrast`).toContain(
        "highContrast",
      );
      expect(source, `${name} is missing text scale`).toContain("textScale");
    }
  });
});
