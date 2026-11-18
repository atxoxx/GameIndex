import { Gamepad2 } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { ItchGameSummary } from "../../types/itch";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import DealsResults from "./DealsResults";
import ItchCard from "./ItchCard";

interface ItchPanelProps {
  games: ItchGameSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  hasMore: boolean;
  loadingMore: boolean;
  ownedOnly: boolean;
  authenticated: boolean;
  onLoadMore: () => void;
  onOpenUrl: (url: string | null | undefined) => void;
  onReload: () => void;
  onResetFilters: () => void;
  onSignIn: () => void;
}

/** Source tab: the itch.io catalogue (or the signed-in account's purchases). */
export default function ItchPanel({
  games,
  total,
  loading,
  error,
  density,
  hasMore,
  loadingMore,
  ownedOnly,
  authenticated,
  onLoadMore,
  onOpenUrl,
  onReload,
  onResetFilters,
  onSignIn,
}: ItchPanelProps) {
  const { t } = useLanguage();
  const needsSignIn = ownedOnly && !authenticated && !loading && !error;

  return (
    <div className="deals-itch">
      {needsSignIn && (
        <div className="itch-notice">
          <div className="itch-notice__text">
            <strong>{t("itch.signInTitle")}</strong>
            <span>{t("itch.signInBody")}</span>
          </div>
          <Button variant="primary" size="md" onClick={onSignIn}>
            {t("itch.signIn")}
          </Button>
        </div>
      )}

      <DealsResults
        loading={loading}
        error={error}
        empty={total === 0}
        shown={games.length}
        total={total}
        density={density}
        items={games}
        renderItem={(game, index) => (
          <ItchCard
            key={game.id}
            game={game}
            density={density}
            index={index}
            onOpenUrl={onOpenUrl}
          />
        )}
        skeletonCount={12}
        emptyIcon={<Gamepad2 size={22} strokeWidth={1.6} />}
        emptyMessage={ownedOnly ? t("itch.emptyLibrary") : t("itch.emptyBrowse")}
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
