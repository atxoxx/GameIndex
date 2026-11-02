import { describe, expect, it } from "vitest";
import type { InterfacePageKey } from "../../../context/interfaceLayout";
import {
  STUDIO_NAV_GROUPS,
  buildStudioSearchIndex,
  groupStudioSearchResults,
  searchStudioIndex,
  studioScopeLabel,
  type StudioSearchEntry,
  type Translate,
} from "./studioScopes";

const t: Translate = (key) => key;

function buildIndex(caps: { showDeckVerified?: boolean; showFullLinuxUi?: boolean } = {}) {
  return buildStudioSearchIndex({
    t,
    showDeckVerified: caps.showDeckVerified ?? false,
    showFullLinuxUi: caps.showFullLinuxUi ?? false,
  });
}

function entry(id: string, scope: InterfacePageKey): StudioSearchEntry {
  return { id, scope, kind: "pageBlock", label: id, hint: "hint", keywords: id };
}

const index = buildIndex();

describe("buildStudioSearchIndex", () => {
  it("covers the shell, page blocks and detail tabs", () => {
    expect(index.find((item) => item.id === "navHome")).toMatchObject({
      scope: "global",
      kind: "navTab",
    });
    expect(index.find((item) => item.id === "libGrid")).toMatchObject({
      scope: "library",
      kind: "pageBlock",
    });
    expect(
      index.find((item) => item.id === "overview" && item.scope === "game"),
    ).toMatchObject({
      scope: "game",
      kind: "detailTab",
    });
  });

  it("indexes every page the rail groups", () => {
    const pageScopes = new Set(index.map((item) => item.scope));
    for (const group of STUDIO_NAV_GROUPS) {
      for (const page of group.pages) {
        expect(pageScopes.has(page)).toBe(true);
      }
    }
  });

  it("finds a nav tab through searchStudioIndex", () => {
    const hits = searchStudioIndex(index, "Library");
    expect(hits.some((item) => item.id === "navLibrary")).toBe(true);
  });
});

describe("searchStudioIndex", () => {
  it("requires every term and ignores case", () => {
    const lowercase = searchStudioIndex(index, "game tab", 500);
    const uppercase = searchStudioIndex(index, "GAME TAB", 500);
    expect(lowercase.some((item) => item.kind === "detailTab")).toBe(true);
    expect(uppercase.map((item) => item.id)).toEqual(lowercase.map((item) => item.id));
  });

  it("returns nothing for a query that matches no element", () => {
    expect(searchStudioIndex(index, "qqqzzz")).toEqual([]);
  });

  it("never searches on an empty or whitespace-only query", () => {
    expect(searchStudioIndex(index, "   ")).toEqual([]);
    expect(searchStudioIndex(index, "")).toEqual([]);
  });
});

describe("capability gating", () => {
  const idsForScope = (list: StudioSearchEntry[], scope: InterfacePageKey) =>
    new Set(list.filter((item) => item.scope === scope).map((item) => item.id));

  it("drops the Linux-only top-bar buttons when the full Linux UI is off", () => {
    const withoutLinux = buildIndex({ showFullLinuxUi: false });
    const withLinux = buildIndex({ showFullLinuxUi: true });

    expect(idsForScope(withoutLinux, "game").has("wineLogs")).toBe(false);
    expect(idsForScope(withoutLinux, "game").has("editCompatibility")).toBe(false);
    expect(idsForScope(withLinux, "game").has("wineLogs")).toBe(true);
    expect(idsForScope(withLinux, "game").has("editCompatibility")).toBe(true);
    expect(idsForScope(withoutLinux, "game").has("back")).toBe(true);
  });

  it("keeps the Deck flag from inventing a Deck-only detail tab", () => {
    // "protonDb" is a detail section rather than a detail tab, so no detail-tab
    // entry is Deck-gated today; the flag must not surface one either way.
    const withoutDeck = buildIndex({ showDeckVerified: false });
    const withDeck = buildIndex({ showDeckVerified: true });
    const tabIds = (list: StudioSearchEntry[]) =>
      list.filter((item) => item.kind === "detailTab").map((item) => item.id);

    expect(tabIds(withoutDeck)).not.toContain("protonDb");
    expect(tabIds(withDeck)).not.toContain("protonDb");
    expect(tabIds(withDeck)).toEqual(tabIds(withoutDeck));
  });
});

describe("groupStudioSearchResults", () => {
  it("keeps entries of one scope together and preserves their order", () => {
    const groups = groupStudioSearchResults([
      entry("a", "global"),
      entry("b", "library"),
      entry("c", "global"),
      entry("d", "game"),
    ]);

    expect(groups.map((group) => group.scope)).toEqual(["global", "library", "game"]);
    expect(groups[0].entries.map((item) => item.id)).toEqual(["a", "c"]);
    expect(groups[1].entries.map((item) => item.id)).toEqual(["b"]);
  });

  it("groups real search hits, keeping each scope's hits in rank order", () => {
    const hits = searchStudioIndex(index, "library", 500);
    const grouped = groupStudioSearchResults(hits);
    const rank = new Map(hits.map((item, position) => [item.id, position]));

    expect(hits.length).toBeGreaterThan(0);
    for (const group of grouped) {
      const ranks = group.entries.map((item) => rank.get(item.id));
      expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
      expect(new Set(group.entries.map((item) => item.scope))).toEqual(new Set([group.scope]));
    }
    expect(grouped.reduce((total, group) => total + group.entries.length, 0)).toBe(hits.length);
  });
});

describe("studioScopeLabel", () => {
  it("falls back to the global label for a scope with no page definition", () => {
    const unknown = "no-such-page" as InterfacePageKey;
    expect(studioScopeLabel(unknown, t)).toBe("settings.studio.scopeGlobal");

    const groups = groupStudioSearchResults([entry("x", unknown), entry("y", "global")]);
    expect(groups.map((group) => studioScopeLabel(group.scope, t))).toEqual([
      "settings.studio.scopeGlobal",
      "settings.studio.scopeGlobal",
    ]);
  });

  it("uses the page's own label key for a known scope", () => {
    expect(studioScopeLabel("library", t)).toBe("nav.library");
  });
});
