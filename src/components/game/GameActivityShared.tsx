import type { ReactNode } from "react";

/**
 * Shared types + the consistent section-header pattern used by the
 * Playtime and Performance sub-views of the game Activity tab.
 *
 * Data memos (stats, chart data, hardware averages, timelines) are
 * computed once in GameActivityTab and passed down through these types —
 * sub-views never recompute them.
 */

export type Timeframe = "7d" | "30d" | "90d" | "all";
export type ViewMode = "playtime" | "performance";
export type PlaytimeChartStyle = "bar" | "line";
export type PlaytimeAggregation = "AGG_DAY" | "AGG_WEEK" | "AGG_MONTH";

export interface Stats {
  totalPlayTimeMin: number;
  totalSessions: number;
  avgSessionMin: number;
  longestSessionMin: number;
  currentStreak: number;
  bestStreak: number;
  trendDirection: "up" | "down" | "flat";
  mostActiveDay: string;
  activeDaysCount: number;
  firstPlayed: string;
  lastPlayed: string;
}

export interface HwAverages {
  avgFps: number;
  maxFps: number;
  avgCpu: number;
  maxCpu: number;
  avgGpu: number;
  maxGpu: number;
  avgCpuT: number;
  maxCpuT: number;
  avgGpuT: number;
  maxGpuT: number;
  avgRamPct: number;
  maxRamPct: number;
}

export interface PerfTimelineData {
  cpu: number[];
  gpu: number[];
  cpuTemp: number[];
  gpuTemp: number[];
  ram: number[];
  fps: number[];
  labels: string[];
  real: boolean;
}

/**
 * The section header every content group shares: icon tile + title + sub
 * on the left, optional tools on the right. Reading one section header
 * teaches you where everything lives in both sub-views.
 */
export function SectionHead({
  icon,
  title,
  sub,
  tools,
}: {
  icon?: ReactNode;
  title: string;
  sub?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div className="game-activity-section-head">
      {icon && (
        <span className="game-activity-section-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="game-activity-section-titles">
        <h3 className="game-activity-section-title">{title}</h3>
        {sub && <div className="game-activity-section-sub">{sub}</div>}
      </div>
      {tools && <div className="game-activity-section-tools">{tools}</div>}
    </div>
  );
}
