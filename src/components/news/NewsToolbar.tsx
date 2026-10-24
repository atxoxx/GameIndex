import { useEffect, useMemo, useState } from "react";
import {
  AlignJustify,
  Bookmark,
  Clock,
  LayoutGrid,
  Newspaper,
  PanelTop,
  Rows3,
  Rss,
  Search,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  NewsFilterState,
  NewsTab,
  NewsTimeRange,
  NewsTopicId,
} from "../../types/news";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { SubTabs } from "../ui";
import { NEWS_TOPICS } from "../../utils/news/topics";
import { activeFilterCount } from "../../utils/news/filters";
import NewsFilterPopover from "./NewsFilterPopover";

export interface NewsToolbarProps {
  tab: NewsTab;
  onTabChange: (tab: NewsTab) => void;
  counts: Record<NewsTab, number>;
  filters: NewsFilterState;
  onFiltersChange: (patch: Partial<NewsFilterState>) => void;
  onResetFilters: () => void;
  topics: { id: NewsTopicId; count: number }[];
  followedTopics: Set<NewsTopicId>;
  mutedTopics: Set<NewsTopicId>;
  onToggleFollowTopic: (id: NewsTopicId) => void;
  onToggleMuteTopic: (id: NewsTopicId) => void;
  sourceNames: string[];
  density: ViewDensity;
  onDensityChange: (density: ViewDensity) => void;
}

const TAB_ICONS: Record<NewsTab, LucideIcon> = {
  overview: PanelTop,
  feed: Newspaper,
  saved: Bookmark,
  history: Clock,
};

const DENSITIES: { id: ViewDensity; labelKey: string; icon: LucideIcon }[] = [
  { id: "cinematic", labelKey: "news.densityCinematic", icon: PanelTop },
  { id: "cozy", labelKey: "news.densityCozy", icon: LayoutGrid },
  { id: "compact", labelKey: "news.densityCompact", icon: Rows3 },
  { id: "list", labelKey: "news.densityList", icon: AlignJustify },
];

const TIME_RANGES: { id: NewsTimeRange; labelKey: string }[] = [
  { id: "all", labelKey: "news.timeAll" },
  { id: "today", labelKey: "news.timeToday" },
  { id: "3days", labelKey: "news.time3Days" },
  { id: "week", labelKey: "news.timeWeek" },
];

const TOPIC_LABEL = new Map(NEWS_TOPICS.map((topic) => [topic.id, topic.labelKey]));

/**
 * NewsToolbar — destinations plus one control band.
 *
 * The tab strip carries only four destinations; search stays visible because it
 * is used constantly; topics get their own quiet row; everything occasional
 * lives in one popover anchored under its trigger that reports how many filters
 * are on.
 */
