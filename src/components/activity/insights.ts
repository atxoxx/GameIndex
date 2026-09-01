import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";

/** Date-range presets shared by both activity surfaces. */
export type DateRangeKey = "7d" | "30d" | "90d" | "all";

export const DATE_RANGES: readonly DateRangeKey[] = ["7d", "30d", "90d", "all"];

export function rangeDays(range: DateRangeKey): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return 365;
  }
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromDayKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

/** Inclusive [start, end] window for a preset, anchored to today. */
export function computeRangeWindow(
  range: DateRangeKey,
  sessions: GameSession[],
  today = new Date(),
): { startDate: string; endDate: string } {
  const end = new Date(today);
  const endDate = dayKey(end);
  if (range === "all") {
    const keys = sessions.map((s) => s.date.slice(0, 10)).sort();
    return keys.length > 0
      ? { startDate: keys[0], endDate }
      : { startDate: dayKey(new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())), endDate };
  }
  const start = new Date(end);
  start.setDate(start.getDate() - (rangeDays(range) - 1));
  return { startDate: dayKey(start), endDate };
}

export function filterSessionsByWindow(
  sessions: GameSession[],
  startDate: string,
  endDate: string,
): GameSession[] {
  return sessions.filter((s) => {
    const day = s.date.slice(0, 10);
    return day >= startDate && day <= endDate;
  });
}

export function filterSessionsBySource(
  sessions: GameSession[],
  games: Game[],
  source: string,
): GameSession[] {
  if (!source || source === "all") return sessions;
  const platformById = new Map(games.map((g) => [g.id, g.platform]));
  return sessions.filter((s) => platformById.get(s.gameId) === source);
}

export function sumMinutes(sessions: GameSession[]): number {
  return sessions.reduce((sum, s) => sum + s.durationMin, 0);
}

export function distinctGames(sessions: GameSession[]): number {
  return new Set(sessions.map((s) => s.gameId)).size;
}

export function activeDays(sessions: GameSession[]): number {
  return new Set(sessions.map((s) => s.date.slice(0, 10))).size;
}

export type DeltaDirection = "up" | "down" | "flat";

export interface Delta {
  direction: DeltaDirection;
  /** Percentage change, rounded. Always ≥ 0 for up/down; 0 for flat. */
  pct: number;
}

/** Percentage change from `previous` to `current`. Null when there is no
 *  meaningful baseline (previous is 0 / no prior data). */
export function computeDelta(current: number, previous: number): Delta | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  if (current === previous) return { direction: "flat", pct: 0 };
  const change = ((current - previous) / previous) * 100;
  const pct = Math.round(Math.abs(change));
  if (pct === 0) return { direction: "flat", pct: 0 };
  return { direction: change > 0 ? "up" : "down", pct };
}

export interface PeriodStats {
  minutes: number;
  sessions: number;
  games: number;
  activeDays: number;
  avgPerDay: number;
}

export function computePeriodStats(sessions: GameSession[], days: number): PeriodStats {
  const minutes = sumMinutes(sessions);
  return {
    minutes,
    sessions: sessions.length,
    games: distinctGames(sessions),
    activeDays: activeDays(sessions),
    avgPerDay: Math.round(minutes / Math.max(1, days)),
  };
}

export interface PeriodComparison {
  current: PeriodStats;
  previous: PeriodStats;
  playtime: Delta | null;
  sessions: Delta | null;
  games: Delta | null;
  activeDays: Delta | null;
}

/** Compare the selected window against the immediately preceding window of
 *  equal length. `range === "all"` yields null deltas (no prior baseline). */
export function buildPeriodComparison(
  sessions: GameSession[],
  range: DateRangeKey,
  today = new Date(),
): PeriodComparison | null {
  if (range === "all") return null;

  const days = rangeDays(range);
  const { startDate } = computeRangeWindow(range, sessions, today);
  const start = dateFromDayKey(startDate);

  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));

  const current = filterSessionsByWindow(sessions, startDate, dayKey(today));
  const previous = filterSessionsByWindow(sessions, dayKey(prevStart), dayKey(prevEnd));

  const cur = computePeriodStats(current, days);
  const prev = computePeriodStats(previous, days);

  return {
    current: cur,
    previous: prev,
    playtime: computeDelta(cur.minutes, prev.minutes),
    sessions: computeDelta(cur.sessions, prev.sessions),
    games: computeDelta(cur.games, prev.games),
    activeDays: computeDelta(cur.activeDays, prev.activeDays),
  };
}

