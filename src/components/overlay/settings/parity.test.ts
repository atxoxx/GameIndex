import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERLAY_SETTING_KEYS } from "./keys";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The two surfaces that expose overlay settings. Read as source text so the
 * test fails on drift without needing to render either surface (which would
 * pull in Tauri/overlay context wiring).
 */
const SURFACES: Record<string, string> = {
  SettingsWidget: readFileSync(
    resolve(here, "../widgets/SettingsWidget.tsx"),
    "utf8",
  ),
  OverlayTab: readFileSync(
    resolve(here, "../../../pages/settings/OverlayTab.tsx"),
    "utf8",
  ),
};

describe("overlay settings surface parity", () => {
  it("loads both settings surfaces", () => {
    for (const [name, source] of Object.entries(SURFACES)) {
      expect(source.length, `${name} source is empty`).toBeGreaterThan(0);
    }
  });

  it("exposes every OVERLAY_SETTING_KEYS entry in both surfaces", () => {
    for (const key of OVERLAY_SETTING_KEYS) {
      // Match `settings.<key>` (reads) or `<key>:` (writes) so a stray CSS
      // class name can't mask a genuinely missing setting.
      const pattern = new RegExp(`settings\\.${key}\\b|\\b${key}:`);
      for (const [name, source] of Object.entries(SURFACES)) {
        expect(
          pattern.test(source),
          `${name} is missing the "${key}" setting`,
        ).toBe(true);
      }
    }
  });

  it("exposes the accessibility fields in both surfaces", () => {
    for (const [name, source] of Object.entries(SURFACES)) {
      expect(
        source,
        `${name} is missing the high-contrast field`,
      ).toContain("overlay.settings.highContrast");
      expect(
        source,
        `${name} is missing the text-scale field`,
      ).toContain("overlay.settings.textScale");
    }
  });
});
