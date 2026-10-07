// Results grid with loading / error / empty / load-more states.

import { SearchX, ServerCrash, PackageSearch } from "lucide-react";
import { Button, Skeleton } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import type { RemoteModSummary } from "../../../types/mods";
import RemoteModCard from "./RemoteModCard";
import "./mods-discover.css";

interface RemoteModGridProps {
  results: RemoteModSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  hasSource: boolean;
  onOpen: (mod: RemoteModSummary) => void;
  onOpenExternal: (mod: RemoteModSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

export default function RemoteModGrid({
  results,
  loading,
  loadingMore,
  error,
  hasMore,
  hasSource,
  onOpen,
  onOpenExternal,
  onLoadMore,
  onRetry,
}: RemoteModGridProps) {
  const { t } = useLanguage();

  if (!hasSource) {
    return (
      <div className="mods-discover-empty">
        <PackageSearch size={36} />
        <h3>{t("mods.discover.noGame")}</h3>
      </div>
    );
  }

  if (loading && results.length === 0) {
    return (
      <div className="mods-discover-grid" aria-busy="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="mods-discover-skeleton">
            <Skeleton shape="rect" width="100%" height="120px" />
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
      {hasMore && (
        <div className="mods-discover-loadmore">
          <Button
            variant="secondary"
            size="sm"
            isLoading={loadingMore}
            onClick={onLoadMore}
          >
            {t("mods.discover.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
