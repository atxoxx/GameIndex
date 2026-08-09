import type { Game, GameSession, SessionMetrics } from "../../../types/game";
import { buildTimelineFromSessions, buildSingleSessionSeries, type PerfTimelineSeries } from "../../../utils/perfSamples";

/**
 * Pure data layer for the Activity → Performance tab.
 *
 * Everything here is free of React so the aggregation rules are unit-testable
 * and shared verbatim between the overview strip, the comparison bars, the
 * detailed board and the session timeline.
 */

// ─── Metric presence ────────────────────────────────────────────────────────

/** True when a session carries ANY usable hardware telemetry. */
export function hasAnyMetrics(s: GameSession): boolean {
  const m = s.metrics;
  if (!m) return false;
  return (
    m.avgFps > 0 ||
    m.avgCpuUsage > 0 ||
    m.avgGpuUsage > 0 ||
    m.avgRamUsage > 0 ||
    m.avgCpuTemp > 0 ||
    m.avgGpuTemp > 0
  );
}

/** True when a session recorded an average FPS. */
export function hasFps(s: GameSession): boolean {
  return !!s.metrics && s.metrics.avgFps > 0;
}

// ─── Date / source filtering ────────────────────────────────────────────────

/**
 * Sessions whose wall-clock date (YYYY-MM-DD slice) falls inside the active
 * date window. `startDate` / `endDate` are ISO date strings from the shared
 * Activity toolbar ("all" expands the window to the earliest session).
 */
export function filterSessionsByWindow(
  sessions: GameSession[],
  startDate: string,
  endDate: string
): GameSession[] {
  return sessions.filter((s) => {
    const day = s.date.slice(0, 10);
    return day >= startDate && day <= endDate;
  });
}

/** Sessions belonging to the selected platform/source (or all when "all"). */
export function filterSessionsBySource(
  sessions: GameSession[],
  games: Game[],
  sourceFilter: string
): GameSession[] {
  if (!sourceFilter || sourceFilter === "all") return sessions;
  const platforms = new Map(games.map((g) => [g.id, g.platform]));
  return sessions.filter((s) => platforms.get(s.gameId) === sourceFilter);
}

// ─── Per-game aggregation ───────────────────────────────────────────────────

export interface GamePerfAvg {
  gameId: string;
  game: Game | null;
  gameTitle: string;
  /** Small square icon (base64) — often unset for Steam-synced games. */
  gameIconUrl: string | null;
  /** Larger cover (base64 or remote Steam-CDN URL). */
  coverArtUrl: string | null;
  /** Steam app id — lets thumbnails walk the CDN fallback chain. */
  steamAppId: number | null;
  /** Sessions contributing any hardware telemetry. */
  sessionsCount: number;
  /** Sessions that actually recorded FPS (subset of sessionsCount). */
  fpsCount: number;
  avgFps: number;
  minFps: number;
  maxFps: number;
  avgCpuTemp: number;
  avgGpuTemp: number;
  avgRamUsage: number;
  avgCpuUsage: number;
  avgGpuUsage: number;
}

interface GameAgg {
  hwCount: number;
  fpsCount: number;
  fpsSum: number;
  minFpsMin: number;
  maxFpsMax: number;
  cpuTempSum: number;
  cpuTempCount: number;
  gpuTempSum: number;
  gpuTempCount: number;
  ramSum: number;
  ramCount: number;
  cpuSum: number;
  cpuCount: number;
  gpuSum: number;
  gpuCount: number;
}

/**
 * Aggregate per-game averages from the supplied sessions. Each metric is
 * averaged over ONLY the sessions that captured it (a session without FPS
 * cannot drag a game's average FPS down, and a session without temperature
 * sensors cannot flatten its temp curve).
 */
