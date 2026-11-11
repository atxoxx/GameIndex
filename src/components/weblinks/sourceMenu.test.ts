import { describe, it, expect } from "vitest";
import { groupSourcesByCategory, matchesSourceQuery } from "./sourceMenu";
import type { SourceDef } from "./types";

function source(
  partial: Pick<SourceDef, "key" | "label" | "category"> &
    Partial<SourceDef>,
): SourceDef {
  return {
    accent: "var(--color-accent)",
    iconBg: "var(--color-bg-tertiary)",
    icon: null,
    ...partial,
  };
}

const SOURCES: SourceDef[] = [
  source({ key: "reddit", label: "Reddit", category: "community" }),
  source({ key: "steam", label: "Steam", category: "stores" }),
  source({ key: "nexusmods", label: "NexusMods", category: "modding" }),
  source({ key: "steamgriddb", label: "SteamGridDB", category: "modding" }),
  source({ key: "steamdb", label: "SteamDB", category: "stores" }),
  source({ key: "protondb", label: "ProtonDB", category: "wikis" }),
  source({
    key: "https://example.com/wiki",
    label: "Example",
    category: "mylinks",
    url: "https://example.com/wiki",
  }),
];

describe("groupSourcesByCategory", () => {
  it("orders groups by category, not by input order", () => {
    expect(groupSourcesByCategory(SOURCES).map((group) => group.key)).toEqual([
      "stores",
      "wikis",
      "community",
      "modding",
      "mylinks",
    ]);
  });

  it("keeps the sources inside each group in their input order", () => {
    const stores = groupSourcesByCategory(SOURCES).find(
      (group) => group.key === "stores",
    );
    expect(stores?.sources.map((s) => s.key)).toEqual(["steam", "steamdb"]);
  });

  it("skips categories with no sources", () => {
    const onlyStoresAndModding = SOURCES.filter(
      (s) => s.category === "stores" || s.category === "modding",
    );
    expect(
      groupSourcesByCategory(onlyStoresAndModding).map((group) => group.key),
    ).toEqual(["stores", "modding"]);
  });

  it("filters across every group and drops groups left empty", () => {
    const groups = groupSourcesByCategory(SOURCES, "steam");
    expect(groups.map((group) => group.key)).toEqual(["stores", "modding"]);
    expect(groups.flatMap((group) => group.sources.map((s) => s.key))).toEqual([
      "steam",
      "steamdb",
      "steamgriddb",
    ]);
  });

  it("matches the host of a custom link", () => {
    const groups = groupSourcesByCategory(SOURCES, "example.com");
    expect(groups.map((group) => group.key)).toEqual(["mylinks"]);
    expect(groups[0].sources[0].label).toBe("Example");
  });

  it("returns no groups when nothing matches", () => {
    expect(groupSourcesByCategory(SOURCES, "no-such-source")).toEqual([]);
  });

  it("ignores surrounding whitespace and letter case", () => {
    expect(matchesSourceQuery(SOURCES[1], "  STEAM ")).toBe(true);
    expect(matchesSourceQuery(SOURCES[1], "   ")).toBe(true);
  });
});
