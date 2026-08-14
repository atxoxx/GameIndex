import type { GamePassFilters, DealsFilters } from "../../types/deals";

export type SubTab = "gamepass" | "isthereanydeal" | "giveaways";

export interface GamePassFiltersState {
  region: string;
  categories: string[];
  platform: string;
}

export interface DealsFiltersState {
  platform: string;
  minDiscount: number;
  store: string;
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

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  return `€${price.toFixed(2)}`;
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
    Fanatical: "#ff9800",
    IndieGala: "#ffb4e0",
    GOG: "#b6883a",
    Steam: "#1b2838",
    Epic: "#2a2a72",
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

export const DEFAULT_GP_FILTERS: GamePassFiltersState = {
  region: "US",
  categories: [],
  platform: "all",
};

export const DEFAULT_DEAL_FILTERS: DealsFiltersState = {
  platform: "all",
  minDiscount: 0,
  store: "all",
};
