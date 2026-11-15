import { describe, it, expect } from "vitest";
import type { DisplayMatch } from "./types";
import {
  ALL_SOURCES_ENTRY_ID,
  PLUGIN_ENTRY_ID,
  buildSourceNavEntries,
  groupMatchesBySource,
  sourceEntryMatches,
  sourceInitials,
} from "./sourceNavigation";

function match(overrides: Partial<DisplayMatch> = {}): DisplayMatch {
  return {
    sourceName: "Source",
    sourceId: "source",
    title: "Game",
    fileSize: "1 GB",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0.9,
    isNew: false,
    provider: "source",
    id: "id",
    ...overrides,
  };
}

describe("buildSourceNavEntries", () => {
  it("puts all results first, then built-in sources alphabetically, then plugins", () => {
    const matches = [
      match({ id: "1", sourceId: "alpha", sourceName: "Alpha" }),
      match({ id: "2", sourceId: "zeta", sourceName: "Zeta" }),
      match({ id: "3", sourceId: "alpha", sourceName: "Alpha" }),
      match({ id: "4", sourceId: "mid", sourceName: "mid" }),
      match({
        id: "5",
        provider: "plugin",
        sourceId: "plugin-a",
        sourceName: "Plugin A",
        pluginId: "plugin-a",
      }),
      match({
        id: "6",
        provider: "plugin",
        sourceId: "plugin-b",
        sourceName: "Plugin B",
        pluginId: "plugin-b",
      }),
    ];

    const entries = buildSourceNavEntries(matches, "All sources", "Plugins");

    expect(entries.map((entry) => entry.id)).toEqual([
      ALL_SOURCES_ENTRY_ID,
      "alpha",
      "mid",
      "zeta",
      PLUGIN_ENTRY_ID,
    ]);
    expect(entries.map((entry) => entry.count)).toEqual([6, 2, 1, 1, 2]);
    expect(entries.map((entry) => entry.provider)).toEqual([
      "all",
      "source",
      "source",
      "source",
      "plugin",
    ]);
    expect(entries[0].label).toBe("All sources");
    expect(entries[entries.length - 1].label).toBe("Plugins");
  });

  it("omits the plugin entry when no plugin results exist", () => {
    const entries = buildSourceNavEntries(
      [match({ id: "1", sourceId: "alpha", sourceName: "Alpha" })],
      "All",
      "Plugins",
    );

    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.provider === "plugin")).toBe(false);
  });

  it("returns only the aggregate entry for empty input", () => {
    expect(buildSourceNavEntries([], "All", "Plugins")).toEqual([
      { id: ALL_SOURCES_ENTRY_ID, label: "All", count: 0, provider: "all" },
    ]);
  });

  it("keeps real source identity: ids use sourceId, names are labels", () => {
    const entries = buildSourceNavEntries(
      [
        match({ id: "1", sourceId: "sg-id", sourceName: "FitGirl" }),
        // Same source, different spelling of the display name.
        match({ id: "2", sourceId: "sg-id", sourceName: "FitGirl Repacks" }),
        // No sourceId: identity falls back to the name.
        match({ id: "3", sourceId: "", sourceName: "DODI" }),
      ],
      "All",
      "Plugins",
    );

    expect(entries.map((entry) => entry.id)).toEqual(["all", "DODI", "sg-id"]);
    expect(entries.find((entry) => entry.id === "sg-id")?.label).toBe("FitGirl");
    expect(entries.find((entry) => entry.id === "sg-id")?.count).toBe(2);
    expect(entries.find((entry) => entry.id === "DODI")?.count).toBe(1);
  });
});

