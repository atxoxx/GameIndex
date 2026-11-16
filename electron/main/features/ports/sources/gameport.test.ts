import { describe, expect, it } from "vitest";

import { parseGameportDetail, parseGameportList, type RawGameportCard } from "./gameport";

/** Trimmed card markup from https://gameport.games/explore?page=1 */
const LIST_FIXTURE = `
<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
  <li>
    <a title="osu +3" class="group flex h-36 gap-3 overflow-hidden rounded-card" href="/projects/github-com-ppy-osu">
      <img src="https://images.igdb.com/igdb/image/upload/t_cover_big/co8a4m.jpg" alt="osu" loading="lazy" class="object-cover h-full w-[84px] shrink-0 rounded-[6px] bg-inset"/>
      <span class="flex min-w-0 flex-1 flex-col justify-between">
        <span class="truncate text-[14px] font-medium group-hover:text-accent-ink">osu +3</span>
        <span class="truncate font-mono text-[11.5px] text-ink-3">github.com/ppy/osu</span>
        <span class="truncate text-[12.5px] text-ink-2">osu, Osu! Tatakae! Ouendan, Taiko no Tatsujin +1</span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-1.5 overflow-hidden">
          <span class="inline-flex items-center rounded-chip brand-chip kind-engine-reimplementation">Engine reimplementation</span>
        </span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-x-3 gap-y-4 overflow-hidden">
          <span class="inline-flex items-center rounded-chip bg-[color-mix(in_oklab,var(--green)_18%,var(--surface))] text-green" title="Playable end to end, released, maintained and established: 80 and up.">Polished<span class="font-mono tabular-nums">98</span></span>
          <span class="font-mono text-[12px] text-ink-2 tabular-nums" title="GitHub stars">★ 19.4K</span>
          <span class="inline-flex items-center rounded-chip bg-accent-tint text-accent-ink">Playable</span>
          <span class="inline-flex items-center gap-1.5 text-[12px] text-green"><span aria-hidden="true" class="size-1.5 rounded-full bg-current"></span>Active</span>
        </span>
      </span>
    </a>
  </li>
  <li>
    <a title="RollerCoaster Tycoon 2 (OpenRCT2)" class="group flex h-36 gap-3 overflow-hidden rounded-card" href="/projects/github-com-openrct2-openrct2">
      <img src="https://images.igdb.com/igdb/image/upload/t_cover_big/co2dws.jpg" alt="RollerCoaster Tycoon 2" loading="lazy" class="object-cover h-full w-[84px]"/>
      <span class="flex min-w-0 flex-1 flex-col justify-between">
        <span class="truncate text-[14px] font-medium group-hover:text-accent-ink">RollerCoaster Tycoon 2 (OpenRCT2)</span>
        <span class="truncate font-mono text-[11.5px] text-ink-3">github.com/openrct2/openrct2</span>
        <span class="truncate text-[12.5px] text-ink-2">An open source re-implementation of RollerCoaster Tycoon 2</span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-1.5 overflow-hidden">
          <span class="inline-flex items-center rounded-chip brand-chip kind-rewrite">Rewrite</span>
          <span class="inline-flex items-center rounded-chip brand-chip kind-engine-reimplementation">Engine reimplementation</span>
        </span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-x-3 gap-y-4 overflow-hidden">
          <span class="inline-flex items-center rounded-chip bg-[color-mix(in_oklab,var(--green)_18%,var(--surface))] text-green" title="Playable end to end, released, maintained and established: 80 and up.">Polished<span class="font-mono tabular-nums">98</span></span>
          <span class="font-mono text-[12px] text-ink-2 tabular-nums" title="GitHub stars">★ 16.6K</span>
          <span class="inline-flex items-center rounded-chip bg-accent-tint text-accent-ink">Playable</span>
        </span>
      </span>
    </a>
  </li>
  <li>
    <a title="Super Mario 64 (sm64)" class="group flex h-36 gap-3 overflow-hidden rounded-card" href="/projects/github-com-n64decomp-sm64">
      <span class="flex min-w-0 flex-1 flex-col justify-between">
        <span class="truncate text-[14px] font-medium group-hover:text-accent-ink">Super Mario 64 (sm64)</span>
        <span class="truncate font-mono text-[11.5px] text-ink-3">github.com/n64decomp/sm64</span>
        <span class="truncate text-[12.5px] text-ink-2">A Super Mario 64 decompilation, brought to you by a bunch of clever folks.</span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-1.5 overflow-hidden">
          <span class="inline-flex items-center rounded-chip brand-chip kind-decompilation">Decompilation</span>
        </span>
        <span class="flex max-h-[18px] flex-wrap items-center gap-x-3 gap-y-4 overflow-hidden">
          <span class="inline-flex items-center rounded-chip bg-accent-tint text-accent-ink" title="Playable with a working build and signs of life: 60 to 79.">Solid<span class="font-mono tabular-nums">79</span></span>
          <span class="font-mono text-[12px] text-ink-2 tabular-nums" title="GitHub stars">★ 9K</span>
          <span class="inline-flex items-center rounded-chip bg-accent-tint text-accent-ink">Playable</span>
        </span>
      </span>
    </a>
  </li>
</ul>`;

