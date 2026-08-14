import type { Giveaway } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import GiveawayCard from "./GiveawayCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface GiveawaysPanelProps {
  giveaways: Giveaway[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onReload: () => void;
}

export default function GiveawaysPanel({
  giveaways,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onReload,
}: GiveawaysPanelProps) {
  const { t } = useLanguage();

  return (
    <section className="deals-section" aria-label={t("deals.freeGames")}>
      <div className="deals-filters">
        <div className="deals-filters-info">
          <span>{t("deals.giveawaysInfo")}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          isLoading={loading}
          onClick={onReload}
          title={t("deals.refreshGiveaways")}
          leftIcon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          }
        >
          {t("common.refresh")}
        </Button>
      </div>

      {loading && (
        <DealsSkeletonGrid density={density} variant="giveaway" count={8} />
      )}

      {!loading && error && (
        <DealsErrorState message={error} onRetry={onReload} />
      )}

      {!loading && !error && empty && (
        <DealsEmptyState
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 12 20 22 4 22 4 12" />
              <rect x="2" y="7" width="20" height="5" />
              <line x1="12" y1="22" x2="12" y2="7" />
            </svg>
          }
          message={t("deals.emptyGiveaways")}
          onRetry={onReload}
        />
      )}

      {!loading && !error && giveaways.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {giveaways.map((giveaway, i) => (
            <GiveawayCard
              key={giveaway.id}
              giveaway={giveaway}
              onOpenUrl={onOpenUrl}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}
