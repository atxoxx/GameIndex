import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import type {
  GameNewsFilterCategory,
  GameNewsViewMode,
  GameNewsSortOption,
} from "./gameNewsTypes";

interface CategoryCount {
  all: number;
  patch_notes: number;
  official: number;
  press: number;
  saved: number;
}

interface GameNewsToolbarProps {
  activeCategory: GameNewsFilterCategory;
  onSelectCategory: (cat: GameNewsFilterCategory) => void;
  counts: CategoryCount;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: GameNewsViewMode;
  onViewModeChange: (mode: GameNewsViewMode) => void;
  sortOption: GameNewsSortOption;
  onSortChange: (sort: GameNewsSortOption) => void;
  onMarkAllRead: () => void;
  onOpenCustomFeeds: () => void;
  onRefresh: () => void;
  onOpenNewsHub: () => void;
  isRefreshing?: boolean;
  hasUnread?: boolean;
}

export default function GameNewsToolbar({
  activeCategory,
  onSelectCategory,
  counts,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  sortOption,
  onSortChange,
  onMarkAllRead,
  onOpenCustomFeeds,
  onRefresh,
  onOpenNewsHub,
  isRefreshing = false,
  hasUnread = false,
}: GameNewsToolbarProps) {
  const { t } = useLanguage();

  const categories: { id: GameNewsFilterCategory; label: string; count: number; icon: React.ReactNode }[] = [
    {
      id: "all",
      label: t("game.news.all"),
      count: counts.all,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
      ),
    },
    {
      id: "patch_notes",
      label: t("game.news.patchNotes"),
      count: counts.patch_notes,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      ),
    },
    {
      id: "official",
      label: t("game.news.official"),
      count: counts.official,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ),
    },
    {
      id: "press",
      label: t("game.news.press"),
      count: counts.press,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
          <path d="M18 14h-8" />
          <path d="M15 18h-5" />
          <path d="M10 6h8v4h-8V6Z" />
        </svg>
      ),
    },
    {
      id: "saved",
      label: t("game.news.saved"),
      count: counts.saved,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="game-news-toolbar-container">
      {/* Category Pills Row */}
      <div className="game-news-categories-row" role="tablist" aria-label="Game news categories">
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`game-news-category-pill ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectCategory(cat.id)}
            >
              <span className="game-news-category-icon" aria-hidden="true">
                {cat.icon}
              </span>
              <span className="game-news-category-label">{cat.label}</span>
              <span className="game-news-category-count">{cat.count}</span>
            </button>
          );
        })}
      </div>

      {/* Control bar: Search, View Mode, Sort, Actions */}
      <div className="game-news-controls-row">
        {/* Search input */}
        <div className="game-news-search-box">
          <svg
            className="game-news-search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="game-news-search-input"
            placeholder={t("game.news.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="game-news-search-clear"
              onClick={() => onSearchChange("")}
              title={t("game.news.clearFilter")}
              aria-label={t("game.news.clearFilter")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* View Mode Toggle Group */}
        <div className="game-news-view-toggles" role="group" aria-label="View layout switcher">
          <button
            type="button"
            className={`game-news-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
            onClick={() => onViewModeChange("grid")}
            title={t("game.news.viewGrid")}
            aria-label={t("game.news.viewGrid")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </button>

          <button
            type="button"
            className={`game-news-view-btn ${viewMode === "timeline" ? "is-active" : ""}`}
            onClick={() => onViewModeChange("timeline")}
            title={t("game.news.viewTimeline")}
            aria-label={t("game.news.viewTimeline")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3" />
              <circle cx="12" cy="19" r="3" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="15" y1="12" x2="20" y2="12" />
            </svg>
          </button>

          <button
            type="button"
            className={`game-news-view-btn ${viewMode === "list" ? "is-active" : ""}`}
            onClick={() => onViewModeChange("list")}
            title={t("game.news.viewList")}
            aria-label={t("game.news.viewList")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>

        {/* Sort selector */}
        <select
          className="game-news-sort-select"
          value={sortOption}
          onChange={(e) => onSortChange(e.target.value as GameNewsSortOption)}
          aria-label="Sort articles"
        >
          <option value="newest">{t("game.news.sortByNewest")}</option>
          <option value="oldest">{t("game.news.sortByOldest")}</option>
        </select>

        {/* Action Buttons */}
        <div className="game-news-action-buttons">
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkAllRead}
              title={t("game.news.markAllRead")}
              aria-label={t("game.news.markAllRead")}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              }
            >
              {t("game.news.markAllRead")}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCustomFeeds}
            title={t("game.news.customFeedsTitle")}
            aria-label={t("game.news.customFeedsTitle")}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 11a9 9 0 0 1 9 9" />
                <path d="M4 4a16 16 0 0 1 16 16" />
                <circle cx="5" cy="19" r="1" />
              </svg>
            }
          >
            {t("game.news.customFeeds")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
            leftIcon={
              <svg
                className={isRefreshing ? "spin-animation" : ""}
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

          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenNewsHub}
            title={t("game.news.openNewsHub")}
            aria-label={t("game.news.openNewsHub")}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            }
          >
            {t("game.news.openNewsHub")}
          </Button>
        </div>
      </div>
    </div>
  );
}
