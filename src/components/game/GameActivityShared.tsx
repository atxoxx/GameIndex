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

/** Seeded series generator — deterministic smooth curves consistent with
 *  session metrics, used when no real per-sample telemetry exists. */
export function generateConsistentSeries(
  avgVal: number,
  minVal: number,
  maxVal: number,
  N: number,
  seedStr: string
): number[] {
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
