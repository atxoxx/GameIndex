import { describe, expect, it } from "vitest";
import { parseRecompfyiPayload } from "./recompfyi";

const payload = {
  projects: [
    {
      game: "The Legend of Zelda: Majora's Mask",
      system: ["N64", "GameCube"],
      type: "recomp",
      project: "Zelda 64: Recompiled",
      repo: "https://github.com/Zelda64Recomp/Zelda64Recomp",
      status: "playable",
      language: "C",
      description: "Static recompilation for PC",
      notes: "Progress tracked on ByteMatch",
      targets: ["Windows", "macOS"],
      builds: ["Windows", "Linux"],
      page: "/game/the-legend-of-zelda-majoras-mask-n64",
      links: [
        { label: "Discord", url: "https://discord.gg/example" },
        { url: "https://github.com/Zelda64Recomp/Zelda64Recomp" },
        { label: "Site", url: "https://zelda64.dev/" },
      ],
    },
    { game: "Doom", system: "PC", type: "decomp", project: "Doom decomp", status: "in-progress" },
    { game: "Sonic", system: "Genesis", type: "port", project: "Sonic port", status: "released" },
    { game: "Mario", system: "N64", type: "wrapper", project: "Mario wrapper", status: "unknown" },
    { game: "", project: "Missing game" },
    { game: "Missing project", project: "" },
  ],
};

describe("parseRecompfyiPayload", () => {
  it("maps types and statuses and keeps the source's platform label", () => {
    const projects = parseRecompfyiPayload(payload);
    expect(projects).toHaveLength(4);
    expect(projects[0]).toMatchObject({
      source: "recompfyi",
      sourceUrl: "https://recomp.fyi/game/the-legend-of-zelda-majoras-mask-n64",
      game: "The Legend of Zelda: Majora's Mask",
      platform: "N64",
      portName: "Zelda 64: Recompiled",
      origin: "Recompilation",
      status: "Playable",
      languages: "C",
      stars: null,
      communityRating: null,
      realRating: null,
      group: "",
    });
    expect(projects.map((project) => [project.origin, project.status])).toEqual([
      ["Recompilation", "Playable"],
      ["Decompilation", "In progress"],
      ["Port", "Released"],
      ["Wrapper", ""],
    ]);
    // A plain string system is used as-is; a row without a page points at the site.
    expect(projects[1].platform).toBe("PC");
    expect(projects[1].sourceUrl).toBe("https://recomp.fyi/");
  });

  it("joins notes and unions targets with builds", () => {
    const [first] = parseRecompfyiPayload(payload);
    expect(first.notes).toBe("Static recompilation for PC — Progress tracked on ByteMatch");
    expect(first.targets).toEqual(["Windows", "macOS", "Linux"]);
  });

  it("dedupes repo and links by URL and derives link kinds from the host", () => {
    const [first] = parseRecompfyiPayload(payload);
    expect(first.links.map((link) => [link.url, link.kind])).toEqual([
      ["https://github.com/Zelda64Recomp/Zelda64Recomp", "github"],
      ["https://discord.gg/example", "website"],
      ["https://zelda64.dev/", "website"],
    ]);
    expect(first.links[0].label).toBe("https://github.com/Zelda64Recomp/Zelda64Recomp");
    expect(first.links[1].label).toBe("Discord");
  });

  it("omits rows without a game or project and caps the result", () => {
    expect(parseRecompfyiPayload({ projects: [{ game: "A" }, { project: "B" }, {}] })).toEqual([]);
    const many = {
      projects: Array.from({ length: 10_005 }, (_, index) => ({
        game: `Game ${index}`,
        project: `Project ${index}`,
      })),
    };
    expect(parseRecompfyiPayload(many)).toHaveLength(10_000);
  });

  it("accepts a bare array payload", () => {
    expect(parseRecompfyiPayload([{ game: "Doom", project: "Doom port" }])).toHaveLength(1);
  });
});
