// Year-in-review ("Wrapped") tab of the Activity page.
//
// Data model: everything aggregates from the session history the
// ActivityProvider already holds plus the backend's all-time yearly
// achievement buckets (`achievement_stats::YearlyPoint`) and the
// purchase-cost fields from the $/hour tracker. No new IPC.
//
// Layout is deliberately poster-like (hero hours number + card grid)
// rather than a second dashboard: this tab exists to be looked at once
// a year and exported as an image.

import { useMemo, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useAchievements } from "../../context/AchievementContext";
import { formatPlayTime, formatCost, type Game, type GameSession } from "../../types/game";
import BarChart from "../../components/charts/BarChart";
import { GameThumbnail, EmptyState } from "../../components/activity";
import * as Icons from "./Icons";
import { captureAndSaveScreenshot } from "../../utils/screenshot";
import { useToast } from "../../context/ToastContext";
import {
  buildWrappedYear,
  mergedYears,
  wrappedValueStats,
  yearHeatmapCells,
  type WrappedYear,
} from "../../components/activity/wrapped";
import "./ActivityPage.css";
import "../../styles/activity.css";

export interface WrappedViewProps {
  sessions: GameSession[];
  games: Game[];
}

/** Weekday labels, same source as WeeklyHeatmap. */
function useDayLabels(): string[] {
  const { t } = useLanguage();
  return [
    t("activityDash.sun"),
    t("activityDash.mon"),
    t("activityDash.tue"),
    t("activityDash.wed"),
    t("activityDash.thu"),
    t("activityDash.fri"),
    t("activityDash.sat"),
  ];
}

function heatmapIntensity(minutes: number): string {
  if (minutes <= 0) return "act-heatmap__cell--empty";
  if (minutes < 15) return "act-heatmap__cell--low";
  if (minutes < 45) return "act-heatmap__cell--medium";
  if (minutes < 120) return "act-heatmap__cell--high";
  return "act-heatmap__cell--peak";
}

/** Poster number: one decimal under 10h, whole hours above so the hero
 *  never wraps on a narrow window. */
function heroHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  if (hours <= 0) return "0";
  if (hours < 10) return hours.toFixed(1);
  return String(Math.round(hours));
}

