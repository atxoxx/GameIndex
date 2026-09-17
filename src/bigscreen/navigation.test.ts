import { describe, expect, it } from "vitest";
import { bigScreenParentOf } from "./registry";

// The shell-owned Back resolver is a pure route table: given a Big
// Screen pathname it returns the section Back should walk up to, or
// `null` when the route is top-level (Back then offers the exit
// confirmation instead of silently leaving the mode).
describe("bigScreenParentOf", () => {
  it("maps a nested game route back to the library", () => {
    expect(bigScreenParentOf("/library/game-123")).toBe("/library");
  });

  it("maps a nested store route back to the store", () => {
    expect(bigScreenParentOf("/store/portal-2")).toBe("/store");
  });

  it("maps the System-hub routes back to settings", () => {
    expect(bigScreenParentOf("/mods")).toBe("/settings");
    expect(bigScreenParentOf("/emulators")).toBe("/settings");
    expect(bigScreenParentOf("/docs")).toBe("/settings");
  });

  it("maps a settings sub-route back to the settings hub", () => {
    // Regression: `/settings/:tab` is mapped to BigScreenSystem by
    // BIGSCREEN_ROUTE_PAIRS, so it is a System-hub sub-route exactly like
    // /mods — Back must walk up to /settings, not offer to exit.
    expect(bigScreenParentOf("/settings/appearance")).toBe("/settings");
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
      "/deals",
      "/news",
      "/friends",
      "/community",
      "/settings",
      "/downloads",
      "/storage",
      "/achievements",
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
    expect(bigScreenParentOf("/storage")).toBeNull();
  });

  it("treats deeper unknown routes as top-level (no parent)", () => {
    expect(bigScreenParentOf("/library/game-123/notes")).toBeNull();
  });
});