export function buildGameAverages(
  sessions: GameSession[],
  games: Game[],
  unknownTitle = "Unknown Game",
): GamePerfAvg[] {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const map = new Map<string, GameAgg>();

  for (const s of sessions) {
    const m = s.metrics;
    if (!m || !hasAnyMetrics(s)) continue;

    let agg = map.get(s.gameId);
    if (!agg) {
      agg = {
        hwCount: 0,
        fpsCount: 0,
        fpsSum: 0,
        minFpsMin: Infinity,
        maxFpsMax: 0,
        cpuTempSum: 0,
        cpuTempCount: 0,
        gpuTempSum: 0,
        gpuTempCount: 0,
        ramSum: 0,
        ramCount: 0,
        cpuSum: 0,
        cpuCount: 0,
        gpuSum: 0,
        gpuCount: 0,
      };
      map.set(s.gameId, agg);
    }

    agg.hwCount++;

    if (m.avgFps > 0) {
      agg.fpsCount++;
      agg.fpsSum += m.avgFps;
      agg.minFpsMin = Math.min(agg.minFpsMin, m.minFps || m.avgFps * 0.6);
      agg.maxFpsMax = Math.max(agg.maxFpsMax, m.maxFps || m.avgFps * 1.4);
    }
    if (m.avgCpuTemp > 0) { agg.cpuTempSum += m.avgCpuTemp; agg.cpuTempCount++; }
    if (m.avgGpuTemp > 0) { agg.gpuTempSum += m.avgGpuTemp; agg.gpuTempCount++; }
    if (m.avgRamUsage > 0) { agg.ramSum += m.avgRamUsage; agg.ramCount++; }
    if (m.avgCpuUsage > 0) { agg.cpuSum += m.avgCpuUsage; agg.cpuCount++; }
    if (m.avgGpuUsage > 0) { agg.gpuSum += m.avgGpuUsage; agg.gpuCount++; }
  }

  const mean = (sum: number, count: number) => (count > 0 ? Math.round(sum / count) : 0);

  return Array.from(map.entries()).map(([gameId, d]) => {
    const game = gameById.get(gameId) ?? null;
    return {
      gameId,
      game,
      gameTitle: game?.name || unknownTitle,
      gameIconUrl: game?.iconUrl || null,
      coverArtUrl: game?.coverArtUrl || null,
      steamAppId: game?.steamAppId ?? null,
      sessionsCount: d.hwCount,
      fpsCount: d.fpsCount,
      avgFps: d.fpsCount > 0 ? Math.round(d.fpsSum / d.fpsCount) : 0,
      minFps: d.fpsCount > 0 ? (Number.isFinite(d.minFpsMin) ? Math.round(d.minFpsMin) : 30) : 0,
      maxFps: d.maxFpsMax > 0 ? Math.round(d.maxFpsMax) : 0,
      avgCpuTemp: mean(d.cpuTempSum, d.cpuTempCount),
      avgGpuTemp: mean(d.gpuTempSum, d.gpuTempCount),
      avgRamUsage: mean(d.ramSum, d.ramCount),
      avgCpuUsage: mean(d.cpuSum, d.cpuCount),
      avgGpuUsage: mean(d.gpuSum, d.gpuCount),
    };
  });
}

// ─── Overview (KPI strip) ───────────────────────────────────────────────────

export interface PerfOverview {
  /** Mean FPS across all sessions that recorded FPS. */
  avgFps: number;
  /** Sessions contributing any telemetry. */
  telemetrySessions: number;
  /** Session count with FPS data. */
  fpsSessions: number;
  /** Game with the highest average FPS (null when no FPS data). */
  bestGame: GamePerfAvg | null;
  /** Highest average CPU temp across all games (0 when none). */
  hottestCpuTemp: number;
  hottestCpuGame: string | null;
  /** Highest average GPU temp across all games (0 when none). */
  hottestGpuTemp: number;
  hottestGpuGame: string | null;
  /** Mean RAM usage % (0 when none). */
  avgRamPercent: number;
  /** Total games with telemetry. */
  gamesTracked: number;
}

