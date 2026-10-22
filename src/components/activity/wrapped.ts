// Year-in-review ("Wrapped") aggregation builders.
//
// Pure functions only — the view (`WrappedView.tsx`) renders what these
// return, and the tests pin the math. Everything computes from the same
// `GameSession` history the Activity dashboard already holds in memory:
// no extra IPC round-trip, and numbers agree between the two pages.

import type { Game, GameSession } from "../../types/game";
import {
  libraryValueStats,
  parsePlayTime,
  type LibraryValueStats,
} from "../../types/game";

/** Stats for one calendar year of sessions. */
export interface WrappedYear {
  year: number;
  totalMinutes: number;
  sessionsCount: number;
  distinctGames: number;
  activeDays: number;
  /** Longest run of consecutive active days. */
  longestStreakDays: number;
  /** Length-weighted average session across the year. */
  avgSessionMinutes: number;
  /** Per-calendar-month total minutes, indices 0–11 (0 = Jan). */
  monthMinutes: number[];
  /** Sessions with a measured FPS, and their average. */
  fpsSessions: number;
  avgFps: number | null;
  /** Day with the most playtime ("marathon"), if any. */
  topDay: { date: string; minutes: number } | null;
  /** Slot 0 = most played. */
  topGames: { gameId: string; gameName: string; minutes: number; sessions: number }[];
  /** Per-weekday total minutes, indices 0–6 (0 = Sun) — fun-fact tiles. */
  weekdayMinutes: number[];
  achievements: number;
}

/** Years with sessions, newest first. */
export function wrappedYears(sessions: GameSession[]): number[] {
  const years = new Set<number>();
  for (const s of sessions) {
    const y = Number(s.date?.slice(0, 4));
    if (Number.isFinite(y) && y > 1900) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/** All-time years are derived from session history; fallback to the
 *  achievement-years when the library has no sessions but tracked unlocks. */
export function mergedYears(sessions: GameSession[], achievementYears: number[]): number[] {
  const set = new Set<number>(wrappedYears(sessions));
  for (const y of achievementYears) set.add(y);
  return [...set].sort((a, b) => b - a);
}

/** Aggregate one year. `achievements` is the all-time count for that
 *  year from the backend's yearly achievement buckets (0 when unknown). */
export function buildWrappedYear(
  year: number,
  sessions: GameSession[],
  games: Game[],
  achievements = 0
): WrappedYear {
  const inYear = sessions.filter((s) => s.date?.slice(0, 4) === String(year));

  let totalMinutes = 0;
  let sessionsCount = 0;
  let fpsSum = 0;
  let fpsSessions = 0;
  const perGame = new Map<string, { name: string; minutes: number; sessions: number }>();
  const dayMinutes = new Map<string, number>();

  for (const s of inYear) {
    const minutes = Math.max(0, s.durationMin || 0);
    totalMinutes += minutes;
    sessionsCount += 1;

    const avgFps = s.metrics?.avgFps;
    if (avgFps && avgFps > 0) {
      fpsSum += avgFps;
      fpsSessions += 1;
    }

    const key = s.gameId || s.gameName;
    const entry = perGame.get(key) || { name: s.gameName || key, minutes: 0, sessions: 0 };
    entry.minutes += minutes;
    entry.sessions += 1;
    perGame.set(key, entry);

    const day = s.date.slice(0, 10);
    dayMinutes.set(day, (dayMinutes.get(day) || 0) + minutes);
  }

  const monthMinutes = new Array<number>(12).fill(0);
  const weekdayMinutes = new Array<number>(7).fill(0);
  let topDay: WrappedYear["topDay"] = null;
  for (const [date, minutes] of dayMinutes) {
    const month = Number(date.slice(5, 7));
    if (month >= 1 && month <= 12) monthMinutes[month - 1] += minutes;
    // Sunday = 0 for both `getDay()` and our index.
    const weekday = new Date(`${date}T00:00:00`).getDay();
    weekdayMinutes[weekday] += minutes;
    if (!topDay || minutes > topDay.minutes) topDay = { date, minutes };
  }

  // Longest consecutive-day streak within the year's active days.
  const activeDates = [...dayMinutes.keys()].filter((d) => (dayMinutes.get(d) || 0) > 0).sort();
  let activeDays = activeDates.length;
  let longestStreakDays = activeDays > 0 ? 1 : 0;
  let currentStreak = 1;
  for (let i = 1; i < activeDates.length; i++) {
    const prev = new Date(`${activeDates[i - 1]}T00:00:00`);
    const cur = new Date(`${activeDates[i]}T00:00:00`);
    const diff = Math.round((cur.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) {
      currentStreak += 1;
      longestStreakDays = Math.max(longestStreakDays, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  const thisYearsGames = games.filter(
    (g) => parsePlayTime(g.playTime) > 0 || true // metadata just for names
  );
  void thisYearsGames;

  const topGames = [...perGame.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([gameId, e]) => ({ gameId, gameName: e.name, minutes: e.minutes, sessions: e.sessions }));

  return {
    year,
    totalMinutes,
    sessionsCount,
    distinctGames: perGame.size,
    activeDays,
    longestStreakDays,
    avgSessionMinutes: sessionsCount > 0 ? totalMinutes / sessionsCount : 0,
    monthMinutes,
    fpsSessions,
    avgFps: fpsSessions > 0 ? fpsSum / fpsSessions : null,
    topDay,
    topGames,
    weekdayMinutes,
    achievements,
  };
}
/** Cost-over-playtime aggregates for the year (feature 1 data). `null`
 *  when no priced game exists or the wins are meaningless. */
export function wrappedValueStats(games: Game[]): LibraryValueStats | null {
  return libraryValueStats(games);
}

/** Chronological per-day cells for one calendar year, Jan 1 → Dec 31
 *  (inclusive), feeding the year-anchored heat map. Days without
 *  sessions still get a 0-minute cell so the grid stays aligned to the
 *  week grid; future days of the current year are included as empty. */
export function yearHeatmapCells(
  year: number,
  sessions: GameSession[]
): { date: string; minutes: number }[] {
  const dayMinutes = new Map<string, number>();
  for (const s of sessions) {
    if (s.date?.slice(0, 4) !== String(year)) continue;
    const day = s.date.slice(0, 10);
    dayMinutes.set(day, (dayMinutes.get(day) || 0) + Math.max(0, s.durationMin || 0));
  }

  const cells: { date: string; minutes: number }[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));
  const end = Date.UTC(year, 11, 31);
  while (cursor.getTime() <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    cells.push({ date: iso, minutes: dayMinutes.get(iso) || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}