export default function NewsToolbar({
  tab,
  onTabChange,
  counts,
  filters,
  onFiltersChange,
  onResetFilters,
  topics,
  followedTopics,
  mutedTopics,
  onToggleFollowTopic,
  onToggleMuteTopic,
  sourceNames,
  density,
  onDensityChange,
}: NewsToolbarProps) {
  const { t } = useLanguage();
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  const filterCount = activeFilterCount(filters);
  const showTopics = tab === "feed";
  const showDensity = tab !== "overview";

  const tabItems = useMemo(
    () =>
      (["overview", "feed", "saved", "history"] as NewsTab[]).map((id) => ({
        id,
        label: t(`news.tab${id.charAt(0).toUpperCase()}${id.slice(1)}`),
        icon: TAB_ICONS[id],
        count: counts[id] ?? 0,
      })),
    [counts, t],
  );

  const toggleTopic = (id: NewsTopicId) => {
    const active = filters.topics.includes(id);
    onFiltersChange({
      topics: active ? filters.topics.filter((topic) => topic !== id) : [...filters.topics, id],
    });
  };

  return (
    <div className="news-toolbar">
      <div className="news-toolbar__row">
        <SubTabs
          ariaLabel={t("news.title")}
          value={tab}
          onChange={onTabChange}
          items={tabItems}
        />

        <div className="news-toolbar__actions">
          <label className="news-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={filters.query}
              onChange={(event) => onFiltersChange({ query: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") onFiltersChange({ query: "" });
              }}
              placeholder={t("news.searchPlaceholder")}
              aria-label={t("news.searchPlaceholder")}
            />
            {filters.query && (
              <button
                type="button"
                className="news-search__clear"
                onClick={() => onFiltersChange({ query: "" })}
                aria-label={t("common.clearSearch")}
              >
                <X size={13} />
              </button>
            )}
          </label>

          <div className="news-filter-anchor">
            <button
              type="button"
              className={`news-filter-trigger${filterCount > 0 ? " is-active" : ""}`}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="news-filter-popover"
            >
              <SlidersHorizontal size={15} aria-hidden />
              <span>{t("news.filtersTitle")}</span>
              {filterCount > 0 && <span className="news-filter-trigger__count">{filterCount}</span>}
            </button>

            {filtersOpen && (
              <NewsFilterPopover
                filters={filters}
                onFiltersChange={onFiltersChange}
                onResetFilters={onResetFilters}
                sourceNames={sourceNames}
                followedTopics={followedTopics}
                mutedTopics={mutedTopics}
                onToggleFollowTopic={onToggleFollowTopic}
                onToggleMuteTopic={onToggleMuteTopic}
              />
            )}
          </div>

          {showDensity && (
            <div className="news-density" role="radiogroup" aria-label={t("news.viewTabsLabel")}>
              {DENSITIES.map(({ id, labelKey, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={density === id}
                  className={density === id ? "is-active" : ""}
                  onClick={() => onDensityChange(id)}
                  title={t(labelKey)}
                  aria-label={t(labelKey)}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {showTopics && topics.length > 0 && (
        <div className="news-topic-row" role="group" aria-label={t("news.topicsLabel")}>
          <button
            type="button"
            className={`news-topic${filters.topics.length === 0 ? " is-active" : ""}`}
            onClick={() => onFiltersChange({ topics: [] })}
          >
            {t("news.allTopics")}
          </button>
          {topics.map((topic) => {
            const active = filters.topics.includes(topic.id);
            const followed = followedTopics.has(topic.id);
            const muted = mutedTopics.has(topic.id);
            return (
              <button
                key={topic.id}
                type="button"
                className={`news-topic${active ? " is-active" : ""}${muted ? " is-muted" : ""}`}
                aria-pressed={active}
                onClick={() => toggleTopic(topic.id)}
                title={t(TOPIC_LABEL.get(topic.id) ?? topic.id)}
              >
                {followed && <span className="news-topic__follow" aria-hidden />}
                {t(TOPIC_LABEL.get(topic.id) ?? topic.id)}
                <span className="news-topic__count">{topic.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {filtersOpen && (
        <button
          type="button"
          className="news-filter-scrim"
          aria-label={t("common.close")}
          onClick={() => setFiltersOpen(false)}
        />
      )}

      {filterCount > 0 && (
        <div className="news-active-filters">
          <Rss size={13} aria-hidden />
          {filters.source && (
            <button type="button" onClick={() => onFiltersChange({ source: null })}>
              {filters.source}
              <X size={11} />
            </button>
          )}
          {filters.topics.map((topic) => (
            <button key={topic} type="button" onClick={() => toggleTopic(topic)}>
              {t(TOPIC_LABEL.get(topic) ?? topic)}
              <X size={11} />
            </button>
          ))}
          {filters.unreadOnly && (
            <button type="button" onClick={() => onFiltersChange({ unreadOnly: false })}>
              {t("news.unreadOnly")}
              <X size={11} />
            </button>
          )}
          {filters.hasImagesOnly && (
            <button type="button" onClick={() => onFiltersChange({ hasImagesOnly: false })}>
              {t("news.hasImagesOnly")}
              <X size={11} />
            </button>
          )}
          {filters.timeRange !== "all" && (
            <button type="button" onClick={() => onFiltersChange({ timeRange: "all" })}>
              {t(TIME_RANGES.find((range) => range.id === filters.timeRange)?.labelKey ?? "news.timeAll")}
              <X size={11} />
            </button>
          )}
          {filters.sort !== "signal" && (
            <button type="button" onClick={() => onFiltersChange({ sort: "signal" })}>
              {t(filters.sort === "newest" ? "news.sortNewest" : filters.sort === "oldest" ? "news.sortOldest" : "news.sortSource")}
              <X size={11} />
            </button>
          )}
          <button type="button" className="news-active-filters__reset" onClick={onResetFilters}>
            {t("news.resetFilters")}
          </button>
        </div>
      )}
    </div>
  );
}
