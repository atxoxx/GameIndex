import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  BarChart3,
  Calendar,
  Clock,
  Gamepad2,
  History,
  LayoutDashboard,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { useActivity } from "../../context/ActivityContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useToast } from "../../context/ToastContext";
import {
  formatPlayTime,
  gameDisplayName,
  parsePlayTime,
  type Game,
  type GameSession,
} from "../../types/game";
import {
  GameTabEmpty,
  GameTabShell,
  GameTabToolbar,
  GameTabViewSwitch,
  useGameTabState,
} from "./tabs";
import { ConfirmModal, Button, type StatBandItem } from "../ui";
import { ActivityActions } from "../activity/ActivityActions";
import { ActivityRecapDrawer } from "../activity/ActivityRecapDrawer";
import { ActivityScopeBar } from "../activity/ActivityScopeBar";
import { ActivitySessionList } from "../activity/ActivitySessionList";
import { ManualSessionModal } from "../activity/ManualSessionModal";
import {
  ACTIVITY_RANGE_KEYS,
  filterSessionsToRange,
  formatRangeLabel,
  localDayKey,
  rangeDayCount,
  resolveActivityRange,
  type ActivityRangeKey,
} from "../../utils/activity/range";
import {
  DURATION_FILTERS,
  SESSION_DENSITIES,
  SESSION_SORT_FIELDS,
  SORT_DIRECTIONS,
  TELEMETRY_FILTERS,
  sanitizeSessionFilters,
  type ActivitySessionFilters,
  type DurationFilter,
  type SessionDensity,
  type SessionSortField,
  type SortDirection,
  type TelemetryFilter,
} from "../../utils/activity/sessionQuery";
import {
  currentDayStreak,
  longestDayStreak,
  sessionDayKey,
} from "../../utils/activity/sessionTime";
import { buildActivityRecap } from "../../utils/activity/recap";
import { buildActivitySummaryText } from "../../utils/activity/summary";
import {
  buildActivityCsv,
  buildActivityExportPayload,
  downloadTextFile,
} from "../../utils/activity/export";
import type { PlaytimeAggregation } from "../../utils/activity/chartSeries";
import { recommendedAggregation } from "../../utils/activity/chartSeries";
import type {
  PlaytimeChartMode,
  PlaytimeChartStyle,
} from "../activity/ActivityPlaytimeChart";
import { ActivityPerformance } from "../activity/ActivityPerformance";
import { GameActivityOverviewView } from "./GameActivityOverviewView";
import { GameActivityHabitsView } from "./GameActivityHabitsView";
import "../../styles/activity.css";
import "../../styles/activity-workspace.css";

type GameActivityView = "overview" | "sessions" | "performance" | "habits";

interface GameActivityState {
  view: GameActivityView;
  range: ActivityRangeKey;
  from: string;
  to: string;
  chart: PlaytimeChartStyle;
  agg: PlaytimeAggregation;
  mode: PlaytimeChartMode;
  data: TelemetryFilter;
  dur: DurationFilter;
  sort: SessionSortField;
  dir: SortDirection;
  dens: SessionDensity;
}

const DEFAULTS: GameActivityState = {
  view: "overview",
  range: "30d",
  from: "",
  to: "",
  chart: "bar",
  agg: "day",
  mode: "periodic",
  data: "all",
  dur: "all",
  sort: "date",
  dir: "desc",
  dens: "comfortable",
};

const ALLOWED = {
  view: ["overview", "sessions", "performance", "habits"],
  range: ACTIVITY_RANGE_KEYS,
  chart: ["bar", "line"],
  agg: ["day", "week", "month"],
  mode: ["periodic", "cumulative"],
  data: TELEMETRY_FILTERS,
  dur: DURATION_FILTERS,
  sort: SESSION_SORT_FIELDS,
  dir: SORT_DIRECTIONS,
  dens: SESSION_DENSITIES,
} satisfies Partial<Record<keyof GameActivityState, readonly string[]>>;

const ALL_VIEWS: Array<{ id: GameActivityView; labelKey: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", labelKey: "game.tab.overview", icon: LayoutDashboard },
  { id: "sessions", labelKey: "activity.tab.sessions", icon: History },
  { id: "performance", labelKey: "activity.tab.performance", icon: BarChart3 },
  { id: "habits", labelKey: "activity.tab.habits", icon: Sparkles },
];

