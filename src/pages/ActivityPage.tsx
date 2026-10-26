import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { BarChart3, History, LayoutDashboard, Sparkles } from "lucide-react";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useSessionNotes } from "../context/SessionNotesContext";
import { useToast } from "../context/ToastContext";
import { usePersistedState } from "../hooks/usePersistedState";
import { captureAndSaveScreenshot } from "../utils/screenshot";
import { copyTextToClipboard } from "../utils/clipboard";
import { formatPlayTime, gameDisplayName, type Game, type GameSession } from "../types/game";
import { PageHeader, SubTabs, ConfirmModal, Skeleton } from "../components/ui";
import PageWidget from "../components/PageWidget";
import { ActivityActions } from "../components/activity/ActivityActions";
import { ActivityScopeBar } from "../components/activity/ActivityScopeBar";
import { ActivitySessionDrawer } from "../components/activity/ActivitySessionDrawer";
import { ActivityRecapModal } from "../components/activity/ActivityRecapModal";
import { ManualSessionModal } from "../components/activity/ManualSessionModal";
import { SessionComparisonModal } from "../components/activity/SessionComparisonModal";
import { LinkGameModal } from "../components/activity/LinkGameModal";
import { AddActivityGameModal } from "../components/activity/AddActivityGameModal";
import { ActivityOverview } from "./activity/ActivityOverview";
import { ActivitySessionsTab } from "./activity/ActivitySessionsTab";
import { useActivityWorkspace } from "./activity/useActivityWorkspace";
import { useSavedActivityViews } from "./activity/useSavedActivityViews";
import { useWeeklyGoal } from "./activity/useWeeklyGoal";
import type { ActivitySessionFilters } from "../utils/activity/sessionQuery";
import type { PlaytimeAggregation } from "../utils/activity/chartSeries";
import { recommendedAggregation } from "../utils/activity/chartSeries";
import type { PlaytimeChartMode, PlaytimeChartStyle } from "../components/activity/ActivityPlaytimeChart";
import {
  buildActivityGameSummaries,
  buildGamePickerOptions,
  buildSourceOptions,
  filterSessionsByGame,
  filterSessionsBySource,
} from "../utils/activity/scoping";
import { buildActivityRecap } from "../utils/activity/recap";
import { buildActivitySummaryText } from "../utils/activity/summary";
import {
  buildActivityCsv,
  buildActivityExportPayload,
  downloadTextFile,
} from "../utils/activity/export";
import {
  filterSessionsToRange,
  formatRangeLabel,
  localDayKey,
  rangeDayCount,
  resolveActivityRange,
  type ActivityRange,
} from "../utils/activity/range";
import "../styles/activity.css";
import "./activity/ActivityPage.css";
import "../styles/activity-workspace.css";

const ActivityPerformance = lazy(() =>
  import("../components/activity/ActivityPerformance").then((module) => ({
    default: module.ActivityPerformance,
  })),
);
const WrappedView = lazy(() => import("./activity/WrappedView"));

/**
 * Activity — the library's play-history workspace.
 *
 * The page is a scope plus four views. The scope strip below the tabs is the
 * single source of truth for the range, source and game; the overview, the
 * session list, the timeline and telemetry all read the same scoped sessions.
 */
