import { useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { Card, KpiTile } from "../../../components/ui";
import DonutChart from "../../../components/charts/DonutChart";
import {
  formatHours,
  buildHeatmap,
  computeStreaks,
  computeTimeOfDay,
  computePeriodCompare,
  computeMonthToDate,
  computeWeekdaySplit,
  computeGoalPace,
} from "../statsCalculations";
import { saveMonthlyGoal } from "../statsStorage";
import type { Game, GameSession, GameAchievementData, DayCell } from "../statsTypes";

const DONUT_PALETTE = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-danger)",
  "color-mix(in srgb, var(--color-accent) 60%, var(--color-info))",
  "color-mix(in srgb, var(--color-info) 60%, var(--color-success))",
  "color-mix(in srgb, var(--color-success) 60%, var(--color-warning))",
];

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAY_LABELS = ["Mon", "Wed", "Fri"];

function heatLevel(minutes: number, max: number): number {
  if (minutes <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = minutes / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

interface OverviewTabProps {
  sessions: GameSession[];
  games: Game[];
  achievementCache: Record<string, GameAchievementData>;
  initialGoalMin: number;
  hideAchievementProgress: boolean;
}

export function OverviewTab({
  sessions,
  games,
  achievementCache,
  initialGoalMin,
  hideAchievementProgress,
}: OverviewTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Basic totals
  const totalPlaytimeMin = useMemo(() => sessions.reduce((s, x) => s + x.durationMin, 0), [sessions]);
  const totalSessions = sessions.length;
  const longestSessionMin = useMemo(
    () => sessions.reduce((max, s) => Math.max(max, s.durationMin), 0),
    [sessions]
  );
  const avgSessionMin = totalSessions > 0 ? Math.round(totalPlaytimeMin / totalSessions) : 0;

  // Analytics
  const heatmap = useMemo(() => buildHeatmap(sessions, 16), [sessions]);
  const streak = useMemo(() => computeStreaks(sessions), [sessions]);
  const timeOfDay = useMemo(() => computeTimeOfDay(sessions), [sessions]);
  const periodCompare = useMemo(() => computePeriodCompare(sessions), [sessions]);
  const monthToDate = useMemo(() => computeMonthToDate(sessions), [sessions]);
  const weekday = useMemo(() => computeWeekdaySplit(sessions), [sessions]);
  const bestDay = useMemo(() => {
    let best: DayCell | null = null;
    const now = new Date();
    for (const c of heatmap.cells) {
      if (c.date > now) continue;
      if (c.minutes > 0 && (!best || c.minutes > best.minutes)) best = c;
    }
    return best;
  }, [heatmap.cells]);

  // Monthly goal
  const [goalMin, setGoalMin] = useState<number>(initialGoalMin);
  const [editingGoal, setEditingGoal] = useState(false);
  const [draftGoalHours, setDraftGoalHours] = useState(String(goalMin / 60 || 0));

  const handleSaveGoal = useCallback(() => {
    const hours = Math.max(0, Number(draftGoalHours) || 0);
    const newMin = hours * 60;
    setGoalMin(newMin);
    saveMonthlyGoal(newMin);
    setEditingGoal(false);
  }, [draftGoalHours]);

  const goalPct = goalMin > 0 ? Math.min(100, Math.round((monthToDate / goalMin) * 100)) : 0;
  const goalPace = useMemo(() => computeGoalPace(monthToDate, goalMin), [monthToDate, goalMin]);

  // Achievement counts
  const achievementCounts = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gid of Object.keys(achievementCache)) {
      const g = achievementCache[gid];
      total += g.total;
      unlocked += g.unlocked;
    }
    return { total, unlocked };
  }, [achievementCache]);

  const achievementPct =
    achievementCounts.total > 0
      ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
      : null;

  // Games added this month
  const gamesAddedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return games.filter((g) => g.addedAt >= monthStart).length;
  }, [games]);

  // Recently played count (last 14 days)
  const recentlyPlayedCount = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return games.filter((g) => g.lastPlayed && g.lastPlayed >= cutoff).length;
  }, [games]);

  // Genre breakdown
  const genreBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    const gameById = new Map(games.map((g) => [g.id, g]));
    for (const s of sessions) {
      const g = gameById.get(s.gameId);
      const genre = g?.genres?.[0] || "Uncategorized";
      map.set(genre, (map.get(genre) || 0) + s.durationMin);
    }
    return Array.from(map.entries())
      .map(([genre, minutes]) => ({ genre, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [sessions, games]);

  const genreSlices = useMemo(() => {
    if (genreBreakdown.length <= 6) {
      return genreBreakdown.map((g, i) => ({
        label: g.genre,
        value: g.minutes,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      }));
    }
    const top = genreBreakdown.slice(0, 6);
    const rest = genreBreakdown.slice(6).reduce((s, g) => s + g.minutes, 0);
    const slices = top.map((g, i) => ({
      label: g.genre,
      value: g.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
    if (rest > 0) slices.push({ label: t("communityExtras.other"), value: rest, color: "var(--color-text-muted)" });
    return slices;
  }, [genreBreakdown, t]);

  // Platform breakdown
  const platformBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    const gameById = new Map(games.map((g) => [g.id, g]));
    for (const s of sessions) {
      const g = gameById.get(s.gameId);
      const plat = g?.platform || "PC / Windows";
      map.set(plat, (map.get(plat) || 0) + s.durationMin);
    }
    return Array.from(map.entries())
      .map(([platform, minutes]) => ({ platform, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [sessions, games]);

  const platformSlices = useMemo(() => {
    return platformBreakdown.map((p, i) => ({
      label: p.platform,
      value: p.minutes,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));
  }, [platformBreakdown]);

  // Top Games ranked list
  const topGames = useMemo(() => {
    const map = new Map<string, { minutes: number; sessions: number; name: string }>();
    for (const s of sessions) {
      const cur = map.get(s.gameId) || { minutes: 0, sessions: 0, name: s.gameName };
      cur.minutes += s.durationMin;
      cur.sessions++;
      map.set(s.gameId, cur);
    }
    const list = Array.from(map.entries()).map(([gameId, data]) => {
      const lib = games.find((g) => g.id === gameId);
      return {
        gameId,
        gameName: lib?.name || data.name,
        coverArtUrl: lib?.coverArtUrl,
        platform: lib?.platform,
        lastPlayed: lib?.lastPlayed,
        minutes: data.minutes,
        sessions: data.sessions,
      };
    });
    list.sort((a, b) => b.minutes - a.minutes);
    const maxMin = list[0]?.minutes || 1;
    return list.map((g) => ({
      ...g,
      pct: Math.round((g.minutes / maxMin) * 100),
    }));
  }, [sessions, games]);

  // Heatmap week columns (7 rows x weeksCount cols)
  const heatmapWeeks = useMemo(() => {
    const cols: DayCell[][] = [];
    for (let i = 0; i < heatmap.cells.length; i += 7) {
      cols.push(heatmap.cells.slice(i, i + 7));
    }
    return cols;
  }, [heatmap.cells]);

  const top3 = topGames.slice(0, 3);
  const remainingTop = topGames.slice(3, 10);

  return (
    <div className="stats-tab-overview">
      {/* ── KPI Grid ─────────────────────────────────────────────── */}
      <div className="stats-kpi-grid">
        <KpiTile
          label={t("community.totalPlaytime")}
          value={formatHours(totalPlaytimeMin)}
          subtext={t("gameActivity.sessionCount", { count: totalSessions, s: totalSessions !== 1 ? "s" : "" })}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
          intent="accent"
          size="md"
          trailing={
            <span
              className={`stats-compare-badge ${periodCompare.deltaMin >= 0 ? "up" : "down"}`}
              title={t("communityExtras.compareTitle", {
                this: formatHours(periodCompare.thisMonthMin),
                last: formatHours(periodCompare.lastMonthMin),
              })}
            >
              {periodCompare.deltaMin >= 0 ? "▲" : "▼"} {periodCompare.pct === null ? "—" : `${periodCompare.deltaMin >= 0 ? "+" : ""}${periodCompare.pct}%`}
            </span>
          }
        />

        <KpiTile
          label={t("community.gamesOwned")}
          value={games.length}
          subtext={t("community.addedThisMonth", { count: gamesAddedThisMonth })}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="6" y1="12" x2="10" y2="12" />
              <line x1="8" y1="10" x2="8" y2="14" />
            </svg>
          }
          intent="info"
          size="md"
        />

        {!hideAchievementProgress && achievementPct !== null && (
          <KpiTile
            label={t("community.achievements")}
            value={`${achievementPct}%`}
            subtext={t("community.unlockedOf", { unlocked: achievementCounts.unlocked, total: achievementCounts.total })}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            }
            intent={achievementPct >= 50 ? "success" : "warning"}
            size="md"
          />
        )}

        <KpiTile
          label={t("community.recentlyPlayed")}
          value={recentlyPlayedCount}
          subtext={t("community.last14Days")}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
          intent="success"
          size="md"
        />
      </div>

      {/* ── Year in Review / Scoreboard Summary Strip ───────────── */}
      <Card variant="glass" elevation="glow" className="stats-summary-strip-card">
        <div className="stats-summary-strip-header">
          <span className="stats-summary-strip-icon">📊</span>
          <h3>{t("community.yearInReview")}</h3>
        </div>
        <div className="stats-summary-strip-grid">
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{formatHours(totalPlaytimeMin)}</span>
            <span className="stats-summary-lbl">{t("community.totalPlaytime")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{totalSessions}</span>
            <span className="stats-summary-lbl">{t("community.sessions")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{games.length}</span>
            <span className="stats-summary-lbl">{t("community.gamesInLibrary")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{topGames.length}</span>
            <span className="stats-summary-lbl">{t("community.gamesPlayed")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{longestSessionMin > 0 ? formatHours(longestSessionMin) : "—"}</span>
            <span className="stats-summary-lbl">{t("community.longestSession")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{avgSessionMin > 0 ? formatHours(avgSessionMin) : "—"}</span>
            <span className="stats-summary-lbl">{t("community.avgSession")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{genreBreakdown.length}</span>
            <span className="stats-summary-lbl">{t("community.genresPlayed")}</span>
          </div>
          <div className="stats-summary-cell">
            <span className="stats-summary-val">{streak.current} {t("communityExtras.dayStreak")}</span>
            <span className="stats-summary-lbl">{t("communityExtras.longest", { days: streak.longest })}</span>
          </div>
        </div>
      </Card>

      {/* ── When You Play Section ─────────────────────────────────── */}
      <section className="stats-section">
        <h2 className="stats-section-title">{t("communityExtras.whenYouPlay")}</h2>
        <div className="stats-when-grid">
          {/* Activity Heatmap Card */}
          <Card variant="surface" elevation="1" className="stats-card stats-heatmap-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("communityExtras.activityHeatmap")}</h3>
                <span className="stats-card-sub">{t("communityExtras.heatmapSubtitle", { count: heatmap.activeDays })}</span>
              </div>
              {bestDay && (
                <span className="stats-heatmap-badge">
                  🏆 {bestDay.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {formatHours(bestDay.minutes)}
                </span>
              )}
            </div>

            <div className="stats-heatmap-wrap">
              <div className="stats-heatmap-weekdays">
                {WEEKDAY_LABELS.map((l) => (
                  <span key={l} className="stats-heatmap-weekday-lbl">
                    {t(`communityExtras.weekday.${l.toLowerCase()}`)}
                  </span>
                ))}
              </div>

              <div className="stats-heatmap-grid">
                {heatmapWeeks.map((week, wi) => (
                  <div key={wi} className="stats-heatmap-col">
                    {week.map((cell) => {
                      const lvl = heatLevel(cell.minutes, heatmap.maxMinutes);
                      const isFuture = cell.date > new Date();
                      return (
                        <div
                          key={cell.key}
                          className={`stats-heatmap-cell level-${lvl}${isFuture ? " is-future" : ""}`}
                          title={
                            isFuture
                              ? ""
                              : `${cell.date.toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}: ${cell.minutes > 0 ? formatHours(cell.minutes) : t("communityExtras.noPlay")}`
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="stats-heatmap-legend-row">
              <span>{t("activityDash.less")}</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={`stats-heatmap-cell level-${l}`} />
              ))}
              <span>{t("activityDash.more")}</span>
            </div>
          </Card>

          {/* Weekday Split Bar Chart */}
          <Card variant="surface" elevation="1" className="stats-card stats-weekday-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("communityExtras.weekdaySplit")}</h3>
                <span className="stats-card-sub">{t("communityExtras.byTotalPlaytime")}</span>
              </div>
            </div>

            {weekday.totalMinutes > 0 ? (
              <div className="stats-weekday-bars">
                {weekday.minutes.map((m, i) => {
                  const isFav = i === weekday.favoriteIndex;
                  const pct = weekday.maxMinutes > 0 ? Math.round((m / weekday.maxMinutes) * 100) : 0;
                  return (
                    <div key={WEEKDAY_KEYS[i]} className={`stats-weekday-row${isFav ? " is-favorite" : ""}`}>
                      <span className="stats-weekday-name">{t(`communityExtras.weekday.${WEEKDAY_KEYS[i]}`)}</span>
                      <div className="stats-weekday-track">
                        <div className="stats-weekday-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="stats-weekday-val">{formatHours(m)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="stats-empty-view">
                <p>{t("communityExtras.weekdayEmpty")}</p>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ── What You Play & Goals Section ─────────────────────────── */}
      <section className="stats-section">
        <h2 className="stats-section-title">{t("communityExtras.whatYouPlay")}</h2>
        <div className="stats-donuts-grid">
          {/* Genre Breakdown Donut */}
          <Card variant="surface" elevation="1" className="stats-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("community.genreBreakdown")}</h3>
                <span className="stats-card-sub">{t("communityExtras.byTotalPlaytime")}</span>
              </div>
            </div>
            {genreSlices.length > 0 ? (
              <div className="stats-donut-container">
                <DonutChart
                  slices={genreSlices}
                  size={190}
                  innerRadius={52}
                  formatValue={(v) => formatHours(v)}
                />
              </div>
            ) : (
              <div className="stats-empty-view">
                <p>{t("community.emptyGenre")}</p>
              </div>
            )}
          </Card>

          {/* Platform Split Donut */}
          <Card variant="surface" elevation="1" className="stats-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("community.platformSplit")}</h3>
                <span className="stats-card-sub">{t("communityExtras.byTotalPlaytime")}</span>
              </div>
            </div>
            {platformSlices.length > 0 ? (
              <div className="stats-donut-container">
                <DonutChart
                  slices={platformSlices}
                  size={190}
                  innerRadius={52}
                  formatValue={(v) => formatHours(v)}
                />
              </div>
            ) : (
              <div className="stats-empty-view">
                <p>{t("community.emptyPlatform")}</p>
              </div>
            )}
          </Card>

          {/* Time of Day Donut */}
          <Card variant="surface" elevation="1" className="stats-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("communityExtras.timeOfDay")}</h3>
                <span className="stats-card-sub">{t("communityExtras.byTotalPlaytime")}</span>
              </div>
            </div>
            {timeOfDay.some((s) => s.minutes > 0) ? (
              <div className="stats-donut-container">
                <DonutChart
                  slices={timeOfDay
                    .filter((s) => s.minutes > 0)
                    .map((s) => ({
                      label: t(`communityExtras.timeOfDay.${s.key}`),
                      value: s.minutes,
                      color: s.color,
                    }))}
                  size={190}
                  innerRadius={52}
                  formatValue={(v) => formatHours(v)}
                />
              </div>
            ) : (
              <div className="stats-empty-view">
                <p>{t("communityExtras.playGamesSplit")}</p>
              </div>
            )}
          </Card>

          {/* Monthly Goal Ring Card */}
          <Card variant="surface" elevation="1" className="stats-card stats-goal-card">
            <div className="stats-card-header">
              <div>
                <h3>{t("communityExtras.monthlyGoal")}</h3>
                <span className="stats-card-sub">
                  {goalMin > 0 ? t("communityExtras.ofGoal", { time: formatHours(goalMin) }) : t("communityExtras.noGoalSet")}
                </span>
              </div>
              <button
                type="button"
                className="stats-goal-edit-toggle"
                onClick={() => {
                  setDraftGoalHours(String(goalMin / 60 || 0));
                  setEditingGoal((e) => !e);
                }}
              >
                {editingGoal ? t("editImage.done") : t("communityExtras.setGoal")}
              </button>
            </div>

            {editingGoal ? (
              <div className="stats-goal-edit-box">
                <input
                  type="number"
                  min={0}
                  className="stats-goal-num-input"
                  value={draftGoalHours}
                  onChange={(e) => setDraftGoalHours(e.target.value)}
                  aria-label={t("communityExtras.goalInHours")}
                />
                <span className="stats-goal-unit-text">{t("communityExtras.hoursUnit")}</span>
                <button type="button" className="stats-goal-save-btn" onClick={handleSaveGoal}>
                  {t("common.save")}
                </button>
              </div>
            ) : (
              <div className="stats-goal-ring-display">
                <svg width="120" height="120" viewBox="0 0 120 120" className="stats-goal-svg">
                  <circle cx="60" cy="60" r="48" fill="none" stroke="var(--color-bg-tertiary)" strokeWidth="10" />
                  <circle
                    cx="60"
                    cy="60"
                    r="48"
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 48}
                    strokeDashoffset={(2 * Math.PI * 48) - (goalPct / 100) * (2 * Math.PI * 48)}
                    transform="rotate(-90 60 60)"
                    style={{ transition: "stroke-dashoffset 400ms ease" }}
                  />
                  <text x="60" y="55" textAnchor="middle" className="stats-goal-pct-text">
                    {goalPct}%
                  </text>
                  <text x="60" y="74" textAnchor="middle" className="stats-goal-sub-text">
                    {formatHours(monthToDate)}
                  </text>
                </svg>

                {goalPace && (
                  <span className={`stats-goal-pace-pill ${goalPace.diffMin > 0 ? "ahead" : goalPace.diffMin < 0 ? "behind" : "on"}`}>
                    {goalPace.diffMin > 0
                      ? t("communityExtras.goalAhead", { time: formatHours(goalPace.diffMin) })
                      : goalPace.diffMin < 0
                      ? t("communityExtras.goalBehind", { time: formatHours(-goalPace.diffMin) })
                      : t("communityExtras.goalOnPace")}
                  </span>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ── Top Played Games: Podium & Ranked List ────────────────── */}
      <section className="stats-section">
        <h2 className="stats-section-title">{t("community.mostPlayedGames")}</h2>

        {top3.length > 0 ? (
          <>
            {/* Top 3 Podium */}
            <div className="stats-podium-grid">
              {top3.map((g, idx) => {
                const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                const rankClass = idx === 0 ? "gold" : idx === 1 ? "silver" : "bronze";
                return (
                  <div
                    key={g.gameId}
                    className={`stats-podium-card stats-podium-${rankClass}`}
                    onClick={() => navigate(`/library/${g.gameId}`)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="stats-podium-rank-badge">{medal} #{idx + 1}</div>
                    <div className="stats-podium-cover">
                      {g.coverArtUrl ? (
                        <img src={g.coverArtUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="stats-podium-cover-fallback">🎮</div>
                      )}
                    </div>
                    <div className="stats-podium-meta">
                      <span className="stats-podium-name" title={g.gameName}>{g.gameName}</span>
                      <span className="stats-podium-time">{formatHours(g.minutes)}</span>
                      <div className="stats-podium-sub">
                        <span>{t("gameActivity.sessionCount", { count: g.sessions, s: g.sessions !== 1 ? "s" : "" })}</span>
                        {g.platform && <span>· {g.platform}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Remaining Top 4-10 list */}
            {remainingTop.length > 0 && (
              <Card variant="surface" elevation="1" className="stats-ranked-list-card">
                <ol className="stats-ranked-list">
                  {remainingTop.map((g, i) => (
                    <li
                      key={g.gameId}
                      className="stats-ranked-row"
                      onClick={() => navigate(`/library/${g.gameId}`)}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="stats-ranked-pos">#{i + 4}</span>
                      <div className="stats-ranked-cover">
                        {g.coverArtUrl ? (
                          <img src={g.coverArtUrl} alt="" loading="lazy" />
                        ) : (
                          <div className="stats-ranked-cover-fallback">🎮</div>
                        )}
                      </div>
                      <div className="stats-ranked-info">
                        <div className="stats-ranked-title-row">
                          <span className="stats-ranked-title" title={g.gameName}>{g.gameName}</span>
                          <span className="stats-ranked-hours">{formatHours(g.minutes)}</span>
                        </div>
                        <div className="stats-ranked-track">
                          <div className="stats-ranked-fill" style={{ width: `${g.pct}%` }} />
                        </div>
                        <div className="stats-ranked-meta-row">
                          {g.platform && <span>{g.platform}</span>}
                          <span>{t("gameActivity.sessionCount", { count: g.sessions, s: g.sessions !== 1 ? "s" : "" })}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </>
        ) : (
          <Card variant="surface" elevation="1" className="stats-empty-card">
            <p>{t("community.emptyMostPlayed")}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
