import type { Dispatch, SetStateAction } from "react";
import { Heart, Timer } from "lucide-react";
import type {
  DealsToolbarFilter,
  DealsToolbarToggle,
} from "../../components/deals/DealsToolbar";
import {
  DEAL_DISCOUNTS,
  DEAL_STORES,
  DEFAULT_DEAL_FILTERS,
  DEFAULT_GIVEAWAY_FILTERS,
  DEFAULT_GP_FILTERS,
  DEFAULT_PLAYTESTER_FILTERS,
  GP_CATEGORIES,
  GP_CATEGORY_KEYS,
  GP_PLATFORMS,
  GP_REGIONS,
  type DealsFiltersState,
  type GamePassFiltersState,
  type GiveawaysFiltersState,
  type PlaytesterFiltersState,
} from "./dealsConstants";

type Translate = (key: string, vars?: Record<string, unknown>) => string;
type Setter<T> = Dispatch<SetStateAction<T>>;

export interface DealsTabToolbar {
  searchPlaceholder: string;
  sort: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  filters: DealsToolbarFilter[];
  toggles: DealsToolbarToggle[];
  onReset: () => void;
}

/**
 * Per-tab toolbar descriptions.
 *
 * Each source builds the same control band from a declarative list, so adding a
 * filter is a data change instead of another copy of the search/sort/refresh
 * markup.
 */

export function dealsToolbar(
  filters: DealsFiltersState,
  setFilters: Setter<DealsFiltersState>,
  t: Translate,
): DealsTabToolbar {
  return {
    searchPlaceholder: t("deals.searchPlaceholder"),
    sort: {
      value: filters.sortBy,
      onChange: (value) =>
        setFilters((prev) => ({ ...prev, sortBy: value as DealsFiltersState["sortBy"] })),
      options: [
        { value: "discount_desc", label: t("deals.sortDiscountDesc") },
        { value: "savings_desc", label: t("deals.sortSavingsDesc") },
        { value: "price_asc", label: t("deals.sortPriceAsc") },
        { value: "price_desc", label: t("deals.sortPriceDesc") },
        { value: "title_asc", label: t("deals.sortTitleAsc") },
        { value: "title_desc", label: t("deals.sortTitleDesc") },
      ],
    },
    filters: [
      {
        id: "store",
        label: t("deals.store"),
        value: filters.store,
        neutral: "all",
        options: DEAL_STORES.map((store) => ({
          value: store.value,
          label: t(store.label),
        })),
        onChange: (value) => setFilters((prev) => ({ ...prev, store: value })),
      },
      {
        id: "discount",
        label: t("deals.minDiscount"),
        value: String(filters.minDiscount),
        neutral: "0",
        options: DEAL_DISCOUNTS.map((discount) => ({
          value: String(discount.value),
          label:
            discount.value === 0
              ? t("deals.anyDiscount")
              : t("deals.discountOrMore", { pct: discount.value }),
        })),
        onChange: (value) =>
          setFilters((prev) => ({ ...prev, minDiscount: Number(value) })),
      },
    ],
    toggles: [
      scopeToggle("wishlist", filters.wishlistOnly, t("deals.wishlistOnly"), () =>
        setFilters((prev) => ({ ...prev, wishlistOnly: !prev.wishlistOnly })),
      ),
      scopeToggle("owned", filters.hideOwned, t("deals.hideOwned"), () =>
        setFilters((prev) => ({ ...prev, hideOwned: !prev.hideOwned })),
      ),
    ],
    onReset: () => setFilters(DEFAULT_DEAL_FILTERS),
  };
}

export function gamePassToolbar(
  filters: GamePassFiltersState,
  setFilters: Setter<GamePassFiltersState>,
  t: Translate,
): DealsTabToolbar {
  return {
    searchPlaceholder: t("deals.searchGamePassPlaceholder"),
    sort: {
      value: filters.sortBy,
      onChange: (value) =>
        setFilters((prev) => ({
          ...prev,
          sortBy: value as GamePassFiltersState["sortBy"],
        })),
      options: [
        { value: "title_asc", label: t("deals.sortTitleAsc") },
        { value: "title_desc", label: t("deals.sortTitleDesc") },
        { value: "release_desc", label: t("deals.sortReleaseDesc") },
        { value: "release_asc", label: t("deals.sortReleaseAsc") },
      ],
    },
    filters: [
      {
        id: "region",
        label: t("deals.region"),
        value: filters.region,
        neutral: "US",
        options: GP_REGIONS.map((region) => ({
          value: region.code,
          label: `${t(region.label)} (${region.code})`,
        })),
        onChange: (value) => setFilters((prev) => ({ ...prev, region: value })),
      },
      {
        id: "platform",
        label: t("deals.platform"),
        value: filters.platform,
        neutral: "all",
        options: GP_PLATFORMS.map((platform) => ({
          value: platform.value,
          label: t(platform.label),
        })),
        onChange: (value) => setFilters((prev) => ({ ...prev, platform: value })),
      },
      {
        id: "category",
        label: t("deals.categories"),
        value: filters.categories[0] ?? "all",
        neutral: "all",
        options: [
          { value: "all", label: t("deals.allCategories") },
          ...GP_CATEGORIES.map((category) => ({
            value: category,
            label: t(GP_CATEGORY_KEYS[category] ?? category),
          })),
        ],
        onChange: (value) =>
          setFilters((prev) => ({
            ...prev,
            categories: value === "all" ? [] : [value],
          })),
      },
    ],
    toggles: [
      scopeToggle("wishlist", filters.wishlistOnly, t("deals.wishlistOnly"), () =>
        setFilters((prev) => ({ ...prev, wishlistOnly: !prev.wishlistOnly })),
      ),
      scopeToggle("owned", filters.hideOwned, t("deals.hideOwned"), () =>
        setFilters((prev) => ({ ...prev, hideOwned: !prev.hideOwned })),
      ),
    ],
    onReset: () => setFilters(DEFAULT_GP_FILTERS),
  };
}

