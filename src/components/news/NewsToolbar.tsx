import { useLanguage } from "../../context/LanguageContext";

export type NewsFeedView = "feed" | "saved";

interface NewsToolbarProps {
  view: NewsFeedView;
  onViewChange: (view: NewsFeedView) => void;
  feedCount: number;
  savedCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

/**
 * NewsToolbar — view switcher (feed / saved) plus a client-side search
 * box. Search filters whatever view is active, so it composes with the
 * source pills below.
 */
export default function NewsToolbar({
  view,
  onViewChange,
  feedCount,
  savedCount,
  searchQuery,
  onSearchChange,
}: NewsToolbarProps) {
  const { t } = useLanguage();

  return (
    <div className="news-toolbar">
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
  );
}
