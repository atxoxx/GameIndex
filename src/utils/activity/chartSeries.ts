import type { GameSession } from "../../types/game";
import {
  addLocalDays,
  parseLocalDayKey,
  type ActivityRange,
} from "./range";
import { sessionDayKey } from "./sessionTime";

export type PlaytimeAggregation = "day" | "week" | "month";

export const PLAYTIME_AGGREGATIONS: readonly PlaytimeAggregation[] = [
  "day",
  "week",
  "month",
];

export interface PlaytimePoint {
  /** YYYY-MM-DD (day/week start) or YYYY-MM (month). */
  key: string;
  label: string;
  minutes: number;
}

function minuteMap(sessions: GameSession[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const session of sessions) {
    const day = sessionDayKey(session);
    map.set(day, (map.get(day) || 0) + session.durationMin);
  }
  return map;
}

function mondayOf(date: Date): Date {
  const day = date.getDay();
  const diff = (day + 6) % 7;
  const monday = new Date(date);
  monday.setDate(monday.getDate() - diff);
  return monday;
}

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function dayLabel(date: Date, language: string): string {
  return date.toLocaleDateString(language, { month: "numeric", day: "numeric" });
}

function weekLabel(monday: Date, language: string): string {
  return monday.toLocaleDateString(language, { month: "short", day: "numeric" });
}

function monthLabel(date: Date, language: string): string {
  return date.toLocaleDateString(language, { month: "short", year: "2-digit" });
}

/**
 * Build the chart series for a range. The series carries every bucket in the
 * range (zeros included) so the x-axis stays honest, and operates on local
 * days rather than the UTC slice of the ISO timestamp.
 */
export function buildPlaytimeSeries(
  sessions: GameSession[],
  range: ActivityRange,
  aggregation: PlaytimeAggregation,
  language: string,
): PlaytimePoint[] {
  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  if (!start || !end) return [];

  // Buckets for weeks/months span days outside the requested window; drop
  // those first so a monthly total never counts a neighbouring day.
  const scoped = sessions.filter((session) => {
    const day = sessionDayKey(session);
    return day >= range.startDate && day <= range.endDate;
  });
  const byDay = minuteMap(scoped);

  if (aggregation === "day") {
    const points: PlaytimePoint[] = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addLocalDays(cursor, 1)) {
      const key = localKey(cursor);
      points.push({ key, label: dayLabel(cursor, language), minutes: byDay.get(key) ?? 0 });
    }
    return points;
  }

  if (aggregation === "week") {
    const byWeek = new Map<string, number>();
    for (const [day, minutes] of byDay) {
      const date = parseLocalDayKey(day);
      if (!date) continue;
      const key = localKey(mondayOf(date));
      byWeek.set(key, (byWeek.get(key) || 0) + minutes);
    }
    const points: PlaytimePoint[] = [];
    const firstMonday = mondayOf(start);
    for (
      let cursor = firstMonday;
      cursor <= end;
      cursor = addLocalDays(cursor, 7)
    ) {
      const key = localKey(cursor);
      points.push({
        key,
        label: weekLabel(cursor, language),
        minutes: byWeek.get(key) ?? 0,
      });
    }
    return points;
  }

  const byMonth = new Map<string, number>();
  for (const [day, minutes] of byDay) {
    const key = day.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + minutes);
  }
  const points: PlaytimePoint[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    points.push({
      key,
      label: monthLabel(cursor, language),
      minutes: byMonth.get(key) ?? 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}

/** Running total (hours) over the periodic series. */
export function cumulativeHours(points: PlaytimePoint[]): number[] {
  let total = 0;
  return points.map((point) => {
    total += point.minutes;
    return Math.round((total / 60) * 10) / 10;
  });
}

export function periodHours(points: PlaytimePoint[]): number[] {
  return points.map((point) => Math.round((point.minutes / 60) * 10) / 10);
}

/** Long ranges should not paint hundreds of daily bars. The overview picks a
 *  sensible default when the range changes; this helper keeps the preference
 *  valid for a given range. */
export function recommendedAggregation(range: ActivityRange): PlaytimeAggregation {
  if (range.key === "all") return "month";
  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  if (!start || !end) return "day";
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 180) return "month";
  if (days > 90) return "week";
  return "day";
}
