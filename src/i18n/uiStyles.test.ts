import { describe, expect, it, vi } from "vitest";
import { UI_STYLES } from "../context/ThemeContext";
import { en } from "./en";
import { de } from "./de";
import { fr } from "./fr";
import { es } from "./es";
import { ru } from "./ru";
import { zhCN } from "./zh-CN";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const LOCALES: Record<string, Record<string, string>> = {
  en,
  de,
  fr,
  es,
  ru,
  "zh-CN": zhCN,
};

const FIELDS = ["name", "badge", "desc"] as const;

/** Keys the settings picker needs but the dictionary does not actually define. */
function missingStyleKeys(dict: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const style of UI_STYLES) {
    for (const field of FIELDS) {
      const key = `settings.uiStyle.${style.id}.${field}`;
      if (!dict[key] || dict[key] === key) missing.push(key);
    }
  }
  return missing;
}

describe("UI style registry", () => {
  it("exposes a unique id and complete metadata for every style", () => {
    const ids = UI_STYLES.map((style) => style.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const style of UI_STYLES) {
      expect(style.id.trim()).not.toBe("");
      expect(style.name.trim()).not.toBe("");
      expect(style.badge.trim()).not.toBe("");
      expect(style.desc.trim()).not.toBe("");
      expect(style.themeId.trim()).not.toBe("");
    }
  });

  it("has a name, badge and description for every style in every locale", () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      expect(missingStyleKeys(dict), `${lang} dictionary is incomplete`).toEqual([]);
    }
  });

  it("reports a style whose strings are absent from a dictionary", () => {
    const incomplete = { ...en };
    delete incomplete["settings.uiStyle.liquidglass.desc"];

    expect(missingStyleKeys(incomplete)).toEqual(["settings.uiStyle.liquidglass.desc"]);
  });

  it("reports a key that falls through to the raw key instead of a string", () => {
    const incomplete = { ...en, "settings.uiStyle.steam.badge": "settings.uiStyle.steam.badge" };

    expect(missingStyleKeys(incomplete)).toEqual(["settings.uiStyle.steam.badge"]);
  });
});