export function giveawaysToolbar(
  filters: GiveawaysFiltersState,
  setFilters: Setter<GiveawaysFiltersState>,
  stores: string[],
  t: Translate,
): DealsTabToolbar {
  return {
    searchPlaceholder: t("deals.searchGiveawaysPlaceholder"),
    sort: {
      value: filters.sortBy,
      onChange: (value) =>
        setFilters((prev) => ({
          ...prev,
          sortBy: value as GiveawaysFiltersState["sortBy"],
        })),
      options: [
        { value: "expiry_asc", label: t("deals.sortExpiryAsc") },
        { value: "title_asc", label: t("deals.sortTitleAsc") },
        { value: "title_desc", label: t("deals.sortTitleDesc") },
      ],
    },
    filters: [
      {
        id: "store",
        label: t("deals.store"),
        value: filters.store,
        neutral: "all",
        options: [
          { value: "all", label: t("deals.allStores") },
          ...stores.map((store) => ({ value: store, label: store })),
        ],
        onChange: (value) => setFilters((prev) => ({ ...prev, store: value })),
      },
    ],
    toggles: [
      {
        id: "active",
        label: t("deals.activeOnly"),
        icon: <Timer size={13} aria-hidden="true" />,
        active: filters.activeOnly,
        defaultActive: true,
        onToggle: () =>
          setFilters((prev) => ({ ...prev, activeOnly: !prev.activeOnly })),
      },
    ],
    onReset: () => setFilters(DEFAULT_GIVEAWAY_FILTERS),
  };
}

export function playtesterToolbar(
  filters: PlaytesterFiltersState,
  setFilters: Setter<PlaytesterFiltersState>,
  facets: { platforms: string[]; genres: string[]; statuses: string[]; kinds: string[] },
  t: Translate,
): DealsTabToolbar {
  const toOptions = (values: string[], allLabel: string) => [
    { value: "all", label: allLabel },
    ...values.map((value) => ({ value, label: value })),
  ];

  return {
    searchPlaceholder: t("deals.searchPlaytesterPlaceholder"),
    sort: {
      value: filters.sortBy,
      onChange: (value) =>
        setFilters((prev) => ({
          ...prev,
          sortBy: value as PlaytesterFiltersState["sortBy"],
        })),
      options: [
        { value: "newest_desc", label: t("deals.sortNewestDesc") },
        { value: "newest_asc", label: t("deals.sortNewestAsc") },
        { value: "title_asc", label: t("deals.sortTitleAsc") },
        { value: "title_desc", label: t("deals.sortTitleDesc") },
      ],
    },
    filters: [
      {
        id: "platform",
        label: t("deals.platform"),
        value: filters.platform,
        neutral: "all",
        options: toOptions(facets.platforms, t("deals.allPlatforms")),
        onChange: (value) => setFilters((prev) => ({ ...prev, platform: value })),
      },
      {
        id: "genre",
        label: t("deals.genre"),
        value: filters.genre,
        neutral: "all",
        options: toOptions(facets.genres, t("deals.allGenres")),
        onChange: (value) => setFilters((prev) => ({ ...prev, genre: value })),
      },
      {
        id: "status",
        label: t("deals.status"),
        value: filters.status,
        neutral: "all",
        options: toOptions(facets.statuses, t("deals.allStatuses")),
        onChange: (value) => setFilters((prev) => ({ ...prev, status: value })),
      },
      {
        id: "kind",
        label: t("deals.type"),
        value: filters.kind,
        neutral: "all",
        options: toOptions(facets.kinds, t("deals.allTypes")),
        onChange: (value) => setFilters((prev) => ({ ...prev, kind: value })),
      },
    ],
    toggles: [
      scopeToggle("wishlist", filters.wishlistOnly, t("deals.wishlistOnly"), () =>
        setFilters((prev) => ({ ...prev, wishlistOnly: !prev.wishlistOnly })),
      ),
      scopeToggle("owned", filters.hideOwned, t("deals.hideOwned"), () =>
        setFilters((prev) => ({ ...prev, hideOwned: !prev.hideOwned })),
      ),
    ],
    onReset: () => setFilters(DEFAULT_PLAYTESTER_FILTERS),
  };
}

function scopeToggle(
  id: string,
  active: boolean,
  label: string,
  onToggle: () => void,
): DealsToolbarToggle {
  return {
    id,
    label,
    icon: <Heart size={13} fill={active ? "currentColor" : "none"} aria-hidden="true" />,
    active,
    onToggle,
  };
}
