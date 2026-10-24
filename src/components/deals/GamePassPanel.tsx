import { Gamepad2 } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { GamePassGame } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import GamePassCard from "./GamePassCard";
import DealsResults from "./DealsResults";

interface GamePassPanelProps {
  games: GamePassGame[];
  total: number;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (game: GamePassGame) => void;
  onReload: () => void;
  onResetFilters: () => void;
}

/** Source tab: the Xbox Game Pass catalogue. */
export default function GamePassPanel({
  games,
  total,
  loading,
  error,
  density,
  onOpenUrl,
  onInspect,
  onReload,
  onResetFilters,
}: GamePassPanelProps) {
  const { t } = useLanguage();

  return (
    <DealsResults
      loading={loading}
      error={error}
      empty={total === 0}
      shown={games.length}
      total={total}
      density={density}
      items={games}
      renderItem={(game, index) => (
        <GamePassCard
          key={game.id}
          game={game}
          density={density}
          index={index}
          onOpenUrl={onOpenUrl}
          onInspect={onInspect}
        />
      )}
      skeletonCount={8}
      emptyIcon={<Gamepad2 size={22} strokeWidth={1.6} />}
      emptyMessage={t("deals.emptyGamepass")}
      onRetry={onReload}
      onReset={onResetFilters}
    />
  );
}
