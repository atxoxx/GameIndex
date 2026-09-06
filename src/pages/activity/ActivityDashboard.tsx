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
  TimeOfDayDistribution,
  SessionLengthDistribution,
  DayOfWeekDistribution,
  BacklogCompletionHub,
  GamerPersonaCard,
  TimeToBeatProgress,
  LinkGameModal,
  AddActivityGameModal,
  buildPeriodComparison,
  buildRecords,
  buildMilestoneLadders,
  buildTimeOfDayDistribution,
  buildSessionLengthDistribution,
  buildDayOfWeekDistribution,
  buildCumulativeSeries,
  buildGamerPersona,
  buildGameCompletionProgress,
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
  onLaunchGame?: (game: Game) => void;
}

type SidebarSort = "playtime" | "name" | "sessions";
type ChartMode = "periodic" | "cumulative";

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
  onLaunchGame,
}: ActivityDashboardProps) {
  const { t, language } = useLanguage();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarSort, setSidebarSort] = useState<SidebarSort>("playtime");
  const [chartMode, setChartMode] = useState<ChartMode>("periodic");
  const [pendingDeleteGameId, setPendingDeleteGameId] = useState<string | null>(null);
  const [linkModalTarget, setLinkModalTarget] = useState<{ id: string; title: string } | null>(null);
  const [addModalTarget, setAddModalTarget] = useState<{ id: string; title: string } | null>(null);

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
    const gameSessionsCount = new Map<string, number>();

    filteredSessions.forEach((s) => {
      gamePlaytimes.set(s.gameId, (gamePlaytimes.get(s.gameId) || 0) + s.durationMin);
      gameSessionsCount.set(s.gameId, (gameSessionsCount.get(s.gameId) || 0) + 1);
      if (!gameNames.has(s.gameId) && s.gameName) gameNames.set(s.gameId, s.gameName);
    });

    const list = Array.from(gamePlaytimes.entries()).map(([gameId, minutes]) => {
      const game = games.find((g) => g.id === gameId);
      return {
        id: gameId,
        title: game?.name || gameNames.get(gameId) || t("activityDash.unknownGame"),
        platform: game?.platform || "Local",
        iconUrl: game?.iconUrl || null,
        coverArtUrl: game?.coverArtUrl || null,
        steamAppId: game?.steamAppId || null,
        minutes,
        sessionsCount: gameSessionsCount.get(gameId) || 1,
      };
    });

    return list.sort((a, b) => {
      if (sidebarSort === "name") {
        return a.title.localeCompare(b.title);
      }
      if (sidebarSort === "sessions") {
        return b.sessionsCount - a.sessionsCount;
      }
      return b.minutes - a.minutes;
    });
  }, [filteredSessions, games, sidebarSort, t]);

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
    () =>
      buildRecords({
        sessions: gameIsolatedSessions,
        games,
        language,
        scope: selectedGameId ? "game" : "all",
      }),
    [gameIsolatedSessions, games, language, selectedGameId],
  );

  const milestones = useMemo(
    () => buildMilestoneLadders(gameIsolatedSessions, selectedGameId ? "game" : "all"),
    [gameIsolatedSessions, selectedGameId],
  );

  const gamerPersona = useMemo(() => {
    return buildGamerPersona(filteredSessions, games);
  }, [filteredSessions, games]);

  const timeOfDayDist = useMemo(() => {
    return buildTimeOfDayDistribution(gameIsolatedSessions);
  }, [gameIsolatedSessions]);

  const sessionLengthDist = useMemo(() => {
    return buildSessionLengthDistribution(gameIsolatedSessions);
  }, [gameIsolatedSessions]);

  const dayOfWeekDist = useMemo(() => {
    return buildDayOfWeekDistribution(gameIsolatedSessions);
  }, [gameIsolatedSessions]);

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

  const cumulativeSeries = useMemo(() => {
    return buildCumulativeSeries(gameIsolatedSessions, startDate, endDate, aggregation, language);
  }, [gameIsolatedSessions, startDate, endDate, aggregation, language]);

  const chartData = useMemo(() => {
    return chartMode === "cumulative"
      ? cumulativeSeries.map((p) => p.cumulativeHours)
      : chartPoints.map((p) => p.value);
  }, [chartMode, cumulativeSeries, chartPoints]);

  const chartLabels = useMemo(() => {
    return chartMode === "cumulative"
      ? cumulativeSeries.map((p) => p.label)
      : chartPoints.map((p) => p.label);
  }, [chartMode, cumulativeSeries, chartPoints]);

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
        game.genres.forEach((genre: string) =>
          genreMap.set(genre, (genreMap.get(genre) || 0) + s.durationMin),
        );
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

  const selectedGameCompletion = useMemo(() => {
    if (!selectedGame) return null;
    const totalMinutesForGame = sessions
      .filter((s) => s.gameId === selectedGame.id)
      .reduce((sum, s) => sum + s.durationMin, 0);
    return buildGameCompletionProgress(totalMinutesForGame, selectedGame.timeToBeat);
  }, [selectedGame, sessions]);

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

      {!selectedGameId && (
        <div className="activity__persona-container">
          <GamerPersonaCard persona={gamerPersona} />
        </div>
      )}

      <RecordsStrip records={records} />
      <Milestones ladders={milestones} />

      <div className="activity__dashboard-layout">
        <aside className="activity-game-sidebar">
          <div className="activity-game-sidebar__header">
            <h3 className="activity-game-sidebar__title">
              <Icons.LayoutDashboard size={14} />
              {t("activityDash.games")}
            </h3>
            <div className="activity-game-sidebar__sort-group">
              <button
                type="button"
                className={`activity-game-sidebar__sort-btn ${sidebarSort === "playtime" ? "active" : ""}`}
                onClick={() => setSidebarSort("playtime")}
                title={t("activityDash.sortByPlaytime")}
              >
                <Icons.Clock size={12} />
              </button>
              <button
                type="button"
                className={`activity-game-sidebar__sort-btn ${sidebarSort === "sessions" ? "active" : ""}`}
                onClick={() => setSidebarSort("sessions")}
                title={t("activityDash.sortBySessions")}
              >
                <Icons.Calendar size={12} />
              </button>
              <button
                type="button"
                className={`activity-game-sidebar__sort-btn ${sidebarSort === "name" ? "active" : ""}`}
                onClick={() => setSidebarSort("name")}
                title={t("activityDash.sortByName")}
              >
                <Icons.ArrowUpDown size={12} />
              </button>
            </div>
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
                  onRequestLink={(id, title) => setLinkModalTarget({ id, title })}
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
                {selectedGameId && (
                  <button
                    type="button"
                    className="activity-main-chart__clear-btn"
                    onClick={() => setSelectedGameId(null)}
                  >
                    <Icons.X size={12} /> {t("activityDash.showAllGames")}
                  </button>
                )}
                {selectedGame && onLaunchGame && (
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                    onClick={() => onLaunchGame(selectedGame)}
                  >
                    <Icons.Play size={11} /> {t("game.play")}
                  </button>
                )}
                {selectedGameId && !selectedGame && (
                  <>
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--secondary act-inspector-btn--sm"
                      onClick={() => {
                        const title =
                          gameIsolatedSessions[0]?.gameName ||
                          sidebarGamesList.find((g) => g.id === selectedGameId)?.title ||
                          t("activityDash.unknownGame");
                        setLinkModalTarget({ id: selectedGameId, title });
                      }}
                      title={t("activity.linkToLibrary")}
                    >
                      <Icons.Link2 size={11} /> {t("activity.linkToLibrary")}
                    </button>
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--primary act-inspector-btn--sm"
                      onClick={() => {
                        const title =
                          gameIsolatedSessions[0]?.gameName ||
                          sidebarGamesList.find((g) => g.id === selectedGameId)?.title ||
                          t("activityDash.unknownGame");
                        setAddModalTarget({ id: selectedGameId, title });
                      }}
                      title={t("activity.addToLibrary")}
                    >
                      <Icons.Plus size={11} /> {t("activity.addToLibrary")}
                    </button>
                  </>
                )}
              </div>
              <div className="activity-main-chart__header-tools">
                <div className="act-chart-mode-toggle">
                  <button
                    type="button"
                    className={`act-chart-mode-btn ${chartMode === "periodic" ? "active" : ""}`}
                    onClick={() => setChartMode("periodic")}
                  >
                    {t("activityDash.modePeriodic")}
                  </button>
                  <button
                    type="button"
                    className={`act-chart-mode-btn ${chartMode === "cumulative" ? "active" : ""}`}
                    onClick={() => setChartMode("cumulative")}
                  >
                    {t("activityDash.modeCumulative")}
                  </button>
                </div>
                <span className="activity-main-chart__subtitle">{stats.playtimeStr}</span>
              </div>
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
              ) : chartMode === "cumulative" || chartType === "line" ? (
                <LineChart
                  series={[
                    {
                      data: chartData,
                      color: "var(--color-brand-teal)",
                      label: chartMode === "cumulative" ? t("activityDash.cumulativeHours") : t("activityDash.playtimeHours"),
                    },
                  ]}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={240}
                  legend={false}
                  smooth
                />
              ) : (
                <BarChart
                  data={chartData}
                  labels={chartLabels}
                  formatValue={(v) => `${v}h`}
                  height={240}
                  color="var(--color-brand-teal)"
                />
              )}
            </div>
          </div>

          {selectedGame && selectedGameCompletion?.hasTimeToBeat && (
            <div className="section-panel">
              <TimeToBeatProgress progress={selectedGameCompletion} />
            </div>
          )}

          <div className="activity__two-column">
            <div className="section-panel">
              <h3 className="section-panel__title">
                <Icons.Clock size={14} /> {t("activityInsights.timeOfDayTitle")}
              </h3>
              <TimeOfDayDistribution distribution={timeOfDayDist} compact={Boolean(selectedGameId)} />
            </div>

            <div className="section-panel">
              <h3 className="section-panel__title">
                <Icons.Target size={14} /> {t("activityInsights.sessionLengthsTitle")}
              </h3>
              <SessionLengthDistribution
                buckets={sessionLengthDist.buckets}
                averageMinutes={sessionLengthDist.averageMinutes}
                longestMinutes={sessionLengthDist.longestMinutes}
                totalSessions={sessionLengthDist.totalSessions}
              />
            </div>
          </div>

          <div className="section-panel">
            <h3 className="section-panel__title">
              <Icons.Calendar size={14} /> {t("activityInsights.dayOfWeekTitle")}
            </h3>
            <DayOfWeekDistribution distribution={dayOfWeekDist} compact={Boolean(selectedGameId)} />
          </div>

          {!selectedGameId && (
            <>
              <BacklogCompletionHub
                games={games}
                sessions={sessions}
                onLaunchGame={onLaunchGame}
              />
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
                      <DonutChart
                        slices={platformBreakdownSlices}
                        size={150}
                        formatValue={(v) => `${Math.round(v * 10) / 10}h`}
                      />
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
                      <DonutChart
                        slices={genreBreakdownSlices}
                        size={150}
                        formatValue={(v) => `${Math.round(v * 10) / 10}h`}
                      />
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

      {linkModalTarget && (
        <LinkGameModal
          isOpen={true}
          onClose={() => setLinkModalTarget(null)}
          unlinkedGameId={linkModalTarget.id}
          unlinkedGameTitle={linkModalTarget.title}
          games={games}
          onLinked={(targetGame) => {
            setSelectedGameId(targetGame.id);
            setLinkModalTarget(null);
          }}
        />
      )}

      {addModalTarget && (
        <AddActivityGameModal
          isOpen={true}
          onClose={() => setAddModalTarget(null)}
          unlinkedGameId={addModalTarget.id}
          unlinkedGameTitle={addModalTarget.title}
          onAdded={(newGame) => {
            setSelectedGameId(newGame.id);
            setAddModalTarget(null);
          }}
        />
      )}
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
  onRequestLink,
}: {
  summary: {
    id: string;
    title: string;
    platform: string;
    iconUrl: string | null;
    coverArtUrl: string | null;
    steamAppId: number | null;
    minutes: number;
    sessionsCount: number;
  };
  game: Game | null;
  selected: boolean;
  maxMinutes: number;
  onSelect: (id: string) => void;
  onRequestDelete: (gameId: string) => void;
  onRequestLink?: (gameId: string, gameTitle: string) => void;
}) {
  const { t } = useLanguage();
  const { appId: resolvedSteamAppId } = useSteamAppId(game);
  const steamAppId =
    typeof resolvedSteamAppId === "number"
      ? resolvedSteamAppId
      : summary.steamAppId ?? game?.steamAppId ?? null;

  const barWidth = maxMinutes > 0 ? (summary.minutes / maxMinutes) * 100 : 0;

  return (
    <div className={`activity-game-sidebar__row ${!game ? "activity-game-sidebar__row--unlinked" : ""}`}>
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
        <div className="activity-game-sidebar__meta-right">
          <span className="activity-game-sidebar__time">{formatPlayTime(summary.minutes)}</span>
          <span className="activity-game-sidebar__sessions-tag">
            {summary.sessionsCount} {summary.sessionsCount === 1 ? t("activity.sessionOne") : t("activity.sessionsMany")}
          </span>
        </div>
      </button>

      <div className="activity-game-sidebar__actions">
        {!game && onRequestLink && (
          <button
            type="button"
            className="activity-game-sidebar__action-btn activity-game-sidebar__link-btn"
            onClick={(e) => {
              e.stopPropagation();
              onRequestLink(summary.id, summary.title);
            }}
            title={t("activity.linkToLibrary")}
            aria-label={t("activity.linkToLibrary")}
          >
            <Icons.Link2 size={13} />
          </button>
        )}
        <button
          type="button"
          className="activity-game-sidebar__action-btn activity-game-sidebar__delete-btn"
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
    </div>
  );
}