/** Trimmed to the detail containers, from https://gameport.games/projects/github-com-ppy-osu */
const DETAIL_FIXTURE = `
<main class="mx-auto w-full max-w-7xl px-4">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <div class="mb-1 text-[13px] font-medium text-ink-2">
        <span class="flex flex-wrap gap-1.5">
          <span class="inline-flex items-center rounded-chip bg-[color-mix(in_oklab,var(--green)_18%,var(--surface))] text-green" title="Playable end to end, released, maintained and established: 80 and up.">Polished<span class="font-mono tabular-nums">98</span></span>
          <a class="inline-flex items-center rounded-chip brand-chip kind-engine-reimplementation" href="/kinds/engine-reimplementation">Engine reimplementation</a>
          <span class="inline-flex items-center rounded-chip bg-accent-tint text-accent-ink">Playable</span>
        </span>
      </div>
      <h1 class="font-display text-3xl font-medium tracking-display">osu +3</h1>
      <p class="mt-2 max-w-prose text-[14px] leading-body text-ink-2">rhythm is just a *click* away!</p>
    </div>
    <div class="shrink-0">
      <span class="flex flex-wrap gap-2">
        <a href="https://github.com/ppy/osu" rel="noreferrer" class="inline-flex h-10 items-center rounded-button bg-ink px-4 text-page">github.com/ppy/osu<svg aria-hidden="true"></svg></a>
      </span>
    </div>
  </header>
  <div class="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
    <div class="flex flex-col gap-8">
      <ul class="flex flex-wrap gap-2">
        <li><img src="https://images.igdb.com/igdb/image/upload/t_cover_big/co8a4m.jpg" alt="osu" class="object-cover h-40"/></li>
      </ul>
      <section>
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2 class="font-semibold text-[17px]">Games<span class="ml-2 text-[12.5px] font-normal text-ink-2">4</span></h2>
        </div>
        <ul class="divide-y divide-line rounded-card border border-line bg-surface">
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13.5px]">
            <span class="font-medium">osu</span>
            <a class="inline-flex items-center rounded-chip brand-chip normal-case brand-pc" href="/systems/windows">Windows</a>
          </li>
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13.5px]">
            <span class="font-medium">Osu! Tatakae! Ouendan</span>
            <a class="inline-flex items-center rounded-chip brand-chip normal-case brand-pc" href="/systems/windows">Windows</a>
          </li>
        </ul>
      </section>
      <section>
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2 class="font-semibold text-[17px]">Gameport rating</h2>
        </div>
        <section aria-label="How ready it is to play" class="grid gap-5 rounded-card border border-line bg-surface p-5">
          <div role="meter" aria-label="How ready it is to play" aria-valuemin="0" aria-valuemax="100" aria-valuenow="98" aria-valuetext="98, Polished"></div>
        </section>
      </section>
      <section>
        <div class="mb-3 flex items-baseline justify-between gap-4">
          <h2 class="font-semibold text-[17px]">Approach</h2>
        </div>
        <ul class="flex flex-col gap-2 text-[13.5px] leading-body">
          <li class="flex flex-wrap items-baseline gap-2">
            <a class="inline-flex items-center rounded-chip brand-chip kind-engine-reimplementation" href="/kinds/engine-reimplementation">Engine reimplementation</a>
            <span class="text-ink-2">An engine written anew that runs the original game data.</span>
          </li>
        </ul>
      </section>
    </div>
    <aside class="flex flex-col gap-4 self-start rounded-card border border-line bg-surface p-4 text-[13px]">
      <div>
        <div class="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Community rating</div>
        <div class="mt-1 leading-body">
          <span class="font-mono text-[15px] font-medium tabular-nums">4.8<span class="text-[12px] text-ink-3"> / 5</span></span>
          <span class="block text-ink-2 tabular-nums">Playability 5 · completeness 4 · activity 5 · popularity 5</span>
        </div>
      </div>
      <div>
        <div class="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Repository</div>
        <div class="mt-1 leading-body">
          <span class="font-mono text-[12.5px]">ppy/osu</span>
          <span class="block text-ink-2 tabular-nums">19,378 stars · 2,877 forks · MIT</span>
          <span class="block text-ink-2">Created 31 July 2014.</span>
        </div>
      </div>
      <div>
        <div class="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Site</div>
        <div class="mt-1 leading-body">
          <a href="https://osu.ppy.sh" rel="noreferrer" class="break-all text-accent-ink">osu.ppy.sh</a>
        </div>
      </div>
      <div>
        <div class="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Languages</div>
        <div class="mt-1 leading-body">C#</div>
      </div>
      <div>
        <div class="text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">Status</div>
        <div class="mt-1 leading-body">Playable</div>
      </div>
    </aside>
  </div>
</main>`;

