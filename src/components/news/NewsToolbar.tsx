import { useState, type ReactNode } from "react";
import type { NewsCategory } from "../../hooks/useNewsFeeds";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

export type NewsTimeFilter = "all" | "today" | "3days" | "week" | "month";
export type NewsReadTimeFilter = "all" | "quick" | "medium" | "long";
export type NewsSortOption = "newest" | "oldest" | "read_time" | "source" | "title";

interface NewsToolbarProps {
  activeCategory: NewsCategory;
  onCategoryChange: (category: NewsCategory) => void;
  countsByCategory: Record<NewsCategory, number>;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  timeFilter: NewsTimeFilter;
  onTimeFilterChange: (time: NewsTimeFilter) => void;
  readTimeFilter: NewsReadTimeFilter;
  onReadTimeFilterChange: (rt: NewsReadTimeFilter) => void;
  sortBy: NewsSortOption;
  onSortByChange: (sort: NewsSortOption) => void;
  hasImagesOnly: boolean;
  onToggleHasImagesOnly: () => void;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  unreadTotal: number;
  density: ViewDensity;
  onDensityChange: (density: ViewDensity) => void;
}

export default function NewsToolbar({
  activeCategory,
  onCategoryChange,
  countsByCategory,
  searchQuery,
  onSearchChange,
  timeFilter,
  onTimeFilterChange,
  readTimeFilter,
  onReadTimeFilterChange,
  sortBy,
  onSortByChange,
  hasImagesOnly,
  onToggleHasImagesOnly,
  unreadOnly,
  onToggleUnreadOnly,
  unreadTotal,
  density,
  onDensityChange,
}: NewsToolbarProps) {
  const { t } = useLanguage();

  const [filtersOpen, setFiltersOpen] = useState(false);

  const activeFilterCount = [
    timeFilter !== "all",
    readTimeFilter !== "all",
    sortBy !== "newest",
    hasImagesOnly,
    unreadOnly,
  ].filter(Boolean).length;
  const showFiltersRow = filtersOpen || activeFilterCount > 0;

  const categories: { id: NewsCategory; labelKey: string; icon: ReactNode }[] = [
    {
      id: "all",
      labelKey: "news.tabAll",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11a9 9 0 0 1 9 9" />
          <path d="M4 4a16 16 0 0 1 16 16" />
          <circle cx="5" cy="19" r="1" />
        </svg>
      ),
    },
    {
      id: "for_you",
      labelKey: "news.tabForYou",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <line x1="6" y1="12" x2="10" y2="12" />
          <line x1="8" y1="10" x2="8" y2="14" />
          <line x1="15" y1="11" x2="15.01" y2="11" />
          <line x1="18" y1="13" x2="18.01" y2="13" />
        </svg>
      ),
    },
    {
      id: "pc",
      labelKey: "news.tabPc",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
    {
      id: "console",
      labelKey: "news.tabConsole",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 3 22 17 2 17 5 3" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="10" y1="11" x2="14" y2="11" />
        </svg>
      ),
    },
    {
      id: "tech",
      labelKey: "news.tabTech",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      id: "indie",
      labelKey: "news.tabIndie",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
      ),
    },
    {
      id: "deals",
      labelKey: "news.tabDeals",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      ),
    },
    {
      id: "saved",
      labelKey: "news.tabSaved",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: "history",
      labelKey: "news.tabHistory",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  return (
    <div className="news-toolbar">
      {/* Category / Stream Subtabs */}
      <div className="news-categories-track" role="tablist" aria-label={t("news.categoriesLabel")}>
        {categories.map((cat) => {
          const count = countsByCategory[cat.id] ?? 0;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`news-category-tab ${isActive ? "active" : ""}`}
              onClick={() => onCategoryChange(cat.id)}
            >
              <span className="news-category-tab-icon" aria-hidden="true">
                {cat.icon}
              </span>
              <span>{t(cat.labelKey)}</span>
              {count > 0 && <span className="news-category-tab-badge">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Main Row: Search, Unread Toggle, Filters Trigger, Density */}
      <div className="news-toolbar-main-row">
        <div className="news-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="news-search-icon" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="news-search-input"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onSearchChange("");
            }}
            placeholder={t("news.searchPlaceholder")}
            aria-label={t("news.searchPlaceholder")}
          />
          {searchQuery && (
            <button
              type="button"
              className="news-search-clear"
              onClick={() => onSearchChange("")}
              aria-label={t("common.clearSearch")}
              title={t("common.clearSearch")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* View Density Switcher */}
        <div className="news-density-picker" role="radiogroup" aria-label="Layout density">
          <button
            type="button"
            role="radio"
            aria-checked={density === "cinematic"}
            className={`news-density-btn ${density === "cinematic" ? "active" : ""}`}
            onClick={() => onDensityChange("cinematic")}
            title="Cinematic Magazine View"
            aria-label="Cinematic Magazine View"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="14" x2="21" y2="14" />
            </svg>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === "cozy"}
            className={`news-density-btn ${density === "cozy" ? "active" : ""}`}
            onClick={() => onDensityChange("cozy")}
            title="Cozy Cards View"
            aria-label="Cozy Cards View"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === "compact"}
            className={`news-density-btn ${density === "compact" ? "active" : ""}`}
            onClick={() => onDensityChange("compact")}
            title="Compact View"
            aria-label="Compact View"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={density === "list"}
            className={`news-density-btn ${density === "list" ? "active" : ""}`}
            onClick={() => onDensityChange("list")}
            title="Editorial List View"
            aria-label="Editorial List View"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>

        {/* Unread toggle + advanced filters trigger */}
        <div className="news-toolbar-actions">
          <button
            type="button"
            className={`news-toggle-pill ${unreadOnly ? "active" : ""}`}
            onClick={onToggleUnreadOnly}
            aria-pressed={unreadOnly}
            title={t("news.unreadOnlyTitle")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10" />
              <polyline points="16 2 22 8 16 8" />
              <line x1="22" y1="2" x2="16" y2="8" />
            </svg>
            {t("news.unreadOnly")}
            {unreadTotal > 0 && <span className="news-toggle-unread-badge">{unreadTotal}</span>}
          </button>

          <button
            type="button"
            className={`news-toggle-pill news-filters-toggle${activeFilterCount > 0 ? " active" : ""}`}
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={showFiltersRow}
            aria-controls="news-filter-row"
            title={t(showFiltersRow ? "news.hideFilters" : "news.showFilters")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {t(showFiltersRow ? "news.hideFilters" : "news.showFilters")}
            {activeFilterCount > 0 && <span className="news-toggle-unread-badge">{activeFilterCount}</span>}
          </button>
        </div>
      </div>

      {/* Advanced filters row — collapsible from the main row */}
      {showFiltersRow && (
        <div className="news-toolbar-filters-row" id="news-filter-row">
          {/* Time filter */}
          <div className="news-filter-group">
            <label htmlFor="news-time-filter">{t("news.timeFilterLabel")}</label>
            <select
              id="news-time-filter"
              className="news-filter-select"
              value={timeFilter}
              onChange={(e) => onTimeFilterChange(e.target.value as NewsTimeFilter)}
            >
              <option value="all">{t("news.timeAll")}</option>
              <option value="today">{t("news.timeToday")}</option>
              <option value="3days">{t("news.time3Days")}</option>
              <option value="week">{t("news.timeWeek")}</option>
              <option value="month">{t("news.timeMonth")}</option>
            </select>
          </div>

          {/* Read time filter */}
          <div className="news-filter-group">
            <label htmlFor="news-readtime-filter">{t("news.readTimeLabel")}</label>
            <select
              id="news-readtime-filter"
              className="news-filter-select"
              value={readTimeFilter}
              onChange={(e) => onReadTimeFilterChange(e.target.value as NewsReadTimeFilter)}
            >
              <option value="all">{t("news.readTimeAll")}</option>
              <option value="quick">{t("news.readTimeQuick")}</option>
              <option value="medium">{t("news.readTimeMedium")}</option>
              <option value="long">{t("news.readTimeLong")}</option>
            </select>
          </div>

          {/* Sort filter */}
          <div className="news-filter-group">
            <label htmlFor="news-sort-filter">{t("news.sortByLabel")}</label>
            <select
              id="news-sort-filter"
              className="news-filter-select"
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value as NewsSortOption)}
            >
              <option value="newest">{t("news.sortNewest")}</option>
              <option value="oldest">{t("news.sortOldest")}</option>
              <option value="read_time">{t("news.sortReadTime")}</option>
              <option value="source">{t("news.sortSource")}</option>
              <option value="title">{t("news.sortTitle")}</option>
            </select>
          </div>

          {/* Images only toggle */}
          <button
            type="button"
            className={`news-toggle-pill ${hasImagesOnly ? "active" : ""}`}
            onClick={onToggleHasImagesOnly}
            aria-pressed={hasImagesOnly}
            title={t("news.hasImagesOnly")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {t("news.hasImagesOnly")}
          </button>
        </div>
      )}
    </div>
  );
}
