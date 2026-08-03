// Derived analytics for the Community > Profile tab. These are computed
// purely from the ActivityContext sessions + GameContext games, mirroring
// the existing `computeStats` approach (no backend, no mock data).

import type { GameSession } from "../types/game";

export interface DayCell {
  date: Date;
  minutes: number;
  /** ISO yyyy-mm-dd key for stable lookups */
  key: string;
}

export interface StreakInfo {
  current: number;
  longest: number;
  /** true if the player played at all today */
  playedToday: boolean;
}

export interface TimeOfDaySlice {
  label: string;
  minutes: number;
  color: string;
}

export interface PeriodCompare {
  thisMonthMin: number;
  lastMonthMin: number;
  /** signed delta in minutes */
  deltaMin: number;
  /** percentage change (infinite-safe) */
  pct: number | null;
}

const TOD_PALETTE = [
  "var(--color-info)",
  "var(--color-accent)",
  "var(--color-warning)",
  "var(--color-success)",
];

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Build a 7-week (49-day) heatmap grid ending today, Mon–Sun aligned. */
export function buildHeatmap(sessions: GameSession[]): {
  cells: DayCell[];
  maxMinutes: number;
  activeDays: number;
  totalMinutes: number;
} {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.date);
    const k = dayKey(d);
    byDay.set(k, (byDay.get(k) || 0) + s.durationMin);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Walk back to the Monday of the current week so the grid is column-aligned.
  const cells: DayCell[] = [];
  const cursor = new Date(today);
  const backDays = 48 + ((cursor.getDay() + 6) % 7); // align to Monday
  cursor.setDate(cursor.getDate() - backDays);

  let maxMinutes = 0;
  let activeDays = 0;
  let totalMinutes = 0;
  for (let i = 0; i < 49; i++) {
    const minutes = byDay.get(dayKey(cursor)) || 0;
    if (minutes > 0) {
      activeDays++;
      totalMinutes += minutes;
      if (minutes > maxMinutes) maxMinutes = minutes;
    }
    cells.push({ date: new Date(cursor), minutes, key: dayKey(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { cells, maxMinutes, activeDays, totalMinutes };
}

/** Current + longest consecutive-day streak based on played days. */
export function computeStreaks(sessions: GameSession[]): StreakInfo {
  const playedDays = new Set<string>();
  for (const s of sessions) {
    playedDays.add(dayKey(new Date(s.date)));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = dayKey(today);
  const playedToday = playedDays.has(todayKey);

  // Longest streak: scan all played days.
  const sorted = Array.from(playedDays).sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sorted) {
    const d = new Date(k + "T00:00:00");
    if (prev) {
      const diff = Math.round((d.getTime() - prev.getTime()) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  // Current streak: count back from today (or yesterday if today is idle).
  let current = 0;
  const cursor = new Date(today);
  if (!playedDays.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1); // allow streak to "hold" across a quiet day
  }
  while (playedDays.has(dayKey(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { current, longest: Math.max(longest, current), playedToday };
}

/** Split total playtime into morning/afternoon/evening/night buckets. */
export function computeTimeOfDay(sessions: GameSession[]): TimeOfDaySlice[] {
  const buckets = [0, 0, 0, 0]; // 0-6, 6-12, 12-18, 18-24
  for (const s of sessions) {
    const h = new Date(s.date).getHours();
    const idx = Math.min(3, Math.floor(h / 6));
    buckets[idx] += s.durationMin;
  }
  const labels = ["Night (00–06)", "Morning (06–12)", "Afternoon (12–18)", "Evening (18–24)"];
  return labels.map((label, i) => ({
    label,
    minutes: buckets[i],
    color: TOD_PALETTE[i],
  }));
}

/** Compare playtime for the current calendar month vs the previous one. */
export function computePeriodCompare(sessions: GameSession[]): PeriodCompare {
  const now = new Date();
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  let thisMonthMin = 0;
  let lastMonthMin = 0;
  for (const s of sessions) {
    const d = new Date(s.date);
    if (d >= thisStart) thisMonthMin += s.durationMin;
    else if (d >= lastStart && d <= lastEnd) lastMonthMin += s.durationMin;
  }

  const deltaMin = thisMonthMin - lastMonthMin;
  const pct =
    lastMonthMin > 0
      ? Math.round((deltaMin / lastMonthMin) * 100)
      : thisMonthMin > 0
      ? 100
      : 0;

  return { thisMonthMin, lastMonthMin, deltaMin, pct };
}

/** Playtime so far in the current calendar month. */
export function computeMonthToDate(sessions: GameSession[]): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return sessions
    .filter((s) => new Date(s.date) >= start)
    .reduce((sum, s) => sum + s.durationMin, 0);
}

// ── Weekday split ────────────────────────────────────────────────────

export interface WeekdaySplit {
  /** Minutes per weekday, Monday-first (index 0 = Mon … 6 = Sun). */
  minutes: number[];
  totalMinutes: number;
  maxMinutes: number;
  /** Index into `minutes` of the busiest weekday (-1 when nothing played). */
  favoriteIndex: number;
}

/** Aggregate playtime by weekday (Mon–Sun, Monday-first). */
export function computeWeekdaySplit(sessions: GameSession[]): WeekdaySplit {
  const minutes = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    const day = new Date(s.date).getDay(); // 0 = Sun … 6 = Sat
    minutes[(day + 6) % 7] += s.durationMin; // shift to Mon-first
  }

  let favoriteIndex = -1;
  let maxMinutes = 0;
  let totalMinutes = 0;
  minutes.forEach((m, i) => {
    totalMinutes += m;
    if (m > maxMinutes) {
      maxMinutes = m;
      favoriteIndex = i;
    }
  });

  return { minutes, totalMinutes, maxMinutes, favoriteIndex };
}

// ── Monthly trend ────────────────────────────────────────────────────

/** Playtime per calendar month for the last `months` months (incl. current). */
export function computeMonthlyTrend(
  sessions: GameSession[],
  months = 6
): { label: string; minutes: number }[] {
  const now = new Date();
  const out: { label: string; minutes: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    let mins = 0;
    for (const s of sessions) {
      const d = new Date(s.date);
      if (d >= monthStart && d < monthEnd) mins += s.durationMin;
    }
    out.push({
      label: monthStart.toLocaleDateString(undefined, { month: "short" }),
      minutes: mins,
    });
  }
  return out;
}

// ── Best single day ──────────────────────────────────────────────────

/** The most-played day within a heatmap window (skips future cells). */
export function findBestDay(cells: DayCell[]): DayCell | null {
  let best: DayCell | null = null;
  const now = new Date();
  for (const c of cells) {
    if (c.date > now) continue;
    if (c.minutes > 0 && (!best || c.minutes > best.minutes)) best = c;
  }
  return best;
}

// ── Monthly goal pace ────────────────────────────────────────────────

export interface GoalPace {
  /** Minutes the goal expects by today, assuming a linear monthly rate. */
  expectedMin: number;
  /** actual - expected (positive = ahead of pace). */
  diffMin: number;
}

/** How the current month's playtime compares to a linear goal pace. */
export function computeGoalPace(
  currentMin: number,
  goalMin: number
): GoalPace | null {
  if (goalMin <= 0) return null;
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedMin = (goalMin * dayOfMonth) / daysInMonth;
  return { expectedMin, diffMin: currentMin - expectedMin };
}
