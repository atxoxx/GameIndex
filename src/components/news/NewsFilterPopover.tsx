import { EyeOff, RotateCcw, Star } from "lucide-react";
import type { NewsFilterState, NewsTimeRange, NewsTopicId } from "../../types/news";
import { useLanguage } from "../../context/LanguageContext";
import { NEWS_TOPICS } from "../../utils/news/topics";

interface NewsFilterPopoverProps {
  filters: NewsFilterState;
  onFiltersChange: (patch: Partial<NewsFilterState>) => void;
  onResetFilters: () => void;
  sourceNames: string[];
  followedTopics: Set<NewsTopicId>;
  mutedTopics: Set<NewsTopicId>;
  onToggleFollowTopic: (id: NewsTopicId) => void;
  onToggleMuteTopic: (id: NewsTopicId) => void;
}

const TIME_RANGES: { id: NewsTimeRange; labelKey: string }[] = [
  { id: "all", labelKey: "news.timeAll" },
  { id: "today", labelKey: "news.timeToday" },
  { id: "3days", labelKey: "news.time3Days" },
  { id: "week", labelKey: "news.timeWeek" },
];

/**
 * The occasional controls: source, time range, sort, toggles and the
 * follow/mute switches for every topic. Rendered inside the trigger's anchor so
 * it opens under the button instead of at the page edge.
 */
export default function NewsFilterPopover({
  filters,
  onFiltersChange,
  onResetFilters,
  sourceNames,
  followedTopics,
  mutedTopics,
  onToggleFollowTopic,
  onToggleMuteTopic,
}: NewsFilterPopoverProps) {
  const { t } = useLanguage();

  return (
    <div className="news-filter-pop" id="news-filter-popover" role="dialog" aria-label={t("news.filtersTitle")}>
      <div className="news-filter-pop__head">
        <strong>{t("news.filtersTitle")}</strong>
        <button type="button" onClick={onResetFilters}>
          <RotateCcw size={13} aria-hidden />
          {t("news.resetFilters")}
        </button>
      </div>

      <div className="news-filter-pop__group">
        <span className="news-filter-pop__label">{t("news.sourceLabel")}</span>
        <select
          className="news-filter-pop__select"
          value={filters.source ?? "all"}
          onChange={(event) =>
            onFiltersChange({ source: event.target.value === "all" ? null : event.target.value })
          }
          aria-label={t("news.sourceLabel")}
        >
          <option value="all">{t("news.allSources")}</option>
          {sourceNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="news-filter-pop__group">
        <span className="news-filter-pop__label">{t("news.timeFilterLabel")}</span>
        <div className="news-segmented">
          {TIME_RANGES.map((range) => (
            <button
              key={range.id}
              type="button"
              aria-pressed={filters.timeRange === range.id}
              className={filters.timeRange === range.id ? "is-active" : ""}
              onClick={() => onFiltersChange({ timeRange: range.id })}
            >
              {t(range.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="news-filter-pop__group">
        <span className="news-filter-pop__label">{t("news.sortByLabel")}</span>
        <div className="news-segmented">
          <button
            type="button"
            aria-pressed={filters.sort === "signal"}
            className={filters.sort === "signal" ? "is-active" : ""}
            onClick={() => onFiltersChange({ sort: "signal" })}
          >
            {t("news.sortSignal")}
          </button>
          <button
            type="button"
            aria-pressed={filters.sort === "newest"}
            className={filters.sort === "newest" ? "is-active" : ""}
            onClick={() => onFiltersChange({ sort: "newest" })}
          >
            {t("news.sortNewest")}
          </button>
          <button
            type="button"
            aria-pressed={filters.sort === "oldest"}
            className={filters.sort === "oldest" ? "is-active" : ""}
            onClick={() => onFiltersChange({ sort: "oldest" })}
          >
            {t("news.sortOldest")}
          </button>
          <button
            type="button"
            aria-pressed={filters.sort === "source"}
            className={filters.sort === "source" ? "is-active" : ""}
            onClick={() => onFiltersChange({ sort: "source" })}
          >
            {t("news.sortSource")}
          </button>
        </div>
      </div>

      <div className="news-filter-pop__toggles">
        <label className="news-check">
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            onChange={(event) => onFiltersChange({ unreadOnly: event.target.checked })}
          />
          <span>{t("news.unreadOnly")}</span>
        </label>
        <label className="news-check">
          <input
            type="checkbox"
            checked={filters.hasImagesOnly}
            onChange={(event) => onFiltersChange({ hasImagesOnly: event.target.checked })}
          />
          <span>{t("news.hasImagesOnly")}</span>
        </label>
      </div>

      <div className="news-filter-pop__group">
        <span className="news-filter-pop__label">{t("news.followedTopics")}</span>
        <div className="news-topic-manage">
          {NEWS_TOPICS.map((topic) => {
            const followed = followedTopics.has(topic.id);
            const muted = mutedTopics.has(topic.id);
            return (
              <div key={topic.id} className="news-topic-manage__row">
                <span className={muted ? "is-muted" : undefined}>{t(topic.labelKey)}</span>
                <div>
                  <button
                    type="button"
                    className={`news-icon-toggle${followed ? " is-active" : ""}`}
                    aria-pressed={followed}
                    onClick={() => onToggleFollowTopic(topic.id)}
                    title={t(followed ? "news.unfollowTopic" : "news.followTopic")}
                    aria-label={t(followed ? "news.unfollowTopic" : "news.followTopic")}
                  >
                    <Star size={13} fill={followed ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    className={`news-icon-toggle${muted ? " is-muted" : ""}`}
                    aria-pressed={muted}
                    onClick={() => onToggleMuteTopic(topic.id)}
                    title={t(muted ? "news.unmuteTopic" : "news.muteTopic")}
                    aria-label={t(muted ? "news.unmuteTopic" : "news.muteTopic")}
                  >
                    <EyeOff size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
