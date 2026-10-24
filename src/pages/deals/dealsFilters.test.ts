import { describe, expect, it } from "vitest";
import type { Giveaway, PlaytesterGame } from "../../types/deals";
import {
  DEFAULT_DEAL_FILTERS,
  DEFAULT_GIVEAWAY_FILTERS,
  groupDealsByTitle,
} from "./dealsConstants";
import {

  endingSoonGiveaways,
  filterDealGroups,
  filterGiveaways,
  filterPlaytesterGames,
  wishlistGroups,
} from "./dealsFilters";

const ctx = {
  isWishlisted: (slug: string) => slug === "hades",
  isOwned: (title: string) => title === "Celeste",
};

const groups = groupDealsByTitle([
  {
    id: "a",
    gameTitle: "Hades",
    storeName: "Steam",
    storeUrl: "https://store.steampowered.com/app/1145360/",
    dealPrice: 10,
    discountPercent: 60,
    expiration: null,
    platform: "Windows",
    thumbnail: null,
  },
  {
    id: "b",
    gameTitle: "Hades",
    storeName: "GOG",
    storeUrl: "https://www.gog.com/game/hades",
    dealPrice: 14,
    discountPercent: 40,
    expiration: null,
    platform: "Windows",
    thumbnail: null,
  },
  {
    id: "c",
    gameTitle: "Celeste",
    storeName: "Steam",
    storeUrl: "https://store.steampowered.com/app/504230/",
    dealPrice: 5,
    discountPercent: 80,
    expiration: null,
    platform: "Windows",
    thumbnail: null,
  },
]);

function giveaway(overrides: Partial<Giveaway>): Giveaway {
  return {
    id: "gw-1",
    title: "Cave Story+",
    bundleTitle: "Free on Epic",
    storeName: "Epic",
    imageUrl: null,
    dealUrl: "https://store.epicgames.com/free",
    isMature: false,
    expiry: "2026-10-25T12:00:00Z",
    ...overrides,
  };
}

describe("filterDealGroups", () => {
  it("keeps the whole store set when the title matches and sorts by discount", () => {
    const result = filterDealGroups(
      groups,
      { ...DEFAULT_DEAL_FILTERS, searchQuery: "hades" },
      ctx,
    );

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Hades");
    expect(result[0].storeCount).toBe(2);
  });

  it("honours the wishlist and owned scopes independently", () => {
    const wishlistOnly = filterDealGroups(
      groups,
      { ...DEFAULT_DEAL_FILTERS, wishlistOnly: true },
      ctx,
    );
    expect(wishlistOnly.map((group) => group.title)).toEqual(["Hades"]);

    const hideOwned = filterDealGroups(
      groups,
      { ...DEFAULT_DEAL_FILTERS, hideOwned: true },
      ctx,
    );
    expect(hideOwned.map((group) => group.title)).toEqual(["Hades"]);
  });

  it("returns nothing when the search cannot match any store", () => {
    const result = filterDealGroups(
      groups,
      { ...DEFAULT_DEAL_FILTERS, searchQuery: "nonexistent" },
      ctx,
    );
    expect(result).toEqual([]);
  });

  it("orders by best price when asked", () => {
    const result = filterDealGroups(
      groups,
      { ...DEFAULT_DEAL_FILTERS, sortBy: "price_asc" },
      ctx,
    );
    expect(result[0].title).toBe("Celeste");
  });
});

describe("giveaway filtering", () => {
  const now = new Date("2026-10-24T12:00:00Z").getTime();

  it("hides expired giveaways when active-only is on", () => {
    const expired = giveaway({
      id: "gw-expired",
      title: "Old Freebie",
      expiry: "2026-10-20T12:00:00Z",
    });
    const result = filterGiveaways(
      [expired, giveaway({})],
      DEFAULT_GIVEAWAY_FILTERS,
      now,
    );

    expect(result.map((item) => item.id)).toEqual(["gw-1"]);
  });

  it("filters by store and reports only genuinely ending-soon items", () => {
    const steam = giveaway({ id: "gw-steam", storeName: "Steam", expiry: "2026-10-30T12:00:00Z" });
    const result = filterGiveaways(
      [giveaway({}), steam],
      { ...DEFAULT_GIVEAWAY_FILTERS, store: "Steam" },
      now,
    );
    expect(result.map((item) => item.id)).toEqual(["gw-steam"]);

    const soon = endingSoonGiveaways([giveaway({}), steam], now, 48 * 3600 * 1000);
    expect(soon.map((item) => item.id)).toEqual(["gw-1"]);
  });
});

describe("wishlistGroups and filter counting", () => {
  it("returns only wishlisted games, biggest discount first", () => {
    const result = wishlistGroups(groups, ctx.isWishlisted);
    expect(result.map((group) => group.title)).toEqual(["Hades"]);
  });


});

describe("playtester filter guard", () => {
  const game: PlaytesterGame = {
    id: "pt-1",
    slug: "pt-1",
    title: "Rogue Trial",
    description: "A demo",
    thumbnail: null,
    platform: "Steam",
    platforms: ["Steam", "itch.io"],
    genres: ["Roguelike"],
    kind: "Demo",
    status: "Active",
    dateAdded: "2026-10-20T00:00:00Z",
    url: "https://playtester.io/game/pt-1",
  };

  it("keeps an entry when every categorical filter is 'all'", () => {
    const result = filterPlaytesterGames([game], {
      searchQuery: "",
      platform: "all",
      genre: "all",
      status: "all",
      kind: "all",
      sortBy: "newest_desc",
      hideOwned: false,
      wishlistOnly: false,
    }, ctx);
    expect(result).toHaveLength(1);
  });

  it("rejects an entry that does not carry the requested platform", () => {
    const result = filterPlaytesterGames([game], {
      searchQuery: "",
      platform: "PlayStation",
      genre: "all",
      status: "all",
      kind: "all",
      sortBy: "newest_desc",
      hideOwned: false,
      wishlistOnly: false,
    }, ctx);
    expect(result).toEqual([]);
  });
});

