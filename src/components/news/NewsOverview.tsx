import { useMemo } from "react";
import {
  ArrowRight,
  Bookmark,
  Flame,
  Gamepad2,
  Newspaper,
  Rss,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type {
  NewsCardItem,
  NewsCluster,
  NewsTopicId,
} from "../../types/news";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import NewsRail from "./NewsRail";
import NewsEmptyState, { NewsErrorState } from "./NewsEmptyState";
import { NewsArticleCardSkeleton } from "./NewsArticleCard";
import { clustersSince } from "../../utils/news/ranking";

interface NewsOverviewProps {
  clusters: NewsCluster[];
  savedLinks: Set<string>;
  savedCount: number;
  unreadCount: number;
  sourceCount: number;
  failingCount: number;
  previousVisit: number;
  density: ViewDensity;
  relatedGames: Map<string, string>;
  followedTopics: Set<NewsTopicId>;
  loading: boolean;
  error: string | null;
  onOpen: (item: NewsCardItem) => void;
  onToggleSave: (item: NewsCardItem) => void;
  onToggleRead: (item: NewsCardItem) => void;
  onSelectTopic: (topic: NewsTopicId) => void;
  onCatchUp: (clusters: NewsCluster[]) => void;
  onOpenFeed: (options?: { unreadOnly?: boolean; topics?: NewsTopicId[] }) => void;
  onOpenSaved: () => void;
  onOpenSources: () => void;
  onRefresh: () => void;
}

const RAIL_LIMIT = 10;

/**
 * Overview — the briefing.
 *
 * Answers three questions before the reader scrolls: what arrived while I was
 * away, what is waiting for me, and what deserves a look first. No rotating
 * hero: the lead block is the count and a catch-up action, followed by rails
 * that each have a reason to exist.
 */
export default function NewsOverview({
  clusters,
  savedLinks,
  savedCount,
  unreadCount,
  sourceCount,
  failingCount,
  previousVisit,
  density,
  relatedGames,
  followedTopics,
  loading,
  error,
  onOpen,
  onToggleSave,
  onToggleRead,
  onSelectTopic,
  onCatchUp,
  onOpenFeed,
  onOpenSaved,
  onOpenSources,
  onRefresh,
}: NewsOverviewProps) {
  const { t } = useLanguage();

  const newClusters = useMemo(
    () => clustersSince(clusters, previousVisit),
    [clusters, previousVisit],
  );

  const forYou = useMemo(
    () =>
      relatedGames.size === 0
        ? []
        : clusters
            .filter((cluster) =>
              [cluster.lead, ...cluster.related].some((article) => relatedGames.has(article.link)),
            )
            .slice(0, RAIL_LIMIT),
    [clusters, relatedGames],
  );

  const deals = useMemo(
    () => clusters.filter((cluster) => cluster.topics.includes("deals")).slice(0, RAIL_LIMIT),
    [clusters],
  );

  const updates = useMemo(
    () => clusters.filter((cluster) => cluster.topics.includes("patches")).slice(0, RAIL_LIMIT),
    [clusters],
  );

  const latest = useMemo(() => clusters.slice(0, RAIL_LIMIT), [clusters]);

  const railProps = {
    density,
    savedLinks,
    relatedGames,
    onOpen,
    onToggleSave,
    onToggleRead,
    onSelectTopic,
  };

  if (loading && clusters.length === 0) {
    return (
      <div className="news-overview">
        <div className="news-briefing news-briefing--skeleton" aria-hidden>
          <div className="news-skeleton-line" style={{ width: 220, height: 44 }} />
          <div className="news-skeleton-line" style={{ width: 320, height: 14 }} />
        </div>
        <div className="news-rail__track">
          {Array.from({ length: 4 }).map((_, index) => (
            <NewsArticleCardSkeleton key={index} density={density} />
          ))}
        </div>
      </div>
    );
  }

  if (error && clusters.length === 0) {
    return (
      <div className="news-overview">
        <NewsErrorState message={error} onRetry={onRefresh} />
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="news-overview">
        <NewsEmptyState
          icon={<Rss size={22} />}
          title={t("news.noArticles")}
          message={sourceCount === 0 ? t("news.noArticlesSources") : t("news.noArticlesGeneric")}
          actionLabel={sourceCount === 0 ? t("news.manageSources") : t("common.refresh")}
          onAction={sourceCount === 0 ? onOpenSources : onRefresh}
        />
      </div>
    );
  }

  const isFirstVisit = previousVisit <= 0;
  const leadCount = isFirstVisit ? clusters.length : newClusters.length;

  return (
    <div className="news-overview">
      <section className="news-briefing">
        <div className="news-briefing__lead">
          <span className="news-briefing__eyebrow">
            <Sparkles size={14} aria-hidden />
            {t(isFirstVisit ? "news.firstBriefing" : "news.sinceLastVisit")}
          </span>
          <p className="news-briefing__count">{leadCount}</p>
          <p className="news-briefing__hint">
            {isFirstVisit
              ? t("news.firstBriefingHint")
              : leadCount > 0
                ? t("news.newStoriesHint", { count: leadCount })
                : t("news.allCaughtUp")}
          </p>
          {leadCount > 0 && (
            <button
              type="button"
              className="news-briefing__cta"
              onClick={() => onCatchUp(newClusters.length > 0 ? newClusters : clusters)}
            >
              {t("news.catchUp")}
              <ArrowRight size={15} />
            </button>
          )}
        </div>

        <div className="news-briefing__stats">
          <button
            type="button"
            className="news-stat"
            onClick={() => onOpenFeed({ unreadOnly: true })}
          >
            <span className="news-stat__icon">
              <Newspaper size={15} />
            </span>
            <span className="news-stat__value">{unreadCount}</span>
            <span className="news-stat__label">{t("news.statsUnread")}</span>
          </button>
          <button type="button" className="news-stat" onClick={onOpenSaved}>
            <span className="news-stat__icon">
              <Bookmark size={15} />
            </span>
            <span className="news-stat__value">{savedCount}</span>
            <span className="news-stat__label">{t("news.statsSaved")}</span>
          </button>
          <button type="button" className="news-stat" onClick={onOpenSources}>
            <span className="news-stat__icon">
              <Rss size={15} />
            </span>
            <span className="news-stat__value">{sourceCount}</span>
            <span className="news-stat__label">{t("news.statsFeeds")}</span>
            {failingCount > 0 && (
              <span className="news-stat__warn" title={t("news.failedFeedsWarningShort", { count: failingCount })}>
                <TriangleAlert size={11} />
                {failingCount}
              </span>
            )}
          </button>
        </div>
      </section>

      <NewsRail
        title={t("news.railForYou")}
        subtitle={t("news.railForYouHint")}
        icon={<Gamepad2 size={15} />}
        clusters={forYou}
        {...railProps}
      />

      {followedTopics.size > 0 && (
        <NewsRail
          title={t("news.railFollowed")}
          icon={<Sparkles size={15} />}
          clusters={clusters
            .filter((cluster) => cluster.topics.some((topic) => followedTopics.has(topic)))
            .slice(0, RAIL_LIMIT)}
          {...railProps}
        />
      )}

      <NewsRail
        title={t("news.railDeals")}
        icon={<Flame size={15} />}
        clusters={deals}
        onSeeAll={() => onOpenFeed({ topics: ["deals"] })}
        {...railProps}
      />

      <NewsRail
        title={t("news.railUpdates")}
        icon={<Wrench size={15} />}
        clusters={updates}
        onSeeAll={() => onOpenFeed({ topics: ["patches"] })}
        {...railProps}
      />

      <NewsRail
        title={t("news.railLatest")}
        icon={<Newspaper size={15} />}
        clusters={latest}
        onSeeAll={() => onOpenFeed()}
        {...railProps}
      />
    </div>
  );
}
