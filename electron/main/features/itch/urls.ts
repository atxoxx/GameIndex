/**
 * Pure itch.io URL/ordering helpers.
 *
 * No IO lives here so the facet logic (the part that is easy to get wrong) can
 * be unit-tested without the network, Electron or the SQLite cache.
 *
 * Two store constraints shape this file:
 *  • a browse URL accepts at most **two** facet segments — a third is a 403, so
 *    the remaining filter is applied client-side;
 *  • `/search` ignores `sort` entirely, so search results are ordered locally.
 */
import type {
  ItchFilters as ItchFiltersPayload,
  ItchGameSummary,
  ItchPriceFilter,
  ItchSort,
} from "../../../../src/types/itch";

export const MAX_SERVER_FACETS = 2;

const SEARCH_BASE = "https://itch.io/search";

const SORTS: Record<ItchSort, string | null> = {
  popular: null,
  "new-and-popular": "new-and-popular",
  "top-sellers": "top-sellers",
  "top-rated": "top-rated",
  newest: "newest",
  // itch has no price sort; these are ordered client-side over the page.
  "price-asc": null,
  "price-desc": null,
};

export interface ItchBrowseUrl {
  url: string;
  page: number;
  /** Price filter the page itself cannot express (it was the third facet). */
  clientPrice: ItchPriceFilter | null;
  /** True when the request used itch's HTML5 platform facet. */
  webFacet: boolean;
  /** Sort the server cannot apply (search results, price sorts). */
  clientSort: ItchSort | null;
}

function priceFacet(price: ItchPriceFilter): string | null {
  return price === "all" ? null : price;
}

function platformFacet(platform: string): string | null {
  return platform === "all" || !platform ? null : `platform-${platform}`;
}

function categoryFacet(category: string | null): string | null {
  if (!category) return null;
  return /^(genre|tag)-[a-z0-9-]+$/i.test(category) ? category.toLowerCase() : null;
}

/**
 * Build the itch browse URL for a filter set, deciding which facet has to be
 * filtered client-side. Facet priority is platform → category → price, because
 * price is the only one of the three that survives an exact client-side check.
 */
export function buildItchBrowseUrl(filters: ItchFiltersPayload): ItchBrowseUrl {
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const query = filters.query.trim();

  if (query) {
    const params = new URLSearchParams({ q: query });
    if (page > 1) params.set("page", String(page));
    return {
      url: `${SEARCH_BASE}?${params.toString()}`,
      page,
      clientPrice: filters.price === "all" ? null : filters.price,
      webFacet: false,
      clientSort: filters.sort,
    };
  }

  const candidates: string[] = [];
  const platform = platformFacet(filters.platform);
  if (platform) candidates.push(platform);
  const category = categoryFacet(filters.category);
  if (category) candidates.push(category);
  const price = priceFacet(filters.price);
  if (price) candidates.push(price);

  const serverFacets = candidates.slice(0, MAX_SERVER_FACETS);
  const dropped = candidates.slice(MAX_SERVER_FACETS);
  const sort = SORTS[filters.sort] ?? null;
  const segments = ["games"];
  if (sort) segments.push(sort);
  segments.push(...serverFacets);

  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  const search = params.toString();

  return {
    url: `https://itch.io/${segments.join("/")}${search ? `?${search}` : ""}`,
    page,
    // Only the price facet can be pushed past the two-segment budget (platform
    // and category come first), so a dropped facet is always the price.
    clientPrice: dropped.length > 0 ? filters.price : null,
    webFacet: platform === "platform-web",
    clientSort:
      filters.sort === "price-asc" || filters.sort === "price-desc" ? filters.sort : null,
  };
}

export function matchesPrice(game: ItchGameSummary, price: ItchPriceFilter): boolean {
  const isFree = game.price === null || game.price === 0;
  switch (price) {
    case "free":
      return isFree;
    case "on-sale":
      return game.onSale;
    case "5-dollars-or-less":
      return isFree || (game.price ?? Number.POSITIVE_INFINITY) <= 5;
    case "15-dollars-or-less":
      return isFree || (game.price ?? Number.POSITIVE_INFINITY) <= 15;
    default:
      return true;
  }
}

/** Free first for ascending price sorts, then the advertised price. */
export function sortItchGames(
  games: ItchGameSummary[],
  sort: ItchSort | null,
): ItchGameSummary[] {
  if (sort !== "price-asc" && sort !== "price-desc") return games;
  const direction = sort === "price-asc" ? 1 : -1;
  return [...games].sort((a, b) => {
    const left = a.price ?? 0;
    const right = b.price ?? 0;
    if (left === right) return a.title.localeCompare(b.title);
    return (left - right) * direction;
  });
}

const SORT_VALUES: ItchSort[] = [
  "popular",
  "new-and-popular",
  "top-sellers",
  "top-rated",
  "newest",
  "price-asc",
  "price-desc",
];

const PRICE_VALUES: ItchPriceFilter[] = [
  "all",
  "on-sale",
  "free",
  "5-dollars-or-less",
  "15-dollars-or-less",
];

const PLATFORM_VALUES = ["all", "web", "windows", "osx", "linux", "android"];

/** Coerce renderer input into a valid filter payload (never throws). */
export function normaliseFilters(raw: unknown): ItchFiltersPayload {
  const input = (raw ?? {}) as Record<string, unknown>;
  const sort = String(input.sort ?? "popular") as ItchSort;
  const price = String(input.price ?? "all") as ItchPriceFilter;
  const platform = String(input.platform ?? "all");

  return {
    sort: SORT_VALUES.includes(sort) ? sort : "popular",
    price: PRICE_VALUES.includes(price) ? price : "all",
    category:
      typeof input.category === "string" && /^(genre|tag)-[a-z0-9-]+$/i.test(input.category)
        ? input.category.toLowerCase()
        : null,
    platform: (PLATFORM_VALUES.includes(platform)
      ? platform
      : "all") as ItchFiltersPayload["platform"],
    query: typeof input.query === "string" ? input.query.slice(0, 120) : "",
    page: Math.max(1, Math.min(400, Math.floor(Number(input.page) || 1))),
  };
}

/** Accept either an absolute game URL or the `author/game` route slug. */
export function itchGameUrl(target: string): string {
  const raw = target.trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const [author, ...rest] = raw.split("/").filter(Boolean);
  if (!author) throw new Error("itch.io: a game URL or author/slug is required.");
  return `https://${author}.itch.io/${rest.join("/")}`;
}
