import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { prepareClonedDocumentForCanvasCapture, resolveColorForCapture } from "../../utils/color";
import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { type Game } from "../../types/game";
import { buildTimelineFromSessions, buildSingleSessionSeries } from "../../utils/perfSamples";
import { ConfirmModal } from "../ui/ConfirmModal";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { GameActivityPlaytimeView } from "./GameActivityPlaytimeView";
import { GameActivityPerformanceView } from "./GameActivityPerformanceView";
import {
  Segmented,
  RangePills,
  EmptyState,
  buildPeriodComparison,
  buildRecords,
  buildMilestoneLadders,
} from "../activity";
import {
  type Timeframe,
  type ViewMode,
  type PlaytimeChartStyle,
  type PlaytimeAggregation,
  generateConsistentSeries,
} from "./GameActivityShared";
import * as Icons from "../activity/Icons";

export function GameActivityTab({ game }: { game: Game }) {
  const { getGameSessions, deleteSession } = useActivity();
  const { tempUnit } = useSettings();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const sessions = useMemo(() => getGameSessions(game.id), [game.id, getGameSessions]);

  const [viewMode, setViewMode] = useState<ViewMode>("playtime");
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [playtimeChartStyle, setPlaytimeChartStyle] = useState<PlaytimeChartStyle>("bar");
  const [playtimeAgg, setPlaytimeAgg] = useState<PlaytimeAggregation>("AGG_DAY");
  const [isolatedSessionIndex, setIsolatedSessionIndex] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleCaptureScreenshot = async () => {
    try {
      const container = document.querySelector(".game-activity-tab");
      if (!container) return;
      const fullHeight = (container as HTMLElement).scrollHeight;
      const fullWidth = (container as HTMLElement).scrollWidth;

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
        onclone: prepareClonedDocumentForCanvasCapture,
      });

      const dataUrl = canvas.toDataURL("image/png");
      const filePath = await save({
        title: t("gameActivity.saveScreenshot", { game: game.name }),
        defaultPath: `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_activity_screenshot_${new Date().toISOString().slice(0, 10)}.png`,
        filters: [{ name: t("activity.pngImage"), extensions: ["png"] }],
      });

      if (!filePath) return;
      await invoke("save_screenshot", { filePath, base64Data: dataUrl });
      showToast(t("activity.screenshotSaved"), "success");
    } catch (error) {
      console.error("Screenshot error:", error);
      showToast(t("activity.screenshotFailed", { error: String(error) }), "error");
    }
  };

  const handleExportSessions = async (format: "csv" | "json") => {
    try {
      const baseName = `${game.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_sessions_${new Date().toISOString().slice(0, 10)}`;
      const filePath = await save({
        title: t("activity.exportTitle", { name: game.name }),
        defaultPath: `${baseName}.${format}`,
        filters: [{ name: format === "csv" ? t("activity.csvFile") : t("activity.jsonFile"), extensions: [format] }],
      });
      if (!filePath) return;

      let contents: string;
      if (format === "csv") {
        const header = [
          "date", "start_time", "duration_min",
          "avg_fps", "min_fps", "max_fps",
          "avg_cpu", "avg_gpu", "avg_ram",
          "avg_cpu_temp", "avg_gpu_temp", "resolution",
        ];
        const rows = filteredSessions.map((s) => {
          const m = s.metrics;
          const start = new Date(s.date).toLocaleTimeString("en-GB", { hour12: false });
          return [
            s.date.slice(0, 10),
            start,
            String(s.durationMin),
            m ? String(m.avgFps) : "",
            m ? String(m.minFps) : "",
            m ? String(m.maxFps) : "",
            m ? String(m.avgCpuUsage) : "",
            m ? String(m.avgGpuUsage) : "",
            m ? String(m.avgRamUsage) : "",
            m ? String(m.avgCpuTemp) : "",
            m ? String(m.avgGpuTemp) : "",
            m ? m.resolution : "",
          ].join(",");
        });
        contents = [header.join(","), ...rows].join("\n");
      } else {
        contents = JSON.stringify(
          filteredSessions.map((s) => ({ date: s.date, durationMin: s.durationMin, metrics: s.metrics ?? null })),
          null,
          2,
        );
      }

      await invoke("save_text_file", { filePath, contents });
      showToast(t("activity.exportedAs", { format: format.toUpperCase() }), "success");
    } catch (error) {
      console.error("Export error:", error);
      showToast(t("activity.exportFailed", { error: String(error) }), "error");
    }
  };

  const filteredSessions = useMemo(() => {
    if (timeframe === "all") return sessions;
    const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sessions.filter((s) => new Date(s.date) >= cutoff);
  }, [sessions, timeframe]);

  const stats = useMemo(() => {
    const totalPlayTimeMin = filteredSessions.reduce((s, sess) => s + sess.durationMin, 0);
    const totalSessions = filteredSessions.length;
    const avgSessionMin = totalSessions > 0 ? Math.round(totalPlayTimeMin / totalSessions) : 0;

    const uniqueDays = new Set<string>();
    filteredSessions.forEach((s) => {
      if (s.date) uniqueDays.add(s.date.slice(0, 10));
    });
    const sortedDays = Array.from(uniqueDays).sort().reverse();

    let currentStreak = 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let checkDate = sortedDays.includes(today) ? today : sortedDays.includes(yesterday) ? yesterday : null;

    if (checkDate) {
      let cursor = new Date(checkDate);
      while (true) {
        const cursorStr = cursor.toISOString().slice(0, 10);
        if (sortedDays.includes(cursorStr)) {
          currentStreak++;
          cursor.setDate(cursor.getDate() - 1);
        } else {
          break;
        }
      }
    }

    let bestStreak = 0;
    if (sortedDays.length > 0) {
      const chronoDays = [...sortedDays].reverse();
      let currentRun = 1;
      bestStreak = 1;
      for (let i = 1; i < chronoDays.length; i++) {
        const prev = new Date(chronoDays[i - 1]);
        const curr = new Date(chronoDays[i]);
        const diffDays = Math.ceil(Math.abs(curr.getTime() - prev.getTime()) / 86_400_000);
        if (diffDays === 1) {
          currentRun++;
        } else if (diffDays > 1) {
          bestStreak = Math.max(bestStreak, currentRun);
          currentRun = 1;
        }
      }
      bestStreak = Math.max(bestStreak, currentRun);
    }

    const dayNames = Array.from({ length: 7 }, (_, i) =>
      new Date(2026, 0, 4 + i).toLocaleDateString(language, { weekday: "short" }),
    );
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    filteredSessions.forEach((s) => {
      dayTotals[new Date(s.date).getDay()] += s.durationMin;
    });
    let maxDayIdx = 0;
    let maxDayVal = -1;
    for (let i = 0; i < 7; i++) {
      if (dayTotals[i] > maxDayVal) {
        maxDayVal = dayTotals[i];
        maxDayIdx = i;
      }
    }
    const mostActiveDay = maxDayVal > 0 ? dayNames[maxDayIdx] : "—";

    let trendDirection: "up" | "down" | "flat" = "flat";
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const entries: { mins: number }[] = [];
    const now = new Date();
    for (let i = timeframeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const daySessions = filteredSessions.filter((s) => s.date && s.date.slice(0, 10) === dateStr);
      entries.push({ mins: daySessions.reduce((sum, s) => sum + s.durationMin, 0) });
    }
    if (entries.length >= 4) {
      const mid = Math.floor(entries.length / 2);
      const firstAvg = entries.slice(0, mid).reduce((sum, e) => sum + e.mins, 0) / mid;
      const secondAvg = entries.slice(mid).reduce((sum, e) => sum + e.mins, 0) / entries.slice(mid).length;
      if (firstAvg !== 0 || secondAvg !== 0) {
        if (firstAvg === 0) trendDirection = "up";
        else {
          const change = ((secondAvg - firstAvg) / firstAvg) * 100;
          if (change > 10) trendDirection = "up";
          else if (change < -10) trendDirection = "down";
        }
      }
    }

    const sortedChronological = [...filteredSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[0].date).toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" })
      : "—";
    const lastPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[sortedChronological.length - 1].date).toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" })
      : "—";

    return {
      totalPlayTimeMin,
      totalSessions,
      avgSessionMin,
      longestSessionMin: filteredSessions.reduce((max, s) => Math.max(max, s.durationMin), 0),
      currentStreak,
      bestStreak,
      trendDirection,
      mostActiveDay,
      activeDaysCount: uniqueDays.size,
      firstPlayed,
      lastPlayed,
    };
  }, [filteredSessions, timeframe, language]);

  const playtimeChartData = useMemo(() => {
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);

    if (playtimeAgg === "AGG_DAY") {
      const dayMap = new Map<string, number>();
      for (let i = timeframeDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dayMap.set(d.toISOString().slice(0, 10), 0);
      }
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 10);
        if (dayMap.has(key)) dayMap.set(key, dayMap.get(key)! + s.durationMin);
      });
      const entries = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => new Date(e[0]).toLocaleDateString(language, { month: "numeric", day: "numeric" })),
      };
    } else if (playtimeAgg === "AGG_WEEK") {
      const weekMap = new Map<string, number>();
      const numWeeks = Math.ceil(timeframeDays / 7);
      for (let i = numWeeks - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(d.setDate(diff));
        weekMap.set(startOfWeek.toISOString().slice(0, 10), 0);
      }
      filteredSessions.forEach((s) => {
        const sDate = new Date(s.date);
        const day = sDate.getDay();
        const diff = sDate.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(sDate.setDate(diff));
        let closestKey = "";
        let minDiff = Infinity;
        for (const k of weekMap.keys()) {
          const diffTime = Math.abs(startOfWeek.getTime() - new Date(k).getTime());
          if (diffTime < minDiff) {
            minDiff = diffTime;
            closestKey = k;
          }
        }
        if (closestKey && minDiff < 7 * 24 * 60 * 60 * 1000) {
          weekMap.set(closestKey, weekMap.get(closestKey)! + s.durationMin);
        }
      });
      const entries = Array.from(weekMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => `${t("gameActivity.weekShort")} ${new Date(e[0]).toLocaleDateString(language, { month: "numeric", day: "numeric" })}`),
      };
    } else {
      const monthMap = new Map<string, number>();
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 7);
        monthMap.set(key, (monthMap.get(key) || 0) + s.durationMin);
      });
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        if (new Date(key + "-01") >= cutoffDate && !monthMap.has(key)) monthMap.set(key, 0);
      }
      const entries = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => new Date(e[0] + "-01").toLocaleDateString(language, { month: "short" })),
      };
    }
  }, [filteredSessions, timeframe, playtimeAgg, language, t]);

  const sessionsWithHw = useMemo(() => {
    return filteredSessions.filter((s) => s.metrics && s.metrics.avgCpuUsage > 0);
  }, [filteredSessions]);

  const hasTemps = useMemo(() => {
    return sessionsWithHw.some((s) => s.metrics && (s.metrics.avgCpuTemp > 0 || s.metrics.avgGpuTemp > 0));
  }, [sessionsWithHw]);

  const hwAverages = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const len = sessionsWithHw.length;
    const clampFps = (v: number) => (!Number.isFinite(v) || v < 0 || v > 1000 ? 0 : Math.round(v));
    const fpsSessions = sessionsWithHw.filter((s) => (s.metrics!.avgFps ?? 0) > 0);
    const fpsLen = fpsSessions.length || 1;
    const avgFps = Math.round(fpsSessions.reduce((sum, s) => sum + clampFps(s.metrics!.avgFps), 0) / fpsLen);
    const maxFps = fpsSessions.reduce((max, s) => Math.max(max, clampFps(s.metrics!.maxFps)), 0);
    const avgCpu = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgCpuUsage, 0) / len);
    const maxCpu = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgCpuUsage), 0);
    const avgGpu = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgGpuUsage, 0) / len);
    const maxGpu = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgGpuUsage), 0);
    const avgCpuT = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgCpuTemp, 0) / len);
    const maxCpuT = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgCpuTemp), 0);
    const avgGpuT = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgGpuTemp, 0) / len);
    const maxGpuT = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgGpuTemp), 0);
    const avgRamPct = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.metrics!.avgRamUsage, 0) / len);
    const maxRamPct = sessionsWithHw.reduce((max, s) => Math.max(max, s.metrics!.avgRamUsage), 0);

    return {
      avgFps, maxFps,
      avgCpu, maxCpu: Math.max(avgCpu, maxCpu),
      avgGpu, maxGpu: Math.max(avgGpu, maxGpu),
      avgCpuT, maxCpuT: Math.max(avgCpuT, maxCpuT),
      avgGpuT, maxGpuT: Math.max(avgGpuT, maxGpuT),
      avgRamPct, maxRamPct: Math.max(avgRamPct, maxRamPct),
    };
  }, [sessionsWithHw]);

  const perfTimelineData = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const selectedSess = isolatedSessionIndex !== null ? sessionsWithHw[isolatedSessionIndex] : null;
    const avgDuration = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.durationMin, 0) / sessionsWithHw.length);
    const durationMin = selectedSess?.durationMin ?? avgDuration;

    const pts = 45;
    const labels: string[] = [];
    for (let i = 0; i < pts; i++) {
      const elapsedSec = Math.round((i / (pts - 1)) * durationMin * 60);
      labels.push(`${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`);
    }

    let cpu: number[], gpu: number[], ram: number[], fps: number[], cpuTemp: number[], gpuTemp: number[];
    let real = false;

    if (selectedSess) {
      const realSeries = buildSingleSessionSeries(selectedSess.metrics, pts);
      if (realSeries) {
        ({ cpu, gpu, ram, fps, cpuTemp, gpuTemp } = realSeries);
        real = true;
      } else {
        const m = selectedSess.metrics!;
        const seedStr = selectedSess.id;
        cpu = generateConsistentSeries(m.avgCpuUsage, Math.max(0, m.avgCpuUsage - 15), Math.min(100, m.avgCpuUsage + 20), pts, seedStr + "-cpu");
        gpu = generateConsistentSeries(m.avgGpuUsage, Math.max(0, m.avgGpuUsage - 10), Math.min(100, m.avgGpuUsage + 15), pts, seedStr + "-gpu");
        ram = generateConsistentSeries(m.avgRamUsage, Math.max(0, m.avgRamUsage - 5), Math.min(100, m.avgRamUsage + 5), pts, seedStr + "-ram");
        fps = m.avgFps > 0 ? generateConsistentSeries(m.avgFps, m.minFps, m.maxFps, pts, seedStr + "-fps") : new Array(pts).fill(0);
        cpuTemp = hasTemps ? generateConsistentSeries(m.avgCpuTemp, Math.max(35, m.avgCpuTemp - 8), Math.min(100, m.avgCpuTemp + 10), pts, seedStr + "-cputemp") : [];
        gpuTemp = hasTemps ? generateConsistentSeries(m.avgGpuTemp, Math.max(35, m.avgGpuTemp - 6), Math.min(100, m.avgGpuTemp + 8), pts, seedStr + "-gputemp") : [];
      }
    } else {
      const realSeries = buildTimelineFromSessions(sessionsWithHw, pts);
      if (realSeries) {
        ({ cpu, gpu, ram, fps, cpuTemp, gpuTemp } = realSeries);
        real = true;
      } else if (hwAverages) {
        const seedStr = "all-average";
        cpu = generateConsistentSeries(hwAverages.avgCpu, Math.max(0, hwAverages.avgCpu - 15), Math.min(100, hwAverages.avgCpu + 20), pts, seedStr + "-cpu");
        gpu = generateConsistentSeries(hwAverages.avgGpu, Math.max(0, hwAverages.avgGpu - 10), Math.min(100, hwAverages.avgGpu + 15), pts, seedStr + "-gpu");
        ram = generateConsistentSeries(hwAverages.avgRamPct, Math.max(0, hwAverages.avgRamPct - 5), Math.min(100, hwAverages.avgRamPct + 5), pts, seedStr + "-ram");
        fps = hwAverages.avgFps > 0 ? generateConsistentSeries(hwAverages.avgFps, Math.round(hwAverages.avgFps * 0.8), hwAverages.maxFps, pts, seedStr + "-fps") : new Array(pts).fill(0);
        cpuTemp = hasTemps ? generateConsistentSeries(hwAverages.avgCpuT, Math.max(35, hwAverages.avgCpuT - 8), Math.min(100, hwAverages.avgCpuT + 10), pts, seedStr + "-cputemp") : [];
        gpuTemp = hasTemps ? generateConsistentSeries(hwAverages.avgGpuT, Math.max(35, hwAverages.avgGpuT - 6), Math.min(100, hwAverages.avgGpuT + 8), pts, seedStr + "-gputemp") : [];
      } else {
        return null;
      }
    }

    return { cpu, gpu, cpuTemp, gpuTemp, ram, fps, labels, real };
  }, [sessionsWithHw, isolatedSessionIndex, hwAverages, hasTemps]);

  const comparison = useMemo(() => buildPeriodComparison(sessions, timeframe), [sessions, timeframe]);
  const records = useMemo(
    () => buildRecords({ sessions: filteredSessions, games: [], language, scope: "game" }),
    [filteredSessions, language],
  );
  const milestones = useMemo(() => buildMilestoneLadders(sessions, "game"), [sessions]);

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Icons.History size={24} />}
        title={t("gameActivity.noSessionsTitle")}
        hint={t("activityInsights.gameEmptyHint")}
      />
    );
  }

  return (
    <>
      <div className="game-activity-tab act-stack">
        <div className="act-toolbar">
          <div className="act-toolbar__left">
            <Segmented<ViewMode>
              ariaLabel={t("nav.activity")}
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "playtime", label: <><Icons.Clock size={13} /> {t("activity.playtime")}</> },
                { value: "performance", label: <><Icons.BarChart3 size={13} /> {t("activity.performance")}</> },
              ]}
            />
            <RangePills value={timeframe} onChange={setTimeframe} />
          </div>

          <div className="act-toolbar__right">
            <button
              type="button"
              className="act-icon-btn"
              title={t("gameActivity.saveScreenshotBtn")}
              aria-label={t("gameActivity.saveScreenshotBtn")}
              onClick={handleCaptureScreenshot}
            >
              <Icons.Camera size={14} />
            </button>
            <Button variant="secondary" size="sm" leftIcon={<Icons.Download size={13} />} onClick={() => handleExportSessions("csv")}>
              {t("activity.exportCsv")}
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Icons.Download size={13} />} onClick={() => handleExportSessions("json")}>
              {t("activity.exportJson")}
            </Button>
          </div>
        </div>

        {viewMode === "playtime" ? (
          <GameActivityPlaytimeView
            game={game}
            stats={stats}
            allSessions={sessions}
            playtimeChartData={playtimeChartData}
            filteredSessions={filteredSessions}
            sessionsWithHw={sessionsWithHw}
            timeframe={timeframe}
            playtimeAgg={playtimeAgg}
            onAggChange={setPlaytimeAgg}
            playtimeChartStyle={playtimeChartStyle}
            onStyleChange={setPlaytimeChartStyle}
            onRequestDelete={setPendingDeleteId}
            comparison={comparison}
            records={records}
            milestones={milestones}
            hasTemps={hasTemps}
            tempUnit={tempUnit}
          />
        ) : (
          <GameActivityPerformanceView
            filteredSessions={filteredSessions}
            sessionsWithHw={sessionsWithHw}
            hasTemps={hasTemps}
            hwAverages={hwAverages}
            perfTimelineData={perfTimelineData}
            isolatedSessionIndex={isolatedSessionIndex}
            setIsolatedSessionIndex={setIsolatedSessionIndex}
            tempUnit={tempUnit}
          />
        )}
      </div>
      <ConfirmModal
        open={pendingDeleteId !== null}
        title={t("gameActivity.deleteTitle")}
        message={<span>{t("gameActivity.deleteBody")}</span>}
        confirmLabel={t("gameActivity.deleteSession")}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) {
            deleteSession(pendingDeleteId);
            setIsolatedSessionIndex(null);
          }
          setPendingDeleteId(null);
        }}
      />
    </>
  );
}
