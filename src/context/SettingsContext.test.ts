import { describe, it, expect } from "vitest";
import {
  DEFAULT_NAVBAR_TAB_ORDER,
  normalizeNavbarTabOrder,
} from "./SettingsContext";

describe("normalizeNavbarTabOrder", () => {
  it("preserves a valid custom order", () => {
    const custom = [...DEFAULT_NAVBAR_TAB_ORDER].reverse();
    expect(normalizeNavbarTabOrder(custom)).toEqual(custom);
  });

  it("appends tabs missing from a partial stored order", () => {
    const result = normalizeNavbarTabOrder(["navStore", "navLibrary"]);
    expect(result.slice(0, 2)).toEqual(["navStore", "navLibrary"]);
    expect(result).toHaveLength(DEFAULT_NAVBAR_TAB_ORDER.length);
    expect(new Set(result)).toEqual(new Set(DEFAULT_NAVBAR_TAB_ORDER));
  });

  it("drops unknown and duplicate keys", () => {
    const result = normalizeNavbarTabOrder([
      "navStore",
      "navStore",
      "navNonexistent",
      "navLibrary",
    ]);
    expect(result.slice(0, 2)).toEqual(["navStore", "navLibrary"]);
    expect(result.filter((key) => key === "navStore")).toHaveLength(1);
    expect(result).toHaveLength(DEFAULT_NAVBAR_TAB_ORDER.length);
  });

  it("slots Ports between Emulators and Mods for orders saved before it existed", () => {
    const stored = DEFAULT_NAVBAR_TAB_ORDER.filter((key) => key !== "navPorts");
    const result = normalizeNavbarTabOrder(stored);
    expect(result.indexOf("navPorts")).toBe(result.indexOf("navEmulators") + 1);
    expect(result.indexOf("navMods")).toBe(result.indexOf("navPorts") + 1);
  });

  it("keeps an explicit Ports placement", () => {
    const stored = ["navPorts", ...DEFAULT_NAVBAR_TAB_ORDER.filter((key) => key !== "navPorts")];
    expect(normalizeNavbarTabOrder(stored)[0]).toBe("navPorts");
  });

  it("falls back to the default order for malformed or empty input", () => {
    expect(normalizeNavbarTabOrder(null)).toEqual(DEFAULT_NAVBAR_TAB_ORDER);
    expect(normalizeNavbarTabOrder("navStore")).toEqual(
      DEFAULT_NAVBAR_TAB_ORDER,
    );
    expect(normalizeNavbarTabOrder([42, null, {}, "navStore"])).toEqual([
      "navStore",
      ...DEFAULT_NAVBAR_TAB_ORDER.filter((key) => key !== "navStore"),
    ]);
  });
});