export function buildOverview(
  sessions: GameSession[],
  gameAverages: GamePerfAvg[]
): PerfOverview {
  const fpsSessions = sessions.filter(hasFps);
  const avgFps =
    fpsSessions.length > 0
      ? Math.round(fpsSessions.reduce((s, x) => s + x.metrics!.avgFps, 0) / fpsSessions.length)
      : 0;

  let hottestCpuTemp = 0;
  let hottestCpuGame: string | null = null;
  let hottestGpuTemp = 0;
  let hottestGpuGame: string | null = null;
  for (const g of gameAverages) {
    if (g.avgCpuTemp > hottestCpuTemp) { hottestCpuTemp = g.avgCpuTemp; hottestCpuGame = g.gameTitle; }
    if (g.avgGpuTemp > hottestGpuTemp) { hottestGpuTemp = g.avgGpuTemp; hottestGpuGame = g.gameTitle; }
  }

  const ramSessions = sessions.filter((s) => s.metrics && s.metrics.avgRamUsage > 0);
  const avgRamPercent =
    ramSessions.length > 0
      ? Math.round(ramSessions.reduce((sum, s) => sum + s.metrics!.avgRamUsage, 0) / ramSessions.length)
      : 0;

  let bestGame: GamePerfAvg | null = null;
  for (const g of gameAverages) {
    if (g.avgFps > 0 && (!bestGame || g.avgFps > bestGame.avgFps)) bestGame = g;
  }

  return {
    avgFps,
    telemetrySessions: gameAverages.reduce((s, g) => s + g.sessionsCount, 0),
    fpsSessions: fpsSessions.length,
    bestGame,
    hottestCpuTemp,
    hottestCpuGame,
    hottestGpuTemp,
    hottestGpuGame,
    avgRamPercent,
    gamesTracked: gameAverages.length,
  };
}

// ─── Deterministic estimated curves ─────────────────────────────────────────

/** Small fast seeded PRNG (mulberry32) — stable curves across re-renders. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Reconstruct a plausible performance curve from recorded averages when no
 * per-sample telemetry exists. Unlike the previous `Math.random()` version the
 * curve is fully deterministic: the same selection always renders the same
 * shape, and every re-render / tab switch is stable.
 */
export function generateEstimatedTimeline(
  avg: number,
  min: number,
  max: number,
  count: number,
  seedKey: string
): number[] {
  if (avg <= 0) return new Array(count).fill(0);
  const actualMin = min > 0 ? min : Math.round(avg * 0.7);
  const actualMax = max > 0 ? max : Math.round(avg * 1.3);
  const rng = mulberry32(hashSeed(seedKey));

  const raw: number[] = [];
  let current = avg;
  for (let i = 0; i < count; i++) {
    current += (rng() - 0.5) * (actualMax - actualMin) * 0.2;
    if (current < actualMin) current = actualMin + rng() * 2;
    if (current > actualMax) current = actualMax - rng() * 2;
    raw.push(current);
  }

  // Moving-average smoothing (window 4).
  const smoothed: number[] = [];
  const win = 4;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    let n = 0;
    for (let w = -Math.floor(win / 2); w <= Math.floor(win / 2); w++) {
      const idx = i + w;
      if (idx >= 0 && idx < count) {
        sum += raw[idx];
        n++;
      }
    }
    smoothed.push(Math.round(sum / n));
  }
  return smoothed;
}

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

// ─── Timeline bundle ────────────────────────────────────────────────────────

export interface LineSeries {
  data: number[];
  color: string;
  label: string;
}

export interface SparkPoint {
  x: number;
  y: number;
}

export interface TimelineRaw {
  avgFps: number;
  minFps: number;
  maxFps: number;
  avgCpuUsage: number;
  avgGpuUsage: number;
  avgCpuTemp: number;
  avgGpuTemp: number;
  avgRamUsage: number;
}

export interface SparkReadouts {
  cpu: { max: number; min: number };
  gpu: { max: number; min: number };
  cpuTemp: { max: number; min: number };
  gpuTemp: { max: number; min: number };
  ram: { max: number; min: number };
  fps: { max: number; min: number };
}

export interface TimelineBundle {
  labels: string[];
  /** True when no real per-sample telemetry backed the curves. */
  estimated: boolean;
  cpuGpu: LineSeries[];
  temps: LineSeries[];
  ram: LineSeries[];
  fps: LineSeries[];
  raw: TimelineRaw;
  sparklines: Record<keyof SparkReadouts, SparkPoint[]>;
  /** Real min/max of the rendered curves — honest readouts for the cards. */
  readouts: SparkReadouts;
}

