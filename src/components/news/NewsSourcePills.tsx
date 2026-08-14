import { useMemo, useRef } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -240, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 240, behavior: "smooth" });
    }
  };

  return (
    <div className="news-source-pills-wrapper">
      <button
        type="button"
        className="news-source-pills-scroll-btn left"
        onClick={scrollLeft}
        aria-label="Scroll sources left"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div
        ref={scrollRef}
        className="news-source-pills"
        role="tablist"
        aria-label={t("news.filterBySource")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSource === null}
          className={`news-source-pill all-pill${activeSource === null ? " active" : ""}`}
          onClick={() => onSourceChange(null)}
        >
          <span className="news-source-pill-icon">🌐</span>
          <span>{t("common.all")}</span>
          <span className="news-source-pill-count">{allTotal}</span>
        </button>

        {sourceNames.map((name) => {
          const c = counts.get(name) ?? { total: 0, unread: 0 };
          const firstLetter = name.charAt(0).toUpperCase();
          const isActive = activeSource === name;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`news-source-pill${isActive ? " active" : ""}`}
              onClick={() => onSourceChange(isActive ? null : name)}
            >
              <span className="news-source-pill-avatar">{firstLetter}</span>
              <span>{name}</span>
              <span className="news-source-pill-count">{c.total}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="news-source-pills-scroll-btn right"
        onClick={scrollRight}
        aria-label="Scroll sources right"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
