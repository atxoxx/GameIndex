import { useMemo } from "react";
import type { NewsArticle } from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";

interface NewsSourcePillsProps {
  sourceNames: string[];
  activeSource: string | null;
  /** The dataset to count against (feed articles or saved articles). */
  articles: NewsArticle[];
  readLinks: Set<string>;
  onSourceChange: (source: string | null) => void;
}

/**
 * NewsSourcePills — horizontal source filter. Every pill shows its
 * article count plus a small unread chip when that source has unseen
 * items, so the strip doubles as a quick unread summary.
 */
export default function NewsSourcePills({
  sourceNames,
  activeSource,
  articles,
  readLinks,
  onSourceChange,
}: NewsSourcePillsProps) {
  const { t } = useLanguage();

  const counts = useMemo(() => {
    const map = new Map<string, { total: number; unread: number }>();
    for (const a of articles) {
      const entry = map.get(a.sourceName) ?? { total: 0, unread: 0 };
      entry.total += 1;
      if (!readLinks.has(a.link)) entry.unread += 1;
      map.set(a.sourceName, entry);
    }
    return map;
  }, [articles, readLinks]);

  if (sourceNames.length === 0) return null;

  const allTotal = articles.length;
  const allUnread = articles.filter((a) => !readLinks.has(a.link)).length;

  return (
    <div className="news-source-pills" role="tablist" aria-label={t("news.filterBySource")}>
      <button
        type="button"
        role="tab"
        aria-selected={activeSource === null}
        className={`news-source-pill all-pill${activeSource === null ? " active" : ""}`}
        onClick={() => onSourceChange(null)}
      >
        {t("common.all")}
        <span className="news-source-pill-count">{allTotal}</span>
        {allUnread > 0 && (
          <span className="news-source-pill-unread" title={t("news.unreadCount", { count: allUnread })}>
            {allUnread}
          </span>
        )}
      </button>

      {sourceNames.map((name) => {
        const c = counts.get(name) ?? { total: 0, unread: 0 };
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={activeSource === name}
            className={`news-source-pill${activeSource === name ? " active" : ""}`}
            onClick={() => onSourceChange(activeSource === name ? null : name)}
          >
            {name}
            <span className="news-source-pill-count">{c.total}</span>
            {c.unread > 0 && (
              <span className="news-source-pill-unread" title={t("news.unreadCount", { count: c.unread })}>
                {c.unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
