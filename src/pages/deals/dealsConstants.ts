import type { GamePassFilters, DealsFilters } from "../../types/deals";

export type SubTab =
  | "gamepass"
  | "isthereanydeal"
  | "giveaways"
  | "playtester";

export type DealsSortOption =
  | "discount_desc"
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
  platform: string;
  minDiscount: number;
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

export const DEAL_PLATFORMS = [
  { value: "all", label: "deals.allPlatforms" },
  { value: "steam", label: "Steam" },
  { value: "epic", label: "Epic Games Store" },
  { value: "gog", label: "GOG" },
  { value: "humble", label: "Humble Store" },
];

export const DEAL_DISCOUNTS = [
  { value: 0 },
  { value: 25 },
  { value: 50 },
  { value: 75 },
  { value: 90 },
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

export function formatPrice(price: number, currency = "EUR"): string {
  if (!Number.isFinite(price)) return "—";
  if (price === 0) return "Free";
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";
  return `${symbol}${price.toFixed(2)}`;
}

/**
 * Calculates original price and estimated savings based on deal price and discount %.
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
    platform: filters.platform === "all" ? null : filters.platform,
    minDiscount: filters.minDiscount > 0 ? filters.minDiscount : null,
    store: filters.store === "all" ? null : filters.store,
  };
}

export function storeTint(storeName: string): string {
  const palette: Record<string, string> = {
    "Humble Bundle": "#ff3e1b",
    Humble: "#ff3e1b",
    Fanatical: "#ff9800",
    IndieGala: "#ffb4e0",
    GOG: "#b6883a",
    Steam: "#1b2838",
    Epic: "#2a2a72",
    "Xbox / Microsoft": "#107c10",
    "Green Man Gaming": "#5c9e31",
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
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Returns dynamic countdown information for giveaways.
 */
export function formatCountdown(isoDate: string | null | undefined): {
  label: string;
  isUrgent: boolean;
  isExpired: boolean;
} | null {
  if (!isoDate) return null;
  try {
    const end = new Date(isoDate).getTime();
    if (isNaN(end)) return null;
    const now = Date.now();
    const diff = end - now;

    if (diff <= 0) {
      return { label: "Expired", isUrgent: false, isExpired: true };
    }

    const totalMinutes = Math.floor(diff / (1000 * 60));
    const totalHours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    if (days > 1) {
      return { label: `${days}d left`, isUrgent: false, isExpired: false };
    }
    if (days === 1) {
      return { label: `1d ${hours}h left`, isUrgent: false, isExpired: false };
    }
    if (hours > 0) {
      return {
        label: `${hours}h ${minutes}m left`,
        isUrgent: hours <= 6,
        isExpired: false,
      };
    }
    return { label: `${minutes}m left`, isUrgent: true, isExpired: false };
  } catch {
    return null;
  }
}

/**
 * Converts a game title to a normalized lowercase slug for comparison / wishlist lookup.
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  platform: "all",
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
