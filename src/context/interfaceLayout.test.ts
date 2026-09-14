import { describe, it, expect } from "vitest";
import {
  DECK_ONLY_DETAIL_SECTION_KEYS,
  DEFAULT_DETAIL_TAB_ORDER,
  DEFAULT_DETAIL_TOP_BAR_ORDER,
  DEFAULT_HERO_ELEMENT_ORDER,
  DEFAULT_SIDEBAR_SECTION_VISIBILITY,
  DETAIL_TABS,
  DETAIL_TOP_BAR,
  HERO_ELEMENTS,
  interfacePageDef,
  isDetailSectionKeyAvailable,
  isDetailTopBarKeyAvailable,
  isDetailTopBarKeyForScope,
  LINUX_ONLY_DETAIL_TOP_BAR_KEYS,
  normalizeDetailTabOrder,
  normalizeDetailTabOrderMap,
  normalizeDetailTopBarOrder,
  normalizeDetailTopBarOrderMap,
  normalizeDetailTopBarVisibility,
  normalizeDetailTopBarVisibilityMap,
  normalizeHeroElementOrder,
  normalizeHeroElementOrderMap,
  normalizeHeroElementVisibilityMap,
  normalizePageItemOrder,
  normalizePageItemOrderMap,
  normalizePageItemVisibilityMap,
  normalizeSidebarSectionVisibility,
  resolveDetailTabOrder,
  resolveDetailTopBarHidden,
  resolveDetailTopBarOrder,
  resolveHeroElementHidden,
  resolveHeroElementOrder,
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

describe("normalizeDetailTabOrder", () => {
  it("keeps a valid custom order", () => {
    const custom = [...DETAIL_TABS.game].reverse();
    expect(normalizeDetailTabOrder("game", custom)).toEqual(custom);
  });

  it("drops unknown/duplicate keys and appends missing tabs", () => {
    const result = normalizeDetailTabOrder("game", ["notes", "notes", "bogus", "overview"]);
    expect(result.slice(0, 2)).toEqual(["notes", "overview"]);
    expect(result).toHaveLength(DETAIL_TABS.game.length);
    expect(new Set(result)).toEqual(new Set(DETAIL_TABS.game));
  });

  it("falls back to the shipped order for malformed input", () => {
    expect(normalizeDetailTabOrder("store", null)).toEqual(DETAIL_TABS.store);
    expect(normalizeDetailTabOrder("store", ["nope"])).toEqual(DETAIL_TABS.store);
    expect(DEFAULT_DETAIL_TAB_ORDER).toBe(DETAIL_TABS);
  });
});

describe("normalizeDetailTabOrderMap", () => {
  it("normalizes each known scope and ignores junk scopes", () => {
    const result = normalizeDetailTabOrderMap({
      game: ["news"],
      junk: ["news"],
      global: ["overview"],
    });
    expect(result.game?.[0]).toBe("news");
    expect(result.game).toHaveLength(DETAIL_TABS.game.length);
    const loose = result as Record<string, unknown>;
    expect(loose.junk).toBeUndefined();
    expect(loose.global).toBeUndefined();
  });

  it("returns an empty map for malformed input", () => {
    expect(normalizeDetailTabOrderMap(null)).toEqual({});
    expect(normalizeDetailTabOrderMap("game")).toEqual({});
  });
});

describe("resolveDetailTabOrder", () => {
  it("uses the stored order when present", () => {
    expect(resolveDetailTabOrder({ game: ["news"] }, "game")).toEqual(["news"]);
  });

  it("falls back to the shipped order", () => {
    expect(resolveDetailTabOrder({}, "store")).toEqual(DETAIL_TABS.store);
  });
});

describe("normalizeHeroElementOrder", () => {
  it("keeps a valid custom order", () => {
    const custom = [...HERO_ELEMENTS].reverse();
    expect(normalizeHeroElementOrder("game", custom)).toEqual(custom);
  });

  it("drops unknown/duplicate keys and appends missing elements", () => {
    const result = normalizeHeroElementOrder("game", ["title", "title", "nope"]);
    expect(result[0]).toBe("title");
    expect(result).toHaveLength(HERO_ELEMENTS.length);
    expect(new Set(result)).toEqual(new Set(HERO_ELEMENTS));
  });

  it("falls back to the shipped order for malformed input", () => {
    expect(normalizeHeroElementOrder("store", null)).toEqual(HERO_ELEMENTS);
    expect(normalizeHeroElementOrder("store", 42)).toEqual(HERO_ELEMENTS);
    expect(DEFAULT_HERO_ELEMENT_ORDER).toBe(HERO_ELEMENTS);
  });
});

describe("normalizeHeroElementOrderMap", () => {
  it("normalizes each known scope and ignores junk scopes", () => {
    const result = normalizeHeroElementOrderMap({
      store: ["actions"],
      junk: ["actions"],
    });
    expect(result.store?.[0]).toBe("actions");
    expect(result.store).toHaveLength(HERO_ELEMENTS.length);
    expect((result as Record<string, unknown>).junk).toBeUndefined();
  });

  it("returns an empty map for malformed input", () => {
    expect(normalizeHeroElementOrderMap(null)).toEqual({});
    expect(normalizeHeroElementOrderMap([])).toEqual({});
  });
});

describe("normalizeHeroElementVisibilityMap", () => {
  it("keeps only OFF entries for known scopes and keys", () => {
    const result = normalizeHeroElementVisibilityMap({
      game: { title: false, poster: true, nope: false },
      store: { kpis: false },
      junk: { actions: false },
    });
    expect(result.game).toEqual({ title: false });
    expect(result.store).toEqual({ kpis: false });
    expect((result as Record<string, unknown>).junk).toBeUndefined();
  });

  it("drops ON-only and malformed input", () => {
    expect(normalizeHeroElementVisibilityMap(null)).toEqual({});
    expect(normalizeHeroElementVisibilityMap({ game: { title: true } })).toEqual({});
  });
});

describe("resolveHeroElementOrder", () => {
  it("uses the stored order when present", () => {
    expect(resolveHeroElementOrder({ store: ["actions"] }, "store")).toEqual(["actions"]);
  });

  it("falls back to the shipped order", () => {
    expect(resolveHeroElementOrder({}, "game")).toEqual(HERO_ELEMENTS);
  });
});

describe("resolveHeroElementHidden", () => {
  it("returns the stored OFF entries", () => {
    expect(resolveHeroElementHidden({ game: { title: false } }, "game")).toEqual({
      title: false,
    });
  });

  it("falls back to nothing hidden", () => {
    expect(resolveHeroElementHidden({}, "store")).toEqual({});
  });
});

describe("normalizeDetailTopBarOrder", () => {
  it("keeps valid keys in order, dedupes and appends missing keys", () => {
    const result = normalizeDetailTopBarOrder("game", ["quickActions", "back", "back"]);
    expect(result[0]).toBe("quickActions");
    expect(result[1]).toBe("back");
    expect(result).toHaveLength(DETAIL_TOP_BAR.game.length);
    expect(new Set(result)).toEqual(new Set(DETAIL_TOP_BAR.game));
  });

  it("rejects keys the scope does not ship", () => {
    const result = normalizeDetailTopBarOrder("store", ["wineLogs", "back"]);
    expect(result).toEqual(DETAIL_TOP_BAR.store);
    expect((result as string[]).includes("wineLogs")).toBe(false);
  });

  it("falls back to the shipped order for malformed input", () => {
    expect(normalizeDetailTopBarOrder("game", null)).toEqual(DETAIL_TOP_BAR.game);
    expect(normalizeDetailTopBarOrder("game", 42)).toEqual(DETAIL_TOP_BAR.game);
    expect(normalizeDetailTopBarOrder("game", "x")).toEqual(DETAIL_TOP_BAR.game);
    expect(DEFAULT_DETAIL_TOP_BAR_ORDER).toBe(DETAIL_TOP_BAR);
  });
});

describe("isDetailTopBarKeyForScope", () => {
  it("accepts shipped keys and rejects cross-scope keys", () => {
    expect(isDetailTopBarKeyForScope("game", "wineLogs")).toBe(true);
    expect(isDetailTopBarKeyForScope("store", "wineLogs")).toBe(false);
    expect(isDetailTopBarKeyForScope("store", "quickActions")).toBe(true);
    expect(isDetailTopBarKeyForScope("game", 42)).toBe(false);
  });
});

describe("normalizeDetailTopBarOrderMap", () => {
  it("normalizes each known scope and ignores junk scopes", () => {
    const result = normalizeDetailTopBarOrderMap({
      game: ["quickActions"],
      store: ["nope"],
      junk: ["back"],
    });
    expect(result.game?.[0]).toBe("quickActions");
    expect(result.game).toHaveLength(DETAIL_TOP_BAR.game.length);
    expect(result.store).toEqual(DETAIL_TOP_BAR.store);
    expect((result as Record<string, unknown>).junk).toBeUndefined();
  });

  it("returns an empty map for malformed input", () => {
    expect(normalizeDetailTopBarOrderMap(null)).toEqual({});
    expect(normalizeDetailTopBarOrderMap("game")).toEqual({});
  });
});

describe("normalizeDetailTopBarVisibilityMap", () => {
  it("keeps only explicit OFF entries for known scopes and keys", () => {
    const result = normalizeDetailTopBarVisibilityMap({
      game: { back: false, bogus: false },
      store: { quickActions: false },
      junk: { back: false },
    });
    expect(result.game).toEqual({ back: false });
    expect(result.store).toEqual({ quickActions: false });
    expect((result as Record<string, unknown>).junk).toBeUndefined();
  });

  it("drops ON-only and malformed input", () => {
    expect(normalizeDetailTopBarVisibilityMap(null)).toEqual({});
    expect(normalizeDetailTopBarVisibilityMap({ game: { back: true } })).toEqual({});
  });

  it("ignores game-only keys in the store scope", () => {
    expect(
      normalizeDetailTopBarVisibilityMap({ store: { wineLogs: false, back: false } }),
    ).toEqual({ store: { back: false } });
  });
});

describe("normalizeDetailTopBarVisibility", () => {
  it("normalizes a single scope's OFF entries", () => {
    expect(
      normalizeDetailTopBarVisibility("game", { back: false, editMedia: true, nope: false }),
    ).toEqual({ back: false });
  });

  it("returns an empty object for malformed input", () => {
    expect(normalizeDetailTopBarVisibility("game", null)).toEqual({});
    expect(normalizeDetailTopBarVisibility("game", 42)).toEqual({});
  });
});

describe("resolveDetailTopBarOrder", () => {
  it("uses the stored order when present", () => {
    expect(resolveDetailTopBarOrder({ store: ["quickActions", "back"] }, "store")).toEqual([
      "quickActions",
      "back",
    ]);
  });

  it("falls back to the shipped order", () => {
    expect(resolveDetailTopBarOrder({}, "game")).toEqual(DETAIL_TOP_BAR.game);
    expect(resolveDetailTopBarOrder({}, "store")).toEqual(DETAIL_TOP_BAR.store);
  });
});

describe("resolveDetailTopBarHidden", () => {
  it("returns the stored OFF entries", () => {
    expect(resolveDetailTopBarHidden({ game: { quickActions: false } }, "game")).toEqual({
      quickActions: false,
    });
  });

  it("falls back to nothing hidden", () => {
    expect(resolveDetailTopBarHidden({}, "store")).toEqual({});
  });
});

describe("isDetailTopBarKeyAvailable", () => {
  it("hides Linux-only keys when the full Linux UI is off", () => {
    expect(isDetailTopBarKeyAvailable("wineLogs", { showFullLinuxUi: false })).toBe(false);
    expect(isDetailTopBarKeyAvailable("editCompatibility", { showFullLinuxUi: false })).toBe(
      false,
    );
  });

  it("shows Linux-only keys when the full Linux UI is on", () => {
    expect(isDetailTopBarKeyAvailable("wineLogs", { showFullLinuxUi: true })).toBe(true);
    expect(isDetailTopBarKeyAvailable("editCompatibility", { showFullLinuxUi: true })).toBe(
      true,
    );
  });

  it("always allows keys that are not Linux-only", () => {
    for (const key of ["back", "editDetails", "quickActions"] as const) {
      expect(isDetailTopBarKeyAvailable(key, { showFullLinuxUi: false })).toBe(true);
      expect(isDetailTopBarKeyAvailable(key, { showFullLinuxUi: true })).toBe(true);
    }
  });

  it("keeps the Linux-only key list in sync", () => {
    expect(LINUX_ONLY_DETAIL_TOP_BAR_KEYS).toEqual(["wineLogs", "editCompatibility"]);
  });
});

describe("isDetailSectionKeyAvailable", () => {
  it("hides Deck-only sections when Deck-verified is off", () => {
    expect(isDetailSectionKeyAvailable("protonDb", { showDeckVerified: false })).toBe(false);
  });

  it("shows Deck-only sections when Deck-verified is on", () => {
    expect(isDetailSectionKeyAvailable("protonDb", { showDeckVerified: true })).toBe(true);
  });

  it("always allows unrelated keys and never treats them as Deck-only", () => {
    for (const key of ["reviews", "notes", "bogus", ""]) {
      expect(isDetailSectionKeyAvailable(key, { showDeckVerified: false })).toBe(true);
    }
    expect(DECK_ONLY_DETAIL_SECTION_KEYS).toContain("protonDb");
  });
});
