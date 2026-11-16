import { describe, expect, it } from "vitest";

import type { VrModEntry } from "../../../types/vrMod";
import {
  dedupeLinks,
  groupVrMods,
  makeLink,
  normalizeGameKey,
  repoKeyOf,
} from "./vrModData";

function entry(overrides: Partial<VrModEntry>): VrModEntry {
  return {
    id: "e",
    gameKey: "game",
    gameTitle: "Game",
    modName: "Mod",
    description: "",
    details: "",
    links: [],
    image: null,
    date: null,
    kind: "dedicated",
    platforms: ["PCVR"],
    sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
    author: null,
    compatibility: null,
    ...overrides,
  };
}

describe("normalizeGameKey", () => {
  it("strips UEVR suffixes, punctuation and accents so variants collapse", () => {
    expect(normalizeGameKey("Ready Or Not (UEVR conversion)")).toBe("ready or not");
    expect(normalizeGameKey("Ready or Not (PC VR)")).toBe("ready or not");
    expect(normalizeGameKey("Pony Town VR Mod")).toBe("pony town");
    expect(normalizeGameKey("Café/Noir")).toBe("cafe noir");
  });
});

describe("repoKeyOf", () => {
  it("normalizes GitHub tree, releases and .git URLs to one key", () => {
    const expected = "github:owner/repo";
    expect(repoKeyOf("https://github.com/Owner/Repo")).toBe(expected);
    expect(repoKeyOf("https://github.com/Owner/Repo.git")).toBe(expected);
    expect(repoKeyOf("https://github.com/owner/repo/tree/main/abc123")).toBe(expected);
    expect(repoKeyOf("https://github.com/owner/repo/releases/tag/v1")).toBe(expected);
  });

  it("returns null for non-repository URLs", () => {
    expect(repoKeyOf("https://www.patreon.com/realvr")).toBeNull();
    expect(repoKeyOf("https://store.steampowered.com/app/123/")).toBeNull();
  });
});

describe("dedupeLinks", () => {
  it("keeps one link per repository and one per plain URL", () => {
    const links = [
      makeLink("Source", "https://github.com/owner/repo/releases"),
      makeLink("Guide", "https://github.com/Owner/Repo/tree/main/readme"),
      makeLink("Patreon", "https://patreon.com/creator"),
      makeLink("Patreon again", "https://patreon.com/creator"),
    ];
    expect(dedupeLinks(links)).toHaveLength(2);
    expect(dedupeLinks(links)[0].repoKey).toBe("github:owner/repo");
  });
});

describe("groupVrMods", () => {
  it("groups entries for one game and dedupes their GitHub links", () => {
    const groups = groupVrMods([
      entry({
        id: "a",
        gameTitle: "Alyssa (UEVR conversion)",
        gameKey: normalizeGameKey("Alyssa (UEVR conversion)"),
        links: [makeLink("Source", "https://github.com/alice/vr-mod/releases")],
        sources: [{ id: "vrportnews", name: "VR Port News", url: "https://vrportnews.com" }],
        date: "2026-01-01",
      }),
      entry({
        id: "b",
        gameTitle: "Alyssa (PC VR)",
        gameKey: normalizeGameKey("Alyssa (PC VR)"),
        links: [makeLink("Source", "https://github.com/Alice/VR-Mod/tree/main")],
        sources: [{ id: "pcvrcentral", name: "PCVR Central", url: "https://pcvrcentral.com/mods/a" }],
        date: "2026-02-01",
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Alyssa");
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].githubLinks).toHaveLength(1);
    expect(groups[0].githubLinks[0].repoKey).toBe("github:alice/vr-mod");
    expect(groups[0].sources.map((source) => source.id)).toEqual(["pcvrcentral", "vrportnews"]);
    expect(groups[0].date).toBe("2026-02-01");
  });
});
