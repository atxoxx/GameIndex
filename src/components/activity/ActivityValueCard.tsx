import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Coins } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  formatCost,
  gameDisplayName,
  libraryValueStats,
  resolvePurchaseCost,
  type Game,
} from "../../types/game";
import { Panel } from "../ui";

export interface ActivityValueCardProps {
  games: Game[];
}

/**
 * Library spend and value, kept out of the top KPI band but still available.
 * Unpriced games reuse the prices the app already knows (the same CheapShark
 * lookup that powers store badges); nothing here is persisted.
 */
export function ActivityValueCard({ games }: ActivityValueCardProps) {
  const { t } = useLanguage();
  const [knownPrices, setKnownPrices] = useState<Record<string, number>>({});

  const unpricedNames = useMemo(
    () =>
      games
        .filter((game) => game.purchaseCost == null)
        .map((game) => gameDisplayName(game) || game.name)
        .slice(0, 200),
    [games],
  );
  const unpricedKey = unpricedNames.join("\u0000");

  useEffect(() => {
    if (!unpricedKey) return;
    let cancelled = false;
    invoke<Record<string, { salePrice?: number | null; normalPrice?: number | null }>>(
      "fetch_game_prices_batch",
      { gameNames: unpricedKey.split("\u0000") },
    )
      .then((response) => {
        if (cancelled || !response) return;
        const next: Record<string, number> = {};
        for (const [name, price] of Object.entries(response)) {
          const value = price?.salePrice ?? price?.normalPrice;
          if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            next[name] = value;
          }
        }
        setKnownPrices(next);
      })
      .catch(() => {
        // Offline or no match: the card keeps its quiet hint.
      });
    return () => {
      cancelled = true;
    };
  }, [unpricedKey]);

  const gamesForValue = useMemo(() => {
    if (Object.keys(knownPrices).length === 0) return games;
    return games.map((game) => {
      const resolved = resolvePurchaseCost(
        game,
        knownPrices[gameDisplayName(game) || game.name],
      );
      if (!resolved || resolved.source === "stored") return game;
      return {
        ...game,
        purchaseCost: resolved.cost,
        purchaseCurrency: resolved.currency,
      };
    });
  }, [games, knownPrices]);

  const stats = useMemo(() => libraryValueStats(gamesForValue), [gamesForValue]);
  const currency = stats?.byCurrency[0];

  return (
    <Panel
      className="activity-value-card"
      heading={t("activityWs.overview.value")}
      icon={<Coins size={15} />}
    >
      <div className="activity-value-card__figures">
        <div>
          <span className="activity-value-card__label">{t("activityDash.totalSpend")}</span>
          <span className="activity-value-card__value">
            {currency ? formatCost(currency.spent, currency.currency) : "—"}
          </span>
          <span className="activity-value-card__hint">
            {currency
              ? t("activityDash.pricedGames", { n: currency.priced })
              : t("activityDash.setCostHint")}
          </span>
        </div>
        <div>
          <span className="activity-value-card__label">
            {t("activityDash.costPerHourAvg")}
          </span>
          <span className="activity-value-card__value">
            {currency ? formatCost(currency.avgPerHour, currency.currency) : "—"}
          </span>
          <span className="activity-value-card__hint">
            {stats?.worstValue
              ? t("activityDash.worstValue", {
                  name: gameDisplayName(stats.worstValue.game),
                })
              : t("activityWs.overview.valueHint")}
          </span>
        </div>
      </div>
    </Panel>
  );
}

export default ActivityValueCard;
