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
 * items, with smooth scrolling buttons.
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

  return (
    <div className="news-source-select-wrapper">
      <label className="news-source-select-label" htmlFor="news-source-dropdown">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>{t("news.filterBySource")}</span>
      </label>
      <select
        id="news-source-dropdown"
        className="news-source-select"
        value={activeSource ?? "all"}
        onChange={(e) => onSourceChange(e.target.value === "all" ? null : e.target.value)}
        aria-label={t("news.filterBySource")}
      >
        <option value="all">
          {t("common.all")} ({allTotal})
        </option>
        {sourceNames.map((name) => {
          const c = counts.get(name) ?? { total: 0, unread: 0 };
          return (
            <option key={name} value={name}>
              {name} ({c.total}{c.unread > 0 ? ` • ${c.unread} unread` : ""})
            </option>
          );
        })}
      </select>
    </div>
  );
}
