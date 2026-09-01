import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
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
import { Segmented, RangePills } from "../components/activity";
import type { DateRangeKey } from "../components/activity";
import { useLanguage } from "../context/LanguageContext";
import "./activity/ActivityPage.css";
import "../styles/activity.css";

type TabType = "dashboard" | "timeline" | "sessions" | "performance";
type AggregationType = "day" | "week" | "month";
type ChartType = "bar" | "line";

export default function ActivityPage() {
  const { t } = useLanguage();
  const { sessions, deleteSession, deleteSessionsForGame } = useActivity();
  const { games } = useGames();
  const { tempUnit, isSimpleUi } = useSettings();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [dateRange, setDateRange] = useState<DateRangeKey>("7d");
  const [aggregation, setAggregation] = useState<AggregationType>("day");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const effectiveTab: TabType = isSimpleUi && (activeTab === "timeline" || activeTab === "performance")
    ? "dashboard"
    : activeTab;

  const tabOptions = useMemo(() => {
    const all = [
      { value: "dashboard" as const, label: <><Icons.LayoutDashboard size={13} /> {t("activity.tab.dashboard")}</> },
      { value: "timeline" as const, label: <><Icons.GanttChart size={13} /> {t("activity.tab.timeline")}</> },
      { value: "sessions" as const, label: <><Icons.History size={13} /> {t("activity.tab.sessions")}</> },
      { value: "performance" as const, label: <><Icons.BarChart3 size={13} /> {t("activity.tab.performance")}</> },
    ];
    return isSimpleUi
      ? all.filter((opt) => opt.value === "dashboard" || opt.value === "sessions")
      : all;
  }, [isSimpleUi, t]);

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
    } else if (sessions.length > 0) {
      const sortedDates = sessions.map((s) => s.date.slice(0, 10)).sort();
      return { startDate: sortedDates[0], endDate: endStr };
    } else {
      start.setFullYear(today.getFullYear() - 1);
    }

    return { startDate: start.toISOString().slice(0, 10), endDate: endStr };
  }, [dateRange, sessions]);

  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      if (g.platform) set.add(g.platform);
    });
    return Array.from(set).sort();
  }, [games]);

  const handleExportCSV = () => {
    if (sessions.length === 0) {
      showToast(t("activityPage.noSessionsExport"), "info");
      return;
    }

    const headers = [
      t("activityCsv.sessionId"),
      t("activityCsv.gameName"),
      t("activityCsv.gameId"),
      t("activityCsv.datePlayed"),
      t("activityCsv.durationMinutes"),
      t("activityCsv.platform"),
      t("activityCsv.avgFps"),
      t("activityCsv.minFps"),
      t("activityCsv.maxFps"),
      t("activityCsv.avgCpuUsage"),
      t("activityCsv.avgGpuUsage"),
      t("activityCsv.avgRamUsage"),
      t("activityCsv.avgCpuTemp", { unit: tempUnitLabel(tempUnit) }),
      t("activityCsv.avgGpuTemp", { unit: tempUnitLabel(tempUnit) }),
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

      const fullWidth = (container as HTMLElement).scrollWidth;
      const sidebar = (container as HTMLElement).querySelector<HTMLElement>(".activity-game-sidebar");
      const sidebarList = sidebar?.querySelector<HTMLElement>(".activity-game-sidebar__list");
      const expandedSidebarHeight =
        sidebar && sidebarList
          ? sidebar.offsetHeight - sidebarList.offsetHeight + sidebarList.scrollHeight
          : null;
      const fullHeight =
        !sidebar || expandedSidebarHeight === null
          ? (container as HTMLElement).scrollHeight
          : (container as HTMLElement).scrollHeight + Math.max(0, expandedSidebarHeight - sidebar.offsetHeight);

      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: resolveColorForCapture("var(--color-bg-primary)", "#0f1117"),
        scale: 2,
        logging: false,
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        onclone: prepareActivityClone,
      });

      const dataUrl = canvas.toDataURL("image/png");
      const blob = await (await fetch(dataUrl)).blob();

      const suggestedName = `gamelib_activity_${new Date().toISOString().slice(0, 10)}.png`;
      const filePath = await save({
        defaultPath: suggestedName,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (filePath) {
        const buffer = await blob.arrayBuffer();
        await invoke("save_screenshot", {
          path: filePath,
          data: Array.from(new Uint8Array(buffer)),
        });
        showToast(t("activity.screenshotSaved"), "success");
      }
    } catch (err) {
      console.error("Screenshot capture failed:", err);
      showToast(t("activity.screenshotFailed"), "error");
    }
  };

  return (
    <div className="activity__container">
      <PageHeader
        eyebrow={t("activity.eyebrow")}
        title={t("activity.title")}
        actions={
          <div className="activity__export-actions ui-complete-only">
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

      <div className="act-toolbar">
        <div className="act-toolbar__left">
          <Segmented<TabType>
            ariaLabel={t("nav.activity")}
            value={effectiveTab}
            onChange={setActiveTab}
            options={tabOptions}
          />
        </div>

        <div className="act-toolbar__right">
          <RangePills value={dateRange} onChange={setDateRange} />

          <select
            className="act-toolbar__select"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label={t("activityPage.source")}
          >
            <option value="all">{t("activity.sourceAll")}</option>
            {availablePlatforms.map((plat) => (
              <option key={plat} value={plat}>
                {plat}
              </option>
            ))}
          </select>

          {effectiveTab === "dashboard" && (
            <div className="ui-complete-only" style={{ display: "contents" }}>
              <Segmented<AggregationType>
                ariaLabel={t("activity.interval")}
                value={aggregation}
                onChange={setAggregation}
                options={[
                  { value: "day", label: t("activityPage.aggDay") },
                  { value: "week", label: t("activityPage.aggWeek") },
                  { value: "month", label: t("activityPage.aggMonth") },
                ]}
              />
              <Segmented<ChartType>
                ariaLabel={t("activity.barChart")}
                value={chartType}
                onChange={setChartType}
                options={[
                  { value: "bar", label: <Icons.BarChart3 size={13} />, title: t("activity.barChart") },
                  { value: "line", label: <Icons.TrendingUp size={13} />, title: t("activity.lineChart") },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <main className="activity__main">
        {effectiveTab === "dashboard" && (
          <ActivityDashboard
            sessions={sessions}
            games={games}
            dateRange={dateRange}
            startDate={startDate}
            endDate={endDate}
            aggregation={aggregation}
            chartType={chartType}
            sourceFilter={sourceFilter}
            onDeleteGameSessions={deleteSessionsForGame}
          />
        )}

        {effectiveTab === "timeline" && (
          <ActivityGantt
            sessions={sessions}
            games={games}
            startDate={startDate}
            endDate={endDate}
            sourceFilter={sourceFilter}
          />
        )}

        {effectiveTab === "sessions" && (
          <ActivitySessions sessions={sessions} games={games} onDeleteSession={deleteSession} />
        )}

        {effectiveTab === "performance" && (
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
