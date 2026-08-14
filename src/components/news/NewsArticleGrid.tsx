import type { NewsArticle, NewsCategory } from "../../hooks/useNewsFeeds";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import NewsArticleCard, { NewsArticleCardSkeleton } from "./NewsArticleCard";
import NewsEmptyState, { NewsErrorState } from "./NewsEmptyState";

const SKELETON_COUNT = 8;

interface NewsArticleGridProps {
  articles: NewsArticle[];
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  readLinks: Set<string>;
  savedLinks: Set<string>;
  sourceNames: string[];
  activeSource: string | null;
  activeCategory: NewsCategory;
  searchQuery: string;
  activeTag: string | null;
  relatedGameNames?: Map<string, string>;
  onCardClick: (article: NewsArticle) => void;
  onToggleSave?: (article: NewsArticle) => void;
  onToggleRead?: (article: NewsArticle) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onClearSearch: () => void;
  onClearTag?: () => void;
  onSwitchToAll: () => void;
  onSelectTag?: (tag: string) => void;
}

export default function NewsArticleGrid({
  articles,
  totalCount,
  hasMore,
  loading,
  error,
  density,
  readLinks,
  savedLinks,
  sourceNames,
  activeSource,
  activeCategory,
  searchQuery,
  activeTag,
  relatedGameNames,
  onCardClick,
  onToggleSave,
  onToggleRead,
  onLoadMore,
  onRetry,
  onOpenSettings,
  onClearSearch,
  onClearTag,
  onSwitchToAll,
  onSelectTag,
}: NewsArticleGridProps) {
  const { t } = useLanguage();

  if (loading && totalCount === 0) {
    return (
      <div className={`news-article-grid density-${density}`}>
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <NewsArticleCardSkeleton key={i} density={density} />
        ))}
      </div>
    );
  }

  if (error && totalCount === 0) {
    return <NewsErrorState message={error} onRetry={onRetry} />;
  }

  if (totalCount === 0) {
    if (sourceNames.length === 0) {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9" />
              <path d="M4 4a16 16 0 0 1 16 16" />
              <circle cx="5" cy="19" r="1" />
            </svg>
          }
          title={t("news.noArticles")}
          message={t("news.noArticlesSources")}
          actionLabel={t("news.addFeed")}
          onAction={onOpenSettings}
        />
      );
    }

    if (searchQuery.trim()) {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          title={t("news.noSearchResults")}
          actionLabel={t("common.clear")}
          onAction={onClearSearch}
        />
      );
    }

    if (activeTag) {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
          }
          title={t("news.noTagResults", { tag: activeTag })}
          actionLabel={t("common.clear")}
          onAction={onClearTag}
        />
      );
    }

    if (activeCategory === "saved") {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          }
          title={t("news.noSavedArticles")}
          message={t("news.noSavedArticlesHint")}
          actionLabel={t("news.openFeed")}
          onAction={onSwitchToAll}
        />
      );
    }

    if (activeCategory === "history") {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          title={t("news.noHistoryYet")}
          message={t("news.noHistoryHint")}
          actionLabel={t("news.openFeed")}
          onAction={onSwitchToAll}
        />
      );
    }

    if (activeCategory === "for_you") {
      return (
        <NewsEmptyState
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="6" y1="12" x2="10" y2="12" />
              <line x1="8" y1="10" x2="8" y2="14" />
              <line x1="15" y1="11" x2="15.01" y2="11" />
              <line x1="18" y1="13" x2="18.01" y2="13" />
            </svg>
          }
          title={t("news.noForYouMatches")}
          message={t("news.noForYouHint")}
          actionLabel={t("news.openFeed")}
          onAction={onSwitchToAll}
        />
      );
    }

    return (
      <NewsEmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        }
        title={t("news.noArticles")}
        message={
          activeSource
            ? t("news.noArticlesFromSource", { source: activeSource })
            : t("news.noArticlesGeneric")
        }
        actionLabel={t("common.refresh")}
        onAction={onRetry}
      />
    );
  }

  return (
    <>
      {/* Category banner info for 'for_you' stream */}
      {activeCategory === "for_you" && (
        <div className="news-for-you-banner">
          <div className="news-for-you-icon">🎮</div>
          <div className="news-for-you-text">
            <strong>{t("news.forYouTitle")}</strong>
            <span>{t("news.forYouSubtitle")}</span>
          </div>
        </div>
      )}

      {/* Tag filter active chip banner */}
      {activeTag && (
        <div className="news-tag-filter-banner">
          <span>{t("news.filteringByTag", { tag: activeTag })}</span>
          <button type="button" className="news-tag-banner-clear" onClick={onClearTag}>
            ✕ {t("common.clear")}
          </button>
        </div>
      )}

      <div className={`news-article-grid density-${density}`}>
        {articles.map((article, i) => {
          const related = relatedGameNames?.get(article.link) ?? null;
          return (
            <NewsArticleCard
              key={`${article.link}-${i}`}
              article={article}
              density={density}
              read={readLinks.has(article.link)}
              saved={savedLinks.has(article.link)}
              relatedGameName={related}
              onClick={onCardClick}
              onToggleSave={onToggleSave}
              onToggleRead={onToggleRead}
              onSelectTag={onSelectTag}
            />
          );
        })}
      </div>

      {totalCount > 20 && (
        <div className="news-pagination">
          <span className="news-pagination-info">
            {t("news.ofArticles", { visible: articles.length, total: totalCount })}
          </span>
          {hasMore && (
            <button type="button" className="news-pagination-btn" onClick={onLoadMore}>
              {t("news.loadMore")}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      )}
    </>
  );
}
