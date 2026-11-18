/**
 * itch.io subtab primitives: filter state, option lists and the payload the
 * backend needs.
 *
 * The store has no price/rating sort and at most two facets per browse URL, so
 * the option lists here are deliberately the ones itch itself can express
 * (`sort`/`price`/`platform`/`category`) plus two client-side price sorts.
 */
import type {
  ItchFilters,
  ItchPlatformFilter,
  ItchPriceFilter,
  ItchSort,
} from "../../types/itch";
import { ITCH_GENRES, ITCH_TAGS } from "../../types/itch";

export interface ItchFiltersState {
  sort: ItchSort;
  price: ItchPriceFilter;
  /** `all`, `genre-*` or `tag-*` — one category facet at a time. */
  category: string;
  platform: ItchPlatformFilter;
  query: string;
  /** Browse the signed-in account's purchases instead of the store. */
  ownedOnly: boolean;
}

export const DEFAULT_ITCH_FILTERS: ItchFiltersState = {
  sort: "popular",
  price: "all",
  category: "all",
  platform: "all",
  query: "",
  ownedOnly: false,
};

export const ITCH_FILTER_KEY = "gamelib.deals.filters.itch_v1";

export const ITCH_SORTS: { value: ItchSort; label: string }[] = [
  { value: "popular", label: "itch.sortPopular" },
  { value: "new-and-popular", label: "itch.sortNewAndPopular" },
  { value: "top-sellers", label: "itch.sortTopSellers" },
  { value: "top-rated", label: "itch.sortTopRated" },
  { value: "newest", label: "itch.sortNewest" },
  { value: "price-asc", label: "itch.sortPriceAsc" },
  { value: "price-desc", label: "itch.sortPriceDesc" },
];

export const ITCH_PRICES: { value: ItchPriceFilter; label: string }[] = [
  { value: "all", label: "itch.priceAll" },
  { value: "on-sale", label: "itch.priceOnSale" },
  { value: "free", label: "itch.priceFree" },
  { value: "5-dollars-or-less", label: "itch.priceUnder5" },
  { value: "15-dollars-or-less", label: "itch.priceUnder15" },
];

export const ITCH_PLATFORMS: { value: ItchPlatformFilter; label: string }[] = [
  { value: "all", label: "itch.platformAll" },
  { value: "web", label: "itch.platformWeb" },
  { value: "windows", label: "Windows" },
  { value: "osx", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "android", label: "Android" },
];

export const ITCH_CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "itch.categoryAll" },
  ...ITCH_GENRES.map((genre) => ({
    value: genre.segment,
    label: `Genre · ${genre.label}`,
  })),
  ...ITCH_TAGS.map((tag) => ({
    value: tag.segment,
    label: `Tag · ${tag.label}`,
  })),
];

/** The backend payload. Page numbers are added per request by the feed hook. */
export function buildItchPayload(filters: ItchFiltersState): Omit<ItchFilters, "page"> {
  return {
    sort: filters.sort,
    price: filters.price,
    category: filters.category === "all" ? null : filters.category,
    platform: filters.platform,
    query: filters.query.trim(),
  };
}

/**
 * itch prices are USD and a `null` price means the game is free (or
 * name-your-own-price). `freeLabel` lets the page localise that case.
 */
export function formatItchPrice(
  price: number | null,
  freeLabel: string,
): string {
  if (price === null) return freeLabel;
  if (price === 0) return freeLabel;
  return `$${price.toFixed(2)}`;
}
