import { Gift } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { Giveaway } from "../../types/deals";
import { useLanguage } from "../../context/LanguageContext";
import GiveawayCard from "./GiveawayCard";
import DealsResults from "./DealsResults";

interface GiveawaysPanelProps {
  giveaways: Giveaway[];
  total: number;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  now: number;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (giveaway: Giveaway) => void;
  onReload: () => void;
  onResetFilters: () => void;
}

/** Source tab: free games with live claim countdowns. */
export default function GiveawaysPanel({
  giveaways,
  total,
  loading,
  error,
  density,
  now,
  onOpenUrl,
  onInspect,
  onReload,
  onResetFilters,
}: GiveawaysPanelProps) {
  const { t } = useLanguage();

  return (
    <DealsResults
      loading={loading}
      error={error}
      empty={total === 0}
      shown={giveaways.length}
      total={total}
      density={density}
      items={giveaways}
      renderItem={(giveaway, index) => (
        <GiveawayCard
          key={giveaway.id}
          giveaway={giveaway}
          density={density}
          index={index}
          now={now}
          onOpenUrl={onOpenUrl}
          onInspect={onInspect}
        />
      )}
      skeletonCount={6}
      emptyIcon={<Gift size={22} strokeWidth={1.6} />}
      emptyMessage={t("deals.emptyGiveaways")}
      onRetry={onReload}
      onReset={onResetFilters}
    />
  );
}
