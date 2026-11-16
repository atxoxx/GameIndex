import { describe, expect, it } from "vitest";

import { parseDecompsGamePage, parseDecompsList, repoKeyFromHref } from "./decomps";

/** Trimmed to the containers the parser reads, from https://decomps.net/?p=1&f=1 */
const LIST_FIXTURE = `
<div class="win">
  <div class="bar"><span class="bar-title">popular</span></div>
  <div class="row thr">
    <div class="pj-l">
      <a href="/game/super-mario-64-fzBsCMucXe" tabindex="-1" aria-hidden="true"><img class="pj-th" src="/media/thumbs/fzBsCMucXe.jpg" alt="" width="64" height="64"></a>
      <div class="thr-main">
        <h3 class="t17 pj-t"><span class="kind pc5">N64</span><span class="kind k-decompilation">Decompilation</span><a class="lnk" href="/game/super-mario-64-fzBsCMucXe">Super Mario 64</a><span class="hint">1996</span></h3>
        <p class="hint"><a class="tl" href="/progress/n64decomp/sm64">n64decomp/sm64</a> · C</p>
        <p class="f14 muted lh15">A Super Mario 64 decompilation, brought to you by a bunch of clever folks.</p>
      </div>
    </div>
    <div class="thr-meta"><span title="Stars on github.com">★ 9K</span><span>active 2 years ago</span></div>
  </div>
  <div class="row thr">
    <div class="pj-l">
      <div class="thr-main">
        <h3 class="t17 pj-t"><span class="kind pc3">Switch</span><span class="kind k-port">Port</span><a class="lnk" href="/game/the-legend-of-zelda-tears-of-the-kingdom-hg5xLkDkoY">The Legend of Zelda: Tears of the Kingdom</a><span class="hint">2023</span></h3>
        <p class="hint"><a class="tl" href="/progress/ly05010419/MacNativeGames">ly05010419/MacNativeGames</a> · AI-assisted · C</p>
        <p class="f14 muted lh15">Play your own Tears of the Kingdom natively on Apple silicon Mac.</p>
      </div>
    </div>
    <div class="thr-meta"><span title="Stars on github.com">★ 7.9K</span><span>active 9 h ago</span></div>
  </div>
</div>`;

/** Trimmed to two project rows, from https://decomps.net/game/super-mario-64-fzBsCMucXe */
const GAME_PAGE_FIXTURE = `
<div class="win">
  <div class="bar"><span class="bar-title">projects</span></div>
  <div id="ggrid">
    <div class="row thr gprow gk-dec" data-kind="dec" data-stars="8975" data-progress="100">
      <div class="pj-l gpj">
        <div class="thr-main">
          <h3 class="t17 pj-t"><span class="kind k-decompilation">Decompilation</span></h3>
          <p class="hint pj-one"><a class="tl" href="/progress/n64decomp/sm64">n64decomp/sm64</a> · C · CC0-1.0 · 100% matched</p>
          <div class="bcard-acts pj-acts pj-foot"><a class="ghost-sm" href="https://github.com/n64decomp/sm64">Open on GitHub</a><div class="thr-meta pj-meta"><span title="Stars on github.com">★ 9K</span><span>active 2 years ago</span></div></div>
        </div>
      </div>
    </div>
    <div class="row thr gprow gk-port" data-kind="port" data-stars="1885">
      <div class="pj-l gpj">
        <div class="thr-main">
          <h3 class="t17 pj-t"><span class="kind k-port">Port</span><span class="kind" title="Runs on, read from the project's releases and README">Windows</span><span class="kind" title="Runs on, read from the project's releases and README">Linux</span></h3>
          <p class="hint pj-one"><a class="tl" href="/progress/sm64pc/sm64ex">sm64pc/sm64ex</a> · C</p>
        </div>
      </div>
    </div>
  </div>
</div>`;

describe("repoKeyFromHref", () => {
  it("normalizes site progress links and full repository URLs", () => {
    expect(repoKeyFromHref("/progress/n64decomp/sm64")).toBe("github:n64decomp/sm64");
    expect(repoKeyFromHref("/progress/diasurgical/DevilutionX")).toBe(
      "github:diasurgical/devilutionx",
    );
    expect(repoKeyFromHref("https://github.com/ppy/osu.git")).toBe("github:ppy/osu");
    expect(repoKeyFromHref("https://gitlab.com/OpenMW/openmw")).toBe("gitlab:openmw/openmw");
    expect(repoKeyFromHref("gitlab:owner/repo")).toBe("gitlab:owner/repo");
    expect(repoKeyFromHref("")).toBe("");
  });
});

describe("parseDecompsList", () => {
  const projects = parseDecompsList(LIST_FIXTURE, "https://decomps.net/?p=1&f=1");

  it("reads one project per .row.thr and ignores the game-page rows", () => {
    expect(projects).toHaveLength(2);
  });

  it("maps the row cells without canonicalizing platform or origin", () => {
    const [sm64, totk] = projects;
    expect(sm64).toMatchObject({
      source: "decomps",
      game: "Super Mario 64",
      platform: "N64",
      portName: "n64decomp/sm64",
      origin: "Decompilation",
      status: "",
      languages: "C",
      notes: "A Super Mario 64 decompilation, brought to you by a bunch of clever folks.",
      stars: 9000,
      targets: [],
      sourceUrl: "https://decomps.net/progress/n64decomp/sm64",
      links: [{ label: "n64decomp/sm64", url: "https://github.com/n64decomp/sm64", kind: "github" }],
    });
    expect(totk.platform).toBe("Switch");
    expect(totk.origin).toBe("Port");
  });

  it("keeps the AI-assisted marker next to the language", () => {
    expect(projects[1].languages).toBe("AI-assisted, C");
  });

  it("accepts rows without a repository", () => {
    const rows = parseDecompsList(
      `<div class="row thr"><h3 class="t17 pj-t"><span class="kind pc1">PC</span><a class="lnk" href="/game/x">X</a></h3></div>`,
      "https://decomps.net/?p=1&f=1",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceUrl).toBe("https://decomps.net/game/x");
    expect(rows[0].links).toEqual([]);
  });
});

describe("parseDecompsGamePage", () => {
  const targets = parseDecompsGamePage(GAME_PAGE_FIXTURE);

  it("keys projects by normalized repo and collects the Runs on chips", () => {
    expect(targets.get("github:sm64pc/sm64ex")).toEqual({
      targets: ["Windows", "Linux"],
      stars: 1885,
    });
  });

  it("keeps rows without target chips and uses the exact data-stars", () => {
    expect(targets.get("github:n64decomp/sm64")).toEqual({ targets: [], stars: 8975 });
  });

  it("returns an empty map for pages without project rows", () => {
    expect(parseDecompsGamePage("<html><body></body></html>").size).toBe(0);
  });
});
