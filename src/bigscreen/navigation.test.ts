import { describe, expect, it } from "vitest";
import {
  PRIMARY_SECTIONS,
  SYSTEM_SECTIONS,
  bigScreenParentOf,
  sectionForPath,
} from "./registry";

// The shell-owned Back resolver is a pure route table: given a Big
// Screen pathname it returns the section Back should walk up to, or
// `null` when the route is top-level (Back then offers the exit
// confirmation instead of silently leaving the mode).
describe("bigScreenParentOf", () => {
  it("maps nested item routes back to their section", () => {
    expect(bigScreenParentOf("/library/game-123")).toBe("/library");
    expect(bigScreenParentOf("/store/portal-2")).toBe("/store");
    expect(bigScreenParentOf("/settings/appearance")).toBe("/settings");
    expect(bigScreenParentOf("/mods/discover")).toBe("/mods");
    expect(bigScreenParentOf("/emulators/retroarch")).toBe("/emulators");
  });

  it("maps the three Discover areas back to the Discover hub", () => {
    expect(bigScreenParentOf("/deals")).toBe("/discover");
    expect(bigScreenParentOf("/news")).toBe("/discover");
    expect(bigScreenParentOf("/community")).toBe("/discover");
  });

  it("maps System children back to the System hub", () => {
    for (const path of [
      "/mods",
      "/emulators",
      "/docs",
      "/saves",
      "/downloads",
      "/storage",
      "/achievements",
    ]) {
      expect(bigScreenParentOf(path)).toBe("/settings");
    }
  });

  it("maps activity back to home", () => {
    expect(bigScreenParentOf("/activity")).toBe("/home");
  });

  it("returns null for top-level sections so Back can exit", () => {
    for (const path of [
      "/",
      "/home",
      "/library",
      "/store",
      "/wishlist",
      "/discover",
      "/friends",
      "/settings",
    ]) {
      expect(bigScreenParentOf(path)).toBeNull();
    }
  });

  it("ignores a trailing slash", () => {
    expect(bigScreenParentOf("/library/game-123/")).toBe("/library");
    expect(bigScreenParentOf("/store/portal-2/")).toBe("/store");
    expect(bigScreenParentOf("/settings/appearance/")).toBe("/settings");
    expect(bigScreenParentOf("/mods/")).toBe("/settings");
  });

  it("does not confuse /storage with a nested /store route", () => {
    expect(bigScreenParentOf("/storage")).toBe("/settings");
  });

  it("treats deeper unknown routes as top-level (no parent)", () => {
    expect(bigScreenParentOf("/library/game-123/notes")).toBeNull();
  });
});

describe("sectionForPath", () => {
  it("resolves each section from its own route", () => {
    expect(sectionForPath("/home")).toBe("home");
    expect(sectionForPath("/library/game-1")).toBe("library");
    expect(sectionForPath("/store/portal-2")).toBe("store");
    expect(sectionForPath("/wishlist")).toBe("store");
    expect(sectionForPath("/friends")).toBe("friends");
    expect(sectionForPath("/settings/appearance")).toBe("system");
  });

  it("folds Deals, News and Community into Discover", () => {
    expect(sectionForPath("/discover")).toBe("discover");
    expect(sectionForPath("/deals")).toBe("discover");
    expect(sectionForPath("/news")).toBe("discover");
    expect(sectionForPath("/community")).toBe("discover");
  });

  it("folds Mods, Emulators, Docs, Saves and Activity into their owners", () => {
    expect(sectionForPath("/mods")).toBe("system");
    expect(sectionForPath("/emulators/retroarch")).toBe("system");
    expect(sectionForPath("/docs")).toBe("system");
    expect(sectionForPath("/saves")).toBe("system");
    expect(sectionForPath("/activity")).toBe("home");
  });

  it("never lights Store for /storage", () => {
    expect(sectionForPath("/storage")).toBe("system");
  });

  it("falls back to home for unknown paths", () => {
    expect(sectionForPath("/reels")).toBe("system");
    expect(sectionForPath("/not-a-route")).toBe("home");
  });
});

describe("section model", () => {
  it("exposes exactly six top-level sections", () => {
    expect(PRIMARY_SECTIONS).toHaveLength(6);
    expect(PRIMARY_SECTIONS.map((section) => section.id)).toEqual([
      "home",
      "library",
      "store",
      "discover",
      "friends",
      "system",
    ]);
  });

  it("gives every section a unique path and label key", () => {
    const paths = PRIMARY_SECTIONS.map((section) => section.path);
    const labels = PRIMARY_SECTIONS.map((section) => section.labelKey);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps the System hub tiles addressable", () => {
    const paths = SYSTEM_SECTIONS.map((section) => section.path);
    expect(paths).toContain("/downloads");
    expect(paths).toContain("/settings");
    expect(new Set(paths).size).toBe(paths.length);
  });
});
