import { MonitorPlay } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { PlaytesterGame } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import PlaytesterCard from "./PlaytesterCard";
import DealsResults from "./DealsResults";

interface PlaytesterPanelProps {
  games: PlaytesterGame[];
  total: number;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (game: PlaytesterGame) => void;
  onReload: () => void;
  onResetFilters: () => void;
}

/** Source tab: demos, betas and playtests from playtester.io. */
export default function PlaytesterPanel({
  games,
  total,
  loading,
  error,
  density,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenUrl,
  onInspect,
  onReload,
  onResetFilters,
}: PlaytesterPanelProps) {
  const { t } = useLanguage();

  return (
    <div className="deals-playtester">
      <DealsResults
        loading={loading}
        error={error}
        empty={total === 0}
        shown={games.length}
        total={total}
        density={density}
        items={games}
        renderItem={(game, index) => (
          <PlaytesterCard
            key={game.id}
            game={game}
            density={density}
            index={index}
            onOpenUrl={onOpenUrl}
            onInspect={onInspect}
          />
        )}
        skeletonCount={8}
        emptyIcon={<MonitorPlay size={22} strokeWidth={1.6} />}
        emptyMessage={t("deals.emptyPlaytester")}
        onRetry={onReload}
        onReset={onResetFilters}
      />

      {!loading && !error && hasMore && games.length > 0 && (
        <div className="deals-load-more">
          <Button
            variant="secondary"
            size="md"
            isLoading={loadingMore}
            onClick={onLoadMore}
          >
            {t("deals.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