// ─── Personal records ────────────────────────────────────────────────────────

export type RecordIcon = "clock" | "calendar" | "gamepad" | "target" | "zap" | "trophy" | "sparkles";

export interface RecordItem {
  id: string;
  labelKey: string;
  value: string;
  sub?: string;
  icon: RecordIcon;
}

export interface RecordsOptions {
  sessions: GameSession[];
  games: Game[];
  language: string;
  scope: "all" | "game";
}

export function buildRecords({ sessions, games, language, scope }: RecordsOptions): RecordItem[] {
  if (sessions.length === 0) return [];

  const fmtDate = (d: Date) =>
    d.toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" });

  let longest: GameSession | null = null;
  let biggestDay: { key: string; minutes: number } | null = null;
  let mostGamesDay: { key: string; count: number } | null = null;
  let mostActiveHour: { hour: number; minutes: number } | null = null;

  const byDay = new Map<string, number>();
  const gamesByDay = new Map<string, Set<string>>();
  const byHour = new Map<number, number>();

  for (const s of sessions) {
    if (!longest || s.durationMin > longest.durationMin) longest = s;

    const key = s.date.slice(0, 10);
    byDay.set(key, (byDay.get(key) || 0) + s.durationMin);
    if (!gamesByDay.has(key)) gamesByDay.set(key, new Set());
    gamesByDay.get(key)!.add(s.gameId);

    const end = new Date(s.date);
    const start = new Date(end.getTime() - s.durationMin * 60_000);
    for (let h = start.getHours(); ; h = (h + 1) % 24) {
      byHour.set(h, (byHour.get(h) || 0) + Math.min(s.durationMin, 60));
      if (h === end.getHours()) break;
    }
  }

  for (const [key, minutes] of byDay) {
    if (!biggestDay || minutes > biggestDay.minutes) biggestDay = { key, minutes };
    const count = gamesByDay.get(key)?.size || 0;
    if (!mostGamesDay || count > mostGamesDay.count) mostGamesDay = { key, count };
  }
  for (const [hour, minutes] of byHour) {
    if (!mostActiveHour || minutes > mostActiveHour.minutes) mostActiveHour = { hour, minutes };
  }

  const records: RecordItem[] = [];

  if (longest) {
    const game = games.find((g) => g.id === longest!.gameId);
    records.push({
      id: "longestSession",
      labelKey: "activityInsights.record.longestSession",
      value: formatPlayTime(longest.durationMin),
      sub: game?.name || longest.gameName || undefined,
      icon: "clock",
    });
  }

  if (biggestDay) {
    records.push({
      id: "biggestDay",
      labelKey: "activityInsights.record.biggestDay",
      value: formatPlayTime(biggestDay.minutes),
      sub: fmtDate(dateFromDayKey(biggestDay.key)),
      icon: "calendar",
    });
  }

  if (mostGamesDay && scope === "all" && mostGamesDay.count > 1) {
    records.push({
      id: "mostGamesDay",
      labelKey: "activityInsights.record.mostGamesDay",
      value: String(mostGamesDay.count),
      sub: fmtDate(dateFromDayKey(mostGamesDay.key)),
      icon: "gamepad",
    });
  }

  if (mostActiveHour) {
    const start = `${String(mostActiveHour.hour).padStart(2, "0")}:00`;
    const endHour = (mostActiveHour.hour + 1) % 24;
    const end = `${String(endHour).padStart(2, "0")}:00`;
    records.push({
      id: "mostActiveHour",
      labelKey: "activityInsights.record.mostActiveHour",
      value: `${start}–${end}`,
      sub: formatPlayTime(mostActiveHour.minutes),
      icon: "target",
    });
  }

  if (scope === "all") {
    const totals = new Map<string, number>();
    for (const s of sessions) totals.set(s.gameId, (totals.get(s.gameId) || 0) + s.durationMin);
    const top = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const game = games.find((g) => g.id === top[0]);
      records.push({
        id: "topGame",
        labelKey: "activityInsights.record.topGame",
        value: game?.name || sessions.find((s) => s.gameId === top[0])?.gameName || "—",
        sub: formatPlayTime(top[1]),
        icon: "trophy",
      });
    }

    const genreMinutes = new Map<string, number>();
    for (const s of sessions) {
      const game = games.find((g) => g.id === s.gameId);
      if (game?.genres && game.genres.length > 0) {
        for (const genre of game.genres) {
          genreMinutes.set(genre, (genreMinutes.get(genre) || 0) + s.durationMin);
        }
      }
    }
    const topGenre = Array.from(genreMinutes.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topGenre) {
      records.push({
        id: "topGenre",
        labelKey: "activityInsights.record.topGenre",
        value: topGenre[0],
        sub: formatPlayTime(topGenre[1]),
        icon: "sparkles",
      });
    }
  } else {
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    for (const s of sessions) dayTotals[new Date(s.date).getDay()] += s.durationMin;
    let bestDay = 0;
    let bestVal = -1;
    for (let i = 0; i < 7; i++) {
      if (dayTotals[i] > bestVal) {
        bestVal = dayTotals[i];
        bestDay = i;
      }
    }
    if (bestVal > 0) {
      records.push({
        id: "mostActiveDay",
        labelKey: "activityInsights.record.mostActiveDay",
        value: new Date(2026, 0, 4 + bestDay).toLocaleDateString(language, { weekday: "long" }),
        sub: formatPlayTime(bestVal),
        icon: "zap",
      });
    }
  }

  const sorted = [...sessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  records.push({
    id: "firstPlayed",
    labelKey: "activityInsights.record.firstPlayed",
    value: fmtDate(new Date(sorted[0].date)),
    icon: "calendar",
  });
  records.push({
    id: "lastPlayed",
    labelKey: "activityInsights.record.lastPlayed",
    value: fmtDate(new Date(sorted[sorted.length - 1].date)),
    icon: "calendar",
  });

  return records;
}

