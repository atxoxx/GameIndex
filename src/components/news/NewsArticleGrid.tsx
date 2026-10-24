import { useEffect, useRef } from "react";
import { Bookmark, Clock, Search, Rss, SlidersHorizontal } from "lucide-react";
import type {
  NewsCardItem,
  NewsTab,
  NewsTopicId,
} from "../../types/news";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import NewsArticleCard, { NewsArticleCardSkeleton } from "./NewsArticleCard";
import NewsEmptyState, { NewsErrorState } from "./NewsEmptyState";

interface NewsArticleGridProps {
  items: NewsCardItem[];
  total: number;
  tab: Exclude<NewsTab, "overview">;
  density: ViewDensity;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  searching: boolean;
  filtering: boolean;
  sourceCount: number;
  savedLinks: Set<string>;
  relatedGames: Map<string, string>;
  onOpen: (item: NewsCardItem) => void;
  onToggleSave: (item: NewsCardItem) => void;
  onToggleRead: (item: NewsCardItem) => void;
  onSelectTopic: (topic: NewsTopicId) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onOpenSources: () => void;
  onGoToFeed: () => void;
}

const SKELETON_COUNT = 8;

/**
 * NewsArticleGrid — the result surface for Feed, Saved and History.
 *
 * Mounts the first page immediately and pulls the next page when the sentinel
 * enters the viewport (the button stays for keyboards and reduced-motion
 * users). Empty states name the reason instead of showing one generic message.
 */
export default function NewsArticleGrid({
  items,
  total,
  tab,
  density,
  loading,
  error,
  hasMore,
  searching,
  filtering,
  sourceCount,
  savedLinks,
  relatedGames,
  onOpen,
  onToggleSave,
  onToggleRead,
  onSelectTopic,
  onLoadMore,
  onRetry,
  onResetFilters,
  onOpenSources,
  onGoToFeed,
}: NewsArticleGridProps) {
  const { t } = useLanguage();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  if (loading && items.length === 0) {
    return (
      <div className={`news-grid density-${density}`} aria-busy="true">
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <NewsArticleCardSkeleton key={index} density={density} />
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return <NewsErrorState message={error} onRetry={onRetry} />;
  }

  if (total === 0) {
    if (tab === "saved") {
      return (
        <NewsEmptyState
          icon={<Bookmark size={22} />}
          title={t("news.noSavedArticles")}
          message={t("news.noSavedArticlesHint")}
          actionLabel={t("news.openFeed")}
          onAction={onGoToFeed}
        />
      );
    }
    if (tab === "history") {
      return (
        <NewsEmptyState
          icon={<Clock size={22} />}
          title={t("news.noHistoryYet")}
          message={t("news.noHistoryHint")}
          actionLabel={t("news.openFeed")}
          onAction={onGoToFeed}
        />
      );
    }
    if (sourceCount === 0) {
      return (
        <NewsEmptyState
          icon={<Rss size={22} />}
          title={t("news.noArticles")}
          message={t("news.noArticlesSources")}
          actionLabel={t("news.manageSources")}
          onAction={onOpenSources}
        />
      );
    }
    if (searching) {
      return (
        <NewsEmptyState
          icon={<Search size={22} />}
          title={t("news.noSearchResults")}
          actionLabel={t("common.clearSearch")}
          onAction={onResetFilters}
        />
      );
    }
    if (filtering) {
      return (
        <NewsEmptyState
          icon={<SlidersHorizontal size={22} />}
          title={t("news.noFilterResults")}
          message={t("news.noFilterResultsHint")}
          actionLabel={t("news.resetFilters")}
          onAction={onResetFilters}
        />
      );
    }
    return (
      <NewsEmptyState
        icon={<Rss size={22} />}
        title={t("news.noArticles")}
        message={t("news.noArticlesGeneric")}
        actionLabel={t("common.refresh")}
        onAction={onRetry}
      />
    );
  }

  return (
    <>
      <div className={`news-grid density-${density}`}>
        {items.map((item) => (
          <NewsArticleCard
            key={item.key}
            item={item}
            density={density}
            saved={savedLinks.has(item.article.link)}
            relatedGameName={relatedGames.get(item.article.link) ?? null}
            onOpen={onOpen}
            onToggleSave={onToggleSave}
            onToggleRead={onToggleRead}
            onSelectTopic={onSelectTopic}
          />
        ))}
      </div>

      <div className="news-grid__footer">
        <span className="news-grid__count">
          {t("news.ofArticles", { visible: items.length, total })}
        </span>
        {hasMore && (
          <button type="button" className="news-grid__more" onClick={onLoadMore}>
            {t("news.loadMore")}
          </button>
        )}
      </div>
      {hasMore && <div ref={sentinelRef} aria-hidden className="news-grid__sentinel" />}
    </>
  );
}
