import {
  CircleDollarSign,
  Clock3,
  Gamepad2,
  Gift,
  Heart,
  MonitorPlay,
  Sparkles,
} from "lucide-react";
import type { ViewDensity } from "../../types/game";
import type { GamePassGame, Giveaway, PlaytesterGame } from "../../types/deals";
import type { DealGroup, SubTab } from "../../pages/deals/dealsConstants";
import { OVERVIEW_RAIL_SIZE } from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { StatBand, type StatBandItem } from "../ui";
import DealCard from "./DealCard";
import DealsRail from "./DealsRail";
import GamePassCard from "./GamePassCard";
import GiveawayCard from "./GiveawayCard";
import PlaytesterCard from "./PlaytesterCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import { DealsErrorState } from "./DealsEmptyState";

interface OverviewRails {
  bestDiscounts: DealGroup[];
  freeNow: Giveaway[];
  endingSoon: Giveaway[];
  newOnGamePass: GamePassGame[];
  playtests: PlaytesterGame[];
  wishlistOnSale: DealGroup[];
}

interface OverviewTabProps {
  rails: OverviewRails;
  totals: {
    deals: number;
    giveaways: number;
    gamepass: number;
    playtests: number;
  };
  loading: {
    deals: boolean;
    giveaways: boolean;
    gamepass: boolean;
    playtester: boolean;
  };
  errors: {
    deals: string | null;
    giveaways: string | null;
    gamepass: string | null;
    playtester: string | null;
  };
  onReloadAll: () => void;
  density: ViewDensity;
  now: number;
  onSelectTab: (tab: SubTab) => void;
  onOpenUrl: (url: string | null | undefined) => void;
  onInspectDeal: (group: DealGroup) => void;
  onInspectGiveaway: (giveaway: Giveaway) => void;
  onInspectGamePass: (game: GamePassGame) => void;
  onInspectPlaytester: (game: PlaytesterGame) => void;
}

/**
 * Overview - the page's landing tab.
 *
 * Replaces the single-item spotlight with six focused blocks, so the page
 * answers "what is worth my money right now?" before the user picks a source
 * tab. Each block is capped and links into its full source.
 */
