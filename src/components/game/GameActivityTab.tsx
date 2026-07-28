import { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import html2canvas from "html2canvas";
import { prepareClonedDocumentForCanvasCapture } from "../../utils/color";
import { useActivity } from "../../context/ActivityContext";
import { useSettings } from "../../context/SettingsContext";
import { useToast } from "../../context/ToastContext";
import { type Game, type GameSession, formatPlayTime } from "../../types/game";
import { formatTemp, toDisplayTemps, tempMinY, tempMaxY, tempThreshold } from "../../utils/temp";
import { buildTimelineFromSessions, buildSingleSessionSeries } from "../../utils/perfSamples";
import BarChart from "../charts/BarChart";
import LineChart from "../charts/LineChart";
import { ConfirmModal } from "../ui/ConfirmModal";
import { useLanguage } from "../../context/LanguageContext";

type Timeframe = "7d" | "30d" | "90d" | "all";
type ViewMode = "playtime" | "performance";
type PlaytimeChartStyle = "bar" | "line";
type PlaytimeAggregation = "AGG_DAY" | "AGG_WEEK" | "AGG_MONTH";

// Seeded series generator to create smooth curves mathematically consistent with session metrics
function generateConsistentSeries(avgVal: number, minVal: number, maxVal: number, N: number, seedStr: string): number[] {
  if (minVal === maxVal) {
    return Array(N).fill(avgVal);
  }

  const series: number[] = Array(N).fill(avgVal);
  series[0] = minVal;
  series[Math.floor(N / 2)] = maxVal;

  let seed = seedStr.split("").reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const spread = (maxVal - minVal) / 4;
  for (let i = 1; i < N - 1; i++) {
    if (i === Math.floor(N / 2)) continue;
    const noise = rnd() * 2 - 1;
    series[i] = Math.max(minVal, Math.min(maxVal, Math.round(avgVal + noise * spread)));
  }

  // Adjust values so the average matches exactly
  const targetSum = avgVal * N;
  let currentSum = series.reduce((sum, val) => sum + val, 0);
  let attempts = 0;
  
  while (currentSum !== targetSum && attempts < 100) {
    attempts++;
    const diff = targetSum - currentSum;
    const step = diff > 0 ? 1 : -1;
    
    for (let i = 0; i < N; i++) {
      const newVal = series[i] + step;
      if (newVal >= minVal && newVal <= maxVal) {
        series[i] = newVal;
        currentSum += step;
        if (currentSum === targetSum) break;
      }
    }
  }

  return series;
}

export function GameActivityTab({ game }: { game: Game }) {
  const { getGameSessions, deleteSession } = useActivity();
  const { tempUnit } = useSettings();
  // Toast feedback for screenshot success / error — GameActivityTab is
  // a sibling component to GameDetail, so its own useToast() (rather
  // than the one inside GameDetail) is in scope here.
  const { showToast } = useToast();
  const { t } = useLanguage();
  const sessions = useMemo(() => getGameSessions(game.id), [game.id, getGameSessions]);

  const [viewMode, setViewMode] = useState<ViewMode>("playtime");
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [playtimeChartStyle, setPlaytimeChartStyle] = useState<PlaytimeChartStyle>("bar");
  const [playtimeAgg, setPlaytimeAgg] = useState<PlaytimeAggregation>("AGG_DAY");
  const [isolatedSessionIndex, setIsolatedSessionIndex] = useState<number | null>(null);
  // Pending session id awaiting delete confirmation via ConfirmModal
  // (replaces the native window.confirm so the dialog matches the app's
  // design language instead of a blocking browser prompt).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleCaptureScreenshot = async () => {
    try {
      const container = document.querySelector(".game-activity-tab");
      if (!container) return;

      // Capture the *entire* activity view in height, not just the
      // currently-visible portion. scrollHeight reflects the full
      // rendered tab including content below the fold; passing it as
      // both `height` and `windowHeight` lets html2canvas paint the
      // complete layout in one pass instead of just viewport-clipped
      // pixels.
      const fullHeight = (container as HTMLElement).scrollHeight;
      const fullWidth = (container as HTMLElement).scrollWidth;

      const canvas = await html2canvas(container as HTMLElement, {
        backgroundColor: "#0f1117",
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

  // Build a CSV / JSON export of the currently filtered sessions and open
  // the native save dialog. Telemetry columns are only present when the
  // session recorded hardware metrics, so missing values render as empty.
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
          filteredSessions.map((s) => ({
            date: s.date,
            durationMin: s.durationMin,
            metrics: s.metrics ?? null,
          })),
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

  // Close the export dropdown when clicking outside of it.
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        const menu = exportMenuRef.current.querySelector(".game-activity-export-menu") as HTMLElement | null;
        if (menu) menu.style.display = "none";
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filteredSessions = useMemo(() => {
    if (timeframe === "all") return sessions;
    const days = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sessions.filter((s) => new Date(s.date) >= cutoff);
  }, [sessions, timeframe]);

  // Compute stats on the fly based on filtered sessions
  const stats = useMemo(() => {
    const totalPlayTimeMin = filteredSessions.reduce((s, sess) => s + sess.durationMin, 0);
    const totalSessions = filteredSessions.length;
    const avgSessionMin = totalSessions > 0 ? Math.round(totalPlayTimeMin / totalSessions) : 0;
    
    // Streaks
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
        const diffTime = Math.abs(curr.getTime() - prev.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          currentRun++;
        } else if (diffDays > 1) {
          bestStreak = Math.max(bestStreak, currentRun);
          currentRun = 1;
        }
      }
      bestStreak = Math.max(bestStreak, currentRun);
    }

    // Most active day
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    filteredSessions.forEach((s) => {
      const d = new Date(s.date).getDay();
      dayTotals[d] += s.durationMin;
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

    // Playtime trend (compare first half to second half of timeframe days)
    let trendDirection: "up" | "down" | "flat" = "flat";
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const entries: { date: string; mins: number }[] = [];
    const now = new Date();
    for (let i = timeframeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const daySessions = filteredSessions.filter((s) => s.date && s.date.slice(0, 10) === dateStr);
      entries.push({ date: dateStr, mins: daySessions.reduce((sum, s) => sum + s.durationMin, 0) });
    }
    if (entries.length >= 4) {
      const mid = Math.floor(entries.length / 2);
      const firstHalf = entries.slice(0, mid);
      const secondHalf = entries.slice(mid);
      const firstAvg = firstHalf.reduce((sum, e) => sum + e.mins, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, e) => sum + e.mins, 0) / secondHalf.length;
      if (firstAvg !== 0 || secondAvg !== 0) {
        if (firstAvg === 0) trendDirection = "up";
        else {
          const change = ((secondAvg - firstAvg) / firstAvg) * 100;
          if (change > 10) trendDirection = "up";
          else if (change < -10) trendDirection = "down";
        }
      }
    }

    // First and last play dates
    const sortedChronological = [...filteredSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const firstPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[0].date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
      : "—";
    const lastPlayed = sortedChronological.length > 0
      ? new Date(sortedChronological[sortedChronological.length - 1].date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
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
  }, [filteredSessions, timeframe]);

  // Grouped playtime data for aggregation tabs (AGG_DAY, AGG_WEEK, AGG_MONTH)
  const playtimeChartData = useMemo(() => {
    const timeframeDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);
    
    if (playtimeAgg === "AGG_DAY") {
      const dayMap = new Map<string, number>();
      for (let i = timeframeDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dayMap.set(key, 0);
      }
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 10);
        if (dayMap.has(key)) {
          dayMap.set(key, dayMap.get(key)! + s.durationMin);
        }
      });
      const entries = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => {
          const d = new Date(e[0]);
          return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
        }),
      };
    } else if (playtimeAgg === "AGG_WEEK") {
      const weekMap = new Map<string, number>();
      const numWeeks = Math.ceil(timeframeDays / 7);
      for (let i = numWeeks - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
        const startOfWeek = new Date(d.setDate(diff));
        const key = startOfWeek.toISOString().slice(0, 10);
        weekMap.set(key, 0);
      }
      filteredSessions.forEach((s) => {
        const sDate = new Date(s.date);
        const day = sDate.getDay();
        const diff = sDate.getDate() - day + (day === 0 ? -6 : 1);
        const startOfWeek = new Date(sDate.setDate(diff));
        
        let closestKey = "";
        let minDiff = Infinity;
        for (const k of weekMap.keys()) {
          const kDate = new Date(k);
          const diffTime = Math.abs(startOfWeek.getTime() - kDate.getTime());
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
        labels: entries.map((e) => {
          const d = new Date(e[0]);
          return "Wk " + d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
        }),
      };
    } else {
      const monthMap = new Map<string, number>();
      filteredSessions.forEach((s) => {
        const key = s.date.slice(0, 7); // YYYY-MM
        monthMap.set(key, (monthMap.get(key) || 0) + s.durationMin);
      });
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        if (new Date(key + "-01") >= cutoffDate) {
          if (!monthMap.has(key)) {
            monthMap.set(key, 0);
          }
        }
      }
      const entries = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return {
        data: entries.map((e) => e[1]),
        labels: entries.map((e) => {
          const d = new Date(e[0] + "-01");
          return d.toLocaleDateString("en-US", { month: "short" });
        }),
      };
    }
  }, [filteredSessions, timeframe, playtimeAgg]);

  // Filter hardware sessions (those containing non-zero telemetry).
  // Note: FPS-sanitized sessions whose avgFps collapsed to 0 are kept here
  // because their CPU/GPU/RAM/temp data is still valid for the other perf
  // charts. The empty-FPS sample is filtered at series-build time below
  // so only the FPS chart sees the gap, not CPU/GPU/RAM.
  const sessionsWithHw = useMemo(() => {
    return filteredSessions.filter((s) => s.metrics && s.metrics.avgCpuUsage > 0);
  }, [filteredSessions]);

  // Check if we have real temperature data (WMI returns 0 if unsupported/disabled)
  const hasTemps = useMemo(() => {
    return sessionsWithHw.some((s) => s.metrics && (s.metrics.avgCpuTemp > 0 || s.metrics.avgGpuTemp > 0));
  }, [sessionsWithHw]);

  // Aggregate averages and max values for mini hardware cards.
  const hwAverages = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const len = sessionsWithHw.length;
    const clampFps = (v: number) => {
      if (!Number.isFinite(v) || v < 0 || v > 1000) return 0;
      return Math.round(v);
    };
    // FPS average must only consider sessions that actually recorded FPS.
    // Sessions whose avgFps sanitized to 0 (e.g. FPS telemetry not captured
    // but CPU/GPU/RAM were) must be excluded, otherwise they pollute the
    // average with 0s and under-report perf — matching the Activity main
    // tab's `hwSessions` filter (s.metrics.avgFps > 0).
    const fpsSessions = sessionsWithHw.filter((s) => (s.metrics!.avgFps ?? 0) > 0);
    const fpsLen = fpsSessions.length || 1;
    const avgFps = Math.round(
      fpsSessions.reduce((sum, s) => sum + clampFps(s.metrics!.avgFps), 0) / fpsLen
    );
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

  // Build performance curves. Prefer the real per-sample telemetry captured
  // during the session(s) — this matches the Activity session log. When a
  // selection has no sessions with captured samples, fall back to a
  // deterministic synthetic curve shaped from the recorded averages so the
  // timeline still renders something coherent.
  const perfTimelineData = useMemo(() => {
    if (sessionsWithHw.length === 0) return null;
    const selectedSess = isolatedSessionIndex !== null ? sessionsWithHw[isolatedSessionIndex] : null;

    // Average duration of sessions with hardware (used to scale the time axis)
    const avgDuration = Math.round(sessionsWithHw.reduce((sum, s) => sum + s.durationMin, 0) / sessionsWithHw.length);
    const durationMin = selectedSess?.durationMin ?? avgDuration;

    const pts = 45;

    const labels: string[] = [];
    for (let i = 0; i < pts; i++) {
      const f = i / (pts - 1);
      const elapsedSec = Math.round(f * durationMin * 60);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      labels.push(`${m}:${String(s).padStart(2, "0")}`);
    }

    let cpu: number[], gpu: number[], ram: number[], fps: number[], cpuTemp: number[], gpuTemp: number[];
    let real = false;

    if (selectedSess) {
      const realSeries = buildSingleSessionSeries(selectedSess.metrics, pts);
      if (realSeries) {
        cpu = realSeries.cpu;
        gpu = realSeries.gpu;
        ram = realSeries.ram;
        fps = realSeries.fps;
        cpuTemp = realSeries.cpuTemp;
        gpuTemp = realSeries.gpuTemp;
        real = true;
      } else {
        // No real samples for this session — synthesize from its averages.
        const m = selectedSess.metrics!;
        const seedStr = selectedSess.id;
        cpu = generateConsistentSeries(m.avgCpuUsage, Math.max(0, m.avgCpuUsage - 15), Math.min(100, m.avgCpuUsage + 20), pts, seedStr + "-cpu");
        gpu = generateConsistentSeries(m.avgGpuUsage, Math.max(0, m.avgGpuUsage - 10), Math.min(100, m.avgGpuUsage + 15), pts, seedStr + "-gpu");
        ram = generateConsistentSeries(m.avgRamUsage, Math.max(0, m.avgRamUsage - 5), Math.min(100, m.avgRamUsage + 5), pts, seedStr + "-ram");
        fps = m.avgFps > 0
          ? generateConsistentSeries(m.avgFps, m.minFps, m.maxFps, pts, seedStr + "-fps")
          : new Array(pts).fill(0);
        cpuTemp = hasTemps ? generateConsistentSeries(m.avgCpuTemp, Math.max(35, m.avgCpuTemp - 8), Math.min(100, m.avgCpuTemp + 10), pts, seedStr + "-cputemp") : [];
        gpuTemp = hasTemps ? generateConsistentSeries(m.avgGpuTemp, Math.max(35, m.avgGpuTemp - 6), Math.min(100, m.avgGpuTemp + 8), pts, seedStr + "-gputemp") : [];
      }
    } else {
      const realSeries = buildTimelineFromSessions(sessionsWithHw, pts);
      if (realSeries) {
        cpu = realSeries.cpu;
        gpu = realSeries.gpu;
        ram = realSeries.ram;
        fps = realSeries.fps;
        cpuTemp = realSeries.cpuTemp;
        gpuTemp = realSeries.gpuTemp;
        real = true;
      } else if (hwAverages) {
        // No real samples for any session — synthesize from blended averages.
        const seedStr = "all-average";
        cpu = generateConsistentSeries(hwAverages.avgCpu, Math.max(0, hwAverages.avgCpu - 15), Math.min(100, hwAverages.avgCpu + 20), pts, seedStr + "-cpu");
        gpu = generateConsistentSeries(hwAverages.avgGpu, Math.max(0, hwAverages.avgGpu - 10), Math.min(100, hwAverages.avgGpu + 15), pts, seedStr + "-gpu");
        ram = generateConsistentSeries(hwAverages.avgRamPct, Math.max(0, hwAverages.avgRamPct - 5), Math.min(100, hwAverages.avgRamPct + 5), pts, seedStr + "-ram");
        fps = hwAverages.avgFps > 0
          ? generateConsistentSeries(hwAverages.avgFps, Math.round(hwAverages.avgFps * 0.8), hwAverages.maxFps, pts, seedStr + "-fps")
          : new Array(pts).fill(0);
        cpuTemp = hasTemps ? generateConsistentSeries(hwAverages.avgCpuT, Math.max(35, hwAverages.avgCpuT - 8), Math.min(100, hwAverages.avgCpuT + 10), pts, seedStr + "-cputemp") : [];
        gpuTemp = hasTemps ? generateConsistentSeries(hwAverages.avgGpuT, Math.max(35, hwAverages.avgGpuT - 6), Math.min(100, hwAverages.avgGpuT + 8), pts, seedStr + "-gputemp") : [];
      } else {
        return null;
      }
    }

    return { cpu, gpu, cpuTemp, gpuTemp, ram, fps, labels, real };
  }, [sessionsWithHw, isolatedSessionIndex, hwAverages, hasTemps]);

  if (sessions.length === 0) {
    return (
      <div className="game-activity-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <p>{t("activity.noSessions")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="game-activity-tab">
      {/* Top Header Panel */}
      <div className="game-activity-header">
        <div className="game-activity-title-group">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
          <h2>{t("nav.activity")}</h2>
        </div>

        <div className="game-activity-controls">
          {/* Tabs: Playtime / Performance */}
          <div className="game-activity-toggle-group">
            <button
              className={`game-activity-toggle-btn ${viewMode === "playtime" ? "active" : ""}`}
              onClick={() => setViewMode("playtime")}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {t("activity.playtime")}
            </button>
            <button
              className={`game-activity-toggle-btn ${viewMode === "performance" ? "active" : ""}`}
              onClick={() => setViewMode("performance")}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="1" y1="9" x2="4" y2="9" />
              </svg>
              {t("activity.performance")}
            </button>
          </div>

          {/* Timeframe selector */}
          <div className="game-activity-timeframe-group">
            {(["7d", "30d", "90d", "all"] as const).map((tf) => (
              <button
                key={tf}
                className={`game-activity-timeframe-btn ${timeframe === tf ? "active" : ""}`}
                onClick={() => {
                  setTimeframe(tf);
                  setIsolatedSessionIndex(null);
                }}
              >
                {tf === "7d" ? t("activity.7d") : tf === "30d" ? t("activity.30d") : tf === "90d" ? t("activity.90d") : t("activity.allTime")}
              </button>
            ))}
          </div>

          {/* Camera screenshot button */}
           <button className="game-activity-action-btn" title={t("gameActivity.saveScreenshotBtn")} onClick={handleCaptureScreenshot}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
            </svg>
          </button>

          {/* Export sessions (CSV / JSON) */}
          <div className="game-activity-export-group" ref={exportMenuRef}>
            <button
              className="game-activity-action-btn"
              title={t("activity.exportBtn")}
              onClick={(e) => {
                const menu = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (menu) menu.style.display = menu.style.display === "block" ? "none" : "block";
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <div className="game-activity-export-menu">
               <button onClick={() => handleExportSessions("csv")}>{t("activity.exportCsv")}</button>
               <button onClick={() => handleExportSessions("json")}>{t("activity.exportJson")}</button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Two-column layout grid */}
      <div className="game-activity-layout">
        {/* Left Column: 11 cards + sessions list */}
        <div className="game-activity-left-col">
          <div className="game-activity-stats-grid">
            <StatCard
              label={t("activity.totalPlaytime")}
              value={formatPlayTime(stats.totalPlayTimeMin)}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            />
            <StatCard
              label={t("activity.sessions")}
              value={stats.totalSessions}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
            />
            <StatCard
              label={t("activity.avgSession")}
              value={stats.avgSessionMin > 0 ? `${stats.avgSessionMin}m` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
            />
            <StatCard
              label={t("activity.longestSession")}
              value={stats.longestSessionMin > 0 ? formatPlayTime(stats.longestSessionMin) : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" /><path d="M12 2a6 6 0 0 1 6 6v5a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8a6 6 0 0 1 6-6z" /></svg>}
            />
            <StatCard
              label={t("activity.currentStreak")}
              value={stats.currentStreak > 0 ? `${stats.currentStreak}d` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
            />
            <StatCard
              label={t("activity.bestStreak")}
              value={stats.bestStreak > 0 ? `${stats.bestStreak}d` : "—"}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
            />
            <StatCard
              label={t("activity.trend")}
              value={stats.trendDirection === "up" ? t("activity.increasing") : stats.trendDirection === "down" ? t("activity.decreasing") : t("activity.flat")}
              icon={
                stats.trendDirection === "up" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
                ) : stats.trendDirection === "down" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                )
              }
            />
            <StatCard
              label={t("activity.mostActiveDay")}
              value={stats.mostActiveDay}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label={t("activity.activeDays")}
              value={stats.activeDaysCount}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label={t("activity.firstSession")}
              value={stats.firstPlayed}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            />
            <StatCard
              label={t("activity.lastSession")}
              value={stats.lastPlayed}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
              className="game-activity-stat-card-full"
            />
          </div>

          {/* RECENT SESSIONS */}
          <div className="game-activity-recent-sessions">
            <h3 className="game-activity-sessions-title">
              {t("activity.recentSessions")}
              <span className="game-activity-sessions-count-tag">{filteredSessions.length}</span>
            </h3>
            {filteredSessions.map((session) => {
              const hwIndex = sessionsWithHw.findIndex((s) => s.id === session.id);
              const isSelected = isolatedSessionIndex === hwIndex && hwIndex !== -1;
              const hasHw = hwIndex !== -1;

              const formattedDate = new Date(session.date).toLocaleDateString("en-US", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const startTimeStr = new Date(session.date).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const endTimeStr = new Date(new Date(session.date).getTime() + session.durationMin * 60000).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={session.id}
                  className={`game-activity-session-card${isSelected ? " active" : ""}`}
                  onClick={() => {
                    if (hasHw) {
                      setIsolatedSessionIndex(isSelected ? null : hwIndex);
                    }
                  }}
                  style={{
                    cursor: hasHw ? "pointer" : "default",
                    opacity: hasHw ? 1 : 0.75
                  }}
                >
                  <div className="game-activity-session-info">
                    <span className="game-activity-session-date">
                      {formattedDate}
                      {hasHw && (
                        <span
                          style={{
                            marginLeft: "var(--space-xs)",
                            fontSize: "10px",
                            background: isSelected ? "var(--color-accent)" : "var(--color-bg-tertiary)",
                            color: isSelected ? "#fff" : "var(--color-text-secondary)",
                            padding: "1px 4.5px",
                            borderRadius: "var(--radius-xs)"
                          }}
                        >
                           {t("activity.telemetry")}
                        </span>
                      )}
                    </span>
                    <span className="game-activity-session-time">{startTimeStr} — {endTimeStr}</span>
                  </div>
                  <span className="game-activity-session-duration">{formatPlayTime(session.durationMin)}</span>
                  <button
                    className="game-activity-session-delete-btn"
                     title={t("activity.deleteSessionBtn")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteId(session.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column */}
        <div className="game-activity-right-col">
          {viewMode === "playtime" ? (
            <>
              {/* Playtime Panel */}
              <div className="game-activity-panel">
                <div className="game-activity-panel-header">
                  <h3 className="game-activity-panel-title">
                    Total Playtime: <strong>{formatPlayTime(stats.totalPlayTimeMin)}</strong>
                  </h3>
                  
                  <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
                    <div className="game-activity-agg-tabs">
                      {(["AGG_DAY", "AGG_WEEK", "AGG_MONTH"] as const).map((agg) => (
                        <button
                          key={agg}
                          className={`game-activity-agg-btn ${playtimeAgg === agg ? "active" : ""}`}
                          onClick={() => setPlaytimeAgg(agg)}
                        >
                          {agg === "AGG_DAY" ? t("activity.1d") : agg === "AGG_WEEK" ? t("activity.1w") : t("activity.1m")}
                        </button>
                      ))}
                    </div>

                    <div className="game-activity-style-toggle">
                      <button
                        className={`game-activity-style-btn ${playtimeChartStyle === "bar" ? "active" : ""}`}
                        onClick={() => setPlaytimeChartStyle("bar")}
                        title={t("activity.barChart")}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" /><line x1="6" y1="20" x2="6" y2="14" />
                        </svg>
                      </button>
                      <button
                        className={`game-activity-style-btn ${playtimeChartStyle === "line" ? "active" : ""}`}
                        onClick={() => setPlaytimeChartStyle("line")}
                        title={t("activity.lineChart")}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {playtimeChartData.data.length > 0 ? (
                  playtimeChartStyle === "bar" ? (
                    <BarChart
                      data={playtimeChartData.data}
                      labels={playtimeChartData.labels}
                      formatValue={formatPlayTime}
                      height={220}
                    />
                  ) : (
                    <LineChart
                      series={[
                        { data: playtimeChartData.data, color: "var(--color-accent)", label: t("activity.playtime") }
                      ]}
                      labels={playtimeChartData.labels}
                      formatValue={formatPlayTime}
                      height={220}
                    />
                  )
                ) : (
                  <div style={{ height: "220px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-muted)" }}>
                    {t("activity.noPlaytimeData")}
                  </div>
                )}
              </div>

              {/* Heatmap Panel */}
              <div className="game-activity-panel">
                <WeeklyHeatmap sessions={filteredSessions} timeframeDays={timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : timeframe === "90d" ? 90 : 365} t={t} />
              </div>
            </>
          ) : (
            <>
              {/* Performance View */}
              {sessionsWithHw.length > 0 && hwAverages ? (
                <>
                  {/* Hardware mini cards */}
                  <div className="game-activity-perf-cards">
                    <PerfMiniCard label={t("activityPerf.avgFps")} avg={`${hwAverages.avgFps}`} max={`MAX: ${hwAverages.maxFps}`} />
                    <PerfMiniCard label={t("activityPerf.cpuUsage")} avg={`${hwAverages.avgCpu}%`} max={`MAX: ${hwAverages.maxCpu}%`} />
                    <PerfMiniCard label={t("activityPerf.gpuUsage")} avg={`${hwAverages.avgGpu}%`} max={`MAX: ${hwAverages.maxGpu}%`} />
                    <PerfMiniCard label={t("activityPerf.ramUsage")} avg={`${hwAverages.avgRamPct}%`} max={`MAX: ${hwAverages.maxRamPct}%`} />
                    {hasTemps && (
                      <>
                        <PerfMiniCard label={t("activityPerf.cpuTemp")} avg={formatTemp(hwAverages.avgCpuT, tempUnit)} max={`MAX: ${formatTemp(hwAverages.maxCpuT, tempUnit)}`} />
                        <PerfMiniCard label={t("activityPerf.gpuTemp")} avg={formatTemp(hwAverages.avgGpuT, tempUnit)} max={`MAX: ${formatTemp(hwAverages.maxGpuT, tempUnit)}`} />
                      </>
                    )}
                  </div>

                  {/* Isolated session selector */}
                  {sessionsWithHw.length > 1 && (
                    <div className="game-activity-panel" style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            {t("activity.sessionTelemetry")}
                          </span>
                        <select
                          style={{
                            background: "var(--color-bg-primary)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-primary)",
                            fontSize: "var(--font-size-xs)",
                            padding: "4px 8px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                          value={isolatedSessionIndex !== null ? String(isolatedSessionIndex) : "all"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setIsolatedSessionIndex(val === "all" ? null : Number(val));
                          }}
                        >
                          <option value="all">{t("activityPerf.allSessionsAvg")}</option>
                          {sessionsWithHw.map((s, i) => (
                            <option key={s.id} value={String(i)}>
                              {new Date(s.date).toLocaleDateString("en-US", { day: "numeric", month: "short" })} - {formatPlayTime(s.durationMin)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Stacked Charts */}
                  {perfTimelineData && (
                    <div className="game-activity-stacked-charts">
                      <p className="game-activity-perf-estimated-note">
                        {perfTimelineData.real
                          ? t("gameActivity.curveReal")
                          : t("gameActivity.curveEstimated")}
                      </p>
                      <ChartSection title={t("gameActivity.chartCpuGpu")}>
                        <LineChart
                          series={[
                            { data: perfTimelineData.cpu, color: "#3e62c0", label: t("activityPerf.cpuUsage") },
                            { data: perfTimelineData.gpu, color: "#9b59b6", label: t("activityPerf.gpuUsage") },
                          ]}
                          labels={perfTimelineData.labels}
                          height={180}
                          minY={0}
                          maxY={100}
                          smooth
                          thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                          formatValue={(v) => `${Math.round(v)}%`}
                        />
                      </ChartSection>

                      {hasTemps && (
                        <ChartSection title={t("gameActivity.chartTemps")}>
                          <LineChart
                            series={[
                              { data: toDisplayTemps(perfTimelineData.cpuTemp, tempUnit), color: "#ffab00", label: t("activityPerf.cpuTemp") },
                              { data: toDisplayTemps(perfTimelineData.gpuTemp, tempUnit), color: "#ff5252", label: t("activityPerf.gpuTemp") },
                            ]}
                            labels={perfTimelineData.labels}
                            height={180}
                            minY={tempMinY(tempUnit)}
                            maxY={tempMaxY(tempUnit)}
                            smooth
                            bands={[
                              { from: tempThreshold(85, tempUnit), to: tempMaxY(tempUnit), color: "var(--color-danger)", opacity: 0.1 },
                            ]}
                            thresholds={[
                              { value: tempThreshold(75, tempUnit), label: t("activityPerf.warmThreshold"), color: "var(--color-warning)" },
                              { value: tempThreshold(85, tempUnit), label: t("activityPerf.hotThreshold"), color: "var(--color-danger)" },
                            ]}
                            formatValue={(v) => formatTemp(v, tempUnit)}
                          />
                        </ChartSection>
                      )}

                      <ChartSection title={t("gameActivity.chartRam")}>
                          <LineChart
                            series={[
                              { data: perfTimelineData.ram, color: "#2ecc71", label: t("activityPerf.ramUsage") }
                            ]}
                            labels={perfTimelineData.labels}
                            height={180}
                            minY={0}
                            maxY={100}
                            smooth
                            thresholds={[{ value: 90, label: t("activityPerf.highPercentile"), color: "var(--color-warning)" }]}
                            formatValue={(v) => `${v}%`}
                          />
                      </ChartSection>

                      <ChartSection title={t("gameActivity.chartFps")}>
                          <LineChart
                            series={[
                              { data: perfTimelineData.fps, color: "#16b195", label: t("activityPerf.fps") }
                            ]}
                            labels={perfTimelineData.labels}
                            height={180}
                            minY={0}
                            niceMax
                            smooth
                            thresholds={[{ value: 60, label: t("activityPerf.threshold60fps"), color: "var(--color-success)" }]}
                            formatValue={(v) => `${Math.round(v)} FPS`}
                          />
                      </ChartSection>
                    </div>
                  )}
                </>
              ) : (
                <div className="game-activity-empty-state">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {filteredSessions.length > 0 ? (
                    <p>
                      {t("gameActivity.sessionCount", { count: filteredSessions.length, s: filteredSessions.length > 1 ? "s" : "" })} {t("gameActivity.noPerformanceHint")}
                    </p>
                  ) : (
                    <p>{t("gameActivity.noPerformance")}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    <ConfirmModal
      open={pendingDeleteId !== null}
      title={t("gameActivity.deleteTitle")}
      message={
        <span>
          {t("gameActivity.deleteBody")}
        </span>
      }
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

// ─── Stats Card Helper ────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon,
  className = "",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`game-activity-stat-card ${className}`}>
      <div className="game-activity-stat-icon">{icon}</div>
      <div className="game-activity-stat-details">
        <span className="game-activity-stat-label">{label}</span>
        <span className="game-activity-stat-value">{value}</span>
      </div>
    </div>
  );
}

// ─── Performance Mini Card Helper ─────────────────────────────────────────────
function PerfMiniCard({ label, avg, max }: { label: string; avg: string; max: string }) {
  return (
    <div className="game-activity-perf-card">
      <span className="game-activity-perf-label">{label}</span>
      <div className="game-activity-perf-values">
        <span className="game-activity-perf-avg">{avg}</span>
        <span className="game-activity-perf-max">{max}</span>
      </div>
    </div>
  );
}

// ─── Chart Section Helper ─────────────────────────────────────────────────────
function ChartSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="game-activity-chart-section">
      <span className="game-activity-chart-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        {title}
      </span>
      <div className="game-activity-chart-box">{children}</div>
    </div>
  );
}

// ─── Heatmap Subcomponent ─────────────────────────────────────────────────────
function WeeklyHeatmap({ sessions, timeframeDays = 365, t }: { sessions: GameSession[]; timeframeDays?: number; t: (key: string, vars?: Record<string, unknown>) => string }) {
  
  const cells = useMemo(() => {
    const list: { date: string; duration: number }[] = [];
    const dayMap = new Map<string, number>();
    
    sessions.forEach((s) => {
      if (s.date) {
        const key = s.date.slice(0, 10);
        dayMap.set(key, (dayMap.get(key) || 0) + s.durationMin);
      }
    });

    const start = new Date();
    start.setDate(start.getDate() - timeframeDays + 1);
    
    const cursor = new Date(start);
    for (let i = 0; i < timeframeDays; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      list.push({
        date: dateStr,
        duration: dayMap.get(dateStr) || 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    
    return list;
  }, [sessions]);

  const paddedCells = useMemo(() => {
    const list: ({ date: string; duration: number } | null)[] = [];
    if (cells.length === 0) return list;

    const firstDate = new Date(cells[0].date + "T00:00:00");
    const firstDayOfWeek = firstDate.getDay();

    for (let i = 0; i < firstDayOfWeek; i++) {
      list.push(null);
    }

    list.push(...cells);
    return list;
  }, [cells]);

  const getIntensityClass = (minutes: number) => {
    if (minutes <= 0) return "weekly-heatmap-cell-empty";
    if (minutes < 15) return "weekly-heatmap-cell-low";
    if (minutes < 45) return "weekly-heatmap-cell-medium";
    if (minutes < 120) return "weekly-heatmap-cell-high";
    return "weekly-heatmap-cell-peak";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <h3 className="game-activity-heatmap-title">{t("gameActivity.weeklyActivity")}</h3>
      <div className="weekly-heatmap-container">
        <div className="weekly-heatmap-row-labels">
          <span></span>
          <span>{t("gameActivity.mon")}</span>
          <span></span>
          <span>{t("gameActivity.wed")}</span>
          <span></span>
          <span>{t("gameActivity.fri")}</span>
          <span></span>
        </div>
        <div className="weekly-heatmap-grid">
          {paddedCells.map((cell, index) => {
            if (!cell) {
              return <div key={`pad-${index}`} className="weekly-heatmap-cell weekly-heatmap-cell-padded" />;
            }
            return (
              <div
                key={cell.date}
                className={`weekly-heatmap-cell ${getIntensityClass(cell.duration)}`}
                title={`${new Date(cell.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} : ${formatPlayTime(cell.duration)}`}
              />
            );
          })}
        </div>
      </div>
      <div className="weekly-heatmap-grid-legend" style={{ alignSelf: "flex-end" }}>
        <div className="weekly-heatmap-footer">
          <span>{t("activityDash.less")}</span>
          <div className="weekly-heatmap-cell weekly-heatmap-cell-empty" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-low" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-medium" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-high" />
          <div className="weekly-heatmap-cell weekly-heatmap-cell-peak" />
          <span>{t("activityDash.more")}</span>
        </div>
      </div>
    </div>
  );
}
