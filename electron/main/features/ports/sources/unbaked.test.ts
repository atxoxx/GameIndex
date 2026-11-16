import { describe, expect, it } from "vitest";
import { parseUnbakedGame } from "./unbaked";

const detail = {
  title: "Mindustry",
  platform: "PC",
  runs_on: ["Windows", "macOS", "Linux"],
  projects: [
    {
      name: "Mindustry",
      url: "https://github.com/Anuken/Mindustry",
      methods: ["Source release", "Agent environment"],
      toolchain: "Java",
      stars: 29736,
      runs_on: [],
      description: "The automation tower defense RTS",
      notes: "Open-source Java RTS/automation",
    },
    {
      name: "Mindustry Classic",
      url: "not a url",
      methods: ["Reimplementation"],
      toolchain: null,
      stars: null,
      runs_on: ["Android"],
      description: "",
      notes: "",
    },
    { name: "" },
  ],
};

describe("parseUnbakedGame", () => {
  it("maps every project in a game detail", () => {
    const projects = parseUnbakedGame(detail, "mindustry");
    expect(projects).toHaveLength(2);
    expect(projects[0]).toMatchObject({
      source: "unbaked",
      sourceUrl: "https://unbaked.games/games/mindustry/",
      game: "Mindustry",
      platform: "PC",
      portName: "Mindustry",
      origin: "Source release",
      status: "",
      languages: "Java",
      stars: 29736,
      communityRating: null,
      realRating: null,
      group: "",
    });
    expect(projects[0].notes).toBe(
      "The automation tower defense RTS — Open-source Java RTS/automation",
    );
    expect(projects[0].links).toEqual([
      { label: "Mindustry", url: "https://github.com/Anuken/Mindustry", kind: "github" },
    ]);
  });

  it("uses project runs_on when present and falls back to the game's", () => {
    const projects = parseUnbakedGame(detail, "mindustry");
    expect(projects[0].targets).toEqual(["Windows", "macOS", "Linux"]);
    expect(projects[1].targets).toEqual(["Android"]);
    expect(parseUnbakedGame({ projects: [{ name: "X" }] }, "x")[0].targets).toEqual([]);
  });

  it("maps the documented methods and passes unknown ones through", () => {
    const methods = [
      "",
      "Static recomp",
      "Matching decomp",
      "AI-assisted decomp",
      "Decomp",
      "Disassembly",
      "Reimplementation",
      "Source release",
      "Source port",
      "Native port",
      "Runtime port",
      "Readable bytecode",
      "Agent environment",
      "Homebrew",
    ];
    const projects = parseUnbakedGame(
      { projects: methods.map((method) => ({ name: method || "unnamed", methods: [method] })) },
      "game",
    );
    expect(projects.map((project) => project.origin)).toEqual([
      "",
      "Recompilation",
      "Decompilation",
      "Decompilation",
      "Decompilation",
      "Disassembly",
      "Reimplementation",
      "Source release",
      "Source port",
      "Source port",
      "Source port",
      "Readable bytecode",
      "Agent environment",
      "Homebrew",
    ]);
  });

  it("keeps a non-http repo as no links and a missing toolchain as no languages", () => {
    const projects = parseUnbakedGame(detail, "mindustry");
    expect(projects[1].links).toEqual([]);
    expect(projects[1].languages).toBe("");
    expect(projects[1].stars).toBeNull();
    expect(projects[1].notes).toBe("");
    expect(projects[1].origin).toBe("Reimplementation");
  });

  it("derives gitlab and website link kinds", () => {
    const projects = parseUnbakedGame(
      {
        projects: [
          { name: "GitLab port", url: "https://gitlab.com/example/port" },
          { name: "Site port", url: "https://example.com/port" },
        ],
      },
      "game",
    );
    expect(projects.map((project) => project.links[0]?.kind)).toEqual(["gitlab", "website"]);
  });
});
