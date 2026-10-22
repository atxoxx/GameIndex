import { useMemo } from "react";
import { useActivity } from "../../context/ActivityContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePrice } from "../../context/PriceContext";
import { Button } from "../ui";
import {
  VALUE_RATE_THRESHOLDS,
  VALUE_TARGET_RATE,
  costPerHour,
  formatCost,
  gameDisplayName,
  hoursToReachRate,
  parsePlayTime,
  resolvePurchaseCost,
  valueBenchmark,
  valueHistory,
  valueProjection,
  valueVerdict,
  type Game,
} from "../../types/game";
import { IconClock, IconPencil, IconStar, IconTag, IconTrendUp } from "./icons";

/**
 * GameValueCard
 *
 * The detail page's cost-per-hour KPI: what the game has cost so far, how
 * that rate sits against the rest of the priced library, what finishing it
 * would do to the rate, and how the rate has fallen with playtime.
 *
 * Only ever uses a cost the user actually saved. A store price is shown as a
 * separate reference line ("worth 19.99 today"), never folded into the rate:
 * a sale price is not what the game cost this person.
 */

interface GameValueCardProps {
  game: Game;
  /** Opens the edit dialog on the purchase-cost field. */
  onSetCost?: () => void;
}

/** Hours for display: one decimal under 100h, whole hours past that. */
function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  return `${hours >= 100 ? Math.round(hours) : hours.toFixed(1)} h`;
}

