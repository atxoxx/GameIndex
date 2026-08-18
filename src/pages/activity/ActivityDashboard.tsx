import { useMemo, useState } from "react";
import { formatPlayTime, type Game, type GameSession } from "../../types/game";
import BarChart from "../../components/charts/BarChart";
import LineChart from "../../components/charts/LineChart";
import DonutChart from "../../components/charts/DonutChart";
import { GameThumbnail } from "./GameThumbnail";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useLanguage } from "../../context/LanguageContext";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import {
  StatBand,
  StatCell,
  RecordsStrip,
  Milestones,
  WeeklyHeatmap,
  buildPeriodComparison,
  buildRecords,
  buildMilestoneLadders,
  filterSessionsBySource,
  rangeDays,
  type DateRangeKey,
} from "../../components/activity";
import * as Icons from "./Icons";

export interface ActivityDashboardProps {
  sessions: GameSession[];
  games: Game[];
  dateRange: DateRangeKey;
  startDate: string;
  endDate: string;
  aggregation: "day" | "week" | "month";
  chartType: "bar" | "line";
  sourceFilter: string;
  onDeleteGameSessions: (gameId: string) => void;
}

export function ActivityDashboard({
  sessions,
  games,
  dateRange,
  startDate,
  endDate,
  aggregation,
  chartType,
  sourceFilter,
  onDeleteGameSessions,
}: ActivityDashboardProps) {
  const { t, language } = useLanguage();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDeleteGameId, setPendingDeleteGameId] = useState<string | null>(null);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const d = s.date.slice(0, 10);
      const inRange = d >= startDate && d <= endDate;
      if (!inRange) return false;
      if (sourceFilter === "all") return true;
      const game = games.find((g) => g.id === s.gameId);
      return (game?.platform || "Local").toLowerCase() === sourceFilter.toLowerCase();
    });
  }, [sessions, games, startDate, endDate, sourceFilter]);

  const gameIsolatedSessions = useMemo(() => {
    if (!selectedGameId) return filteredSessions;
    return filteredSessions.filter((s) => s.gameId === selectedGameId);
  }, [filteredSessions, selectedGameId]);

  const sidebarGamesList = useMemo(() => {
    const gamePlaytimes = new Map<string, number>();
    const gameNames = new Map<string, string>();
    filteredSessions.forEach((s) => {
      gamePlaytimes.set(s.gameId, (gamePlaytimes.get(s.gameId) || 0) + s.durationMin);
      if (!gameNames.has(s.gameId) && s.gameName) gameNames.set(s.gameId, s.gameName);
    });

    return Array.from(gamePlaytimes.entries())
      .map(([gameId, minutes]) => {
        const game = games.find((g) => g.id === gameId);
        return {
          id: gameId,
          title: game?.name || gameNames.get(gameId) || t("activityDash.unknownGame"),
          platform: game?.platform || "Local",
          iconUrl: game?.iconUrl || null,
          coverArtUrl: game?.coverArtUrl || null,
          steamAppId: game?.steamAppId || null,
          minutes,
        };
      })
      .sort((a, b) => b.minutes - a.minutes);
  }, [filteredSessions, games, t]);

  const filteredSidebarGames = useMemo(() => {
    if (!searchQuery.trim()) return sidebarGamesList;
    const q = searchQuery.toLowerCase();
    return sidebarGamesList.filter((g) => g.title.toLowerCase().includes(q));
  }, [sidebarGamesList, searchQuery]);

  const maxSidebarMinutes = useMemo(() => {
    return sidebarGamesList.reduce((max, g) => Math.max(max, g.minutes), 0) || 1;
  }, [sidebarGamesList]);

  const totalPlaytimeMinutes = useMemo(() => {
    return sidebarGamesList.reduce((sum, g) => sum + g.minutes, 0);
  }, [sidebarGamesList]);

  const stats = useMemo(() => {
    const totalMin = Math.round(gameIsolatedSessions.reduce((sum, s) => sum + s.durationMin, 0));
    const gamesPlayedCount = new Set(gameIsolatedSessions.map((s) => s.gameId)).size;
    const totalSessCount = gameIsolatedSessions.length;

    let numDays = rangeDays(dateRange);
    if (dateRange === "all") {
      if (sessions.length > 0) {
        const oldest = new Date(sessions[sessions.length - 1].date);
        numDays = Math.max(1, Math.ceil((Date.now() - oldest.getTime()) / 86_400_000));
      } else {
        numDays = 1;
      }
    }
    const avgPerDayMin = Math.round(totalMin / numDays);

    const dates = new Set(sessions.map((s) => s.date.slice(0, 10)));
    const sortedDates = Array.from(dates).sort();
    let longestStreak = 0;
    let currentStreak = 0;
    let prevTime: number | null = null;
    for (const dStr of sortedDates) {
      const curTime = new Date(dStr + "T00:00:00").getTime();
      if (prevTime === null) {
        currentStreak = 1;
      } else if (curTime - prevTime === 86_400_000) {
        currentStreak++;
      } else if (curTime - prevTime > 86_400_000) {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
      prevTime = curTime;
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    return {
      playtimeStr: formatPlayTime(totalMin),
      gamesPlayed: gamesPlayedCount,
      avgPerDayStr: formatPlayTime(avgPerDayMin),
      sessionsCount: totalSessCount,
      longestStreak: longestStreak > 0 ? `${longestStreak}d` : "—",
    };
  }, [gameIsolatedSessions, dateRange, sessions]);

  const comparison = useMemo(() => {
    if (selectedGameId) return null;
    const sourceSessions = filterSessionsBySource(sessions, games, sourceFilter);
    return buildPeriodComparison(sourceSessions, dateRange);
  }, [sessions, games, sourceFilter, dateRange, selectedGameId]);

  const records = useMemo(
    () => buildRecords({ sessions: filteredSessions, games, language, scope: "all" }),
    [filteredSessions, games, language],
  );

  const milestones = useMemo(() => buildMilestoneLadders(sessions, "all"), [sessions]);

  const heatmapDays = useMemo(() => {
    return dateRange === "all" ? 365 : rangeDays(dateRange);
  }, [dateRange]);

  const chartPoints = useMemo(() => {
    const dayMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const d = s.date.slice(0, 10);
      dayMap.set(d, (dayMap.get(d) || 0) + s.durationMin);
    });

    const points: { label: string; date: string; value: number }[] = [];
    const end = new Date(endDate + "T00:00:00");
    const cursor = new Date(startDate + "T00:00:00");

    if (aggregation === "day") {
      while (cursor <= end) {
        const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
        const mins = dayMap.get(dateStr) ?? 0;
        points.push({ label: dateStr.slice(5), date: dateStr, value: Math.round((mins / 60) * 10) / 10 });
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (aggregation === "week") {
      const weeklyMap = new Map<string, number>();
      for (const [dStr, mins] of dayMap.entries()) {
        const date = new Date(dStr + "T00:00:00");
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        const wKey = `${startOfWeek.getFullYear()}-${String(startOfWeek.getMonth() + 1).padStart(2, "0")}-${String(startOfWeek.getDate()).padStart(2, "0")}`;
        weeklyMap.set(wKey, (weeklyMap.get(wKey) || 0) + mins);
      }
      const cursorWeek = new Date(startDate + "T00:00:00");
      cursorWeek.setDate(cursorWeek.getDate() - cursorWeek.getDay());
      while (cursorWeek <= end) {
        const wKey = `${cursorWeek.getFullYear()}-${String(cursorWeek.getMonth() + 1).padStart(2, "0")}-${String(cursorWeek.getDate()).padStart(2, "0")}`;
        const mins = weeklyMap.get(wKey) ?? 0;
        points.push({ label: wKey.slice(5), date: wKey, value: Math.round((mins / 60) * 10) / 10 });
        cursorWeek.setDate(cursorWeek.getDate() + 7);
      }
    } else {
      const monthlyMap = new Map<string, number>();
      for (const [dStr, mins] of dayMap.entries()) {
        const mKey = dStr.slice(0, 7);
        monthlyMap.set(mKey, (monthlyMap.get(mKey) || 0) + mins);
      }
      const startMonth = new Date(startDate + "T00:00:00");
      const endMonth = new Date(endDate + "T00:00:00");
      const cursorMonth = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
      while (cursorMonth <= endMonth) {
        const mKey = `${cursorMonth.getFullYear()}-${String(cursorMonth.getMonth() + 1).padStart(2, "0")}`;
        const mins = monthlyMap.get(mKey) ?? 0;
        points.push({
          label: cursorMonth.toLocaleDateString(language, { month: "short", year: "2-digit" }),
          date: mKey,
          value: Math.round((mins / 60) * 10) / 10,
        });
        cursorMonth.setMonth(cursorMonth.getMonth() + 1);
      }
    }

    return points;
  }, [gameIsolatedSessions, aggregation, startDate, endDate, language]);

  const chartData = useMemo(() => chartPoints.map((p) => p.value), [chartPoints]);
  const chartLabels = useMemo(() => chartPoints.map((p) => p.label), [chartPoints]);

  const platformBreakdownSlices = useMemo(() => {
    const platformMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const game = games.find((g) => g.id === s.gameId);
      const plat = game?.platform || "Local";
      platformMap.set(plat, (platformMap.get(plat) || 0) + s.durationMin);
    });
    return Array.from(platformMap.entries()).map(([label, mins]) => ({
      label,
      value: Math.round((mins / 60) * 10) / 10,
      color: "",
    }));
  }, [gameIsolatedSessions, games]);

  const genreBreakdownSlices = useMemo(() => {
    const genreMap = new Map<string, number>();
    gameIsolatedSessions.forEach((s) => {
      const game = games.find((g) => g.id === s.gameId);
      if (game?.genres && game.genres.length > 0) {
        game.genres.forEach((genre: string) => genreMap.set(genre, (genreMap.get(genre) || 0) + s.durationMin));
      } else {
        genreMap.set(t("splash.unknown"), (genreMap.get(t("splash.unknown")) || 0) + s.durationMin);
      }
    });
    return Array.from(genreMap.entries())
      .map(([label, mins]) => ({ label, value: Math.round((mins / 60) * 10) / 10, color: "" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [gameIsolatedSessions, games, t]);

  const selectedGame = useMemo(() => {
    if (!selectedGameId) return null;
    return games.find((g) => g.id === selectedGameId) || null;
  }, [selectedGameId, games]);

  return (
    <div className="activity__content">
      <StatBand>
        <StatCell
          hero
          icon={<Icons.Clock size={15} />}
          label={t("activityDash.totalPlaytime")}
          value={stats.playtimeStr}
          delta={comparison?.playtime}
        />
        <StatCell
          icon={<Icons.Gamepad2 size={15} />}
          label={t("activityDash.gamesPlayed")}
          value={stats.gamesPlayed}
          delta={comparison?.games}
        />
        <StatCell
          icon={<Icons.TrendingUp size={15} />}
          label={t("activityDash.averagePerDay")}
          value={stats.avgPerDayStr}
          delta={comparison?.playtime}
        />
        <StatCell
          icon={<Icons.Calendar size={15} />}
          label={t("activityDash.sessions")}
          value={stats.sessionsCount}
          delta={comparison?.sessions}
        />
        <StatCell
          icon={<Icons.Zap size={15} />}
          label={t("activityDash.longestStreak")}
          value={stats.longestStreak}
        />
      </StatBand>

      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      <div className="activity__dashboard-layout">
        <aside className="activity-game-sidebar">
          <div className="activity-game-sidebar__header">
            <h3 className="activity-game-sidebar__title">
              <Icons.LayoutDashboard size={14} />
              {t("activityDash.games")}
            </h3>
            <span className="activity-game-sidebar__count">{sidebarGamesList.length}</span>
          </div>

          <div className="activity-game-sidebar__summary">
            <span className="activity-game-sidebar__summary-label">{t("activityDash.totalPlaytime")}</span>
            <span className="activity-game-sidebar__summary-value">{formatPlayTime(totalPlaytimeMinutes)}</span>
          </div>

          <div className="activity-game-sidebar__search">
            <Icons.Search size={13} className="activity-game-sidebar__search-icon" />
            <input
              type="text"
              className="activity-game-sidebar__search-input"
              placeholder={t("activityDash.searchGames")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="activity-game-sidebar__list">
            <button
              type="button"
              className={`activity-game-sidebar__item activity-game-sidebar__item--all ${
                selectedGameId === null ? "activity-game-sidebar__item--selected" : ""
              }`}
              onClick={() => setSelectedGameId(null)}
            >
              <span className="activity-game-sidebar__all-icon">
                <Icons.LayoutDashboard size={15} />
              </span>
              <div className="activity-game-sidebar__info">
                <span className="activity-game-sidebar__name">{t("activityPerf.allGames")}</span>
              </div>
              <span className="activity-game-sidebar__time">{sidebarGamesList.length}</span>
            </button>

            {filteredSidebarGames.map((g) => {
              const fullGame = games.find((gm) => gm.id === g.id) ?? null;
              return (
                <ActivitySidebarGameButton
                  key={g.id}
                  summary={g}
                  game={fullGame}
                  selected={selectedGameId === g.id}
                  maxMinutes={maxSidebarMinutes}
                  onSelect={setSelectedGameId}
                  onRequestDelete={setPendingDeleteGameId}
                />
              );
            })}

            {filteredSidebarGames.length === 0 && (
              <div className="activity-game-sidebar__empty">{t("activityDash.noGames")}</div>
            )}
          </div>
        </aside>

        <div className="activity__dashboard-main">
          <div className="activity-main-chart">
            <div className="activity-main-chart__header">
              <div className="activity-main-chart__header-left">
                <h3 className="activity-main-chart__title">
                  {selectedGame
                    ? selectedGame.name
                    : selectedGameId
                      ? gameIsolatedSessions[0]?.gameName || t("game.tab.overview")
                      : t("game.tab.overview")}
                </h3>
              </div>
              <span className="activity-main-chart__subtitle">{stats.playtimeStr}</span>
            </div>

            <div className="activity-main-chart__body">
              {chartData.length === 0 ? (
                <div className="activity-empty">
                  <div className="activity-empty__icon">
                    <Icons.BarChart3 size={24} />
                  </div>
                  <div className="activity-empty__title">{t("activityDash.noActivity")}</div>
                  <div className="activity-empty__hint">{t("activity.emptyRangeHint")}</div>
                </div>
              ) : chartType === "bar" ? (
                <BarChart
                  data={chartData}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={240}
                  color="var(--color-brand-teal)"
                />
              ) : (
                <LineChart
                  series={[{ data: chartData, color: "var(--color-brand-teal)", label: t("activityDash.playtimeHours") }]}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={240}
                  legend={false}
                />
              )}
            </div>
          </div>

          {!selectedGameId && (
            <>
              <div className="activity__two-column">
                <div className="section-panel">
                  <h3 className="section-panel__title">{t("activityDash.platformBreakdown")}</h3>
                  {platformBreakdownSlices.length === 0 ? (
                    <div className="activity-empty activity-empty--compact">
                      <div className="activity-empty__icon">
                        <Icons.Gamepad2 size={18} />
                      </div>
                      <div className="activity-empty__title">{t("activityDash.noPlatformData")}</div>
                    </div>
                  ) : (
                    <div className="platform-breakdown__content">
                      <DonutChart slices={platformBreakdownSlices} size={150} formatValue={(v) => `${Math.round(v * 10) / 10}h`} />
                    </div>
                  )}
                </div>

                <div className="section-panel">
                  <h3 className="section-panel__title">{t("activityDash.playtimeByGenre")}</h3>
                  {genreBreakdownSlices.length === 0 ? (
                    <div className="activity-empty activity-empty--compact">
                      <div className="activity-empty__icon">
                        <Icons.LayoutDashboard size={18} />
                      </div>
                      <div className="activity-empty__title">{t("activityDash.noGenreData")}</div>
                    </div>
                  ) : (
                    <div className="genre-breakdown__content">
                      <DonutChart slices={genreBreakdownSlices} size={150} formatValue={(v) => `${Math.round(v * 10) / 10}h`} />
                    </div>
                  )}
                </div>
              </div>

              <div className="section-panel">
                <h3 className="section-panel__title">{t("activityDash.weeklyHeatmap")}</h3>
                <WeeklyHeatmap sessions={filteredSessions} timeframeDays={heatmapDays} />
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={pendingDeleteGameId !== null}
        title={t("activityDash.deleteEntryTitle")}
        message={t("activityDash.deleteEntryBody", {
          name: sidebarGamesList.find((g) => g.id === pendingDeleteGameId)?.title ?? "",
        })}
        confirmLabel={t("activityDash.deleteEntry")}
        onCancel={() => setPendingDeleteGameId(null)}
        onConfirm={() => {
          if (pendingDeleteGameId) {
            onDeleteGameSessions(pendingDeleteGameId);
            if (selectedGameId === pendingDeleteGameId) setSelectedGameId(null);
          }
          setPendingDeleteGameId(null);
        }}
      />
    </div>
  );
}

function ActivitySidebarGameButton({
  summary,
  game,
  selected,
  maxMinutes,
  onSelect,
  onRequestDelete,
}: {
  summary: {
    id: string;
    title: string;
    platform: string;
    iconUrl: string | null;
    coverArtUrl: string | null;
    steamAppId: number | null;
    minutes: number;
  };
  game: Game | null;
  selected: boolean;
  maxMinutes: number;
  onSelect: (id: string) => void;
  onRequestDelete: (gameId: string) => void;
}) {
  const { t } = useLanguage();
  const { appId: resolvedSteamAppId } = useSteamAppId(game);
  const steamAppId =
    typeof resolvedSteamAppId === "number"
      ? resolvedSteamAppId
      : summary.steamAppId ?? game?.steamAppId ?? null;

  const barWidth = maxMinutes > 0 ? (summary.minutes / maxMinutes) * 100 : 0;

  return (
    <div className="activity-game-sidebar__row">
      <button
        type="button"
        className={`activity-game-sidebar__item ${
          selected ? "activity-game-sidebar__item--selected" : ""
        }`}
        onClick={() => onSelect(summary.id)}
      >
        <div className="activity-game-sidebar__icon-wrapper">
          <GameThumbnail
            iconUrl={summary.iconUrl}
            coverArtUrl={summary.coverArtUrl}
            steamAppId={steamAppId}
            name={summary.title}
            className="activity-game-sidebar__icon"
          />
        </div>
        <div className="activity-game-sidebar__info">
          <span className="activity-game-sidebar__name">{summary.title}</span>
          <div className="activity-game-sidebar__bar">
            <div className="activity-game-sidebar__bar-fill" style={{ width: `${barWidth}%` }} />
          </div>
        </div>
        <span className="activity-game-sidebar__time">{formatPlayTime(summary.minutes)}</span>
      </button>
      <button
        type="button"
        className="activity-game-sidebar__delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRequestDelete(summary.id);
        }}
        title={t("activityDash.deleteEntry")}
        aria-label={t("activityDash.deleteEntry")}
      >
        <Icons.Trash2 size={13} />
      </button>
    </div>
  );
}
