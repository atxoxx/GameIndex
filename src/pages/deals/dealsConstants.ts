import type { DealItem, DealsFilters, GamePassFilters } from "../../types/deals";
import { normalizeTitle, titleToSlug } from "../../utils/gameTitle";

/** Re-exported so callers keep importing the slug helper from one place. */
export { titleToSlug };

/**
 * Deals page primitives: tab ids, filter state, pricing/countdown helpers and
 * the cross-store grouping that turns one ITAD row per store into one card per
 * game. Everything here is pure so the panels stay presentational and the
 * logic is testable without a DOM.
 */

export type SubTab =
  | "overview"
  | "deals"
  | "gamepass"
  | "giveaways"
  | "playtester";

export type DealsSortOption =
  | "discount_desc"
  | "savings_desc"
  | "price_asc"
  | "price_desc"
  | "title_asc"
  | "title_desc";

export type GamePassSortOption =
  | "title_asc"
  | "title_desc"
  | "release_desc"
  | "release_asc";

export type GiveawaysSortOption =
  | "expiry_asc"
  | "title_asc"
  | "title_desc";

export type PlaytesterSortOption =
  | "newest_desc"
  | "newest_asc"
  | "title_asc"
  | "title_desc";

export interface GamePassFiltersState {
  region: string;
  categories: string[];
  platform: string;
  searchQuery: string;
  sortBy: GamePassSortOption;
  wishlistOnly: boolean;
  hideOwned: boolean;
}

export interface DealsFiltersState {
  /** Minimum discount, 0 means "any". Sent to the backend. */
  minDiscount: number;
  /** Storefront id or "all". Sent to the backend. */
  store: string;
  searchQuery: string;
  sortBy: DealsSortOption;
  wishlistOnly: boolean;
  hideOwned: boolean;
}

export interface GiveawaysFiltersState {
  searchQuery: string;
  store: string;
  sortBy: GiveawaysSortOption;
  activeOnly: boolean;
}

export interface PlaytesterFiltersState {
  searchQuery: string;
  platform: string;
  genre: string;
  status: string;
  kind: string;
  sortBy: PlaytesterSortOption;
  hideOwned: boolean;
  wishlistOnly: boolean;
}

export const GP_REGIONS: { code: string; label: string }[] = [
  { code: "US", label: "deals.regionUS" },
  { code: "UK", label: "deals.regionUK" },
  { code: "CA", label: "deals.regionCA" },
  { code: "AU", label: "deals.regionAU" },
  { code: "DE", label: "deals.regionDE" },
  { code: "FR", label: "deals.regionFR" },
  { code: "JP", label: "deals.regionJP" },
  { code: "BR", label: "deals.regionBR" },
  { code: "MX", label: "deals.regionMX" },
];

export const GP_CATEGORIES = [
  "Action & adventure",
  "RPG",
  "Shooter",
  "Strategy",
  "Sports & racing",
  "Platformer",
  "Puzzle & trivia",
  "Simulation",
  "Fighting",
  "Family & kids",
  "Card & board",
  "Music",
];

export const GP_CATEGORY_KEYS: Record<string, string> = {
  "Action & adventure": "deals.catAction",
  RPG: "deals.catRpg",
  Shooter: "deals.catShooter",
  Strategy: "deals.catStrategy",
  "Sports & racing": "deals.catSports",
  Platformer: "deals.catPlatformer",
  "Puzzle & trivia": "deals.catPuzzle",
  Simulation: "deals.catSimulation",
  Fighting: "deals.catFighting",
  "Family & kids": "deals.catFamily",
  "Card & board": "deals.catCard",
  Music: "deals.catMusic",
};

export const GP_PLATFORMS = [
  { value: "all", label: "deals.allPlatforms" },
  { value: "xbox", label: "deals.xboxConsole" },
  { value: "pc", label: "PC" },
  { value: "cloud", label: "deals.cloudGaming" },
];

export const DEAL_STORES = [
  { value: "all", label: "deals.allStores" },
  { value: "steam", label: "Steam" },
  { value: "gog", label: "GOG" },
  { value: "epic", label: "Epic Games Store" },
  { value: "humble", label: "Humble Store" },
  { value: "fanatical", label: "Fanatical" },
  { value: "greenmangaming", label: "Green Man Gaming" },
];

export const DEAL_DISCOUNTS = [
  { value: 0 },
  { value: 25 },
  { value: 50 },
  { value: 75 },
  { value: 90 },
];

/**
 * Format a price for display. `freeLabel` lets callers localise the zero-price
 * case; callers that predate the deals refactor can keep the default.
 */
