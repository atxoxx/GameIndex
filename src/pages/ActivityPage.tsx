import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { prepareClonedDocumentForCanvasCapture, resolveColorForCapture } from "../utils/color";
import { useActivity } from "../context/ActivityContext";
import { useGames } from "../context/GameContext";
import { useSettings } from "../context/SettingsContext";
import { tempUnitLabel } from "../utils/temp";
import { useToast } from "../context/ToastContext";
import { ActivityDashboard } from "./activity/ActivityDashboard";
import { ActivityGantt } from "./activity/ActivityGantt";
import { ActivitySessions } from "./activity/ActivitySessions";
import { ActivityPerformance } from "./activity/ActivityPerformance";
import * as Icons from "./activity/Icons";
import { PageHeader } from "../components/ui";
import { useLanguage } from "../context/LanguageContext";
import "./activity/ActivityPage.css";

type TabType = "dashboard" | "timeline" | "sessions" | "performance";
type DateRangePreset = "7d" | "30d" | "90d" | "all";
type AggregationType = "day" | "week" | "month";
type ChartType = "bar" | "line";

export default function ActivityPage() {
  const { t } = useLanguage();
  const { sessions, deleteSession } = useActivity();
  const { games } = useGames();
  const { tempUnit } = useSettings();
  // Toast feedback for screenshot success / error (matches the rest of
  // the app instead of throwing a native alert()).
  const { showToast } = useToast();

  // Tab & Filter States
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [dateRange, setDateRange] = useState<DateRangePreset>("7d");
  const [aggregation, setAggregation] = useState<AggregationType>("day");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Determine date boundaries based on timeframe preset
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    const endStr = today.toISOString().slice(0, 10);
    const start = new Date(today);

    if (dateRange === "7d") {
      start.setDate(today.getDate() - 6);
    } else if (dateRange === "30d") {
      start.setDate(today.getDate() - 29);
    } else if (dateRange === "90d") {
      start.setDate(today.getDate() - 89);
    } else {
      // All time
      if (sessions.length > 0) {
        const sortedDates = sessions.map((s) => s.date.slice(0, 10)).sort();
        return { startDate: sortedDates[0], endDate: endStr };
      }
      start.setFullYear(today.getFullYear() - 1);
    }

    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: endStr,
    };
  }, [dateRange, sessions]);

  // Dynamically extract all available game platforms
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      if (g.platform) set.add(g.platform);
    });
    return Array.from(set).sort();
  }, [games]);

  // Handler to export session history to a CSV file
  const handleExportCSV = () => {
    if (sessions.length === 0) {
      alert(t("activityPage.noSessionsExport"));
      return;
    }

    const headers = [
      "Session ID",
      "Game Name",
      "Game ID",
      "Date Played",
      "Duration (Minutes)",
      "Platform",
      "Avg FPS",
      "Min FPS",
      "Max FPS",
      "Avg CPU Usage (%)",
      "Avg GPU Usage (%)",
      "Avg RAM Usage (%)",
      "Avg CPU Temp (" + tempUnitLabel(tempUnit) + ")",
      "Avg GPU Temp (" + tempUnitLabel(tempUnit) + ")",
    ];

    const rows = sessions.map((s) => {
      const game = games.find((g) => g.id === s.gameId);
      return [
        s.id,
        s.gameName,
        s.gameId,
        s.date,
        s.durationMin,
        game?.platform || "Local",
        s.metrics?.avgFps || "—",
        s.metrics?.minFps || "—",
        s.metrics?.maxFps || "—",
        s.metrics?.avgCpuUsage || "—",
        s.metrics?.avgGpuUsage || "—",
        s.metrics?.avgRamUsage || "—",
        s.metrics?.avgCpuTemp || "—",
        s.metrics?.avgGpuTemp || "—",
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((row) => row.map((val) => `"${val}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gamelib_activity_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // `showToast` is destructured at the top of this component alongside
  // the other hooks.

  // Clone-side prep for the full-page screenshot: chains the shared
  // capture fixes and un-clamps the dashboard's sticky games sidebar so
  // the whole list is exported instead of only the first viewport's
  // worth (live CSS caps it at `calc(100vh - 200px)`).
  const prepareActivityClone = (clonedDoc: Document) => {
    prepareClonedDocumentForCanvasCapture(clonedDoc);
    const sidebar = clonedDoc.querySelector<HTMLElement>(".activity-game-sidebar");
    if (sidebar) {
      sidebar.style.maxHeight = "none";
      sidebar.style.position = "static";
    }
    const list = clonedDoc.querySelector<HTMLElement>(".activity-game-sidebar__list");
    if (list) {
      list.style.maxHeight = "none";
      list.style.overflow = "visible";
    }
  };

  const handleCaptureScreenshot = async () => {
    try {
      const container = document.querySelector(".activity__container");
      if (!container) return;

      // Capture the *entire* activity view in height, not just the
      // currently-visible portion. scrollHeight reflects the full
      // rendered panel including content below the fold; passing it as
      // both `height` and `windowHeight` lets html2canvas paint the
      // complete layout in one pass instead of viewport-clipped pixels.
      const fullWidth = (container as HTMLElement).scrollWidth;
      // The clone un-clamps the dashboard's sticky games sidebar (live
      // CSS caps it at `calc(100vh - 200px)`), which makes the layout
      // taller than the live scrollHeight. Measure the expanded height
      // so the taller canvas doesn't clip the games list. No-op when
      // the sidebar isn't rendered (non-dashboard tabs).
      const sidebar = (container as HTMLElement).querySelector<HTMLElement>(
        ".activity-game-sidebar",
      );
      const sidebarList = sidebar?.querySelector<HTMLElement>(
        ".activity-game-sidebar__list",
      );
      const expandedSidebarHeight =
        sidebar && sidebarList
          ? sidebar.offsetHeight - sidebarList.offsetHeight + sidebarList.scrollHeight
          : null;
      const fullHeight =
        !sidebar || expandedSidebarHeight === null
          ? (container as HTMLElement).scrollHeight
          : (container as HTMLElement).scrollHeight +
            Math.max(0, expandedSidebarHeight - sidebar.offsetHeight);

      const canvas = await html2canvas(container as HTMLElement, {
        // html2canvas parses the backgroundColor option as raw CSS text
        // and throws "unsupported color function 'var'" on var() — the
        // onclone scrub never sees it. Resolve the current theme's page
        // background to a literal color first (see src/utils/color.ts);
        // the old hardcoded dark hex made light-theme screenshots
        // come out with a dark backdrop.
        backgroundColor: resolveColorForCapture("var(--color-bg-primary)", "#0f1117"),
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        // html2canvas 1.4.1 doesn't understand CSS Color Module L4
        // `color-mix(in srgb, …)` and throws "Attempting to parse an
        // unsupported color function 'color'". The project uses
        // color-mix in 170+ rules, so we rewrite every `color-mix()`
        // in the clone to a literal rgb() / rgba() before html2canvas
        // reads computed styles (see src/utils/color.ts).
        onclone: prepareActivityClone,
      });

      const dataUrl = canvas.toDataURL("image/png");

      const filePath = await save({
        title: t("activity.saveScreenshot"),
        defaultPath: `gamelib_activity_screenshot_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!filePath) return;

      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast(t("gameActivity.screenshotSaved"), "success");
    } catch (error) {
      console.error("Screenshot error:", error);
      showToast(t("gameActivity.screenshotFailed", { error }), "error");
    }
  };

  return (
    <div className="activity__container">
      <PageHeader
        eyebrow={t("activity.eyebrow")}
        title={t("activity.title")}
        actions={
          <div className="activity__export-actions">
            <button
              type="button"
              className="activity__icon-btn"
              onClick={handleCaptureScreenshot}
              title={t("activity.capture")}
            >
              <Icons.Camera size={13} />
            </button>
            <button
              type="button"
              className="activity__icon-btn"
              onClick={handleExportCSV}
              title={t("activity.exportCsv")}
            >
              <Icons.Download size={13} />
            </button>
          </div>
        }
      />

      {/* ── Unified controls panel: primary tabs on top, shared + per-tab filters below ── */}
      <div className="activity__controls">
        <div className="activity__controls-row">
          {/* Main Navigation Tabs */}
          <nav className="activity__tabs" aria-label={t("nav.activity")}>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "dashboard" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Icons.LayoutDashboard size={13} />
              {t("activity.tab.dashboard")}
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "timeline" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("timeline")}
            >
              <Icons.GanttChart size={13} />
              {t("activity.tab.timeline")}
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "sessions" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("sessions")}
            >
              <Icons.History size={13} />
              {t("activity.tab.sessions")}
            </button>
            <button
              type="button"
              className={`activity__tab-btn ${activeTab === "performance" ? "activity__tab-btn--active" : ""}`}
              onClick={() => setActiveTab("performance")}
            >
              <Icons.BarChart3 size={13} />
              {t("activity.tab.performance")}
            </button>
          </nav>
        </div>

        <div className="activity__controls-row activity__controls-row--tools">
          {/* Timeframe Presets */}
          <div className="activity-toolbar__group activity-toolbar__date-range">
            {(["7d", "30d", "90d", "all"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                className={`activity-toolbar__pill ${dateRange === preset ? "activity-toolbar__pill--active" : ""}`}
                onClick={() => setDateRange(preset)}
              >
                {preset === "all" ? t("activity.allTime") : preset.toUpperCase()}
              </button>
            ))}
          </div>

          <span className="activity-toolbar__divider" aria-hidden="true" />

          {/* Platform/Source Selector */}
          <div className="activity-toolbar__group">
            <Icons.Filter size={12} className="activity-toolbar__filter-icon" />
            <span className="activity-toolbar__select-label">{t("activityPage.source")}</span>
            <select
              className="activity-toolbar__select"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">{t("activity.sourceAll")}</option>
              {availablePlatforms.map((plat) => (
                <option key={plat} value={plat}>
                  {plat}
                </option>
              ))}
            </select>
          </div>

          {/* Dashboard Specific Sub-options */}
          {activeTab === "dashboard" && (
            <>
              <span className="activity-toolbar__divider" aria-hidden="true" />

              {/* Aggregation interval (Day/Week/Month) */}
              <div className="activity-toolbar__group">
                <span className="activity-toolbar__label">{t("activity.interval")}</span>
                <div className="activity-toolbar__segmented">
                  {(["day", "week", "month"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`activity-toolbar__segmented-btn ${
                        aggregation === mode ? "activity-toolbar__segmented-btn--active" : ""
                      }`}
                      onClick={() => setAggregation(mode)}
                    >
                      {t(`activityPage.agg${mode.charAt(0).toUpperCase() + mode.slice(1)}`)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart Type (Bar / Line) */}
              <div className="activity-toolbar__group">
                <div className="activity-toolbar__icon-toggle">
                  <button
                    type="button"
                    className={`activity-toolbar__icon-btn ${
                      chartType === "bar" ? "activity-toolbar__icon-btn--active" : ""
                    }`}
                    onClick={() => setChartType("bar")}
                    title={t("activity.barChart")}
                  >
                    <Icons.BarChart3 size={13} />
                  </button>
                  <button
                    type="button"
                    className={`activity-toolbar__icon-btn ${
                      chartType === "line" ? "activity-toolbar__icon-btn--active" : ""
                    }`}
                    onClick={() => setChartType("line")}
                    title={t("activity.lineChart")}
                  >
                    <Icons.TrendingUp size={13} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab Router Content Panels */}
      <main className="activity__main">
        {activeTab === "dashboard" && (
          <ActivityDashboard
            sessions={sessions}
            games={games}
            dateRange={dateRange}
            startDate={startDate}
            endDate={endDate}
            aggregation={aggregation}
            chartType={chartType}
            sourceFilter={sourceFilter}
          />
        )}

        {activeTab === "timeline" && (
          <ActivityGantt
            sessions={sessions}
            games={games}
            startDate={startDate}
            endDate={endDate}
            sourceFilter={sourceFilter}
          />
        )}

        {activeTab === "sessions" && (
          <ActivitySessions
            sessions={sessions}
            games={games}
            onDeleteSession={deleteSession}
          />
        )}

        {activeTab === "performance" && (
          <ActivityPerformance
            sessions={sessions}
            games={games}
            startDate={startDate}
            endDate={endDate}
            sourceFilter={sourceFilter}
          />
        )}
      </main>
    </div>
  );
}