// ─── Milestones ──────────────────────────────────────────────────────────────

export type MilestoneKind = "hours" | "sessions" | "games" | "streak" | "longSession" | "days";
export type MilestoneIcon = "clock" | "flame" | "zap" | "trophy" | "calendar" | "target";

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  /** Threshold value. Hours for `hours`, counts for sessions/games, days for
   *  `streak`/`days`, minutes for `longSession`. */
  target: number;
  earned: boolean;
  icon: MilestoneIcon;
}

interface MilestoneDef {
  kind: MilestoneKind;
  target: number;
  icon: MilestoneIcon;
}

const ALL_SCOPE_DEFS: MilestoneDef[] = [
  { kind: "hours", target: 5, icon: "clock" },
  { kind: "hours", target: 10, icon: "clock" },
  { kind: "hours", target: 25, icon: "clock" },
  { kind: "hours", target: 50, icon: "clock" },
  { kind: "hours", target: 100, icon: "clock" },
  { kind: "hours", target: 250, icon: "clock" },
  { kind: "hours", target: 500, icon: "clock" },
  { kind: "hours", target: 1000, icon: "clock" },
  { kind: "sessions", target: 5, icon: "flame" },
  { kind: "sessions", target: 10, icon: "flame" },
  { kind: "sessions", target: 25, icon: "flame" },
  { kind: "sessions", target: 50, icon: "flame" },
  { kind: "sessions", target: 100, icon: "flame" },
  { kind: "sessions", target: 250, icon: "flame" },
  { kind: "games", target: 3, icon: "trophy" },
  { kind: "games", target: 5, icon: "trophy" },
  { kind: "games", target: 10, icon: "trophy" },
  { kind: "games", target: 25, icon: "trophy" },
  { kind: "games", target: 50, icon: "trophy" },
  { kind: "streak", target: 3, icon: "zap" },
  { kind: "streak", target: 7, icon: "zap" },
  { kind: "streak", target: 14, icon: "zap" },
  { kind: "streak", target: 30, icon: "zap" },
  { kind: "streak", target: 60, icon: "zap" },
  { kind: "longSession", target: 60, icon: "target" },
  { kind: "longSession", target: 120, icon: "target" },
  { kind: "longSession", target: 180, icon: "target" },
  { kind: "longSession", target: 300, icon: "target" },
  { kind: "longSession", target: 480, icon: "target" },
  { kind: "longSession", target: 600, icon: "target" },
  { kind: "days", target: 3, icon: "calendar" },
  { kind: "days", target: 7, icon: "calendar" },
  { kind: "days", target: 14, icon: "calendar" },
  { kind: "days", target: 30, icon: "calendar" },
  { kind: "days", target: 60, icon: "calendar" },
  { kind: "days", target: 100, icon: "calendar" },
];