export function formatPrice(
  price: number,
  currency = "EUR",
  freeLabel = "Free",
): string {
  if (!Number.isFinite(price)) return "—";
  if (price === 0) return freeLabel;
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  return `${symbol}${price.toFixed(2)}`;
}

/**
 * Derives the pre-discount price and the money saved. ITAD only exposes the
 * discounted price, so the original is reconstructed from the percentage.
 */
export function calculateSavings(
  dealPrice: number,
  discountPercent: number,
): { originalPrice: number; savings: number } {
  if (discountPercent <= 0 || discountPercent >= 100 || dealPrice <= 0) {
    return { originalPrice: dealPrice, savings: 0 };
  }
  const originalPrice = dealPrice / (1 - discountPercent / 100);
  const savings = Math.max(0, originalPrice - dealPrice);
  return { originalPrice, savings };
}

export function buildGamePassPayload(
  filters: GamePassFiltersState,
): GamePassFilters {
  return {
    region: filters.region,
    categories: filters.categories.length > 0 ? filters.categories : null,
    platform: filters.platform === "all" ? null : filters.platform,
  };
}

export function buildDealsPayload(filters: DealsFiltersState): DealsFilters {
  return {
    platform: null,
    minDiscount: filters.minDiscount > 0 ? filters.minDiscount : null,
    store: filters.store === "all" ? null : filters.store,
  };
}

/**
 * Store accent used by badges and fallback art. Kept as literal colour data
 * (see `COLOR_DATA_FILES` in eslint.config.js): storefront brand hues cannot be
 * expressed as theme tokens without losing the brand.
 */
export function storeTint(storeName: string): string {
  const palette: Record<string, string> = {
    "Humble Bundle": "#ff3e1b",
    Humble: "#ff3e1b",
    Fanatical: "#ff9800",
    IndieGala: "#ffb4e0",
    GOG: "#b6883a",
    Steam: "#66c0f4",
    Epic: "#8f8fff",
    "Epic Game": "#8f8fff",
    "Xbox / Microsoft": "#107c10",
    "Game Pass": "#107c10",
    "Green Man Gaming": "#5c9e31",
    GreenManGaming: "#5c9e31",
    GamesPlanet: "#2f7bd8",
    WinGameStore: "#3f9c9c",
    Ubisoft: "#0a7bc2",
    "Battle.net": "#148eff",
    Blizzard: "#148eff",
    "itch.io": "#fa5c5c",
    Microsoft: "#107c10",
    Amazon: "#ff9900",
  };
  for (const key of Object.keys(palette)) {
    if (storeName.toLowerCase().includes(key.toLowerCase())) {
      return palette[key];
    }
  }
  return "#3a4a63";
}

export function discountTier(pct: number): "mega" | "large" | "" {
  if (pct >= 90) return "mega";
  if (pct >= 75) return "large";
  return "";
}

export function formatExpiry(
  isoDate: string | null | undefined,
): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface CountdownInfo {
  label: string;
  isUrgent: boolean;
  isExpired: boolean;
  /** Milliseconds remaining (0 once expired). */
  msLeft: number;
}

/**
 * Human countdown for giveaway expiry. Labels are translated through the
 * caller's `t`, so the same helper works for every locale.
 */
