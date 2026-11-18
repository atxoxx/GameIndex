import { describe, expect, it } from "vitest";

import { parseItchCsrfToken, parseItchDetail, parseItchGrid } from "./parse";
import { buildItchBrowseUrl, matchesPrice, normaliseFilters, sortItchGames } from "./urls";
import type { ItchFilters, ItchGameSummary } from "../../../../src/types/itch";

/**
 * Fixtures are trimmed copies of the markup itch.io served on 2026-11-18:
 * `/games/on-sale` for the grid and a browser-playable game page for the detail
 * parse. Keeping them verbatim is the point — these selectors are the contract.
 */
const GRID = `
<div class="game_grid_widget base_widget browse_game_grid">
  <div data-game_id="5155782" class="game_cell has_cover lazy_images" dir="auto">
    <div class="game_thumb" style="background-color:transparent;">
      <a class="thumb_link game_link" href="https://deeplookgames.itch.io/fix-her-pipes">
        <img data-lazy_src="https://img.itch.zone/aW1nLzMyMjQ0ODM2LmdpZg==/315x250%23c/ehOGF8.gif" />
      </a>
    </div>
    <div class="game_cell_data">
      <div class="game_title">
        <a class="title game_link" href="https://deeplookgames.itch.io/fix-her-pipes">Fix Her Pipes</a>
        <a title="Pay $2 or more for this game" class="price_tag meta_tag sale" href="/s/215736/fix-her-pipes">
          <div class="price_value">$2</div>
          <div class="sale_tag">-50%</div>
        </a>
      </div>
      <div title="Escape from Pipe Granny." class="game_text">Escape from Pipe Granny.</div>
      <div class="game_author"><a href="https://deeplookgames.itch.io">DeepLookGames</a></div>
      <div class="game_genre">Survival</div>
      <div class="game_platform">
        <span title="Download for Windows" class="icon icon-windows8"></span>
      </div>
    </div>
  </div>

  <div data-game_id="4943176" class="game_cell has_cover lazy_images" dir="auto">
    <div class="game_thumb"><a class="thumb_link game_link" href="https://worldchampgameco.itch.io/horrorgames"><img src="https://img.itch.zone/cover.png" /></a></div>
    <div class="game_cell_data">
      <div class="game_title"><a href="https://worldchampgameco.itch.io/horrorgames" class="title game_link">Horror Games</a></div>
      <div class="game_text">A compilation of tabletop terror.</div>
      <div class="game_author"><a href="https://worldchampgameco.itch.io">World Champ Game Co.</a></div>
      <div class="game_platform">
        <span title="Play in browser" class="icon icon-html5"></span>
        <span title="Download for Mac" class="icon icon-apple"></span>
      </div>
    </div>
  </div>

  <div data-game_id="5155782" class="game_cell"><div class="game_title"><a class="title game_link" href="https://deeplookgames.itch.io/fix-her-pipes">Fix Her Pipes (mobile duplicate)</a></div></div>
</div>
<div class="game_count_widget"><h2>on sale <nobr class="game_count"> (1,212 results)</nobr></h2></div>
`;