/** `95` → `1h 35m`, `45` → `45m`. */
function formatSessionLength(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function GameValueCard({ game, onSetCost }: GameValueCardProps) {
  const { t } = useLanguage();
  const { games } = useGames();
  const { getGameSessions } = useActivity();

  // Saved cost only: no store-price fallback and nothing is written back to
  // the game record, so a later real purchase price always wins.
  const cost = useMemo(
    () => resolvePurchaseCost(game),
    [game.purchaseCost, game.purchaseCurrency]
  );
  const currency = cost?.currency ?? "USD";
  const perHour = cost
    ? costPerHour({
        purchaseCost: cost.cost,
        purchaseCurrency: cost.currency,
        playTime: game.playTime,
      })
    : null;
  const hoursPlayed = parsePlayTime(game.playTime) / 60;
  // Thresholds and the target rate are quoted in USD-scale currencies; for
  // anything else a verdict would be a guess.
  const comparableCurrency = Boolean(VALUE_RATE_THRESHOLDS[currency]);
  const verdict = valueVerdict(perHour, currency);

  const benchmark = useMemo(
    () => (cost ? valueBenchmark(games, game) : null),
    [games, game, cost]
  );
  const projection = useMemo(
    () => (cost ? valueProjection(cost.cost, game.playTime, game.timeToBeat) : null),
    [cost, game.playTime, game.timeToBeat]
  );
  const hoursToTarget = useMemo(
    () =>
      cost && comparableCurrency
        ? hoursToReachRate(cost.cost, game.playTime, VALUE_TARGET_RATE)
        : null,
    [cost, comparableCurrency, game.playTime]
  );

  const sessions = useMemo(() => getGameSessions(game.id), [getGameSessions, game.id]);
  const history = useMemo(
    () => (cost ? valueHistory(cost.cost, sessions) : []),
    [cost, sessions]
  );
  const sparkline = useMemo(() => {
    if (history.length < 2) return null;
    const rates = history.map((point) => point.rate);
    const max = Math.max(...rates);
    const min = Math.min(...rates);
    const span = max - min || Math.max(max, 1) * 0.1;
    return history
      .map((point, index) => {
        const x = (index / (history.length - 1)) * 100;
        const y = 2 + (1 - (point.rate - min) / span) * 24;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [history]);

  const sessionMinutes = useMemo(
    () => sessions.reduce((sum, session) => sum + session.durationMin, 0),
    [sessions]
  );

  // The store price is a reference, not the cost. CheapShark quotes USD, so
  // the comparison only makes sense for a USD purchase.
  const price = usePrice(gameDisplayName(game) || game.name);
  const storeNow = price?.salePrice ?? price?.normalPrice ?? null;
  const storeDiff = cost && storeNow != null && currency === "USD" ? cost.cost - storeNow : null;

  const titleIcon = (
    <span className="game-section-title__icon" aria-hidden>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 11h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        <circle cx="12" cy="15.5" r="1.5" />
      </svg>
    </span>
  );

  if (!cost) {
    return (
      <section className="game-section game-value-card game-value-card--empty">
        <h2 className="game-section-title">
          {titleIcon}
          {t("game.value.title")}
        </h2>
        <p className="game-value-card__hint">{t("game.value.setCostHint")}</p>
        {onSetCost && (
          <Button size="sm" variant="secondary" onClick={onSetCost}>
            {t("game.value.setCost")}
          </Button>
        )}
      </section>
    );
  }

  const perHourSuffix = <span className="game-value-card__unit">{t("game.value.perHour")}</span>;

  return (
    <section className="game-section game-value-card">
      <h2 className="game-section-title">
        {titleIcon}
        {t("game.value.title")}
      </h2>

      <div className="game-value-card__hero">
        <div className="game-value-card__rate">
          {perHour != null ? (
            <>
              {formatCost(perHour, currency)}
              {perHourSuffix}
            </>
          ) : (
            formatCost(cost.cost, currency)
          )}
        </div>
        {verdict && (
          <span className={`game-value-card__verdict game-value-card__verdict--${verdict}`}>
            {t(`game.value.verdict.${verdict}`)}
          </span>
        )}
      </div>

      {perHour == null && (
        <p className="game-value-card__hint">{t("game.value.needPlaytime")}</p>
      )}

      <div className="game-value-card__facts">
        <div className="game-value-card__fact">
          <span className="game-value-card__fact-label">{t("game.value.paid")}</span>
          <span className="game-value-card__fact-value">
            {formatCost(cost.cost, currency)}
            {onSetCost && (
              <button
                type="button"
                className="game-value-card__edit"
                onClick={onSetCost}
                title={t("game.value.editCost")}
                aria-label={t("game.value.editCost")}
              >
                <IconPencil size={11} />
              </button>
            )}
          </span>
        </div>
        <div className="game-value-card__fact">
          <span className="game-value-card__fact-label">{t("game.value.played")}</span>
          <span className="game-value-card__fact-value">{formatHours(hoursPlayed)}</span>
        </div>
      </div>

      {benchmark?.betterThan != null && perHour != null && (
        <div className="game-value-card__compare">
          <div
            className="game-value-card__bar"
            role="img"
            aria-label={t("game.value.betterThan", {
              pct: Math.round(benchmark.betterThan * 100),
            })}
          >
            <div
              className="game-value-card__bar-fill"
              style={{ width: `${Math.round(benchmark.betterThan * 100)}%` }}
            />
          </div>
          <div className="game-value-card__caption">
            {t("game.value.betterThan", { pct: Math.round(benchmark.betterThan * 100) })}
          </div>
          <div className="game-value-card__caption game-value-card__caption--muted">
            {t("game.value.median", {
              rate: formatCost(benchmark.medianPerHour, benchmark.currency),
            })}
          </div>
        </div>
      )}

      {(projection || hoursToTarget != null || sessions.length > 0 || storeDiff != null) && (
        <div className="game-value-card__rows">
          {projection && (
            <div className="game-value-card__row">
              <span className="game-value-card__row-icon" aria-hidden>
                <IconTrendUp size={13} />
              </span>
              <span>
                {t(
                  projection.milestone === "story"
                    ? "game.value.projection"
                    : "game.value.projectionComplete",
                  {
                    hours: formatHours(projection.hours),
                    rate: formatCost(projection.perHour, currency),
                  }
                )}
              </span>
            </div>
          )}

          {hoursToTarget != null && (
            <div className="game-value-card__row">
              <span className="game-value-card__row-icon" aria-hidden>
                <IconStar size={13} />
              </span>
              <span>
                {hoursToTarget <= 0
                  ? t("game.value.targetReached", {
                      rate: formatCost(VALUE_TARGET_RATE, currency),
                    })
                  : t("game.value.targetLeft", {
                      hours: formatHours(hoursToTarget),
                      rate: formatCost(VALUE_TARGET_RATE, currency),
                    })}
              </span>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="game-value-card__row">
              <span className="game-value-card__row-icon" aria-hidden>
                <IconClock size={13} />
              </span>
              <span>
                {t("game.value.sessions", {
                  count: sessions.length,
                  avg: formatSessionLength(sessionMinutes / sessions.length),
                  rate: formatCost(cost.cost / sessions.length, currency),
                })}
              </span>
            </div>
          )}

          {storeDiff != null && storeNow != null && (
            <div className="game-value-card__row">
              <span className="game-value-card__row-icon" aria-hidden>
                <IconTag size={13} />
              </span>
              <span>
                {Math.abs(storeDiff) < 0.01
                  ? t("game.value.storeSame", { price: formatCost(storeNow, "USD") })
                  : storeDiff > 0
                    ? t("game.value.storeCheaper", {
                        price: formatCost(storeNow, "USD"),
                        diff: formatCost(storeDiff, "USD"),
                      })
                    : t("game.value.storeHigher", {
                        price: formatCost(storeNow, "USD"),
                        diff: formatCost(-storeDiff, "USD"),
                      })}
              </span>
            </div>
          )}
        </div>
      )}

      {sparkline && (
        <div className="game-value-card__spark">
          <div className="game-value-card__caption game-value-card__caption--muted">
            {t("game.value.trend")}
          </div>
          <svg
            className="game-value-card__spark-svg"
            viewBox="0 0 100 28"
            preserveAspectRatio="none"
            role="img"
            aria-label={t("game.value.trend")}
          >
            <polyline className="game-value-card__spark-line" points={sparkline} />
          </svg>
        </div>
      )}
    </section>
  );
}