const GAME_SCOPE_DEFS: MilestoneDef[] = ALL_SCOPE_DEFS.filter((d) => d.kind !== "games");

/** Longest run of consecutive calendar days that appear in the session set. */
export function longestStreak(sessions: GameSession[]): number {
  const days = new Set(sessions.map((s) => s.date.slice(0, 10)));
  const sorted = Array.from(days).sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const key of sorted) {
    const cur = dateFromDayKey(key).getTime();
    if (prev !== null && cur - prev === 86_400_000) {
      run++;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prev = cur;
  }
  return best;
}

export interface MilestoneStats {
  hours: number;
  sessions: number;
  games: number;
  streak: number;
  longestSession: number;
  days: number;
}

export function computeMilestoneStats(sessions: GameSession[]): MilestoneStats {
  return {
    hours: sumMinutes(sessions) / 60,
    sessions: sessions.length,
    games: distinctGames(sessions),
    streak: longestStreak(sessions),
    longestSession: sessions.reduce((max, s) => Math.max(max, s.durationMin), 0),
    days: activeDays(sessions),
  };
}

export interface MilestoneLadder {
  kind: MilestoneKind;
  /** Current value for this kind (hours, counts, days, or minutes). */
  value: number;
  /** Threshold steps sorted ascending by target. */
  steps: Milestone[];
}

/** Group milestone defs into one progress ladder per kind, ordered for the
 *  "stacked ladder" renderer. Each ladder carries the live value so the UI can
 *  draw partial progress toward the next unearned rung. */
export function buildMilestoneLadders(
  sessions: GameSession[],
  scope: "all" | "game",
): MilestoneLadder[] {
  const defs = scope === "all" ? ALL_SCOPE_DEFS : GAME_SCOPE_DEFS;
  const stats = computeMilestoneStats(sessions);
  const valueByKind: Record<MilestoneKind, number> = {
    hours: stats.hours,
    sessions: stats.sessions,
    games: stats.games,
    streak: stats.streak,
    longSession: stats.longestSession,
    days: stats.days,
  };
  const order: MilestoneKind[] = ["hours", "sessions", "games", "streak", "longSession", "days"];
  return order
    .filter((kind) => defs.some((d) => d.kind === kind))
    .map((kind) => {
      const steps = defs
        .filter((d) => d.kind === kind)
        .sort((a, b) => a.target - b.target)
        .map((def) => ({
          id: `${def.kind}-${def.target}`,
          kind: def.kind,
          target: def.target,
          earned: valueByKind[kind] >= def.target,
          icon: def.icon,
        }));
      return { kind, value: valueByKind[kind], steps };
    });
}

// ─── Time of Day & Routine Insights ──────────────────────────────────────────

export type DaypartKey = "morning" | "afternoon" | "evening" | "night";

export interface DaypartSlot {
  key: DaypartKey;
  labelKey: string;
  hoursLabel: string;
  minutes: number;
  sessionsCount: number;
  pct: number;
  icon: "sunrise" | "sun" | "sunset" | "moon";
}

export interface TimeOfDayDistribution {
  slots: DaypartSlot[];
  peakSlot: DaypartSlot | null;
  totalMinutes: number;
  weekdayMinutes: number;
  weekendMinutes: number;
  weekdaySessions: number;
  weekendSessions: number;
  weekendRatioPct: number;
}