const DETAIL = `
<html><head>
  <meta name="itch:path" content="games/3644469" />
  <meta property="og:image" content="https://img.itch.zone/cover-original.png" />
  <meta name="description" content="A rage game about trees." />
  <meta name="csrf_token" value="csrf-from-meta" />
  <script type="application/ld+json">{"@context":"http://schema.org/","@type":"Product","name":"Trees Hate You (demo)","description":"A rage game about trees.","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","ratingCount":535}}</script>
</head><body>
<h1 class="game_title">Trees Hate You (demo)</h1>

<div class="game_frame game_pending" data-width="1071" data-height="650">
  <div class="iframe_placeholder" data-iframe="<iframe src=&quot;https://html-classic.itch.zone/html/14007573-1629712/index.html&quot; id=&quot;game_drop&quot;></iframe>">
    <button class="button load_iframe_btn"></button>
  </div>
</div>

<div class="buy_row">
  <div class="button_message">
    <a class="button buy_btn" href="https://tykenn.itch.io/trees-hate-you/purchase">Buy Now</a>
    <span class="sale_rate">25%</span>
    <span class="dollars original_price">$4.00</span>
    <span class="dollars" itemprop="price">$3.00 USD</span>
  </div>
</div>

<div class="formatted_description user_formatted"><h2>Storyline</h2><p>Trees are angry.</p><script>alert(1)</script></div>

<div class="screenshot_list">
  <a href="https://img.itch.zone/shot1.jpg"><img class="screenshot" src="https://img.itch.zone/shot1-small.jpg" /></a>
  <a href="https://img.itch.zone/shot2.png"><img class="screenshot" src="https://img.itch.zone/shot2-small.png" /></a>
</div>

<div class="video_embed_widget"><iframe src="//www.youtube.com/embed/lv_GVBXZhrA"></iframe></div>

<div class="game_info_panel_widget">
  <table>
    <tr><td>Updated</td><td>12 hours ago</td></tr>
    <tr><td>Status</td><td>Released</td></tr>
    <tr><td>Platforms</td><td>HTML5, Windows</td></tr>
    <tr><td>Rating</td><td>Rated 4.6 out of 5 stars(535 total ratings)</td></tr>
    <tr><td>Author</td><td>tykenn</td></tr>
    <tr><td>Genre</td><td>Adventure</td></tr>
    <tr><td>Tags</td><td>3D, Comedy, Rage, <a href="/games/tag-traps">Traps</a></td></tr>
  </table>
</div>

<div class="upload_list_widget">
  <div class="upload">
    <a href="javascript:void(0);" class="button download_btn" data-upload_id="14007658">Download</a>
    <div class="info_column">
      <div class="upload_name"><strong class="name" title="TreesHateYou.zip">TreesHateYou.zip</strong>
        <span class="file_size"><span>437 MB</span></span>
        <span class="download_platforms"><span class="icon icon-windows8" title="Download for Windows"></span></span>
      </div>
    </div>
  </div>
</div>

<div class="game_devlog"><ul><li><a href="/devlog/1">One</a></li><li><a href="/devlog/2">Two</a></li></ul></div>
<div class="game_comments_widget"><div class="community_post"></div><div class="community_post"></div></div>
</body></html>
`;

describe("parseItchGrid", () => {
  it("reads id, title, author, price, discount and platforms", () => {
    const { games, total } = parseItchGrid(GRID);

    expect(total).toBe(1212);
    expect(games).toHaveLength(2);

    const [first, second] = games;
    expect(first).toMatchObject({
      id: "5155782",
      slug: "deeplookgames/fix-her-pipes",
      title: "Fix Her Pipes",
      author: "DeepLookGames",
      authorUrl: "https://deeplookgames.itch.io",
      coverUrl: "https://img.itch.zone/aW1nLzMyMjQ0ODM2LmdpZg==/315x250%23c/ehOGF8.gif",
      blurb: "Escape from Pipe Granny.",
      price: 2,
      originalPrice: 4,
      discountPercent: 50,
      onSale: true,
      genre: "Survival",
      platforms: ["Windows"],
      playableInBrowser: false,
    });

    expect(second).toMatchObject({
      id: "4943176",
      price: null,
      onSale: false,
      platforms: ["HTML5", "macOS"],
      playableInBrowser: true,
    });
  });

  it("de-duplicates the same game id rendered twice", () => {
    const { games } = parseItchGrid(GRID);
    expect(games.filter((game) => game.id === "5155782")).toHaveLength(1);
  });
});

describe("parseItchDetail", () => {
  const detail = parseItchDetail(DETAIL, "https://tykenn.itch.io/trees-hate-you");

  it("reads identity, price and rating", () => {
    expect(detail.id).toBe("3644469");
    expect(detail.slug).toBe("tykenn/trees-hate-you");
    expect(detail.title).toBe("Trees Hate You (demo)");
    expect(detail.author).toBe("tykenn");
    expect(detail.price).toBe(3);
    expect(detail.originalPrice).toBe(4);
    expect(detail.discountPercent).toBe(25);
    expect(detail.rating).toBe(4.6);
    expect(detail.ratingCount).toBe(535);
    expect(detail.currency).toBe("USD");
  });

  it("extracts the playable iframe from the escaped data attribute", () => {
    expect(detail.playUrl).toBe(
      "https://html-classic.itch.zone/html/14007573-1629712/index.html",
    );
    expect(detail.playableInBrowser).toBe(true);
  });

  it("reads media, info rows, tags and uploads", () => {
    expect(detail.screenshots).toEqual([
      "https://img.itch.zone/shot1.jpg",
      "https://img.itch.zone/shot2.png",
    ]);
    expect(detail.trailerUrl).toBe("https://www.youtube.com/embed/lv_GVBXZhrA");
    expect(detail.tags).toEqual(expect.arrayContaining(["3D", "Comedy", "Rage", "Traps"]));
    expect(detail.platforms).toEqual(["HTML5", "Windows"]);
    expect(detail.genre).toBe("Adventure");
    expect(detail.status).toBe("Released");
    expect(detail.updated).toBe("12 hours ago");
    expect(detail.uploads).toEqual([
      {
        id: "14007658",
        name: "TreesHateYou.zip",
        size: "437 MB",
        platforms: ["Windows"],
      },
    ]);
    expect(detail.devlogCount).toBe(2);
    expect(detail.commentCount).toBe(2);
  });

  it("keeps the description HTML for the renderer to sanitise", () => {
    expect(detail.descriptionHtml).toContain("Trees are angry.");
  });
});