/** Notes/kind/rating shape from https://gameport.games/projects/github-com-harbourmasters-ghostship */
const DETAIL_WITH_NOTES_FIXTURE = `
<main>
  <header>
    <div class="mb-1"><span class="flex flex-wrap gap-1.5">
      <a class="brand-chip kind-decompilation" href="/kinds/decompilation">Decompilation</a>
      <a class="brand-chip kind-source-port" href="/kinds/source-port">Native port</a>
      <span class="bg-accent-tint text-accent-ink">Playable</span>
      <span class="bg-hover text-ink-2" title="AI use rating 2 of 5">AI level 2</span>
    </span></div>
    <h1>Super Mario 64 (Ghostship)</h1>
    <p class="mt-2 max-w-prose">Super Mario 64 reimplementation for PC.</p>
    <div><a href="https://github.com/harbourmasters/ghostship" rel="noreferrer">github.com/harbourmasters/ghostship</a></div>
  </header>
  <section>
    <div><h2>Games<span>1</span></h2></div>
    <ul>
      <li><span class="font-medium">Super Mario 64</span><a class="brand-chip brand-nintendo" href="/systems/n64">Nintendo 64</a></li>
    </ul>
    <p class="mt-2 text-[12.5px] text-ink-2">1996 · Nintendo Entertainment Analysis &amp; Development</p>
  </section>
  <section>
    <div><h2>Notes</h2></div>
    <ul class="flex flex-col gap-2 text-[13.5px] leading-body text-ink-2">
      <li class="text-pretty">Libultraship</li>
      <li class="text-pretty">Builds on n64decomp/sm64.</li>
    </ul>
  </section>
  <aside>
    <div>
      <div class="text-[11px] uppercase">Community rating</div>
      <div class="mt-1 leading-body"><span class="font-mono">4.3<span> / 5</span></span></div>
    </div>
    <div>
      <div class="text-[11px] uppercase">Repository</div>
      <div class="mt-1 leading-body">
        <span class="font-mono">HarbourMasters/Ghostship</span>
        <span class="block text-ink-2 tabular-nums">896 stars · 62 forks · MIT</span>
      </div>
    </div>
    <div>
      <div class="text-[11px] uppercase">Site</div>
      <div class="mt-1 leading-body"><a href="https://ghostship.net64.dev/" rel="noreferrer">ghostship.net64.dev/</a></div>
    </div>
    <div>
      <div class="text-[11px] uppercase">Languages</div>
      <div class="mt-1 leading-body">C, C++</div>
    </div>
  </aside>
</main>`;

const CARD: RawGameportCard = {
  id: "github-com-harbourmasters-ghostship",
  title: "Super Mario 64 (Ghostship)",
  repoUrl: "https://github.com/harbourmasters/ghostship",
  gamesText: "",
  origin: "Decompilation",
  status: "Playable",
  stars: 896,
  score: 95,
  image: "",
};

