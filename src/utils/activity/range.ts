import type { GameSession } from "../../types/game";

/**
 * Date ranges for the activity surfaces.
 *
 * `custom` is the only key that needs companion values (`from`/`to`); every
 * other key is anchored to today so a saved URL or view always means the same
 * thing relative to the day it is opened.
 */
export type ActivityRangeKey = "7d" | "30d" | "90d" | "all" | "custom";

export const ACTIVITY_RANGE_KEYS: readonly ActivityRangeKey[] = [
  "7d",
  "30d",
  "90d",
  "all",
  "custom",
];

/** Default range for both the page and the per-game tab. */
export const DEFAULT_ACTIVITY_RANGE: ActivityRangeKey = "30d";

/** Inclusive day window, resolved to local calendar days. */
export interface ActivityRange {
  key: ActivityRangeKey;
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  /** YYYY-MM-DD, inclusive. */
  endDate: string;
}

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Truncate a date to local midnight. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local `YYYY-MM-DD` key. Never use `toISOString()` for day keys: it can
 *  shift a late-evening session into the next day in UTC. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse a `YYYY-MM-DD` key as local midnight. Returns null for malformed or
 *  impossible dates (`2026-02-31`). */
export function parseLocalDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Session end is the stored timestamp; the start is `end - duration`. */
export function sessionDayKey(session: GameSession): string {
  return localDayKey(new Date(session.date));
}

function sessionsIn(sessions: GameSession[], startDate: string, endDate: string): boolean {
  return sessions.some((session) => {
    const day = sessionDayKey(session);
    return day >= startDate && day <= endDate;
  });
}

/**
 * Resolve a range key (plus custom endpoints) into concrete local day keys.
 *
 * Custom dates are clamped so `end` never precedes `start` and neither runs
 * past today — sessions cannot exist in the future, and an accidental future
 * date should not stretch the chart into empty weeks.
 */
export function resolveActivityRange(options: {
  key: ActivityRangeKey;
  from?: string;
  to?: string;
  sessions?: GameSession[];
  today?: Date;
}): ActivityRange {
  const { key, from, to, sessions = [], today = new Date() } = options;
  const end = startOfLocalDay(today);
  const endKey = localDayKey(end);

  if (key === "custom") {
    let parsedFrom = from ? parseLocalDayKey(from) : null;
    let parsedTo = to ? parseLocalDayKey(to) : null;
    // A reversed picker is a typo, not a reason to drop the range: swap it
    // so the window still matches the two dates the user chose.
    if (parsedFrom && parsedTo && parsedFrom > parsedTo) {
      [parsedFrom, parsedTo] = [parsedTo, parsedFrom];
    }
    const customEnd = parsedTo && parsedTo <= end ? parsedTo : end;
    const fallbackStart = addLocalDays(customEnd, -29);
    const customStart =
      parsedFrom && parsedFrom <= customEnd ? parsedFrom : fallbackStart;
    return {
      key,
      startDate: localDayKey(customStart),
      endDate: localDayKey(customEnd),
    };
  }

  if (key === "all") {
    if (sessions.length === 0) {
      return {
        key,
        startDate: localDayKey(addLocalDays(end, -364)),
        endDate: endKey,
      };
    }
    let earliest = endKey;
    for (const session of sessions) {
      const day = sessionDayKey(session);
      if (day < earliest) earliest = day;
    }
    return { key, startDate: earliest, endDate: endKey };
  }

  const days = key === "7d" ? 7 : key === "90d" ? 90 : 30;
  return {
    key,
    startDate: localDayKey(addLocalDays(end, -(days - 1))),
    endDate: endKey,
  };
}

/** Number of calendar days covered by the range, inclusive. */
export function rangeDayCount(range: ActivityRange): number {
  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  if (!start || !end) return 1;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

/**
 * The equal-length window immediately before `range`, used for deltas.
 * All-time has no meaningful baseline.
 */
export function previousActivityWindow(
  range: ActivityRange,
): { startDate: string; endDate: string } | null {
  if (range.key === "all") return null;
  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  if (!start || !end) return null;
  const days = rangeDayCount(range);
  const prevEnd = addLocalDays(start, -1);
  const prevStart = addLocalDays(prevEnd, -(days - 1));
  return { startDate: localDayKey(prevStart), endDate: localDayKey(prevEnd) };
}

export function isDayInRange(day: string, range: Pick<ActivityRange, "startDate" | "endDate">): boolean {
  return day >= range.startDate && day <= range.endDate;
}

export function filterSessionsToRange(sessions: GameSession[], range: ActivityRange): GameSession[] {
  return sessions.filter((session) => isDayInRange(sessionDayKey(session), range));
}

/** Human label for the scope bar, e.g. "1 Aug – 30 Aug 2026". */
export function formatRangeLabel(range: ActivityRange, language: string): string {
  const start = parseLocalDayKey(range.startDate);
  const end = parseLocalDayKey(range.endDate);
  if (!start || !end) return `${range.startDate} – ${range.endDate}`;
  const sameDay = range.startDate === range.endDate;
  const sameYear = start.getFullYear() === end.getFullYear();
  if (sameDay) {
    return start.toLocaleDateString(language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const startLabel = start.toLocaleDateString(language, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endLabel = end.toLocaleDateString(language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

/** Whether any session falls inside the range. */
export function rangeHasSessions(sessions: GameSession[], range: ActivityRange): boolean {
  return sessionsIn(sessions, range.startDate, range.endDate);
}