describe("parseItchCsrfToken", () => {
  it("reads the download token", () => {
    expect(parseItchCsrfToken(DETAIL)).toBe("csrf-from-meta");
    expect(parseItchCsrfToken("<html></html>")).toBeNull();
  });
});

describe("buildItchBrowseUrl", () => {
  const base: ItchFilters = {
    sort: "popular",
    price: "all",
    category: null,
    platform: "all",
    query: "",
    page: 1,
  };

  it("uses the plain catalogue with no facets", () => {
    expect(buildItchBrowseUrl(base).url).toBe("https://itch.io/games");
  });

  it("puts the sort segment before the facets", () => {
    expect(
      buildItchBrowseUrl({ ...base, sort: "top-rated", category: "genre-rpg" }).url,
    ).toBe("https://itch.io/games/top-rated/genre-rpg");
  });

  it("appends page numbers and price facets", () => {
    expect(buildItchBrowseUrl({ ...base, price: "on-sale", page: 3 }).url).toBe(
      "https://itch.io/games/on-sale?page=3",
    );
  });

  it("drops the third facet to the client and keeps platform priority", () => {
    const built = buildItchBrowseUrl({
      ...base,
      platform: "web",
      category: "genre-rpg",
      price: "on-sale",
    });
    expect(built.url).toBe("https://itch.io/games/platform-web/genre-rpg");
    expect(built.clientPrice).toBe("on-sale");
    expect(built.webFacet).toBe(true);
  });

  it("uses the search endpoint and sorts client-side", () => {
    const built = buildItchBrowseUrl({ ...base, query: "horror", sort: "newest" });
    expect(built.url).toBe("https://itch.io/search?q=horror");
    expect(built.clientSort).toBe("newest");
  });

  it("ignores unknown facets", () => {
    expect(buildItchBrowseUrl({ ...base, category: "javascript:alert(1)" }).url).toBe(
      "https://itch.io/games",
    );
  });
});

describe("price helpers", () => {
  const game = (price: number | null, onSale = false): ItchGameSummary => ({
    id: "1",
    slug: "author/game",
    url: "https://author.itch.io/game",
    title: "Game",
    author: "author",
    authorUrl: null,
    coverUrl: null,
    blurb: null,
    price,
    originalPrice: price,
    discountPercent: onSale ? 50 : 0,
    onSale,
    genre: null,
    platforms: [],
    playableInBrowser: false,
  });

  it("treats null and zero as free", () => {
    expect(matchesPrice(game(null), "free")).toBe(true);
    expect(matchesPrice(game(0), "free")).toBe(true);
    expect(matchesPrice(game(4), "free")).toBe(false);
  });

  it("matches sale flags and thresholds", () => {
    expect(matchesPrice(game(4, true), "on-sale")).toBe(true);
    expect(matchesPrice(game(4), "on-sale")).toBe(false);
    expect(matchesPrice(game(5), "5-dollars-or-less")).toBe(true);
    expect(matchesPrice(game(6), "5-dollars-or-less")).toBe(false);
    expect(matchesPrice(game(null), "15-dollars-or-less")).toBe(true);
  });

  it("sorts free games first ascending", () => {
    const sorted = sortItchGames([game(10), game(null), game(2)], "price-asc");
    expect(sorted.map((entry) => entry.price)).toEqual([null, 2, 10]);
  });
});

describe("normaliseFilters", () => {
  it("falls back to safe defaults", () => {
    expect(normaliseFilters({ sort: "nonsense", price: "free-ish", page: -4 })).toMatchObject({
      sort: "popular",
      price: "all",
      page: 1,
      category: null,
      platform: "all",
      query: "",
    });
  });
});