export function buildTimeOfDayDistribution(sessions: GameSession[]): TimeOfDayDistribution {
  const counts: Record<DaypartKey, { minutes: number; count: number }> = {
    morning: { minutes: 0, count: 0 },
    afternoon: { minutes: 0, count: 0 },
    evening: { minutes: 0, count: 0 },
    night: { minutes: 0, count: 0 },
  };

  let weekdayMins = 0;
  let weekendMins = 0;
  let weekdayCount = 0;
  let weekendCount = 0;

  for (const s of sessions) {
    const end = new Date(s.date);
    const start = new Date(end.getTime() - s.durationMin * 60_000);
    const hour = start.getHours();
    const day = start.getDay(); // 0 = Sun, 6 = Sat

    if (day === 0 || day === 6) {
      weekendMins += s.durationMin;
      weekendCount++;
    } else {
      weekdayMins += s.durationMin;
      weekdayCount++;
    }

    let slot: DaypartKey;
    if (hour >= 6 && hour < 12) {
      slot = "morning";
    } else if (hour >= 12 && hour < 17) {
      slot = "afternoon";
    } else if (hour >= 17 && hour < 22) {
      slot = "evening";
    } else {
      slot = "night";
    }

    counts[slot].minutes += s.durationMin;
    counts[slot].count += 1;
  }

  const totalMinutes = counts.morning.minutes + counts.afternoon.minutes + counts.evening.minutes + counts.night.minutes;

  const getPct = (mins: number) => (totalMinutes > 0 ? Math.round((mins / totalMinutes) * 100) : 0);

  const slots: DaypartSlot[] = [
    {
      key: "morning",
      labelKey: "activityInsights.daypart.morning",
      hoursLabel: "06:00 – 12:00",
      minutes: counts.morning.minutes,
      sessionsCount: counts.morning.count,
      pct: getPct(counts.morning.minutes),
      icon: "sunrise",
    },
    {
      key: "afternoon",
      labelKey: "activityInsights.daypart.afternoon",
      hoursLabel: "12:00 – 17:00",
      minutes: counts.afternoon.minutes,
      sessionsCount: counts.afternoon.count,
      pct: getPct(counts.afternoon.minutes),
      icon: "sun",
    },
    {
      key: "evening",
      labelKey: "activityInsights.daypart.evening",
      hoursLabel: "17:00 – 22:00",
      minutes: counts.evening.minutes,
      sessionsCount: counts.evening.count,
      pct: getPct(counts.evening.minutes),
      icon: "sunset",
    },
    {
      key: "night",
      labelKey: "activityInsights.daypart.night",
      hoursLabel: "22:00 – 06:00",
      minutes: counts.night.minutes,
      sessionsCount: counts.night.count,
      pct: getPct(counts.night.minutes),
      icon: "moon",
    },
  ];

  let peakSlot: DaypartSlot | null = null;
  for (const s of slots) {
    if (!peakSlot || s.minutes > peakSlot.minutes) {
      peakSlot = s;
    }
  }
  if (peakSlot && peakSlot.minutes === 0) peakSlot = null;

  const totalSplit = weekdayMins + weekendMins;
  const weekendRatioPct = totalSplit > 0 ? Math.round((weekendMins / totalSplit) * 100) : 0;

  return {
    slots,
    peakSlot,
    totalMinutes,
    weekdayMinutes: weekdayMins,
    weekendMinutes: weekendMins,
    weekdaySessions: weekdayCount,
    weekendSessions: weekendCount,
    weekendRatioPct,
  };
}

// ─── Session Length Breakdown ────────────────────────────────────────────────

export type SessionDurationBucketKey = "quick" | "short" | "medium" | "long" | "marathon";

export interface SessionDurationBucket {
  key: SessionDurationBucketKey;
  labelKey: string;
  rangeLabel: string;
  count: number;
  totalMinutes: number;
  pct: number;
}