export interface TimelineI18n {
  cpuUsage: string;
  gpuUsage: string;
  cpuTemp: string;
  gpuTemp: string;
  ramUsage: string;
  fps: string;
}

export const TIMELINE_COLORS = {
  cpu: "var(--color-brand-blue)",
  gpu: "var(--color-accent)",
  cpuTemp: "var(--color-danger)",
  gpuTemp: "var(--color-warning)",
  ram: "var(--color-success)",
  fps: "var(--color-brand-teal)",
} as const;

/** Raw aggregate from a session set, per-metric accurate. */
function aggregateSessions(sessions: GameSession[]): TimelineRaw {
  const fpsSessions = sessions.filter(hasFps);
  const metric = (pred: (m: SessionMetrics) => boolean, pick: (m: SessionMetrics) => number) => {
    const list = sessions.filter((s) => s.metrics && pred(s.metrics!));
    return list.length > 0
      ? Math.round(list.reduce((sum, s) => sum + pick(s.metrics!), 0) / list.length)
      : 0;
  };

  let minFps = Infinity;
  let maxFps = 0;
  for (const s of fpsSessions) {
    const m = s.metrics!;
    minFps = Math.min(minFps, m.minFps || m.avgFps * 0.6);
    maxFps = Math.max(maxFps, m.maxFps || m.avgFps * 1.4);
  }

  return {
    avgFps: fpsSessions.length > 0
      ? Math.round(fpsSessions.reduce((sum, s) => sum + s.metrics!.avgFps, 0) / fpsSessions.length)
      : 0,
    minFps: fpsSessions.length > 0 && Number.isFinite(minFps) ? Math.round(minFps) : 0,
    maxFps: Math.round(maxFps),
    avgCpuUsage: metric((m) => m.avgCpuUsage > 0, (m) => m.avgCpuUsage),
    avgGpuUsage: metric((m) => m.avgGpuUsage > 0, (m) => m.avgGpuUsage),
    avgCpuTemp: metric((m) => m.avgCpuTemp > 0, (m) => m.avgCpuTemp),
    avgGpuTemp: metric((m) => m.avgGpuTemp > 0, (m) => m.avgGpuTemp),
    avgRamUsage: metric((m) => m.avgRamUsage > 0, (m) => m.avgRamUsage),
  };
}

/**
 * Assemble every curve + readout for the session timeline panel.
 *
 *  - `gameId === "all"` → averages across every supplied session.
 *  - `gameId` set + `sessionId` null → averages across that game's sessions.
 *  - `gameId` + `sessionId` set → the exact recorded session.
 *
 * Real per-sample telemetry is preferred; when the selection has no samples
 * the curves fall back to deterministic estimates seeded from the selection
 * so they stay stable between renders.
 */