export default function WrappedView({ sessions, games }: WrappedViewProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { overview } = useAchievements();
  const containerRef = useRef<HTMLDivElement>(null);
  const dayLabels = useDayLabels();

  const yearly = overview?.yearly ?? [];
  const years = useMemo(
    () => mergedYears(sessions, yearly.map((y) => y.year)),
    [sessions, yearly]
  );
  const [year, setYear] = useState<number>(() => years[0] ?? new Date().getFullYear());

  const stats = useMemo<WrappedYear>(() => {
    const achForYear = yearly.find((y) => y.year === year)?.count ?? 0;
    return buildWrappedYear(year, sessions, games, achForYear);
  }, [year, sessions, games, yearly]);

  const valueStats = useMemo(() => wrappedValueStats(games), [games]);
  const heat = useMemo(() => yearHeatmapCells(year, sessions), [year, sessions]);

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_v, i) =>
        new Date(2020, i, 1).toLocaleDateString(language, { month: "short" })
      ),
    [language]
  );

  const gameById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) map.set(g.id, g);
    return map;
  }, [games]);

  const paddedHeat = useMemo(() => {
    if (heat.length === 0) return [];
    const leading = new Date(heat[0].date + "T00:00:00").getDay();
    const pad: (typeof heat[number] | null)[] = Array.from({ length: leading }, () => null);
    return pad.concat(heat);
  }, [heat]);

  const heatMonthLabels = useMemo(() => {
    const list: { col: number; label: string }[] = [];
    let prevMonth = "";
    heat.forEach((c, i) => {
      const month = c.date.slice(0, 7);
      if (month !== prevMonth) {
        const leading = new Date(heat[0].date + "T00:00:00").getDay();
        list.push({
          col: Math.floor((leading + i) / 7),
          label: new Date(c.date + "T00:00:00").toLocaleDateString(language, { month: "short" }),
        });
        prevMonth = month;
      }
    });
    return list;
  }, [heat, language]);

  const topGames = stats.topGames.slice(0, 10);
  const topMinutes = topGames[0]?.minutes ?? 0;

  async function handleSaveImage() {
    const container = containerRef.current;
    if (!container) return;
    try {
      const filePath = await captureAndSaveScreenshot({
        element: container,
        fileName: `gamelib_wrapped_${year}`,
        title: t("activity.saveScreenshot"),
        filterLabel: t("activity.pngImage"),
      });
      if (filePath) showToast(t("activity.screenshotSaved"), "success");
    } catch (err) {
      showToast(t("activity.screenshotFailed", { error: String(err) }), "error");
    }
  }

  const primaryCurrency = valueStats?.byCurrency[0] ?? null;

  return (
    <div className="wrapped" ref={containerRef}>
      {stats.sessionsCount === 0 ? (
        <>
          {years.length > 1 && (
            <div className="wrapped__toolbar">
              <select
                className="wrapped__year-select"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                aria-label={t("wrapped.year")}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          <div className="wrapped__empty-card">
            <EmptyState
              icon={<Icons.History size={22} />}
              title={t("wrapped.empty")}
              hint={t("wrapped.emptySub")}
            />
          </div>
        </>
      ) : (
        <>
          <header className="wrapped__hero">
            <div className="wrapped__hero-glow" aria-hidden />
            <div className="wrapped__hero-text">
              <span className="wrapped__hero-eyebrow">
                <Icons.Sparkles size={13} />
                {t("wrapped.year")} {year}
              </span>
              <div className="wrapped__hero-number">
                {heroHours(stats.totalMinutes)}
                <span className="wrapped__hero-unit">h</span>
              </div>
              <span className="wrapped__hero-caption">{t("activity.totalPlaytime")}</span>
              <p className="wrapped__hero-sub">{t("wrapped.heroSub")}</p>
            </div>

            <div className="wrapped__hero-side">
              <div className="wrapped__hero-controls">
                {years.length > 0 && (
                  <select
                    className="wrapped__year-select"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                    aria-label={t("wrapped.year")}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="wrapped__export"
                  onClick={handleSaveImage}
                  title={t("activity.saveScreenshot")}
                >
                  <Icons.Camera size={13} /> {t("wrapped.export")}
                </button>
              </div>

              <div className="wrapped__hero-chips">
                <span className="wrapped__chip">
                  <strong>{stats.sessionsCount}</strong> {t("activity.sessions")}
                </span>
                <span className="wrapped__chip">
                  <strong>{stats.distinctGames}</strong> {t("activity.gamesPlayed")}
                </span>
                <span className="wrapped__chip">
                  <strong>{stats.activeDays}</strong> {t("activity.activeDays")}
                </span>
                <span className="wrapped__chip wrapped__chip--streak">
                  <Icons.Flame size={12} />
                  <strong>{stats.longestStreakDays}</strong>
                  {t("activity.bestStreak").toLowerCase()}
                </span>
              </div>
            </div>
          </header>

          <section className="wrapped__grid" aria-label={t("wrapped.heroSub")}>
            <article className="wrapped__card">
              <span className="wrapped__card-label">
                <Icons.History size={13} /> {t("activity.avgSession")}
              </span>
              <span className="wrapped__card-value">
                {formatPlayTime(Math.round(stats.avgSessionMinutes))}
              </span>
            </article>
            <article className="wrapped__card">
              <span className="wrapped__card-label">
                <Icons.Trophy size={13} /> {t("wrapped.achievements")}
              </span>
              <span className="wrapped__card-value">{stats.achievements}</span>
            </article>
            {stats.avgFps != null && (
              <article className="wrapped__card">
                <span className="wrapped__card-label">
                  <Icons.TrendingUp size={13} /> {t("activity.avgFps")}
                </span>
                <span className="wrapped__card-value">{Math.round(stats.avgFps)}</span>
              </article>
            )}
            {primaryCurrency && (
              <article className="wrapped__card">
                <span className="wrapped__card-label">
                  <Icons.Star size={13} /> {t("activityDash.costPerHourAvg")}
                </span>
                <span className="wrapped__card-value">
                  {formatCost(primaryCurrency.avgPerHour, primaryCurrency.currency)}
                </span>
                <span className="wrapped__card-sub">
                  {t("activityDash.pricedGames", { n: primaryCurrency.priced })}
                </span>
              </article>
            )}
            {stats.topDay && (
              <article className="wrapped__card wrapped__card--wide">
                <span className="wrapped__card-label">
                  <Icons.Zap size={13} /> {t("wrapped.marathon")}
                </span>
                <span className="wrapped__card-value">
                  {formatPlayTime(stats.topDay.minutes)}
                </span>
                <span className="wrapped__card-sub">
                  {new Date(`${stats.topDay.date}T00:00:00`).toLocaleDateString(language, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </article>
            )}
          </section>

          <div className="wrapped__two-col">
            <section className="wrapped__section wrapped__section--chart">
              <h4 className="wrapped__section-title">{t("wrapped.byMonth")}</h4>
              <BarChart
                data={stats.monthMinutes}
                labels={monthLabels}
                formatValue={(v) => formatPlayTime(v)}
                tooltip
                height={190}
              />
            </section>

            <section className="wrapped__section wrapped__section--heat">
              <h4 className="wrapped__section-title">{t("wrapped.heatmapTitle")}</h4>
              <div className="act-heatmap">
                <div className="act-heatmap__scroll">
                  <div className="act-heatmap__body">
                    <div className="act-heatmap__labels">
                      {dayLabels.map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                    <div className="act-heatmap__cols">
                      <div className="act-heatmap__months" aria-hidden="true">
                        {heatMonthLabels.map((m) => (
                          <span key={m.label + m.col} style={{ left: `calc(${m.col} * 16px)` }}>
                            {m.label}
                          </span>
                        ))}
                      </div>
                      <div className="act-heatmap__grid">
                        {paddedHeat.map((cell, i) =>
                          cell === null ? (
                            <div key={`pad-${i}`} className="act-heatmap__cell act-heatmap__cell--pad" />
                          ) : (
                            <div
                              key={cell.date}
                              className={`act-heatmap__cell ${heatmapIntensity(cell.minutes)}`}
                              title={`${cell.date}: ${formatPlayTime(cell.minutes)}`}
                            />
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {topGames.length > 0 && (
            <section className="wrapped__section">
              <h4 className="wrapped__section-title">{t("wrapped.topGames")}</h4>
              <ol className="wrapped__top-list">
                {topGames.map((tg, idx) => {
                  const game = gameById.get(tg.gameId);
                  const share = topMinutes > 0 ? Math.round((tg.minutes / topMinutes) * 100) : 0;
                  return (
                    <li key={`${tg.gameId}-${idx}`} className="wrapped__top-item">
                      <span
                        className={`wrapped__top-rank${idx === 0 ? " wrapped__top-rank--gold" : idx === 1 ? " wrapped__top-rank--silver" : idx === 2 ? " wrapped__top-rank--bronze" : ""}`}
                      >
                        {idx + 1}
                      </span>
                      <div className="wrapped__top-thumb">
                        <GameThumbnail
                          iconUrl={game?.iconUrl}
                          coverArtUrl={game?.coverArtUrl}
                          steamAppId={game?.steamAppId}
                          name={tg.gameName}
                          className="wrapped__top-thumb-img"
                        />
                      </div>
                      <div className="wrapped__top-info">
                        <span className="wrapped__top-name">{tg.gameName}</span>
                        <span className="wrapped__top-meta">
                          {formatPlayTime(tg.minutes)} • {tg.sessions}{" "}
                          {tg.sessions === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
                        </span>
                        <div className="wrapped__top-bar" aria-hidden>
                          <div className="wrapped__top-bar-fill" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                      {game?.purchaseCost != null && (
                        <span className="wrapped__top-cost">
                          {formatCost(game.purchaseCost, game.purchaseCurrency)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
