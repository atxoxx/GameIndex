import { describe, expect, it } from "vitest";

import type { PortSourceProject } from "../../../../../src/types/port";
import { mergePortSources, normalizeTitle, repoKeyOf, isSameGameTitle } from "./merge";
import { canonicalPlatform, canonicalTarget, sortTargets, vendorForPlatform } from "./platforms";

function entry(overrides: Partial<PortSourceProject>): PortSourceProject {
  return {
    source: "pcgamingwiki",
    sourceUrl: "https://example.com",
    game: "Game",
    platform: "N64",
    portName: "Project",
    origin: "Decompilation",
    status: "Playable",
    languages: "C",
    notes: "",
    links: [],
    stars: null,
    targets: [],
    communityRating: null,
    realRating: null,
    ...overrides,
  };
}

const repo = (path = "owner/repo") => ({
  label: "repo",
  url: `https://github.com/${path}`,
  kind: "github" as const,
});

describe("platform normalization", () => {
  it("folds source-specific labels into one name", () => {
    expect(canonicalPlatform("N64")).toBe("Nintendo 64");
    expect(canonicalPlatform("nintendo 64")).toBe("Nintendo 64");
    expect(canonicalPlatform("ps1")).toBe("PlayStation");
    expect(canonicalPlatform("PC (Windows)")).toBe("PC");
    expect(canonicalPlatform("PC (DOS)")).toBe("DOS");
    expect(canonicalPlatform("n64")).toBe(canonicalPlatform("Nintendo 64"));
  });

  it("normalizes target platforms and keeps the card trio first", () => {
    expect(canonicalTarget("windows")).toBe("Windows");
    expect(canonicalTarget("macOS")).toBe("macOS");
    expect(canonicalTarget("Switch")).toBe("Nintendo Switch");
    expect(canonicalTarget("something odd")).toBeNull();
    expect(sortTargets(["Linux", "Android", "Windows", "macOS"])).toEqual([
      "Windows",
      "macOS",
      "Linux",
      "Android",
    ]);
  });

  it("derives the vendor family", () => {
    expect(vendorForPlatform("Nintendo 64")).toBe("Nintendo");
    expect(vendorForPlatform("PlayStation 2")).toBe("Sony");
    expect(vendorForPlatform("Xbox 360")).toBe("Microsoft");
    expect(vendorForPlatform("Genesis")).toBe("SEGA");
    expect(vendorForPlatform("PC")).toBe("PC");
  });
});

describe("repoKeyOf", () => {
  it("drops blob paths, .git and case", () => {
    expect(
      repoKeyOf({
        label: "x",
        url: "https://github.com/Owner/Repo/blob/main/README.md",
        kind: "github",
      }),
    ).toBe("github:owner/repo");
    expect(
      repoKeyOf({ label: "x", url: "https://github.com/owner/repo.git", kind: "github" }),
    ).toBe("github:owner/repo");
  });

  it("ignores plain websites", () => {
    expect(repoKeyOf({ label: "x", url: "https://example.com", kind: "website" })).toBeNull();
  });
});

describe("mergePortSources", () => {
  it("merges the same repo across sources and unions their facts", () => {
    const merged = mergePortSources([
      entry({
        source: "recompfyi",
        game: "Banjo-Kazooie",
        platform: "N64",
        portName: "BanjoRecomp",
        origin: "Recompilation",
        status: "In progress",
        languages: "C/C++",
        links: [repo()],
        targets: ["Windows", "Linux"],
        stars: 120,
        sourceUrl: "https://recomp.fyi/game/banjo-n64",
      }),
      entry({
        source: "gameport",
        game: "Banjo-Kazooie",
        platform: "N64",
        portName: "BanjoRecomp",
        origin: "Recompilation",
        status: "Playable",
        languages: "C",
        links: [repo("Owner/Repo/")],
        targets: ["macOS", "Windows"],
        stars: 340,
        communityRating: 4.4,
        sourceUrl: "https://gameport.games/projects/github-com-owner-repo",
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      game: "Banjo-Kazooie",
      platform: "Nintendo 64",
      status: "Playable",
      stars: 340,
      communityRating: 4.4,
      group: "Nintendo",
    });
    expect(merged[0].links).toHaveLength(1);
    expect(merged[0].platforms).toEqual(["Windows", "macOS", "Linux"]);
    expect(merged[0].sources.map((source) => source.id)).toEqual(["gameport", "recompfyi"]);
  });

  it("keeps different repos of the same game separate", () => {
    const merged = mergePortSources([
      entry({ source: "gameport", links: [repo("a/one")], sourceUrl: "g1" }),
      entry({ source: "recompfyi", links: [repo("b/two")], sourceUrl: "r1" }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("does not collapse a multi-game repo into one card", () => {
    const merged = mergePortSources([
      entry({ source: "decomps", game: "Alien vs. Predator", links: [repo("tmcleroy/cps2")] }),
      entry({ source: "decomps", game: "Cadillacs and Dinosaurs", links: [repo("tmcleroy/cps2")] }),
      entry({ source: "pcgamingwiki", game: "Alien vs. Predator", links: [repo("tmcleroy/cps2")] }),
    ]);
    expect(merged).toHaveLength(2);
    const avp = merged.find((project) => project.game === "Alien vs. Predator");
    expect(avp?.sources.map((source) => source.id)).toEqual(["decomps", "pcgamingwiki"]);
  });

  it("merges the same repo and title across catalogs", () => {
    const merged = mergePortSources([
      entry({ source: "unbaked", game: "Morrowind", links: [repo("openmw/openmw")] }),
      entry({ source: "gameport", game: "Morrowind", links: [repo("openmw/openmw")] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((source) => source.id)).toEqual(["gameport", "unbaked"]);
  });

  it("merges a shortened title with its subtitle on the same repo", () => {
    const merged = mergePortSources([
      entry({
        source: "recompfyi",
        game: "ACE COMBAT X",
        links: [repo("sal063/ace-combat-x")],
      }),
      entry({
        source: "gameport",
        game: "Ace Combat X: Skies of Deception",
        links: [repo("sal063/ace-combat-x")],
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].game).toBe("Ace Combat X: Skies of Deception");
    expect(merged[0].sources.map((source) => source.id)).toEqual([
      "gameport",
      "recompfyi",
    ]);
  });

  it("keeps numbered sequels apart even on the same repo", () => {
    expect(isSameGameTitle("Doom", "Doom 64")).toBe(false);
    expect(isSameGameTitle("ACE COMBAT X", "Ace Combat X: Skies of Deception")).toBe(true);
  });

  it("attaches a repo-less row to the matching project title", () => {
    const merged = mergePortSources([
      entry({ source: "gameport", links: [repo()], sourceUrl: "g1" }),
      entry({ source: "decomps", links: [], sourceUrl: "d1", status: "" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((source) => source.id)).toEqual(["gameport", "decomps"]);
  });

  it("falls back to the next source for empty status, origin and language", () => {
    const [merged] = mergePortSources([
      entry({
        source: "gameport",
        status: "",
        origin: "",
        languages: "",
        links: [repo()],
      }),
      entry({
        source: "recompfyi",
        status: "In progress",
        origin: "Recompilation",
        languages: "C++",
        links: [repo()],
      }),
    ]);
    expect(merged.status).toBe("In progress");
    expect(merged.origin).toBe("Recompilation");
    expect(merged.languages).toBe("C++");
  });

  it("normalizes titles for matching", () => {
    expect(normalizeTitle("The Legend of Zelda: Majora's Mask")).toBe(
      normalizeTitle("the legend of zelda majoras mask"),
    );
  });
});
