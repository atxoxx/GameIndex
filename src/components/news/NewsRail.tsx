import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NewsCardItem, NewsCluster, NewsTopicId } from "../../types/news";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import NewsArticleCard from "./NewsArticleCard";
import { clusterToCardItem } from "../../utils/news/cards";

interface NewsRailProps {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  clusters: NewsCluster[];
  density: ViewDensity;
  savedLinks: Set<string>;
  relatedGames: Map<string, string>;
  onOpen: (item: NewsCardItem) => void;
  onToggleSave: (item: NewsCardItem) => void;
  onToggleRead: (item: NewsCardItem) => void;
  onSelectTopic?: (topic: NewsTopicId) => void;
  onSeeAll?: () => void;
}

/**
 * NewsRail — one horizontal shelf of stories.
 *
 * Scrolls by whole cards with snap points, hides its arrows when the shelf
 * fits, and keeps the scroll position local (the page body never moves).
 */
export default function NewsRail({
  title,
  subtitle,
  icon,
  clusters,
  density,
  savedLinks,
  relatedGames,
  onOpen,
  onToggleSave,
  onToggleRead,
  onSelectTopic,
  onSeeAll,
}: NewsRailProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  const updateScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setCanScroll({
      back: track.scrollLeft > 8,
      forward: max > 8 && track.scrollLeft < max - 8,
    });
  }, []);

  useEffect(() => {
    updateScroll();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(track);
    return () => observer.disconnect();
  }, [updateScroll, clusters.length]);

  if (clusters.length === 0) return null;

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".news-card");
    const step = card ? card.offsetWidth + 16 : track.clientWidth * 0.8;
    track.scrollBy({ left: step * 2 * direction, behavior: "smooth" });
  };

  return (
    <section className="news-rail" aria-label={title}>
      <header className="news-rail__head">
        <span className="news-rail__icon" aria-hidden>
          {icon}
        </span>
        <div className="news-rail__text">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="news-rail__controls">
          {onSeeAll && (
            <button type="button" className="news-rail__see-all" onClick={onSeeAll}>
              {t("news.seeAll")}
            </button>
          )}
          <button
            type="button"
            className="news-rail__arrow"
            onClick={() => scrollBy(-1)}
            disabled={!canScroll.back}
            aria-label={t("news.scrollBack")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="news-rail__arrow"
            onClick={() => scrollBy(1)}
            disabled={!canScroll.forward}
            aria-label={t("news.scrollForward")}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div className="news-rail__track" ref={trackRef} onScroll={updateScroll}>
        {clusters.map((cluster) => {
          const item = clusterToCardItem(cluster);
          return (
            <NewsArticleCard
              key={cluster.id}
              item={item}
              density={density}
              saved={savedLinks.has(cluster.lead.link)}
              relatedGameName={relatedGames.get(cluster.lead.link) ?? null}
              onOpen={onOpen}
              onToggleSave={onToggleSave}
              onToggleRead={onToggleRead}
              onSelectTopic={onSelectTopic}
            />
          );
        })}
      </div>
    </section>
  );
}
