import { useState, useMemo } from "react";
import type { Giveaway } from "../../types/deals";
import type { GiveawaysSortOption } from "../../pages/deals/dealsConstants";
import { DEFAULT_GIVEAWAY_FILTERS } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import GiveawayCard from "./GiveawayCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface GiveawaysPanelProps {
  giveaways: Giveaway[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (giveaway: Giveaway) => void;
  onReload: () => void;
}

export default function GiveawaysPanel({
  giveaways,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onInspect,
  onReload,
}: GiveawaysPanelProps) {
  const { t } = useLanguage();
  const [filters, setFilters] = useState(DEFAULT_GIVEAWAY_FILTERS);

  // Available stores
  const storeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of giveaways) {
      if (g.storeName) set.add(g.storeName);
    }
    return ["all", ...Array.from(set)];
  }, [giveaways]);

  // Client-side filtering & sorting
  const processedGiveaways = useMemo(() => {
    let list = [...giveaways];

    const q = filters.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.title.toLowerCase().includes(q) ||
          g.storeName.toLowerCase().includes(q) ||
          (g.bundleTitle && g.bundleTitle.toLowerCase().includes(q)),
      );
    }

    if (filters.store !== "all") {
      list = list.filter((g) => g.storeName.toLowerCase() === filters.store.toLowerCase());
    }

    if (filters.activeOnly) {
      const now = Date.now();
      list = list.filter((g) => {
        if (!g.expiry) return true;
        const end = new Date(g.expiry).getTime();
        return isNaN(end) || end > now;
      });
    }

    list.sort((a, b) => {
      switch (filters.sortBy) {
        case "expiry_asc": {
          const ta = a.expiry ? new Date(a.expiry).getTime() : Infinity;
          const tb = b.expiry ? new Date(b.expiry).getTime() : Infinity;
          return ta - tb;
        }
        case "title_asc":
          return a.title.localeCompare(b.title);
        case "title_desc":
          return b.title.localeCompare(a.title);
        default:
          return 0;
      }
    });

    return list;
  }, [giveaways, filters.searchQuery, filters.store, filters.activeOnly, filters.sortBy]);

  return (
    <section className="deals-section" aria-label={t("deals.freeGames")}>
      <div className="deals-toolbar">
        {/* Search Input */}
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
            placeholder={t("deals.searchGiveawaysPlaceholder")}
            aria-label={t("deals.searchGiveawaysPlaceholder")}
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

        {/* Filters row */}
        <div className="deals-filters-row">
          <div className="deals-filter-group">
            <label htmlFor="gw-store">{t("deals.store")}</label>
            <select
              id="gw-store"
              className="deals-filter-select"
              value={filters.store}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, store: e.target.value }))
              }
            >
              {storeOptions.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? t("deals.allStores") : s}
                </option>
              ))}
            </select>
          </div>

          <div className="deals-filter-group">
            <label htmlFor="gw-sort">{t("deals.sortBy")}</label>
            <select
              id="gw-sort"
              className="deals-filter-select"
              value={filters.sortBy}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  sortBy: e.target.value as GiveawaysSortOption,
                }))
              }
            >
              <option value="expiry_asc">{t("deals.sortExpiryAsc")}</option>
              <option value="title_asc">{t("deals.sortTitleAsc")}</option>
              <option value="title_desc">{t("deals.sortTitleDesc")}</option>
            </select>
          </div>
        </div>

        {/* Quick Toggles */}
        <div className="deals-quick-toggles">
          <button
            type="button"
            className={`deals-toggle-chip ${filters.activeOnly ? "active" : ""}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                activeOnly: !prev.activeOnly,
              }))
            }
            aria-pressed={filters.activeOnly}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t("deals.activeOnly")}
          </button>

          <Button
            variant="secondary"
            size="sm"
            isLoading={loading}
            onClick={onReload}
            title={t("deals.refreshGiveaways")}
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

      {/* Results Meta */}
      {!loading && !error && giveaways.length > 0 && (
        <div className="deals-results-meta">
          <span>
            {t("deals.showingCount", {
              count: processedGiveaways.length,
              total: giveaways.length,
            })}
          </span>
          {(filters.searchQuery || filters.store !== "all" || !filters.activeOnly) && (
            <button
              type="button"
              className="deals-clear-all-btn"
              onClick={() => setFilters(DEFAULT_GIVEAWAY_FILTERS)}
            >
              {t("deals.resetFilters")}
            </button>
          )}
        </div>
      )}

      {loading && (
        <DealsSkeletonGrid density={density} variant="giveaway" count={8} />
      )}

      {!loading && error && (
        <DealsErrorState message={error} onRetry={onReload} />
      )}

      {!loading && !error && (empty || processedGiveaways.length === 0) && (
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
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
          }
          message={
            processedGiveaways.length === 0 && giveaways.length > 0
              ? t("deals.noMatchingDeals")
              : t("deals.emptyGiveaways")
          }
          onRetry={onReload}
        />
      )}

      {!loading && !error && processedGiveaways.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {processedGiveaways.map((giveaway, i) => (
            <GiveawayCard
              key={giveaway.id}
              giveaway={giveaway}
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