export function buildSessionLengthDistribution(sessions: GameSession[]): {
  buckets: SessionDurationBucket[];
  averageMinutes: number;
  longestMinutes: number;
  totalSessions: number;
} {
  const bucketsMap: Record<SessionDurationBucketKey, { count: number; minutes: number }> = {
    quick: { count: 0, minutes: 0 },
    short: { count: 0, minutes: 0 },
    medium: { count: 0, minutes: 0 },
    long: { count: 0, minutes: 0 },
    marathon: { count: 0, minutes: 0 },
  };

  let totalMinutes = 0;
  let longestMinutes = 0;

  for (const s of sessions) {
    const mins = s.durationMin;
    totalMinutes += mins;
    if (mins > longestMinutes) longestMinutes = mins;

    if (mins < 30) {
      bucketsMap.quick.count++;
      bucketsMap.quick.minutes += mins;
    } else if (mins < 60) {
      bucketsMap.short.count++;
      bucketsMap.short.minutes += mins;
    } else if (mins < 120) {
      bucketsMap.medium.count++;
      bucketsMap.medium.minutes += mins;
    } else if (mins < 240) {
      bucketsMap.long.count++;
      bucketsMap.long.minutes += mins;
    } else {
      bucketsMap.marathon.count++;
      bucketsMap.marathon.minutes += mins;
    }
  }

  const totalSessions = sessions.length;
  const averageMinutes = totalSessions > 0 ? Math.round(totalMinutes / totalSessions) : 0;

  const buckets: SessionDurationBucket[] = [
    {
      key: "quick",
      labelKey: "activityInsights.sessionBucket.quick",
      rangeLabel: "< 30m",
      count: bucketsMap.quick.count,
      totalMinutes: bucketsMap.quick.minutes,
      pct: totalSessions > 0 ? Math.round((bucketsMap.quick.count / totalSessions) * 100) : 0,
    },
    {
      key: "short",
      labelKey: "activityInsights.sessionBucket.short",
      rangeLabel: "30m – 1h",
      count: bucketsMap.short.count,
      totalMinutes: bucketsMap.short.minutes,
      pct: totalSessions > 0 ? Math.round((bucketsMap.short.count / totalSessions) * 100) : 0,
    },
    {
      key: "medium",
      labelKey: "activityInsights.sessionBucket.medium",
      rangeLabel: "1h – 2h",
      count: bucketsMap.medium.count,
      totalMinutes: bucketsMap.medium.minutes,
      pct: totalSessions > 0 ? Math.round((bucketsMap.short.count / totalSessions) * 100) : 0,
    },
    {
      key: "long",
      labelKey: "activityInsights.sessionBucket.long",
      rangeLabel: "2h – 4h",
      count: bucketsMap.long.count,
      totalMinutes: bucketsMap.long.minutes,
      pct: totalSessions > 0 ? Math.round((bucketsMap.long.count / totalSessions) * 100) : 0,
    },
    {
      key: "marathon",
      labelKey: "activityInsights.sessionBucket.marathon",
      rangeLabel: "4h+",
      count: bucketsMap.marathon.count,
      totalMinutes: bucketsMap.marathon.minutes,
      pct: totalSessions > 0 ? Math.round((bucketsMap.marathon.count / totalSessions) * 100) : 0,
    },
  ];

  return {
    buckets,
    averageMinutes,
    longestMinutes,
    totalSessions,
  };
}

// ─── Cumulative Progression Curve ───────────────────────────────────────────

export interface CumulativePoint {
  label: string;
  date: string;
  periodHours: number;
  cumulativeHours: number;
}

export function buildCumulativeSeries(
  sessions: GameSession[],
  startDate: string,
  endDate: string,
  aggregation: "day" | "week" | "month",
  language: string,
): CumulativePoint[] {
  const dayMap = new Map<string, number>();
  sessions.forEach((s) => {
    const d = s.date.slice(0, 10);
    dayMap.set(d, (dayMap.get(d) || 0) + s.durationMin);
  });

  const points: CumulativePoint[] = [];
  const end = new Date(endDate + "T00:00:00");
  const cursor = new Date(startDate + "T00:00:00");
  let runningMinutes = 0;

  if (aggregation === "day") {
    while (cursor <= end) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const mins = dayMap.get(dateStr) ?? 0;
      runningMinutes += mins;
      points.push({
        label: dateStr.slice(5),
        date: dateStr,
        periodHours: Math.round((mins / 60) * 10) / 10,
        cumulativeHours: Math.round((runningMinutes / 60) * 10) / 10,
      });
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
      runningMinutes += mins;
      points.push({
        label: wKey.slice(5),
        date: wKey,
        periodHours: Math.round((mins / 60) * 10) / 10,
        cumulativeHours: Math.round((runningMinutes / 60) * 10) / 10,
      });
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
      runningMinutes += mins;
      points.push({
        label: cursorMonth.toLocaleDateString(language, { month: "short", year: "2-digit" }),
        date: mKey,
        periodHours: Math.round((mins / 60) * 10) / 10,
        cumulativeHours: Math.round((runningMinutes / 60) * 10) / 10,
      });
      cursorMonth.setMonth(cursorMonth.getMonth() + 1);
    }
  }

  return points;
}