export function buildTimelineBundle(opts: {
  sessions: GameSession[];
  gameAverages: GamePerfAvg[];
  gameId: string;
  sessionId: string | null;
  i18n: TimelineI18n;
  pts?: number;
}): TimelineBundle | null {
  const { sessions, gameAverages, gameId, sessionId, i18n, pts = 45 } = opts;
  const gameSessions = gameId === "all" ? sessions : sessions.filter((s) => s.gameId === gameId);

  let raw: TimelineRaw | null = null;
  let realSeries: PerfTimelineSeries | null = null;

  if (gameId !== "all" && sessionId) {
    const s = sessions.find((x) => x.id === sessionId);
    if (s && s.metrics) {
      const m = s.metrics;
      raw = {
        avgFps: m.avgFps,
        minFps: m.minFps,
        maxFps: m.maxFps,
        avgCpuUsage: m.avgCpuUsage,
        avgGpuUsage: m.avgGpuUsage,
        avgCpuTemp: m.avgCpuTemp,
        avgGpuTemp: m.avgGpuTemp,
        avgRamUsage: m.avgRamUsage,
      };
      realSeries = buildSingleSessionSeries(m, pts);
    }
  } else if (gameId !== "all") {
    const match = gameAverages.find((g) => g.gameId === gameId);
    if (match) {
      raw = {
        avgFps: match.avgFps,
        minFps: match.minFps,
        maxFps: match.maxFps,
        avgCpuUsage: match.avgCpuUsage,
        avgGpuUsage: match.avgGpuUsage,
        avgCpuTemp: match.avgCpuTemp,
        avgGpuTemp: match.avgGpuTemp,
        avgRamUsage: match.avgRamUsage,
      };
      realSeries = buildTimelineFromSessions(gameSessions, pts);
    }
  } else {
    raw = aggregateSessions(sessions);
    realSeries = buildTimelineFromSessions(sessions, pts);
  }

  if (!raw) return null;

  // Deterministic seed so the estimated shape is stable per selection.
  const seedKey = `${gameId}:${sessionId ?? "all"}`;

  const cpu = realSeries
    ? realSeries.cpu
    : generateEstimatedTimeline(raw.avgCpuUsage, Math.round(raw.avgCpuUsage * 0.4), Math.round(raw.avgCpuUsage * 1.5), pts, `cpu:${seedKey}`).map(clampPct);
  const gpu = realSeries
    ? realSeries.gpu
    : generateEstimatedTimeline(raw.avgGpuUsage, Math.round(raw.avgGpuUsage * 0.3), Math.round(raw.avgGpuUsage * 1.6), pts, `gpu:${seedKey}`).map(clampPct);
  const cpuTemp = realSeries
    ? realSeries.cpuTemp
    : generateEstimatedTimeline(raw.avgCpuTemp, raw.avgCpuTemp - 7, raw.avgCpuTemp + 11, pts, `cpuTemp:${seedKey}`);
  const gpuTemp = realSeries
    ? realSeries.gpuTemp
    : generateEstimatedTimeline(raw.avgGpuTemp, raw.avgGpuTemp - 6, raw.avgGpuTemp + 9, pts, `gpuTemp:${seedKey}`);
  const ram = realSeries
    ? realSeries.ram
    : generateEstimatedTimeline(raw.avgRamUsage, Math.round(raw.avgRamUsage * 0.8), Math.round(raw.avgRamUsage * 1.12), pts, `ram:${seedKey}`).map(clampPct);
  const fps = realSeries
    ? realSeries.fps
    : generateEstimatedTimeline(raw.avgFps, raw.minFps, raw.maxFps, pts, `fps:${seedKey}`);

  const labels = Array.from({ length: pts }).map((_, i) => `${Math.round((i / (pts - 1)) * 100)}%`);

  const toSpark = (series: number[]): SparkPoint[] =>
    series.map((y, x) => ({ x, y }));

  const mkReadout = (series: number[]): { max: number; min: number } => {
    const max = series.length > 0 ? Math.max(...series) : 0;
    const min = series.length > 0 ? Math.min(...series) : 0;
    return { max: Math.round(max), min: Math.round(min) };
  };

  return {
    labels,
    estimated: !realSeries,
    cpuGpu: [
      { data: cpu, color: TIMELINE_COLORS.cpu, label: i18n.cpuUsage },
      { data: gpu, color: TIMELINE_COLORS.gpu, label: i18n.gpuUsage },
    ],
    temps: [
      { data: cpuTemp, color: TIMELINE_COLORS.cpuTemp, label: i18n.cpuTemp },
      { data: gpuTemp, color: TIMELINE_COLORS.gpuTemp, label: i18n.gpuTemp },
    ],
    ram: [{ data: ram, color: TIMELINE_COLORS.ram, label: i18n.ramUsage }],
    fps: [{ data: fps, color: TIMELINE_COLORS.fps, label: i18n.fps }],
    raw,
    sparklines: {
      cpu: toSpark(cpu),
      gpu: toSpark(gpu),
      cpuTemp: toSpark(cpuTemp),
      gpuTemp: toSpark(gpuTemp),
      ram: toSpark(ram),
      fps: toSpark(fps),
    },
    readouts: {
      cpu: mkReadout(cpu),
      gpu: mkReadout(gpu),
      cpuTemp: mkReadout(cpuTemp),
      gpuTemp: mkReadout(gpuTemp),
      ram: mkReadout(ram),
      fps: mkReadout(fps),
    },
  };
}