export function formatCountdown(
  isoDate: string | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
  now: number = Date.now(),
): CountdownInfo | null {
  if (!isoDate) return null;
  const end = new Date(isoDate).getTime();
  if (Number.isNaN(end)) return null;

  const diff = end - now;
  if (diff <= 0) {
    return { label: t("deals.expired"), isUrgent: false, isExpired: true, msLeft: 0 };
  }

  const totalMinutes = Math.floor(diff / 60000);
  const totalHours = Math.floor(diff / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  if (days > 1) {
    return {
      label: t("deals.countdownDays", { days }),
      isUrgent: false,
      isExpired: false,
      msLeft: diff,
    };
  }
  if (days === 1) {
    return {
      label: t("deals.countdownDaysHours", { days, hours }),
      isUrgent: false,
      isExpired: false,
      msLeft: diff,
    };
  }
  if (hours > 0) {
    return {
      label: t("deals.countdownHours", { hours, minutes }),
      isUrgent: hours <= 6,
      isExpired: false,
      msLeft: diff,
    };
  }
  return {
    label: t("deals.countdownMinutes", { minutes }),
    isUrgent: true,
    isExpired: false,
    msLeft: diff,
  };
}

/** Normalise a game title for identity checks (wishlist, owned, grouping). */

/** One game with every store offer ITAD returned for it. */
export interface DealGroup {
  id: string;
  slug: string;
  title: string;
  /** Offers sorted cheapest first. */
  offers: DealGroupOffer[];
  best: DealGroupOffer;
  storeCount: number;
  bestPrice: number;
  /** Highest price any store asks right now (for the savings column). */
  worstPrice: number;
  /** Biggest discount across the offers. */
  maxDiscount: number;
  /** What the user saves by taking the cheapest offer over the priciest. */
  savings: number;
  /** Soonest expiry among the offers, when any is known. */
  expiresAt: string | null;
}

export type DealGroupOffer = DealItem;

/**
 * Collapse the per-store deal rows into one entry per game.
 *
 * ITAD lists the same title once per storefront, so a naive grid shows the
 * same cover four times with four prices. Grouping keeps the cheapest offer as
 * the card's headline and preserves every store for the detail modal.
 */
export function groupDealsByTitle(
  deals: DealItem[],
): DealGroup[] {
  const buckets = new Map<string, DealItem[]>();

  for (const deal of deals) {
    const title = deal.gameTitle.trim();
    if (!title) continue;
    const key = normalizeTitle(title);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(deal);
    else buckets.set(key, [deal]);
  }

  const groups: DealGroup[] = [];
  for (const [key, offers] of buckets) {
    const sorted = [...offers].sort((a, b) => {
      if (a.dealPrice !== b.dealPrice) return a.dealPrice - b.dealPrice;
      return b.discountPercent - a.discountPercent;
    });
    const best = sorted[0];
    const prices = sorted.map((o) => o.dealPrice);
    const expiries = sorted
      .map((o) => (o.expiration ? new Date(o.expiration).getTime() : NaN))
      .filter((n) => Number.isFinite(n));

    groups.push({
      id: key,
      slug: titleToSlug(best.gameTitle),
      title: best.gameTitle.trim(),
      offers: sorted,
      best,
      storeCount: new Set(sorted.map((o) => o.storeName)).size,
      bestPrice: best.dealPrice,
      worstPrice: Math.max(...prices),
      maxDiscount: Math.max(...sorted.map((o) => o.discountPercent)),
      savings: Math.max(0, Math.max(...prices) - best.dealPrice),
      expiresAt:
        expiries.length > 0
          ? new Date(Math.min(...expiries)).toISOString()
          : null,
    });
  }

  return groups;
}

/** Giveaways that close within this window appear in the "Ending soon" rail. */
export const ENDING_SOON_MS = 48 * 60 * 60 * 1000;

/** Max cards per Overview rail. */
export const OVERVIEW_RAIL_SIZE = 6;

/** Steam AppID from a store/claim URL, when the link points at Steam. */
export function steamAppIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/store\.steampowered\.com\/app\/(\d+)/i);
  if (!match?.[1]) return null;
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : null;
}

export const DEFAULT_GP_FILTERS: GamePassFiltersState = {
  region: "US",
  categories: [],
  platform: "all",
  searchQuery: "",
  sortBy: "title_asc",
  wishlistOnly: false,
  hideOwned: false,
};

export const DEFAULT_DEAL_FILTERS: DealsFiltersState = {
  minDiscount: 0,
  store: "all",
  searchQuery: "",
  sortBy: "discount_desc",
  wishlistOnly: false,
  hideOwned: false,
};

export const DEFAULT_GIVEAWAY_FILTERS: GiveawaysFiltersState = {
  searchQuery: "",
  store: "all",
  sortBy: "expiry_asc",
  activeOnly: true,
};

export const DEFAULT_PLAYTESTER_FILTERS: PlaytesterFiltersState = {
  searchQuery: "",
  platform: "all",
  genre: "all",
  status: "all",
  kind: "all",
  sortBy: "newest_desc",
  hideOwned: false,
  wishlistOnly: false,
};

/** Number of Playtester listing pages scraped per fetch call. */
export const PLAYTESTER_PAGE_SIZE = 20;

/** Storage keys for the persisted per-tab filter state. */
export const DEALS_FILTER_KEYS = {
  tab: "gamelib.deals.sub_tab_v2",
  deals: "gamelib.deals.filters.deals_v1",
  gamepass: "gamelib.deals.filters.gamepass_v1",
  giveaways: "gamelib.deals.filters.giveaways_v1",
  playtester: "gamelib.deals.filters.playtester_v1",
} as const;

export const SUB_TABS: SubTab[] = [
  "overview",
  "deals",
  "gamepass",
  "giveaways",
  "playtester",
];