export default function OverviewTab({
  rails,
  totals,
  loading,
  errors,
  onReloadAll,
  density,
  now,
  onSelectTab,
  onOpenUrl,
  onInspectDeal,
  onInspectGiveaway,
  onInspectGamePass,
  onInspectPlaytester,
}: OverviewTabProps) {
  const { t } = useLanguage();

  const anyLoading =
    loading.deals || loading.giveaways || loading.gamepass || loading.playtester;

  // Every source failed and nothing is cached: say so once instead of showing
  // an empty overview that looks like "no deals exist today".
  const allFailed =
    !anyLoading &&
    Boolean(errors.deals && errors.giveaways && errors.gamepass && errors.playtester) &&
    totals.deals === 0 &&
    totals.giveaways === 0 &&
    totals.gamepass === 0 &&
    totals.playtests === 0;

  const stats: StatBandItem[] = [
    {
      id: "deals",
      label: t("deals.overviewDeals"),
      value: totals.deals,
      icon: <CircleDollarSign size={14} />,
      tone: "accent",
      onClick: () => onSelectTab("deals"),
    },
    {
      id: "free",
      label: t("deals.freeRightNow"),
      value: totals.giveaways,
      icon: <Gift size={14} />,
      tone: totals.giveaways > 0 ? "success" : "default",
      onClick: () => onSelectTab("giveaways"),
    },
    {
      id: "gamepass",
      label: t("deals.overviewGamePass"),
      value: totals.gamepass,
      icon: <Gamepad2 size={14} />,
      onClick: () => onSelectTab("gamepass"),
    },
    {
      id: "playtests",
      label: t("deals.overviewPlaytests"),
      value: totals.playtests,
      icon: <MonitorPlay size={14} />,
      onClick: () => onSelectTab("playtester"),
    },
  ];

  const bestDiscounts = rails.bestDiscounts.slice(0, OVERVIEW_RAIL_SIZE);
  const freeNow = rails.freeNow.slice(0, OVERVIEW_RAIL_SIZE);
  const endingSoon = rails.endingSoon.slice(0, OVERVIEW_RAIL_SIZE);
  const newOnGamePass = rails.newOnGamePass.slice(0, OVERVIEW_RAIL_SIZE);
  const playtests = rails.playtests.slice(0, OVERVIEW_RAIL_SIZE);
  const wishlistOnSale = rails.wishlistOnSale.slice(0, OVERVIEW_RAIL_SIZE);

  const hasAnything =
    bestDiscounts.length > 0 ||
    freeNow.length > 0 ||
    newOnGamePass.length > 0 ||
    playtests.length > 0;

  return (
    <div className="deals-overview">
      <StatBand items={stats} ariaLabel={t("deals.overviewStatsLabel")} />

      {allFailed && (
        <DealsErrorState
          message={errors.deals ?? t("deals.errorDeals")}
          onRetry={onReloadAll}
        />
      )}

      {anyLoading && !hasAnything && <DealsSkeletonGrid density={density} count={6} />}

      {bestDiscounts.length > 0 && (
        <DealsRail
          title={t("deals.bestDiscounts")}
          icon={<Sparkles size={14} />}
          count={rails.bestDiscounts.length}
          onSeeAll={() => onSelectTab("deals")}
        >
          {bestDiscounts.map((group, index) => (
            <DealCard
              key={group.id}
              group={group}
              density={density}
              index={index}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectDeal}
            />
          ))}
        </DealsRail>
      )}

      {freeNow.length > 0 && (
        <DealsRail
          title={t("deals.freeRightNow")}
          icon={<Gift size={14} />}
          count={rails.freeNow.length}
          onSeeAll={() => onSelectTab("giveaways")}
        >
          {freeNow.map((giveaway, index) => (
            <GiveawayCard
              key={giveaway.id}
              giveaway={giveaway}
              density={density}
              index={index}
              now={now}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectGiveaway}
            />
          ))}
        </DealsRail>
      )}

      {endingSoon.length > 0 && (
        <DealsRail
          title={t("deals.endingSoon")}
          icon={<Clock3 size={14} />}
          count={rails.endingSoon.length}
          onSeeAll={() => onSelectTab("giveaways")}
        >
          {endingSoon.map((giveaway, index) => (
            <GiveawayCard
              key={giveaway.id}
              giveaway={giveaway}
              density={density}
              index={index}
              now={now}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectGiveaway}
            />
          ))}
        </DealsRail>
      )}

      {wishlistOnSale.length > 0 && (
        <DealsRail
          title={t("deals.wishlistOnSale")}
          icon={<Heart size={14} />}
          count={rails.wishlistOnSale.length}
          onSeeAll={() => onSelectTab("deals")}
        >
          {wishlistOnSale.map((group, index) => (
            <DealCard
              key={group.id}
              group={group}
              density={density}
              index={index}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectDeal}
            />
          ))}
        </DealsRail>
      )}

      {newOnGamePass.length > 0 && (
        <DealsRail
          title={t("deals.newOnGamePass")}
          icon={<Gamepad2 size={14} />}
          count={rails.newOnGamePass.length}
          onSeeAll={() => onSelectTab("gamepass")}
        >
          {newOnGamePass.map((game, index) => (
            <GamePassCard
              key={game.id}
              game={game}
              density={density}
              index={index}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectGamePass}
            />
          ))}
        </DealsRail>
      )}

      {playtests.length > 0 && (
        <DealsRail
          title={t("deals.playtestsToTry")}
          icon={<MonitorPlay size={14} />}
          count={rails.playtests.length}
          onSeeAll={() => onSelectTab("playtester")}
        >
          {playtests.map((game, index) => (
            <PlaytesterCard
              key={game.id}
              game={game}
              density={density}
              index={index}
              onOpenUrl={onOpenUrl}
              onInspect={onInspectPlaytester}
            />
          ))}
        </DealsRail>
      )}

      {!anyLoading && !allFailed && !hasAnything && (
        <p className="deals-overview__empty">{t("deals.railEmpty")}</p>
      )}
    </div>
  );
}
