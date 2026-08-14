import { useMemo } from "react";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";
import { KpiTile } from "../ui/KpiTile";
import { useLanguage } from "../../context/LanguageContext";
import { useWishlist } from "../../hooks/useWishlist";
import { titleToSlug } from "../../pages/deals/dealsConstants";

interface DealsStatsHeaderProps {
  gpGames: GamePassGame[];
  deals: DealItem[];
  giveaways: Giveaway[];
  gpLoading: boolean;
  dealsLoading: boolean;
  giveawaysLoading: boolean;
  onSelectSubTab?: (tab: "gamepass" | "isthereanydeal" | "giveaways") => void;
  onFilterWishlist?: () => void;
}

export default function DealsStatsHeader({
  gpGames,
  deals,
  giveaways,
  gpLoading,
  dealsLoading,
  giveawaysLoading,
  onSelectSubTab,
  onFilterWishlist,
}: DealsStatsHeaderProps) {
  const { t } = useLanguage();
  const { isWishlisted } = useWishlist();

  const bestDiscount = useMemo(() => {
    if (deals.length === 0) return 0;
    return Math.max(...deals.map((d) => d.discountPercent));
  }, [deals]);

  const wishlistedDealsCount = useMemo(() => {
    return deals.filter((d) => isWishlisted(titleToSlug(d.gameTitle))).length;
  }, [deals, isWishlisted]);

  const activeGiveawaysCount = useMemo(() => {
    const now = Date.now();
    return giveaways.filter((g) => {
      if (!g.expiry) return true;
      const end = new Date(g.expiry).getTime();
      return isNaN(end) || end > now;
    }).length;
  }, [giveaways]);

  const intent = (loading: boolean) => (loading ? "default" as const : "accent" as const);

  return (
    <div className="deals-stats-header">
      <div
        className="deals-stat-clickable"
        onClick={() => onSelectSubTab?.("isthereanydeal")}
        role="button"
        tabIndex={0}
      >
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
      </div>

      <div
        className="deals-stat-clickable"
        onClick={() => onSelectSubTab?.("isthereanydeal")}
        role="button"
        tabIndex={0}
      >
        <KpiTile
          size="sm"
          glass
          intent={bestDiscount >= 75 ? "success" : "accent"}
          label={t("deals.statBestDiscountLabel")}
          value={dealsLoading ? "…" : bestDiscount > 0 ? `-${bestDiscount}%` : "—"}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
        />
      </div>

      <div
        className="deals-stat-clickable"
        onClick={() => {
          onSelectSubTab?.("isthereanydeal");
          if (wishlistedDealsCount > 0 && onFilterWishlist) {
            onFilterWishlist();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <KpiTile
          size="sm"
          glass
          intent={wishlistedDealsCount > 0 ? "warning" : "default"}
          label={t("deals.statWishlistDealsLabel")}
          value={dealsLoading ? "…" : wishlistedDealsCount}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          }
        />
      </div>

      <div
        className="deals-stat-clickable"
        onClick={() => onSelectSubTab?.("giveaways")}
        role="button"
        tabIndex={0}
      >
        <KpiTile
          size="sm"
          glass
          intent={activeGiveawaysCount > 0 ? "success" : intent(giveawaysLoading)}
          label={t("deals.statFreeGamesLabel")}
          value={giveawaysLoading ? "…" : activeGiveawaysCount}
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
      </div>

      <div
        className="deals-stat-clickable"
        onClick={() => onSelectSubTab?.("gamepass")}
        role="button"
        tabIndex={0}
      >
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
    </div>
  );
}