// ─── Gamer Persona & Playstyle Archetype ────────────────────────────────────

export type GamerArchetypeKey =
  | "nightOwl"
  | "weekendWarrior"
  | "marathoner"
  | "dailyDedicated"
  | "genreSpecialist"
  | "explorer"
  | "casual";

export interface GamerPersona {
  archetype: GamerArchetypeKey;
  titleKey: string;
  descriptionKey: string;
  badgeIcon: "moon" | "swords" | "flame" | "target" | "compass" | "trophy" | "sparkles";
  highlightStatKey: string;
  highlightStatValue: string;
}

export function buildGamerPersona(sessions: GameSession[], games: Game[]): GamerPersona {
  if (sessions.length === 0) {
    return {
      archetype: "casual",
      titleKey: "activityInsights.persona.casual.title",
      descriptionKey: "activityInsights.persona.casual.desc",
      badgeIcon: "compass",
      highlightStatKey: "activityDash.sessions",
      highlightStatValue: "0",
    };
  }

  const tod = buildTimeOfDayDistribution(sessions);
  const streak = longestStreak(sessions);
  const totalMins = sumMinutes(sessions);
  const avgSessMins = totalMins / sessions.length;
  const distinctGameCount = distinctGames(sessions);

  // Check top genre dominance
  const genreMinutes = new Map<string, number>();
  for (const s of sessions) {
    const game = games.find((g) => g.id === s.gameId);
    if (game?.genres) {
      for (const g of game.genres) {
        genreMinutes.set(g, (genreMinutes.get(g) || 0) + s.durationMin);
      }
    }
  }
  let topGenreMins = 0;
  for (const mins of genreMinutes.values()) {
    if (mins > topGenreMins) topGenreMins = mins;
  }
  const topGenreShare = totalMins > 0 ? (topGenreMins / totalMins) * 100 : 0;

  // Archetype decisions
  if ((tod.slots.find((s) => s.key === "night")?.pct ?? 0) >= 40) {
    return {
      archetype: "nightOwl",
      titleKey: "activityInsights.persona.nightOwl.title",
      descriptionKey: "activityInsights.persona.nightOwl.desc",
      badgeIcon: "moon",
      highlightStatKey: "activityInsights.night",
      highlightStatValue: `${tod.slots.find((s) => s.key === "night")?.pct ?? 0}%`,
    };
  }

  if (tod.weekendRatioPct >= 65) {
    return {
      archetype: "weekendWarrior",
      titleKey: "activityInsights.persona.weekendWarrior.title",
      descriptionKey: "activityInsights.persona.weekendWarrior.desc",
      badgeIcon: "swords",
      highlightStatKey: "activityInsights.weekends",
      highlightStatValue: `${tod.weekendRatioPct}%`,
    };
  }

  if (avgSessMins >= 120 || sessions.some((s) => s.durationMin >= 240)) {
    return {
      archetype: "marathoner",
      titleKey: "activityInsights.persona.marathoner.title",
      descriptionKey: "activityInsights.persona.marathoner.desc",
      badgeIcon: "flame",
      highlightStatKey: "activityInsights.avgDuration",
      highlightStatValue: formatPlayTime(Math.round(avgSessMins)),
    };
  }

  if (streak >= 7) {
    return {
      archetype: "dailyDedicated",
      titleKey: "activityInsights.persona.dailyDedicated.title",
      descriptionKey: "activityInsights.persona.dailyDedicated.desc",
      badgeIcon: "target",
      highlightStatKey: "activityDash.streak",
      highlightStatValue: `${streak}d`,
    };
  }

  if (distinctGameCount >= 8) {
    return {
      archetype: "explorer",
      titleKey: "activityInsights.persona.explorer.title",
      descriptionKey: "activityInsights.persona.explorer.desc",
      badgeIcon: "compass",
      highlightStatKey: "activity.gamesPlayed",
      highlightStatValue: `${distinctGameCount}`,
    };
  }

  if (topGenreShare >= 60) {
    return {
      archetype: "genreSpecialist",
      titleKey: "activityInsights.persona.genreSpecialist.title",
      descriptionKey: "activityInsights.persona.genreSpecialist.desc",
      badgeIcon: "trophy",
      highlightStatKey: "activityInsights.record.topGenre",
      highlightStatValue: `${Math.round(topGenreShare)}%`,
    };
  }

  return {
    archetype: "casual",
    titleKey: "activityInsights.persona.casual.title",
    descriptionKey: "activityInsights.persona.casual.desc",
    badgeIcon: "sparkles",
    highlightStatKey: "activityDash.totalPlaytime",
    highlightStatValue: formatPlayTime(totalMins),
  };
}

