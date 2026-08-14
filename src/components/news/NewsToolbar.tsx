import { useLanguage } from "../../context/LanguageContext";

export type NewsFeedView = "feed" | "saved";
export type NewsTimeFilter = "all" | "today" | "week" | "month";
export type NewsSortOption = "newest" | "oldest" | "read_time";

interface NewsToolbarProps {
  view: NewsFeedView;
  onViewChange: (view: NewsFeedView) => void;
  feedCount: number;
  savedCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  timeFilter: NewsTimeFilter;
  onTimeFilterChange: (time: NewsTimeFilter) => void;
  sortBy: NewsSortOption;
  onSortByChange: (sort: NewsSortOption) => void;
  unreadOnly: boolean;
  onToggleUnreadOnly: () => void;
  unreadTotal: number;
}

export default function NewsToolbar({
  view,
  onViewChange,
  feedCount,
  savedCount,
  searchQuery,
  onSearchChange,
  timeFilter,
  onTimeFilterChange,
  sortBy,
  onSortByChange,
  unreadOnly,
  onToggleUnreadOnly,
  unreadTotal,
}: NewsToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="news-toolbar">
      {/* Top View Tabs & Search */}
      <div className="news-toolbar-main-row">
        <div className="news-view-tabs" role="tablist" aria-label={t("news.viewTabsLabel")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "feed"}
            className={`news-view-tab${view === "feed" ? " active" : ""}`}
            onClick={() => onViewChange("feed")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
            {t("news.viewFeed")}
            {feedCount > 0 && <span className="news-view-tab-badge">{feedCount}</span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={view === "saved"}
            className={`news-view-tab${view === "saved" ? " active" : ""}`}
            onClick={() => onViewChange("saved")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            {t("news.saved")}
            {savedCount > 0 && <span className="news-view-tab-badge">{savedCount}</span>}
          </button>
        </div>

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
      </div>

      {/* Filter Row: Time range, Sort, Unread toggle */}
      <div className="news-toolbar-filters-row">
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
            <option value="week">{t("news.timeWeek")}</option>
            <option value="month">{t("news.timeMonth")}</option>
          </select>
        </div>

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
          </select>
        </div>

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
      </div>
    </div>
  );
}
