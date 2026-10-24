import { Tag } from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { DealGroup } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import DealCard from "./DealCard";
import DealsResults from "./DealsResults";

interface DealsPanelProps {
  groups: DealGroup[];
  total: number;
  loading: boolean;
  error: string | null;
  density: ViewDensity;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspect: (group: DealGroup) => void;
  onReload: () => void;
  onResetFilters: () => void;
}

/** Source tab: IsThereAnyDeal rows collapsed into one card per game. */
export default function DealsPanel({
  groups,
  total,
  loading,
  error,
  density,
  onOpenUrl,
  onInspect,
  onReload,
  onResetFilters,
}: DealsPanelProps) {
  const { t } = useLanguage();

  return (
    <DealsResults
      loading={loading}
      error={error}
      empty={total === 0}
      shown={groups.length}
      total={total}
      density={density}
      items={groups}
      renderItem={(group, index) => (
        <DealCard
          key={group.id}
          group={group}
          density={density}
          index={index}
          onOpenUrl={onOpenUrl}
          onInspect={onInspect}
        />
      )}
      skeletonCount={9}
      emptyIcon={<Tag size={22} strokeWidth={1.6} />}
      emptyMessage={t("deals.emptyDeals")}
      onRetry={onReload}
      onReset={onResetFilters}
    />
  );
}