export default function ActivityPage() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { sessions, deleteSession, deleteSessionsForGame } = useActivity();
  const { games, launchGame } = useGames();
  const { tempUnit, isSimpleUi } = useSettings();
  const { getAllNotes } = useSessionNotes();
  const { showToast } = useToast();
  const workspace = useActivityWorkspace();
  const savedViews = useSavedActivityViews();
  const goal = useWeeklyGoal(sessions);

  const [manualSessionOpen, setManualSessionOpen] = useState(false);
  const [pendingDeleteSession, setPendingDeleteSession] = useState<GameSession | null>(null);
  const [pendingDeleteGame, setPendingDeleteGame] = useState<{ id: string; name: string } | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState<GameSession[] | null>(null);
  const [inspectedSessionId, setInspectedSessionId] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<{ id: string; name: string } | null>(null);
  const [addTarget, setAddTarget] = useState<{ id: string; name: string } | null>(null);
  const [compareTarget, setCompareTarget] = useState<{ a: GameSession; b: GameSession } | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);

  const [aggregation, setAggregation] = usePersistedState<PlaytimeAggregation>(
    "gamelib.activity.overview.aggregation_v2",
    "day",
    ["day", "week", "month"],
  );
  const [chartStyle, setChartStyle] = usePersistedState<PlaytimeChartStyle>(
    "gamelib.activity.overview.chart_style_v2",
    "bar",
    ["bar", "line"],
  );
  const [chartMode, setChartMode] = usePersistedState<PlaytimeChartMode>(
    "gamelib.activity.overview.chart_mode_v2",
    "periodic",
    ["periodic", "cumulative"],
  );
  const [railState, setRailState] = usePersistedState<"expanded" | "collapsed">(
    "gamelib.activity.overview.rail_v2",
    "expanded",
    ["expanded", "collapsed"],
  );

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  const range = useMemo<ActivityRange>(
    () =>
      resolveActivityRange({
        key: workspace.rangeKey,
        from: workspace.from,
        to: workspace.to,
        sessions,
      }),
    [workspace.rangeKey, workspace.from, workspace.to, sessions],
  );
  const rangeLabel = useMemo(() => formatRangeLabel(range, language), [range, language]);

  const rangeSessions = useMemo(() => filterSessionsToRange(sessions, range), [sessions, range]);
  const sourceSessions = useMemo(
    () => filterSessionsBySource(rangeSessions, games, workspace.source),
    [rangeSessions, games, workspace.source],
  );
  const scopedSessions = useMemo(
    () => filterSessionsByGame(sourceSessions, workspace.gameId),
    [sourceSessions, workspace.gameId],
  );

  const sourceOptions = useMemo(
    () => buildSourceOptions(games, rangeSessions),
    [games, rangeSessions],
  );
  const gameSummaries = useMemo(
    () => buildActivityGameSummaries(sourceSessions, games, t("activityDash.unknownGame")),
    [sourceSessions, games, t],
  );
  const gameOptions = useMemo(() => buildGamePickerOptions(gameSummaries), [gameSummaries]);
  const selectedGameName = useMemo(() => {
    if (!workspace.gameId) return undefined;
    const game = gameById.get(workspace.gameId);
    if (game) return gameDisplayName(game);
    return gameSummaries.find((summary) => summary.id === workspace.gameId)?.name;
  }, [gameById, gameSummaries, workspace.gameId]);

  const telemetryCount = useMemo(
    () =>
      scopedSessions.filter(
        (session) =>
          session.metrics &&
          ((session.metrics.avgFps ?? 0) > 0 || (session.metrics.avgCpuUsage ?? 0) > 0),
      ).length,
    [scopedSessions],
  );

  const allTimeDescription = useMemo(() => {
    if (sessions.length === 0) return t("activityWs.header.empty");
    const totalMinutes = sessions.reduce((sum, session) => sum + session.durationMin, 0);
    return t("activityWs.header.description", {
      sessions: sessions.length,
      games: new Set(sessions.map((session) => session.gameId)).size,
      time: formatPlayTime(totalMinutes),
    });
  }, [sessions, t]);

  const inspectedSession = useMemo(
    () => (inspectedSessionId ? sessions.find((session) => session.id === inspectedSessionId) ?? null : null),
    [inspectedSessionId, sessions],
  );
  const inspectedGame = inspectedSession ? gameById.get(inspectedSession.gameId) : undefined;

  const effectiveTab = isSimpleUi && workspace.tab === "performance" ? "overview" : workspace.tab;

  // A simple-UI deep link to Performance must not leave a hidden tab in the
  // URL; rewrite it to the tab that is actually rendered.
  useEffect(() => {
    if (isSimpleUi && workspace.tab === "performance") {
      workspace.update({ tab: "overview" });
    }
  }, [isSimpleUi, workspace.tab, workspace.update]);

  const tabItems = useMemo(() => {
    const items = [
      {
        id: "overview" as const,
        label: t("activity.tab.dashboard"),
        icon: LayoutDashboard,
      },
      {
        id: "sessions" as const,
        label: t("activity.tab.sessions"),
        icon: History,
        count: scopedSessions.length,
      },
      {
        id: "performance" as const,
        label: t("activity.tab.performance"),
        icon: BarChart3,
        count: telemetryCount,
      },
      {
        id: "wrapped" as const,
        label: t("activity.tab.wrapped"),
        icon: Sparkles,
      },
    ];
    return isSimpleUi ? items.filter((item) => item.id !== "performance") : items;
  }, [isSimpleUi, scopedSessions.length, telemetryCount, t]);

  // Long ranges should not paint hundreds of daily bars, and a monthly
  // resolution on a short window leaves a single bar. Coarsen or refine the
  // default when the window changes; a manual choice made afterwards sticks.
  const rangeSignature = `${range.startDate}|${range.endDate}`;
  useEffect(() => {
    const recommended = recommendedAggregation(range);
    const dayCount = rangeDayCount(range);
    const points =
      aggregation === "day"
        ? dayCount
        : aggregation === "week"
          ? Math.ceil(dayCount / 7)
          : Math.ceil(dayCount / 30);
    if ((aggregation === "day" && recommended !== "day") || points < 2) {
      setAggregation(recommended);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSignature]);

  // A daily bar for a multi-year window is unreadable and expensive; keep the
  // hard cap even if the user picks Daily afterwards.
  useEffect(() => {
    if (aggregation === "day" && rangeDayCount(range) > 366) setAggregation("month");
  }, [aggregation, range, setAggregation]);

  const updateFilters = useCallback(
    (patch: Partial<ActivitySessionFilters>) => {
      workspace.update({ filters: { ...workspace.filters, ...patch } });
    },
    [workspace],
  );

  const openGame = useCallback(
    (gameId: string) => {
      navigate(`/library/${gameId}`);
    },
    [navigate],
  );

  const launchGameById = useCallback(
    (gameId: string) => {
      const game = gameById.get(gameId);
      if (game) launchGame(game);
    },
    [gameById, launchGame],
  );

  const exportCsv = useCallback(
    (list: GameSession[], fileBase: string) => {
      if (list.length === 0) {
        showToast(t("activityPage.noSessionsExport"), "info");
        return;
      }
      const csv = buildActivityCsv(list, games, getAllNotes());
      downloadTextFile(
        csv,
        `${fileBase}_${new Date().toISOString().slice(0, 10)}.csv`,
        "text/csv;charset=utf-8;",
      );
      showToast(t("activity.exportedAs", { format: "CSV" }), "success");
    },
    [games, getAllNotes, showToast, t],
  );

  const exportJson = useCallback(
    async (list: GameSession[], fileBase: string) => {
      if (list.length === 0) {
        showToast(t("activityPage.noSessionsExport"), "info");
        return;
      }
      try {
        const payload = buildActivityExportPayload(list, games, getAllNotes(), range);
        const filePath = await save({
          defaultPath: `${fileBase}_${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: "JSON File", extensions: ["json"] }],
        });
        if (!filePath) return;
        await invoke("save_text_file", {
          filePath,
          contents: JSON.stringify(payload, null, 2),
        });
        showToast(t("activity.exportedAs", { format: "JSON" }), "success");
      } catch (error) {
        console.error("JSON export failed:", error);
        showToast(t("activity.exportFailed", { error: String(error) }), "error");
      }
    },
    [games, getAllNotes, range, showToast, t],
  );

  const capturePage = useCallback(async () => {
    const element = document.querySelector<HTMLElement>(".activity-page");
    if (!element) return;
    try {
      const height = element.scrollHeight;
      const filePath = await captureAndSaveScreenshot({
        element,
        fileName: "gameindex_activity",
        title: t("activity.saveScreenshot"),
        filterLabel: t("activity.pngImage"),
        height,
        prepareClone: (clonedDoc) => {
          clonedDoc
            .querySelectorAll<HTMLElement>(".activity-rail__list, .activity-rail__covers")
            .forEach((node) => {
              node.style.maxHeight = "none";
              node.style.overflow = "visible";
            });
        },
      });
      if (filePath) showToast(t("activity.screenshotSaved"), "success");
    } catch (error) {
      console.error("Activity screenshot failed:", error);
      showToast(t("activity.screenshotFailed", { error: String(error) }), "error");
    }
  }, [showToast, t]);

  const copySummary = useCallback(async () => {
    const recap = buildActivityRecap(scopedSessions, games, range);
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
    const copied = await copyTextToClipboard(text);
    showToast(
      copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      copied ? "success" : "error",
    );
  }, [games, range, rangeLabel, scopedSessions, showToast, t]);

  const handleSaveView = useCallback(
    (name: string) => {
      savedViews.save({
        name,
        tab: effectiveTab,
        rangeKey: workspace.rangeKey,
        from: workspace.from,
        to: workspace.to,
        source: workspace.source,
        gameId: workspace.gameId,
        filters: workspace.filters,
      });
      showToast(t("activityWs.scope.viewSaved"), "success");
    },
    [effectiveTab, savedViews, showToast, t, workspace],
  );

  const requestDeleteSession = useCallback((session: GameSession) => {
    setPendingDeleteSession(session);
  }, []);

  const requestDeleteGame = useCallback((gameId: string, name: string) => {
    setPendingDeleteGame({ id: gameId, name });
  }, []);

  const requestLink = useCallback((gameId: string, name: string) => {
    setLinkTarget({ id: gameId, name });
  }, []);

  const requestAdd = useCallback((gameId: string, name: string) => {
    setAddTarget({ id: gameId, name });
  }, []);

  const gameForLaunch = useCallback(
    (game: Game) => {
      launchGame(game);
    },
    [launchGame],
  );

  return (
    <div className="activity-page">
      <PageWidget page="activity" widget="activityHeader">
        <div className="ui-item-activityHeader">
          <PageHeader
            eyebrow={t("activity.eyebrow")}
            title={t("activity.title")}
            description={allTimeDescription}
            actions={
              <ActivityActions
                onLogSession={() => setManualSessionOpen(true)}
                onExportCsv={() => exportCsv(scopedSessions, "gameindex_activity")}
                onExportJson={() => void exportJson(scopedSessions, "gameindex_activity")}
                onShareRecap={() => setRecapOpen(true)}
                onCapturePage={() => void capturePage()}
                onCopySummary={() => void copySummary()}
                onOpenWrapped={
                  effectiveTab === "wrapped"
                    ? undefined
                    : () => workspace.update({ tab: "wrapped" }, { push: true })
                }
              />
            }
          />
        </div>
      </PageWidget>

      <PageWidget page="activity" widget="activityToolbar">
        <div className="ui-item-activityToolbar activity-page__toolbar">
          <SubTabs
            ariaLabel={t("nav.activity")}
            items={tabItems}
            value={effectiveTab}
            onChange={(tab) => workspace.update({ tab }, { push: true })}
            sticky
          />
          {effectiveTab !== "wrapped" && (
            <ActivityScopeBar
              rangeKey={workspace.rangeKey}
              rangeLabel={rangeLabel}
              defaultFrom={range.startDate}
              defaultTo={range.endDate}
              maxDate={localDayKey(new Date())}
              from={workspace.from}
              to={workspace.to}
              source={workspace.source}
              sourceOptions={sourceOptions}
              gameId={workspace.gameId}
              gameOptions={gameOptions}
              selectedGameLabel={selectedGameName}
              isDefaultScope={workspace.isDefaultScope}
              savedViews={savedViews.views}
              onRangeChange={(rangeKey) => workspace.update({ rangeKey })}
              onCustomRange={workspace.setCustomRange}
              onSourceChange={(source) => workspace.update({ source })}
              onGameChange={(gameId) => workspace.update({ gameId })}
              onReset={workspace.resetScope}
              onApplyView={workspace.applySavedView}
              onSaveView={handleSaveView}
              onDeleteView={savedViews.remove}
            />
          )}
        </div>
      </PageWidget>

      <div className="activity-page__body">
        {effectiveTab === "overview" && (
          <ActivityOverview
            sessions={sourceSessions}
            allSessions={sessions}
            scopedSessions={scopedSessions}
            games={games}
            range={range}
            gameSummaries={gameSummaries}
            selectedGameId={workspace.gameId}
            selectedGameName={selectedGameName}
            railCollapsed={railState === "collapsed"}
            onToggleRail={() => setRailState(railState === "collapsed" ? "expanded" : "collapsed")}
            aggregation={aggregation}
            onAggregationChange={setAggregation}
            chartStyle={chartStyle}
            onChartStyleChange={setChartStyle}
            chartMode={chartMode}
            onChartModeChange={setChartMode}
            goal={goal}
            onSelectGame={(gameId) => workspace.update({ gameId })}
            onOpenGame={openGame}
            onLaunchGame={launchGameById}
            onRequestDeleteGame={requestDeleteGame}
            onRequestLink={requestLink}
            onRequestAdd={requestAdd}
            onLogSession={() => setManualSessionOpen(true)}
          />
        )}

        {effectiveTab === "sessions" && (
          <ActivitySessionsTab
            sessions={scopedSessions}
            games={games}
            range={range}
            rangeLabel={rangeLabel}
            hasHistory={sessions.length > 0}
            filters={workspace.filters}
            onFiltersChange={updateFilters}
            view={workspace.sessionView}
            onViewChange={(sessionView) => workspace.update({ sessionView })}
            tempUnit={tempUnit}
            goal={goal}
            onLogSession={() => setManualSessionOpen(true)}
            onInspect={(session) => setInspectedSessionId(session.id)}
            onDelete={requestDeleteSession}
            onRequestLink={requestLink}
            onRequestAdd={requestAdd}
            onLaunchGame={gameForLaunch}
            onOpenGame={openGame}
            onCompare={(a, b) => setCompareTarget({ a, b })}
            onBatchDelete={(list) => setPendingBatchDelete(list)}
            onExportSelected={(list, format) =>
              format === "csv"
                ? exportCsv(list, "gameindex_sessions")
                : void exportJson(list, "gameindex_sessions")
            }
          />
        )}

        {effectiveTab === "performance" && (
          <div className="activity-page__performance">
            <div className="activity-section-head">
              <div>
                <span className="activity-section-head__eyebrow">
                  {t("activity.tab.performance")}
                </span>
                <h2 className="activity-section-head__title">
                  {t("activityWs.performance.title")}
                </h2>
                <p className="activity-section-head__desc">
                  {t("activityWs.performance.subtitle", {
                    count: telemetryCount,
                    range: rangeLabel,
                  })}
                </p>
              </div>
            </div>
            <Suspense fallback={<Skeleton width="100%" height="260px" />}>
              <ActivityPerformance
                sessions={scopedSessions}
                games={games}
                startDate={range.startDate}
                endDate={range.endDate}
                sourceFilter="all"
                mode={workspace.gameId ? "game" : "library"}
              />
            </Suspense>
          </div>
        )}

        {effectiveTab === "wrapped" && (
          <Suspense fallback={<Skeleton width="100%" height="320px" />}>
            <WrappedView sessions={sessions} games={games} />
          </Suspense>
        )}
      </div>

      <ManualSessionModal
        isOpen={manualSessionOpen}
        onClose={() => setManualSessionOpen(false)}
        games={games}
      />

      <ActivitySessionDrawer
        session={inspectedSession}
        game={inspectedGame}
        tempUnit={tempUnit}
        onClose={() => setInspectedSessionId(null)}
        onDelete={(session) => requestDeleteSession(session)}
        onLaunchGame={gameForLaunch}
        onOpenGame={openGame}
        onRequestLink={requestLink}
        onRequestAdd={requestAdd}
      />

      <ActivityRecapModal
        open={recapOpen}
        onClose={() => setRecapOpen(false)}
        sessions={scopedSessions}
        games={games}
        range={range}
        rangeLabel={rangeLabel}
      />

      <ConfirmModal
        open={pendingDeleteSession !== null}
        title={t("activitySessions.deleteConfirmTitle")}
        message={
          pendingDeleteSession
            ? t("activitySessions.deleteConfirmBody", {
                game: pendingDeleteSession.gameName,
                date: new Date(pendingDeleteSession.date).toLocaleDateString(language, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }),
              })
            : ""
        }
        confirmLabel={t("common.delete")}
        onCancel={() => setPendingDeleteSession(null)}
        onConfirm={() => {
          if (pendingDeleteSession) {
            deleteSession(pendingDeleteSession.id);
            if (inspectedSessionId === pendingDeleteSession.id) setInspectedSessionId(null);
          }
          setPendingDeleteSession(null);
        }}
      />

      <ConfirmModal
        open={pendingDeleteGame !== null}
        title={t("activityDash.deleteEntryTitle")}
        message={t("activityDash.deleteEntryBody", { name: pendingDeleteGame?.name ?? "" })}
        confirmLabel={t("activityDash.deleteEntry")}
        onCancel={() => setPendingDeleteGame(null)}
        onConfirm={() => {
          if (pendingDeleteGame) {
            deleteSessionsForGame(pendingDeleteGame.id);
            if (workspace.gameId === pendingDeleteGame.id) workspace.update({ gameId: null });
            setInspectedSessionId(null);
          }
          setPendingDeleteGame(null);
        }}
      />

      <ConfirmModal
        open={pendingBatchDelete !== null}
        title={t("activitySessions.batchDeleteConfirmTitle")}
        message={t("activitySessions.batchDeleteConfirmBody", {
          count: pendingBatchDelete?.length ?? 0,
        })}
        confirmLabel={t("common.delete")}
        onCancel={() => setPendingBatchDelete(null)}
        onConfirm={() => {
          pendingBatchDelete?.forEach((session) => deleteSession(session.id));
          setPendingBatchDelete(null);
          setInspectedSessionId(null);
        }}
      />

      <SessionComparisonModal
        isOpen={compareTarget !== null}
        onClose={() => setCompareTarget(null)}
        sessions={scopedSessions}
        initialSessionAId={compareTarget?.a.id}
        initialSessionBId={compareTarget?.b.id}
      />

      {linkTarget && (
        <LinkGameModal
          isOpen
          onClose={() => setLinkTarget(null)}
          unlinkedGameId={linkTarget.id}
          unlinkedGameTitle={linkTarget.name}
          games={games}
          onLinked={(target) => workspace.update({ gameId: target.id })}
        />
      )}

      {addTarget && (
        <AddActivityGameModal
          isOpen
          onClose={() => setAddTarget(null)}
          unlinkedGameId={addTarget.id}
          unlinkedGameTitle={addTarget.name}
          onAdded={(newGame) => workspace.update({ gameId: newGame.id })}
        />
      )}
    </div>
  );
}