// ─── Time to Beat Completion Progress ───────────────────────────────────────

export interface CompletionProgress {
  hasTimeToBeat: boolean;
  playedMinutes: number;
  playedHours: number;
  mainStoryHours: number | null;
  mainExtraHours: number | null;
  completionistHours: number | null;
  mainStoryPct: number;
  completionistPct: number;
  status: "notStarted" | "inProgress" | "mainStoryComplete" | "completionistComplete";
}

export function buildGameCompletionProgress(
  playedMinutes: number,
  timeToBeat?: { hastily?: number; normally?: number; completely?: number },
): CompletionProgress {
  const playedHours = Math.round((playedMinutes / 60) * 10) / 10;

  if (!timeToBeat || (!timeToBeat.normally && !timeToBeat.completely && !timeToBeat.hastily)) {
    return {
      hasTimeToBeat: false,
      playedMinutes,
      playedHours,
      mainStoryHours: null,
      mainExtraHours: null,
      completionistHours: null,
      mainStoryPct: 0,
      completionistPct: 0,
      status: playedMinutes > 0 ? "inProgress" : "notStarted",
    };
  }

  // IGDB / Steam timeToBeat values are stored in seconds (e.g. 259920 seconds = 72.2 hours).
  // If a value is > 500, convert seconds to hours; otherwise treat as hours.
  const toHours = (sec?: number | null): number | null => {
    if (sec === undefined || sec === null || sec <= 0) return null;
    const hours = sec > 500 ? sec / 3600 : sec;
    return Math.round(hours * 10) / 10;
  };

  const mainStoryHours = toHours(timeToBeat.normally) || toHours(timeToBeat.hastily);
  const completionistHours = toHours(timeToBeat.completely) || (mainStoryHours ? Math.round(mainStoryHours * 1.5 * 10) / 10 : null);
  const mainExtraHours =
    timeToBeat.normally && timeToBeat.completely
      ? Math.round((((timeToBeat.normally > 500 ? timeToBeat.normally / 3600 : timeToBeat.normally) +
          (timeToBeat.completely > 500 ? timeToBeat.completely / 3600 : timeToBeat.completely)) / 2) * 10) / 10
      : null;

  const mainStoryPct = mainStoryHours ? Math.min(100, Math.round((playedHours / mainStoryHours) * 100)) : 0;
  const completionistPct = completionistHours ? Math.min(100, Math.round((playedHours / completionistHours) * 100)) : 0;

  let status: CompletionProgress["status"] = "notStarted";
  if (playedMinutes > 0) {
    if (completionistPct >= 100) {
      status = "completionistComplete";
    } else if (mainStoryPct >= 100) {
      status = "mainStoryComplete";
    } else {
      status = "inProgress";
    }
  }

  return {
    hasTimeToBeat: true,
    playedMinutes,
    playedHours,
    mainStoryHours,
    mainExtraHours,
    completionistHours,
    mainStoryPct,
    completionistPct,
    status,
  };
}

// ─── FPS Stability Helper ────────────────────────────────────────────────────

export function calculateFpsStability(
  avgFps: number,
  minFps: number,
): { ratio: number; rating: "exceptional" | "smooth" | "unstable" | "unknown" } {
  if (avgFps <= 0 || minFps <= 0) return { ratio: 0, rating: "unknown" };
  const ratio = Math.min(100, Math.round((minFps / avgFps) * 100));
  if (ratio >= 80) return { ratio, rating: "exceptional" };
  if (ratio >= 60) return { ratio, rating: "smooth" };
  return { ratio, rating: "unstable" };
}

