import { describe, expect, it } from "vitest";

import { parsePortsHtml } from "./parse";

const FIXTURE = `
<div class="mw-parser-output">
  <h1><span class="mw-headline" id="Multiplatform">Multiplatform</span><span class="mw-editsection">[edit]</span></h1>
  <h3><span class="mw-headline" id="Arcade">Arcade</span><span class="mw-editsection">[edit]</span></h3>
  <table class="wikitable sortable">
    <tbody>
      <tr>
        <th>Game</th><th>Port name</th><th>Origin of Port</th><th>Status</th>
        <th>Code Language</th><th>REAL rating</th><th>Notes</th>
      </tr>
      <tr>
        <td><a href="/w/index.php?title=Alien_vs._Predator&amp;action=edit&amp;redlink=1" class="new">Alien vs. Predator</a></td>
        <td><a rel="nofollow" class="external text" href="https://github.com/tmcleroy/cps2recomp/blob/main/games/avsp/README.md">CPS-2 Recomp</a></td>
        <td>Recompilation</td><td>Playable</td><td>C++</td><td></td><td>cps2recomp</td>
      </tr>
      <tr>
        <td><a href="/wiki/Super_Mario_64" title="Super Mario 64">Super Mario 64</a></td>
        <td>
          <a rel="nofollow" href="https://github.com/n64decomp/sm64">Super Mario 64</a>
          <a rel="nofollow" href="https://github.com/sm64-port/sm64-port">Super Mario 64 Port</a>
        </td>
        <td>Decompilation</td><td>Playable</td><td>C</td>
        <td><img src="https://thumbnails.pcgamingwiki.com/9/94/REAL_AI_rating_3.png/15px-REAL_AI_rating_3.png" /></td>
        <td>Original project and forks</td>
      </tr>
    </tbody>
  </table>

  <h1><span class="mw-headline" id="SEGA">SEGA</span></h1>
  <h3><span class="mw-headline" id="Arcade_2">Arcade</span></h3>
  <table class="wikitable sortable">
    <tbody>
      <tr>
        <th>Game</th><th>Port name</th><th>Origin of Port</th><th>Status</th>
        <th>Code Language</th><th>REAL rating</th><th>Notes</th>
      </tr>
      <tr>
        <td>Scud Race</td>
        <td><a rel="nofollow" href="https://gitlab.com/example/scud-race">Scud-Race</a></td>
        <td>Decompilation</td><td>Development</td><td>C</td><td></td><td></td>
      </tr>
    </tbody>
  </table>

  <h1><span class="mw-headline" id="Nintendo">Nintendo</span></h1>
  <h3><span class="mw-headline" id="Nintendo_64">Nintendo 64</span></h3>
  <table class="wikitable sortable">
    <tbody>
      <tr>
        <th>Game</th><th>Port name</th><th>Origin of Port</th><th>Status</th>
        <th>Code Language</th><th>REAL rating</th><th>Notes</th>
      </tr>
      <tr>
        <td>MoonShip Test</td>
        <td>MoonShip</td>
        <td>Decompilation</td><td>Planned</td><td></td><td></td><td>Libultraship</td>
      </tr>
    </tbody>
  </table>
</div>
`;

describe("parsePortsHtml", () => {
  const projects = parsePortsHtml(FIXTURE);

  it("reads every row and keeps section context", () => {
    expect(projects).toHaveLength(4);
    expect(projects.map((project) => project.game)).toEqual([
      "Alien vs. Predator",
      "Super Mario 64",
      "Scud Race",
      "MoonShip Test",
    ]);
    expect(projects[0].group).toBe("Multiplatform");
    expect(projects[3].group).toBe("Nintendo");
    expect(projects[3].platform).toBe("Nintendo 64");
  });

  it("uses the first link label as the project name and keeps every link", () => {
    const sm64 = projects.find((project) => project.game === "Super Mario 64");
    expect(sm64?.portName).toBe("Super Mario 64");
    expect(sm64?.links).toHaveLength(2);
    expect(sm64?.links[1].url).toBe("https://github.com/sm64-port/sm64-port");
    expect(sm64?.links[0].kind).toBe("github");
  });

  it("extracts status, origin, language, REAL rating and notes", () => {
    const sm64 = projects.find((project) => project.game === "Super Mario 64");
    expect(sm64).toMatchObject({
      origin: "Decompilation",
      status: "Playable",
      languages: "C",
      realRating: 3,
      notes: "Original project and forks",
    });
  });

  it("keeps rows without links and only links real wiki pages", () => {
    const moonShip = projects.find((project) => project.game === "MoonShip Test");
    expect(moonShip?.links).toEqual([]);
    expect(moonShip?.portName).toBe("MoonShip");
    expect(moonShip?.wikiUrl).toBeUndefined();

    const sm64 = projects.find((project) => project.game === "Super Mario 64");
    expect(sm64?.wikiUrl).toBe("https://www.pcgamingwiki.com/wiki/Super_Mario_64");

    const avp = projects.find((project) => project.game === "Alien vs. Predator");
    expect(avp?.wikiUrl).toBeUndefined();
  });

  it("qualifies duplicate platform names with their family", () => {
    expect(projects[0].platform).toBe("Arcade (Multiplatform)");
    expect(projects[2].platform).toBe("Arcade (SEGA)");
  });

  it("gives every row a stable unique id", () => {
    const ids = projects.map((project) => project.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toContain("alien-vs-predator");
  });
});