describe("sourceEntryMatches", () => {
  const builtIn = match({
    id: "a",
    sourceId: "alpha",
    sourceName: "Alpha Source",
  });
  const plugin = match({
    id: "b",
    provider: "plugin",
    sourceId: "plug",
    sourceName: "Plugin Hit",
    pluginId: "plug",
  });

  it("matches every result for the aggregate entry", () => {
    expect(sourceEntryMatches(builtIn, "all")).toBe(true);
    expect(sourceEntryMatches(plugin, "all")).toBe(true);
    expect(sourceEntryMatches(plugin, "")).toBe(true);
  });

  it("matches only plugin results for the plugin bucket", () => {
    expect(sourceEntryMatches(plugin, "plugin")).toBe(true);
    expect(sourceEntryMatches(builtIn, "plugin")).toBe(false);
  });

  it("matches only built-in results for the source alias", () => {
    expect(sourceEntryMatches(builtIn, "source")).toBe(true);
    expect(sourceEntryMatches(plugin, "source")).toBe(false);
  });

  it("matches a single source by id or case-insensitive name", () => {
    expect(sourceEntryMatches(builtIn, "alpha")).toBe(true);
    expect(sourceEntryMatches(builtIn, "alpha source")).toBe(true);
    expect(sourceEntryMatches(builtIn, "ALPHA SOURCE")).toBe(true);
    expect(sourceEntryMatches(builtIn, "beta")).toBe(false);
  });

  it("matches plugin rows by plugin id when listed individually", () => {
    expect(sourceEntryMatches(plugin, "plug")).toBe(true);
    expect(sourceEntryMatches(plugin, "plugin hit")).toBe(true);
    expect(sourceEntryMatches(plugin, "other")).toBe(false);
  });
});

describe("groupMatchesBySource", () => {
  it("orders groups like the rail and preserves per-group match order", () => {
    const matches = [
      match({ id: "z1", sourceId: "zeta", sourceName: "Zeta" }),
      match({ id: "a1", sourceId: "alpha", sourceName: "Alpha" }),
      match({
        id: "p1",
        provider: "plugin",
        sourceId: "plug",
        sourceName: "Plugin",
        pluginId: "plug",
      }),
      match({ id: "z2", sourceId: "zeta", sourceName: "Zeta" }),
      match({ id: "a2", sourceId: "alpha", sourceName: "Alpha" }),
      match({
        id: "p2",
        provider: "plugin",
        sourceId: "plug",
        sourceName: "Plugin",
        pluginId: "plug",
      }),
    ];

    const groups = groupMatchesBySource(matches, { plugin: "Plugins" });

    expect(groups.map((group) => group.id)).toEqual([
      "alpha",
      "zeta",
      PLUGIN_ENTRY_ID,
    ]);
    expect(groups.map((group) => group.provider)).toEqual([
      "source",
      "source",
      "plugin",
    ]);
    expect(groups[0].matches.map((item) => item.id)).toEqual(["a1", "a2"]);
    expect(groups[1].matches.map((item) => item.id)).toEqual(["z1", "z2"]);
    expect(groups[2].matches.map((item) => item.id)).toEqual(["p1", "p2"]);
    expect(groups[2].label).toBe("Plugins");
  });

  it("supports label overrides and empty input", () => {
    const groups = groupMatchesBySource(
      [match({ id: "1", sourceId: "alpha", sourceName: "Alpha" })],
      { plugin: "Plugins", sources: { alpha: "Alpha (mirror)" } },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Alpha (mirror)");
    expect(groupMatchesBySource([], { plugin: "Plugins" })).toEqual([]);
  });

  it("does not create a plugin group when only built-in results exist", () => {
    const groups = groupMatchesBySource(
      [match({ id: "1", sourceId: "alpha", sourceName: "Alpha" })],
      { plugin: "Plugins" },
    );

    expect(groups.map((group) => group.id)).toEqual(["alpha"]);
  });
});

describe("sourceInitials", () => {
  it("derives initials from the first two words", () => {
    expect(sourceInitials("FitGirl Repacks")).toBe("FR");
    expect(sourceInitials("Alpha Source")).toBe("AS");
  });

  it("uses the first two characters for a single word", () => {
    expect(sourceInitials("DODI")).toBe("DO");
  });

  it("returns a glyph for a blank label", () => {
    expect(sourceInitials("   ")).toBe("?");
  });
});