describe("parseGameportList", () => {
  const cards = parseGameportList(LIST_FIXTURE);

  it("reads every project card", () => {
    expect(cards.map((card) => card.id)).toEqual([
      "github-com-ppy-osu",
      "github-com-openrct2-openrct2",
      "github-com-n64decomp-sm64",
    ]);
  });

  it("reads title, repo, games, kind, status, stars and score", () => {
    expect(cards[0]).toEqual({
      id: "github-com-ppy-osu",
      title: "osu +3",
      repoUrl: "https://github.com/ppy/osu",
      gamesText: "osu, Osu! Tatakae! Ouendan, Taiko no Tatsujin +1",
      origin: "Engine reimplementation",
      status: "Playable",
      stars: 19400,
      score: 98,
      image: "https://images.igdb.com/igdb/image/upload/t_cover_big/co8a4m.jpg",
    });
  });

  it("does not treat a single-game card's description as a games list", () => {
    expect(cards[1].gamesText).toBe("");
    expect(cards[1].origin).toBe("Rewrite");
    expect(cards[1].stars).toBe(16600);
  });

  it("keeps the status chip when a tier also uses the accent tint", () => {
    expect(cards[2].score).toBe(79);
    expect(cards[2].status).toBe("Playable");
  });
});

describe("parseGameportDetail", () => {
  const card = parseGameportList(LIST_FIXTURE)[0];
  const project = parseGameportDetail(DETAIL_FIXTURE, card);

  it("uses the first game and its original platform, never the port target", () => {
    expect(project.game).toBe("osu");
    expect(project.platform).toBe("Windows");
    expect(project.targets).toEqual([]);
  });

  it("maps kinds, status, languages, stars and the community rating", () => {
    expect(project).toMatchObject({
      source: "gameport",
      sourceUrl: "https://gameport.games/projects/github-com-ppy-osu",
      portName: "osu",
      origin: "Recreation",
      status: "Playable",
      languages: "C#",
      notes: "rhythm is just a *click* away!",
      stars: 19378,
      communityRating: 4.8,
      realRating: null,
      group: "",
    });
  });

  it("dedupes repo and homepage links", () => {
    expect(project.links).toEqual([
      { label: "github.com/ppy/osu", url: "https://github.com/ppy/osu", kind: "github" },
      { label: "osu.ppy.sh", url: "https://osu.ppy.sh", kind: "website" },
    ]);
  });

  it("joins notes after the description and reads the raw platform label", () => {
    const ghostship = parseGameportDetail(DETAIL_WITH_NOTES_FIXTURE, CARD);
    expect(ghostship.game).toBe("Super Mario 64");
    expect(ghostship.platform).toBe("Nintendo 64");
    expect(ghostship.origin).toBe("Decompilation");
    expect(ghostship.languages).toBe("C, C++");
    expect(ghostship.stars).toBe(896);
    expect(ghostship.communityRating).toBe(4.3);
    expect(ghostship.notes).toBe(
      "Super Mario 64 reimplementation for PC. — Libultraship — Builds on n64decomp/sm64.",
    );
  });

  it("maps a static recompilation kind and survives a page without games", () => {
    const project = parseGameportDetail(
      `<main><header>
        <div><a class="brand-chip kind-static-recompilation" href="/kinds/static-recompilation">Static recompilation</a></div>
        <h1>Some Game +1</h1>
      </header></main>`,
      {
        ...CARD,
        id: "github-com-example-recomp",
        title: "Some Game +1",
        repoUrl: "https://github.com/example/recomp",
        gamesText: "Some Game, Some Game 2",
        origin: "Static recompilation",
        status: "Unknown",
        stars: 42,
      },
    );
    expect(project.origin).toBe("Recompilation");
    expect(project.status).toBe("");
    expect(project.game).toBe("Some Game");
    expect(project.platform).toBe("");
    expect(project.portName).toBe("recomp");
    expect(project.stars).toBe(42);
    expect(project.links).toEqual([
      { label: "github.com/example/recomp", url: "https://github.com/example/recomp", kind: "github" },
    ]);
  });
});
