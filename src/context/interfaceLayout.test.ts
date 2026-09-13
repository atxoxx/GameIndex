import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIDEBAR_SECTION_VISIBILITY,
  interfacePageDef,
  normalizePageItemOrder,
  normalizePageItemOrderMap,
  normalizePageItemVisibilityMap,
  normalizeSidebarSectionVisibility,
  resolveInterfacePage,
} from "./interfaceLayout";
import { moveKey, sortByOrder, NAV_TAB_ITEMS } from "../pages/settings/interfaceItems";
import {
  DEFAULT_NAVBAR_TAB_ORDER,
  normalizeNavbarButtonOrder,
} from "./SettingsContext";

describe("resolveInterfacePage", () => {
  it("maps the top-level routes to their page", () => {
    expect(resolveInterfacePage("/home")).toBe("home");
    expect(resolveInterfacePage("/library")).toBe("library");
    expect(resolveInterfacePage("/store")).toBe("store");
    expect(resolveInterfacePage("/storage")).toBe("storage");
  });

  it("treats the game detail route as its own page", () => {
    expect(resolveInterfacePage("/library/abc123")).toBe("game");
  });

  it("still resolves nested routes to their parent page", () => {
    expect(resolveInterfacePage("/store/42")).toBe("store");
    expect(resolveInterfacePage("/community/stats")).toBe("community");
  });

  it("falls back to global for unknown routes", () => {
    expect(resolveInterfacePage("/")).toBe("global");
    expect(resolveInterfacePage("/settings")).toBe("global");
  });
});

describe("normalizePageItemOrder", () => {
  it("keeps a valid custom order", () => {
    const custom = [...(interfacePageDef("library")?.items ?? [])].reverse();
    expect(normalizePageItemOrder("library", custom)).toEqual(custom);
  });

  it("appends page items missing from a partial order", () => {
    const result = normalizePageItemOrder("storage", ["storageList"]);
    expect(result[0]).toBe("storageList");
    expect(new Set(result)).toEqual(
      new Set(interfacePageDef("storage")?.items ?? []),
    );
  });

  it("drops keys the page does not render", () => {
    const result = normalizePageItemOrder("deals", ["unknownKey", "hero"]);
    expect(result[0]).toBe("hero");
    expect(result.includes("unknownKey" as any)).toBe(false);
    expect(new Set(result)).toEqual(
      new Set(interfacePageDef("deals")?.items ?? []),
    );
  });
});

describe("normalizePageItemOrderMap", () => {
  it("normalizes each known page and ignores the rest", () => {
    const result = normalizePageItemOrderMap({
      deals: ["dealsGrid"],
      global: ["hero"],
      nonsense: ["hero"],
    });
    const loose = result as Record<string, unknown>;
    expect(result.deals?.[0]).toBe("dealsGrid");
    expect(loose.global).toBeUndefined();
    expect(loose.nonsense).toBeUndefined();
  });

  it("returns an empty map for malformed input", () => {
    expect(normalizePageItemOrderMap(null)).toEqual({});
    expect(normalizePageItemOrderMap("deals")).toEqual({});
  });
});

describe("normalizePageItemVisibilityMap", () => {
  it("keeps only OFF entries for keys the page renders", () => {
    const result = normalizePageItemVisibilityMap({
      news: { hero: false, dashboard: false, filters: true },
    });
    expect(result.news).toEqual({ hero: false });
  });

  it("drops pages and keys that do not exist", () => {
    expect(
      normalizePageItemVisibilityMap({ global: { hero: false }, nope: { hero: false } }),
    ).toEqual({});
  });
});

describe("normalizeSidebarSectionVisibility", () => {
  it("merges stored values over the defaults", () => {
    const result = normalizeSidebarSectionVisibility({ statsFooter: false });
    expect(result.statsFooter).toBe(false);
    expect(result.search).toBe(
      DEFAULT_SIDEBAR_SECTION_VISIBILITY.search,
    );
  });

  it("ignores malformed input", () => {
    expect(normalizeSidebarSectionVisibility(null)).toEqual(
      DEFAULT_SIDEBAR_SECTION_VISIBILITY,
    );
  });
});

describe("header item helpers", () => {
  it("sorts items by the user's key order and keeps unknown keys last", () => {
    const sorted = sortByOrder(NAV_TAB_ITEMS, [...DEFAULT_NAVBAR_TAB_ORDER].reverse());
    expect(sorted[0].key).toBe(
      DEFAULT_NAVBAR_TAB_ORDER[DEFAULT_NAVBAR_TAB_ORDER.length - 1],
    );
  });

  it("moves a key and ignores out-of-range moves", () => {
    expect(moveKey(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], 5, 0)).toEqual(["a", "b", "c"]);
    expect(moveKey(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("normalizes the header button order like the tab order", () => {
    const result = normalizeNavbarButtonOrder(["btnBigScreen"]);
    expect(result[0]).toBe("btnBigScreen");
    expect(result).toHaveLength(4);
  });
});
