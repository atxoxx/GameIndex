import { describe, expect, it } from "vitest";
import {
  PALETTE_SCOPES,
  PRIMARY_SCOPES,
  SCOPE_ORDER,
  SCOPE_PREFIXES,
  SECONDARY_SCOPES,
} from "./commandPaletteScopes";

describe("command palette scopes", () => {
  it("keeps five primary chips and puts the rest behind More", () => {
    expect(PRIMARY_SCOPES.map((scope) => scope.id)).toEqual([
      "all",
      "games",
      "store",
      "actions",
      "navigation",
    ]);
    expect(SECONDARY_SCOPES.length).toBeGreaterThan(0);
    expect(PRIMARY_SCOPES.length + SECONDARY_SCOPES.length).toBe(PALETTE_SCOPES.length);
  });

  it("maps Alt+1…9 to the first nine scopes", () => {
    expect(SCOPE_ORDER.slice(0, 9)).toEqual([
      "all",
      "games",
      "store",
      "actions",
      "navigation",
      "recent",
      "downloads",
      "themes",
      "docs",
    ]);
  });

  it("keeps the type-ahead prefixes stable", () => {
    expect(SCOPE_PREFIXES["@"]).toBe("games");
    expect(SCOPE_PREFIXES["?"]).toBe("store");
    expect(SCOPE_PREFIXES[">"]).toBe("actions");
    expect(SCOPE_PREFIXES["/"]).toBe("navigation");
    expect(SCOPE_PREFIXES["!"]).toBe("wishlist");
    expect(SCOPE_PREFIXES["~"]).toBe("utility");
  });

  it("has no duplicate scope ids", () => {
    expect(new Set(SCOPE_ORDER).size).toBe(SCOPE_ORDER.length);
  });
});
