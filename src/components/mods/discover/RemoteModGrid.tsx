import { useEffect, useRef, useState } from "react";
import { ArrowUp, PackageSearch, SearchX, ServerCrash } from "lucide-react";
import { Button, Skeleton } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import RemoteModCard from "./RemoteModCard";
import RemoteModRow from "./RemoteModRow";
import RemoteModCompactRow from "./RemoteModCompactRow";
import "./mods-discover.css";

export type DiscoverView = "grid" | "list" | "compact";

interface RemoteModGridProps {
  results: RemoteModSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  hasSource: boolean;
  view: DiscoverView;
  total?: number;
  installedKeys: Set<string>;
  isBookmarked?: (source: string, id: string) => boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onToggleBookmark?: (mod: RemoteModSummary) => void;
  onQuickInstall?: (mod: RemoteModSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onConfigure: () => void;
  onClearFilters?: () => void;
}

export default function RemoteModGrid({
  results,
  loading,
  loadingMore,
  error,
  hasMore,
  hasSource,
  view,
  installedKeys,
  isBookmarked,
  onOpen,
  onOpenExternal,
  onToggleBookmark,
  onQuickInstall,
  onLoadMore,
  onRetry,
  onConfigure,
  onClearFilters,
}: RemoteModGridProps) {
  const { t } = useLanguage();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const canObserve =
    typeof window !== "undefined" && "IntersectionObserver" in window;

  // Auto-page when sentinel enters view
  useEffect(() => {
    if (!hasMore || !canObserve) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, canObserve, onLoadMore, loading, loadingMore, results.length]);

  // Scroll listener for back-to-top and scroll paging fallback
  useEffect(() => {
    const handleScroll = () => {
      const top = window.scrollY || document.documentElement.scrollTop;
      setShowBackToTop(top > 400);

      if (hasMore) {
        const el = sentinelRef.current;
        if (el && el.getBoundingClientRect().top <= window.innerHeight + 600) {
          onLoadMore();
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hasMore, onLoadMore]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (!hasSource) {
    return (
      <div className="mods-discover-empty">
        <PackageSearch size={40} className="mods-discover-empty-icon" />
        <h3>{t("mods.discover.noGame")}</h3>
        <p>{t("mods.discover.setupSourcesHint")}</p>
        <Button variant="primary" size="sm" onClick={onConfigure}>
          {t("mods.discover.setupSources")}
        </Button>
      </div>
    );
  }

  if (loading && results.length === 0) {
    return (
      <div
        className={
          view === "grid"
            ? "mods-discover-grid"
            : view === "list"
            ? "mods-discover-list"
            : "mods-discover-compact"
        }
        aria-busy="true"
      >
        {Array.from({ length: view === "grid" ? 12 : view === "list" ? 8 : 14 }).map(
          (_, i) => (
            <div
              key={i}
              className={`mods-discover-skeleton mods-discover-skeleton--${view}`}
            >
              {view === "grid" ? (
                <>
                  <Skeleton shape="rect" width="100%" height="150px" />
                  <Skeleton width="85%" height="16px" />
                  <Skeleton width="55%" height="12px" />
                </>
              ) : view === "list" ? (
                <>
                  <Skeleton shape="rect" width="80px" height="80px" />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <Skeleton width="60%" height="16px" />
                    <Skeleton width="90%" height="12px" />
                    <Skeleton width="30%" height="12px" />
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", padding: "6px 0" }}>
                  <Skeleton shape="rect" width="60px" height="18px" />
                  <Skeleton width="40%" height="14px" />
                  <Skeleton width="20%" height="14px" />
                  <Skeleton width="15%" height="14px" />
                </div>
              )}
            </div>
          ),
        )}
      </div>
    );
  }

  if (error && results.length === 0) {
    return (
      <div className="mods-discover-empty">
        <ServerCrash size={40} className="mods-discover-empty-icon" />
        <h3>{t("mods.discover.error")}</h3>
        <p>{error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("mods.discover.retry")}
        </Button>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="mods-discover-empty">
        <SearchX size={40} className="mods-discover-empty-icon" />
        <h3>{t("mods.discover.empty")}</h3>
        <p>{t("mods.discover.emptyHint")}</p>
        {onClearFilters && (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            {t("mods.source.clear")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mods-discover-results" ref={containerRef}>
      {view === "grid" ? (
        <div className="mods-discover-grid">
          {results.map((mod) => (
            <RemoteModCard
              key={`${mod.source}:${mod.id}`}
              mod={mod}
              installed={installedKeys.has(`${mod.source}:${mod.id}`)}
              isBookmarked={isBookmarked?.(mod.source, mod.id)}
              onOpen={onOpen}
              onOpenExternal={onOpenExternal}
              onToggleBookmark={onToggleBookmark}
              onQuickInstall={onQuickInstall}
            />
          ))}
        </div>
      ) : view === "list" ? (
        <div className="mods-discover-list">
          {results.map((mod) => (
            <RemoteModRow
              key={`${mod.source}:${mod.id}`}
              mod={mod}
              installed={installedKeys.has(`${mod.source}:${mod.id}`)}
              isBookmarked={isBookmarked?.(mod.source, mod.id)}
              onOpen={onOpen}
              onOpenExternal={onOpenExternal}
              onToggleBookmark={onToggleBookmark}
              onQuickInstall={onQuickInstall}
            />
          ))}
        </div>
      ) : (
        <div className="mods-discover-compact">
          {results.map((mod) => (
            <RemoteModCompactRow
              key={`${mod.source}:${mod.id}`}
              mod={mod}
              installed={installedKeys.has(`${mod.source}:${mod.id}`)}
              isBookmarked={isBookmarked?.(mod.source, mod.id)}
              onOpen={onOpen}
              onOpenExternal={onOpenExternal}
              onToggleBookmark={onToggleBookmark}
              onQuickInstall={onQuickInstall}
            />
          ))}
        </div>
      )}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="mods-discover-sentinel" aria-hidden="true" />

      {/* Load more indicator */}
      {loadingMore && (
        <div className="mods-discover-loading-more">
          <div className="mods-discover-spinner" />
          <span>{t("mods.discover.loadingMore")}</span>
        </div>
      )}

      {hasMore && !loadingMore && (
        <div className="mods-discover-load-more-row">
          <Button variant="ghost" size="sm" onClick={onLoadMore}>
            {t("mods.discover.loadMore")}
          </Button>
        </div>
      )}

      {/* Floating Back to Top button */}
      {showBackToTop && (
        <button
          type="button"
          className="mods-discover-back-to-top"
          onClick={scrollToTop}
          title={t("mods.discover.backToTop")}
          aria-label={t("mods.discover.backToTop")}
        >
          <ArrowUp size={16} />
        </button>
      )}
    </div>
  );
}
