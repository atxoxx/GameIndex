import { useMemo } from "react";
import type { DealItem } from "../../types/deals";
import type {
  DealsFiltersState,
  DealsSortOption,
} from "../../pages/deals/dealsConstants";
import {
  DEAL_PLATFORMS,
  DEAL_STORES,
  DEAL_DISCOUNTS,
  titleToSlug,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { useGames } from "../../context/GameContext";
import { Button } from "../ui";
import DealCard from "./DealCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface DealsPanelProps {
  filters: DealsFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<DealsFiltersState>>;
  deals: DealItem[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (deal: DealItem) => void;
  onReload: () => void;
}

export default function DealsPanel({
  filters,
  setFilters,
  deals,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onInspect,
  onReload,
}: DealsPanelProps) {
  const { t } = useLanguage();
  const { isWishlisted } = useWishlist();
  const { games } = useGames();

  // Owned names set for fast lookup
  const ownedNames = useMemo(() => {
    return new Set(games.map((g) => g.name.toLowerCase().trim()));
  }, [games]);

  // Client-side search, wishlist filter, owned filter, and sorting
  const processedDeals = useMemo(() => {
    let list = [...deals];

    // Search query
    const q = filters.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          d.gameTitle.toLowerCase().includes(q) ||
          d.storeName.toLowerCase().includes(q) ||
          d.platform.toLowerCase().includes(q),
      );
    }

    // Wishlist only filter
    if (filters.wishlistOnly) {
      list = list.filter((d) => isWishlisted(titleToSlug(d.gameTitle)));
    }

    // Hide owned filter
    if (filters.hideOwned) {
      list = list.filter(
        (d) => !ownedNames.has(d.gameTitle.toLowerCase().trim()),
      );
    }

    // Sorting
    list.sort((a, b) => {
      switch (filters.sortBy) {
        case "discount_desc":
          return b.discountPercent - a.discountPercent;
        case "price_asc":
          return a.dealPrice - b.dealPrice;
        case "price_desc":
          return b.dealPrice - a.dealPrice;
        case "title_asc":
          return a.gameTitle.localeCompare(b.gameTitle);
        case "title_desc":
          return b.gameTitle.localeCompare(a.gameTitle);
        default:
          return 0;
      }
    });

    return list;
  }, [deals, filters.searchQuery, filters.wishlistOnly, filters.hideOwned, filters.sortBy, isWishlisted, ownedNames]);

  return (
    <section className="deals-section" aria-label="IsThereAnyDeal">
      {/* Filter and Search Bar */}
      <div className="deals-toolbar">
        {/* Search input */}
        <div className="deals-search">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="deals-search-icon"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="deals-search-input"
            value={filters.searchQuery}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
            }
            placeholder={t("deals.searchPlaceholder")}
            aria-label={t("deals.searchPlaceholder")}
          />
          {filters.searchQuery && (
            <button
              type="button"
              className="deals-search-clear"
              onClick={() =>
                setFilters((prev) => ({ ...prev, searchQuery: "" }))
              }
              aria-label={t("common.clearSearch")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Filters Row */}
        <div className="deals-filters-row">
          <div className="deals-filter-group">
            <label htmlFor="deal-store">{t("deals.store")}</label>
            <select
              id="deal-store"
              className="deals-filter-select"
              value={filters.store}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, store: e.target.value }))
              }
            >
              {DEAL_STORES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="deal-discount">{t("deals.minDiscount")}</label>
            <select
              id="deal-discount"
              className="deals-filter-select"
              value={filters.minDiscount}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minDiscount: Number(e.target.value),
                }))
              }
            >
              {DEAL_DISCOUNTS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.value === 0
                    ? t("deals.anyDiscount")
                    : t("deals.discountOrMore", { pct: d.value })}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="deal-platform">{t("deals.platform")}</label>
            <select
              id="deal-platform"
              className="deals-filter-select"
              value={filters.platform}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  platform: e.target.value,
                }))
              }
            >
              {DEAL_PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="deal-sort">{t("deals.sortBy")}</label>
            <select
              id="deal-sort"
              className="deals-filter-select"
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  sortBy: e.target.value as DealsSortOption,
                }))
              }
            >
              <option value="discount_desc">{t("deals.sortDiscountDesc")}</option>
              <option value="price_asc">{t("deals.sortPriceAsc")}</option>
              <option value="price_desc">{t("deals.sortPriceDesc")}</option>
              <option value="title_asc">{t("deals.sortTitleAsc")}</option>
              <option value="title_desc">{t("deals.sortTitleDesc")}</option>
            </select>
          </div>
        </div>

        {/* Quick Toggles */}
        <div className="deals-quick-toggles">
          <button
            type="button"
            className={`deals-toggle-chip ${filters.wishlistOnly ? "active" : ""}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                wishlistOnly: !prev.wishlistOnly,
              }))
            }
            aria-pressed={filters.wishlistOnly}
          >
            <svg
              viewBox="0 0 24 24"
              fill={filters.wishlistOnly ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {t("deals.wishlistOnly")}
          </button>

          <button
            type="button"
            className={`deals-toggle-chip ${filters.hideOwned ? "active" : ""}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                hideOwned: !prev.hideOwned,
              }))
            }
            aria-pressed={filters.hideOwned}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
            {t("deals.hideOwned")}
          </button>

          <Button
            variant="secondary"
            size="sm"
            isLoading={loading}
            onClick={onReload}
            title={t("deals.refreshDeals")}
            leftIcon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            }
          >
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Results Count Banner */}
      {!loading && !error && deals.length > 0 && (
        <div className="deals-results-meta">
          <span>
            {t("deals.showingCount", {
              count: processedDeals.length,
              total: deals.length,
            })}
          </span>
          {(filters.searchQuery || filters.wishlistOnly || filters.hideOwned) && (
            <button
              type="button"
              className="deals-clear-all-btn"
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  searchQuery: "",
                  wishlistOnly: false,
                  hideOwned: false,
                }))
              }
            >
              {t("deals.resetFilters")}
            </button>
          )}
        </div>
      )}

      {loading && (
        <DealsSkeletonGrid density={density} variant="deal" count={12} />
      )}

      {!loading && error && (
        <DealsErrorState message={error} onRetry={onReload} />
      )}

      {!loading && !error && (empty || processedDeals.length === 0) && (
        <DealsEmptyState
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          message={
            processedDeals.length === 0 && deals.length > 0
              ? t("deals.noMatchingDeals")
              : t("deals.emptyDeals")
          }
          onRetry={onReload}
        />
      )}

      {!loading && !error && processedDeals.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {processedDeals.map((deal, i) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onOpenUrl={onOpenUrl}
              onInspect={onInspect}
              index={i}
              density={density}
            />
          ))}
        </div>
      )}
    </section>
  );
}
