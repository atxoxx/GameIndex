import { describe, expect, it } from "vitest";

import type { PortProject } from "../../types/port";
import { baseGameName, groupPorts } from "./portGroups";

function project(overrides: Partial<PortProject>): PortProject {
  return {
    id: "id",
    game: "Game",
    portName: "Project",
    origin: "Recompilation",
    status: "Playable",
    languages: "C++",
    realRating: null,
    notes: "",
    platform: "Nintendo 64",
    group: "Nintendo",
    links: [],
    ...overrides,
  };
}

describe("baseGameName", () => {
  it("drops a port-disambiguation parenthetical", () => {
    expect(baseGameName("Banjo-Kazooie (Lighthouse)")).toBe("Banjo-Kazooie");
    expect(baseGameName("Super Mario 64 (Coop Deluxe)")).toBe("Super Mario 64");
  });

  it("keeps a year suffix because it identifies a different game", () => {
    expect(baseGameName("Perfect Dark (2000)")).toBe("Perfect Dark (2000)");
  });
});

describe("groupPorts", () => {
  it("groups rows for the same game and platform", () => {
    const groups = groupPorts([
      project({ id: "1", game: "Banjo-Kazooie (Banjo: Recompiled)", portName: "BanjoRecomp" }),
      project({ id: "2", game: "Banjo-Kazooie (Lighthouse)", portName: "Lighthouse", origin: "Decompilation" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].game).toBe("Banjo-Kazooie");
    expect(groups[0].projects.map((item) => item.portName)).toEqual([
      "BanjoRecomp",
      "Lighthouse",
    ]);
  });

  it("keeps the same title on different platforms separate", () => {
    const groups = groupPorts([
      project({ id: "1", game: "San Francisco Rush 2049", platform: "Arcade (Multiplatform)" }),
      project({ id: "2", game: "San Francisco Rush 2049", platform: "Nintendo 64" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("picks the most complete status and flags mixed origins", () => {
    const [group] = groupPorts([
      project({ id: "1", status: "Planned", origin: "Recompilation" }),
      project({ id: "2", status: "Playable", origin: "Decompilation", languages: "" }),
    ]);

    expect(group.status).toBe("Playable");
    expect(group.origin).toBe("");
    expect(group.languages).toBe("C++");
    expect(group.primary.id).toBe("1");
  });

  it("keeps a single shared origin", () => {
    const [group] = groupPorts([
      project({ id: "1", origin: "Recompilation" }),
      project({ id: "2", origin: "Recompilation", status: "Development" }),
    ]);
    expect(group.origin).toBe("Recompilation");
    expect(group.status).toBe("Playable");
  });
});
