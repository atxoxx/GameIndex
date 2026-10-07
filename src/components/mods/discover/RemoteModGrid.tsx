// Results container: grid or list layout, with loading / error / empty
// states and automatic (infinite-scroll) paging as the user reaches the
// end of the list.

import { useEffect, useRef } from "react";
import { SearchX, ServerCrash, PackageSearch } from "lucide-react";
import { Button, Skeleton } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import RemoteModCard from "./RemoteModCard";
import RemoteModRow from "./RemoteModRow";
import "./mods-discover.css";

export type DiscoverView = "grid" | "list";

interface RemoteModGridProps {
  results: RemoteModSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  hasSource: boolean;
  view: DiscoverView;
  total?: number;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  onConfigure: () => void;
}

export default function RemoteModGrid({
  results,
  loading,
  loadingMore,
  error,
  hasMore,
  hasSource,
  view,
  total,
  onOpen,
  onOpenExternal,
  onLoadMore,
  onRetry,
  onConfigure,
}: RemoteModGridProps) {
  const { t } = useLanguage();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const canObserve =
    typeof window !== "undefined" && "IntersectionObserver" in window;

  // Load the next page automatically when the sentinel scrolls into view.
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

  if (!hasSource) {
    return (
      <div className="mods-discover-empty">
        <PackageSearch size={36} />
        <h3>{t("mods.discover.noGame")}</h3>
        <Button variant="secondary" size="sm" onClick={onConfigure}>
          {t("mods.discover.setupSources")}
        </Button>
      </div>
    );
  }

  if (loading && results.length === 0) {
    return (
      <div className={view === "grid" ? "mods-discover-grid" : "mods-discover-list"} aria-busy="true">
        {Array.from({ length: view === "grid" ? 12 : 8 }).map((_, i) => (
          <div key={i} className="mods-discover-skeleton">
            <Skeleton shape="rect" width="100%" height={view === "grid" ? "120px" : "44px"} />
            <Skeleton width="80%" />
            <Skeleton width="50%" />
          </div>
        ))}
      </div>
    );
  }

  if (error && results.length === 0) {
    return (
      <div className="mods-discover-empty">
        <ServerCrash size={36} />
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
        <SearchX size={36} />
        <h3>{t("mods.discover.empty")}</h3>
        <p>{t("mods.discover.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="mods-discover-results">
      {view === "grid" ? (
        <div className="mods-discover-grid">
          {results.map((mod) => (
            <RemoteModCard
              key={`${mod.source}:${mod.id}`}
              mod={mod}
              onOpen={onOpen}
              onOpenExternal={onOpenExternal}
            />
          ))}
        </div>
      ) : (
        <div className="mods-discover-list">
          {results.map((mod) => (
            <RemoteModRow
              key={`${mod.source}:${mod.id}`}
              mod={mod}
              onOpen={onOpen}
              onOpenExternal={onOpenExternal}
            />
          ))}
        </div>
      )}

      <div className="mods-discover-footer">
        <span className="mods-discover-count">
          {total != null
            ? t("mods.discover.showingOf", {
                shown: String(results.length),
                total: String(total),
              })
            : t("mods.discover.showing", { shown: String(results.length) })}
        </span>
        {/* Fallback for environments without IntersectionObserver. */}
        {hasMore && !canObserve && (
          <Button variant="secondary" size="sm" isLoading={loadingMore} onClick={onLoadMore}>
            {t("mods.discover.loadMore")}
          </Button>
        )}
      </div>

      {hasMore && (
        <div ref={sentinelRef} className="mods-discover-sentinel" aria-hidden="true">
          {loadingMore && (
            <span className="mods-discover-loading-more">
              <span className="mods-discover-spinner" />
              {t("mods.discover.loadingMore")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