/**
 * A game's activity workspace, rebuilt on the same shell and command row as
 * every other detail tab. The range and workspace live in the URL
 * (`?activityView=…&activityRange=…`), so a tab survives a revisit and works
 * in the game-detail popout.
 */
export function GameActivityTab({ game }: { game: Game }) {
  const { getGameSessions, deleteSession } = useActivity();
  const { launchGame } = useGames();
  const { tempUnit, isSimpleUi } = useSettings();
  const { getAllNotes } = useSessionNotes();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const [state, update] = useGameTabState<GameActivityState>({
    prefix: "activity",
    defaults: DEFAULTS,
    allowed: ALLOWED,
  });

  const [manualOpen, setManualOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<GameSession | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);

  const allSessions = useMemo(() => getGameSessions(game.id), [game.id, getGameSessions]);
  const range = useMemo(
    () =>
      resolveActivityRange({
        key: state.range,
        from: state.from,
        to: state.to,
        sessions: allSessions,
      }),
    [state.range, state.from, state.to, allSessions],
  );
  const rangeLabel = useMemo(() => formatRangeLabel(range, language), [range, language]);
  const sessions = useMemo(
    () => filterSessionsToRange(allSessions, range),
    [allSessions, range],
  );

  const filters: ActivitySessionFilters = useMemo(
    () =>
      sanitizeSessionFilters({
        telemetry: state.data,
        duration: state.dur,
        sort: state.sort,
        dir: state.dir,
        density: state.dens,
      }),
    [state.data, state.dur, state.sort, state.dir, state.dens],
  );

  const updateFilters = useCallback(
    (patch: Partial<ActivitySessionFilters>) => {
      update({
        data: patch.telemetry ?? filters.telemetry,
        dur: patch.duration ?? filters.duration,
        sort: patch.sort ?? filters.sort,
        dir: patch.dir ?? filters.dir,
        dens: patch.density ?? filters.density,
      });
    },
    [filters, update],
  );

  const availableViews = useMemo(
    () =>
      (isSimpleUi
        ? ALL_VIEWS.filter((view) => view.id === "overview" || view.id === "sessions")
        : ALL_VIEWS
      ).map((view) => ({ ...view, label: t(view.labelKey) })),
    [isSimpleUi, t],
  );
  const view: GameActivityView = availableViews.some((entry) => entry.id === state.view)
    ? state.view
    : "overview";

  useEffect(() => {
    if (!isSimpleUi) return;
    if (state.view === "performance" || state.view === "habits") {
      update({ view: "overview" });
    }
  }, [isSimpleUi, state.view, update]);

  useEffect(() => {
    const recommended = recommendedAggregation(range);
    const dayCount = rangeDayCount(range);
    const points =
      state.agg === "day"
        ? dayCount
        : state.agg === "week"
          ? Math.ceil(dayCount / 7)
          : Math.ceil(dayCount / 30);
    if ((state.agg === "day" && recommended !== "day") || points < 2) {
      update({ agg: recommended });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.startDate, range.endDate]);

  useEffect(() => {
    if (state.agg === "day" && rangeDayCount(range) > 366) update({ agg: "month" });
  }, [state.agg, range, update]);

  const stats = useMemo(() => {
    const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMin, 0);
    const allTimeMinutes = Math.max(
      game.playTime ? parsePlayTime(game.playTime) : 0,
      allSessions.reduce((sum, session) => sum + session.durationMin, 0),
    );
    return {
      totalMinutes,
      allTimeMinutes,
      sessions: sessions.length,
      avgSession: sessions.length > 0 ? Math.round(totalMinutes / sessions.length) : 0,
      longestSession: sessions.reduce((max, session) => Math.max(max, session.durationMin), 0),
      currentStreak: currentDayStreak(allSessions.map(sessionDayKey)),
      bestStreak: longestDayStreak(allSessions.map(sessionDayKey)),
      activeDays: new Set(sessions.map(sessionDayKey)).size,
    };
  }, [sessions, allSessions, game.playTime, range]);

  const lastPlayed = useMemo(() => {
    if (allSessions.length === 0) return null;
    const latest = allSessions.reduce((max, session) =>
      new Date(session.date).getTime() > new Date(max.date).getTime() ? session : max,
    );
    return new Date(latest.date).toLocaleDateString(language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [allSessions, language]);

  const description = useMemo(() => {
    if (allSessions.length === 0) return t("activityWs.gameTab.emptyDescription");
    return t("activityWs.gameTab.description", {
      sessions: allSessions.length,
      time: formatPlayTime(stats.allTimeMinutes),
      last: lastPlayed ?? "—",
    });
  }, [allSessions.length, lastPlayed, stats.allTimeMinutes, t]);

  const statItems: StatBandItem[] = [
    {
      id: "playtime",
      icon: <Clock size={15} />,
      label: t("activityDash.totalPlaytime"),
      value: formatPlayTime(stats.totalMinutes),
      detail: rangeLabel,
    },
    {
      id: "sessions",
      icon: <Calendar size={15} />,
      label: t("activityDash.sessions"),
      value: stats.sessions,
      detail: t("gameActivity.activeDaysSub", {
        count: stats.activeDays,
        s: stats.activeDays === 1 ? "" : "s",
      }),
    },
    {
      id: "average",
      icon: <Gamepad2 size={15} />,
      label: t("activity.avgSession"),
      value: stats.avgSession > 0 ? formatPlayTime(stats.avgSession) : "—",
      detail: t("gameActivity.perSession"),
    },
    {
      id: "longest",
      icon: <Trophy size={15} />,
      label: t("activity.longestSession"),
      value: stats.longestSession > 0 ? formatPlayTime(stats.longestSession) : "—",
      detail: rangeLabel,
    },
    {
      id: "streak",
      icon: <Zap size={15} />,
      label: t("activity.currentStreak"),
      value: stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—",
      detail:
        stats.bestStreak > 0
          ? t("gameActivity.bestStreakSub", { days: stats.bestStreak })
          : undefined,
    },
  ];

  const exportCsv = useCallback(() => {
    if (sessions.length === 0) {
      showToast(t("activityPage.noSessionsExport"), "info");
      return;
    }
    const csv = buildActivityCsv(sessions, [game], getAllNotes());
    downloadTextFile(
      csv,
      `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_activity_${range.startDate}.csv`,
      "text/csv;charset=utf-8;",
    );
    showToast(t("activity.exportedAs", { format: "CSV" }), "success");
  }, [sessions, game, getAllNotes, range, showToast, t]);

  const exportJson = useCallback(async () => {
    if (sessions.length === 0) {
      showToast(t("activityPage.noSessionsExport"), "info");
      return;
    }
    try {
      const payload = buildActivityExportPayload(sessions, [game], getAllNotes(), range);
      const filePath = await save({
        defaultPath: `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_activity_${range.startDate}.json`,
        filters: [{ name: "JSON File", extensions: ["json"] }],
      });
      if (!filePath) return;
      await invoke("save_text_file", {
        filePath,
        contents: JSON.stringify(payload, null, 2),
      });
      showToast(t("activity.exportedAs", { format: "JSON" }), "success");
    } catch (error) {
      console.error("Game activity JSON export failed:", error);
      showToast(t("activity.exportFailed", { error: String(error) }), "error");
    }
  }, [sessions, game, getAllNotes, range, showToast, t]);

  const capturePage = useCallback(async () => {
    const element = document.querySelector<HTMLElement>(".game-activity-tab");
    if (!element) return;
    try {
      const { captureAndSaveScreenshot } = await import("../../utils/screenshot");
      const filePath = await captureAndSaveScreenshot({
        element,
        fileName: `${game.name}_activity`,
        title: t("gameActivity.saveScreenshot", { game: gameDisplayName(game) }),
        filterLabel: t("activity.pngImage"),
        height: element.scrollHeight,
      });
      if (filePath) showToast(t("activity.screenshotSaved"), "success");
    } catch (error) {
      console.error("Game activity screenshot failed:", error);
      showToast(t("activity.screenshotFailed", { error: String(error) }), "error");
    }
  }, [game, showToast, t]);

  const copySummary = useCallback(async () => {
    const recap = buildActivityRecap(sessions, [game], range);
    const text = buildActivitySummaryText({
      rangeLabel,
      recap,
      labels: {
        title: t("activity.title"),
        sessions: t("activityWs.recap.sessions"),
        games: t("activityWs.recap.games"),
        topGames: t("activityWs.recap.topGames"),
        footer: t("activityWs.recap.footer"),
        streakText: t("activityWs.recap.streakPhrase", {
          days: recap.longestStreak,
        }),
        activeDaysText: t("activityWs.recap.activeDaysPhrase", {
          days: recap.activeDays,
        }),
      },
    });
    const { copyTextToClipboard } = await import("../../utils/clipboard");
    const copied = await copyTextToClipboard(text);
    showToast(
      copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      copied ? "success" : "error",
    );
  }, [game, range, rangeLabel, sessions, showToast, t]);

  const body = () => {
    if (allSessions.length === 0) {
      return (
        <GameTabEmpty
          icon={<History size={22} />}
          title={t("gameActivity.noSessionsTitle")}
          description={t("activityInsights.gameEmptyHint")}
          actions={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setManualOpen(true)}
            >
              {t("activityManual.logSessionBtn")}
            </Button>
          }
        />
      );
    }

    if (view === "overview") {
      return (
        <GameActivityOverviewView
          game={game}
          sessions={sessions}
          allSessions={allSessions}
          range={range}
          rangeLabel={rangeLabel}
          aggregation={state.agg}
          onAggregationChange={(agg) => update({ agg })}
          chartStyle={state.chart}
          onChartStyleChange={(chart) => update({ chart })}
          chartMode={state.mode}
          onChartModeChange={(mode) => update({ mode })}
        />
      );
    }

    if (view === "sessions") {
      return (
        <ActivitySessionList
          sessions={sessions}
          games={[game]}
          filters={filters}
          onFiltersChange={updateFilters}
          onDelete={(session) => setPendingDelete(session)}
          onLaunchGame={launchGame}
          variant="game"
          tempUnit={tempUnit}
          rangeLabel={rangeLabel}
          emptyTitle={
            allSessions.length > 0
              ? t("activityWs.overview.emptyTitle")
              : t("activityWs.sessions.noSessionsTitle")
          }
          emptyHint={
            allSessions.length > 0
              ? t("activityWs.overview.emptyHint")
              : t("activityWs.sessions.noSessionsHint")
          }
        />
      );
    }

    if (view === "performance") {
      return (
        <ActivityPerformance
          sessions={sessions}
          games={[game]}
          startDate={range.startDate}
          endDate={range.endDate}
          sourceFilter="all"
          mode="game"
        />
      );
    }

    return <GameActivityHabitsView sessions={sessions} range={range} rangeLabel={rangeLabel} />;
  };

  return (
    <>
      <GameTabShell
        className="game-activity-tab"
        eyebrow={gameDisplayName(game)}
        title={t("activityWs.gameTab.title")}
        description={description}
        icon={<Sparkles size={18} />}
        actions={
          <ActivityActions
            compact
            onLogSession={() => setManualOpen(true)}
            onExportCsv={exportCsv}
            onExportJson={() => void exportJson()}
            onShareRecap={() => setRecapOpen(true)}
            onCapturePage={() => void capturePage()}
            onCopySummary={() => void copySummary()}
          />
        }
        stats={statItems}
        statsLabel={t("activity.title")}
        toolbar={
          <GameTabToolbar
            filters={
              <GameTabViewSwitch
                items={availableViews.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  icon: entry.icon,
                }))}
                value={view}
                onChange={(next) => update({ view: next })}
                ariaLabel={t("activityWs.gameTab.views")}
              />
            }
            below={
              <ActivityScopeBar
                rangeKey={state.range}
                rangeLabel={rangeLabel}
                defaultFrom={range.startDate}
                defaultTo={range.endDate}
                maxDate={localDayKey(new Date())}
                from={state.from}
                to={state.to}
                source="all"
                sourceOptions={[]}
                gameId={null}
                gameOptions={[]}
                isDefaultScope={state.range === DEFAULTS.range}
                savedViews={[]}
                showSource={false}
                showGame={false}
                showViews={false}
                onRangeChange={(rangeKey) => update({ range: rangeKey, from: "", to: "" })}
                onCustomRange={(from, to) => update({ range: "custom", from, to })}
                onSourceChange={() => undefined}
                onGameChange={() => undefined}
                onReset={() => update({ range: DEFAULTS.range, from: "", to: "" })}
                onApplyView={() => undefined}
                onSaveView={() => undefined}
                onDeleteView={() => undefined}
              />
            }
          />
        }
      >
        {body()}
      </GameTabShell>

      <ManualSessionModal
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        preselectedGameId={game.id}
        games={[game]}
      />

      <ActivityRecapDrawer
        open={recapOpen}
        onClose={() => setRecapOpen(false)}
        sessions={sessions}
        games={[game]}
        range={range}
        rangeLabel={rangeLabel}
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("gameActivity.deleteTitle")}
        message={t("gameActivity.deleteBody")}
        confirmLabel={t("gameActivity.deleteSession")}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteSession(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />
    </>
  );
}
