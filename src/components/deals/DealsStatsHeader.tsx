import { useMemo } from "react";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";
import { KpiTile } from "../ui/KpiTile";
import { useLanguage } from "../../context/LanguageContext";

interface DealsStatsHeaderProps {
  gpGames: GamePassGame[];
  deals: DealItem[];
  giveaways: Giveaway[];
  gpLoading: boolean;
  dealsLoading: boolean;
  giveawaysLoading: boolean;
}

export default function DealsStatsHeader({
  gpGames,
  deals,
  giveaways,
  gpLoading,
  dealsLoading,
  giveawaysLoading,
}: DealsStatsHeaderProps) {
  const { t } = useLanguage();

  const bestDiscount = useMemo(() => {
    if (deals.length === 0) return 0;
    return Math.max(...deals.map((d) => d.discountPercent));
  }, [deals]);

  const intent = (loading: boolean) => (loading ? "default" as const : "accent" as const);

  return (
    <div className="deals-stats-header">
      <KpiTile
        size="sm"
        glass
        intent={intent(dealsLoading)}
        label={t("deals.statTotalDealsLabel")}
        value={dealsLoading ? "…" : deals.length}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        }
      />
      <KpiTile
        size="sm"
        glass
        intent={bestDiscount >= 75 ? "success" : "default"}
        label={t("deals.statBestDiscountLabel")}
        value={dealsLoading ? "…" : bestDiscount > 0 ? `-${bestDiscount}%` : "—"}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
        }
      />
      <KpiTile
        size="sm"
        glass
        intent={intent(giveawaysLoading)}
        label={t("deals.statFreeGamesLabel")}
        value={giveawaysLoading ? "…" : giveaways.length}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
          </svg>
        }
      />
      <KpiTile
        size="sm"
        glass
        intent={intent(gpLoading)}
        label={t("deals.statGamePassTitlesLabel")}
        value={gpLoading ? "…" : gpGames.length}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <line x1="7" y1="12" x2="11" y2="12" />
            <line x1="9" y1="10" x2="9" y2="14" />
            <line x1="15" y1="10" x2="17" y2="14" />
            <line x1="17" y1="10" x2="15" y2="14" />
          </svg>
        }
      />
    </div>
  );
}
