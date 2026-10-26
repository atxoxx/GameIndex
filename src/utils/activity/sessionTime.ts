import type { GameSession } from "../../types/game";

/** The stored `date` is the session *end*; the start is derived. */
export function sessionEndDate(session: Pick<GameSession, "date">): Date {
  return new Date(session.date);
}

export function sessionStartDate(
  session: Pick<GameSession, "date" | "durationMin">,
): Date {
  return new Date(sessionEndDate(session).getTime() - session.durationMin * 60_000);
}

/** Local `YYYY-MM-DD` key for the day the session ended. */
export function sessionDayKey(session: Pick<GameSession, "date">): string {
  const end = sessionEndDate(session);
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(
    end.getDate(),
  ).padStart(2, "0")}`;
}

function timeLabel(date: Date, language: string): string {
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

/** "21:40 – 23:10" in the active locale. */
export function formatSessionClockRange(
  session: Pick<GameSession, "date" | "durationMin">,
  language: string,
): string {
  return `${timeLabel(sessionStartDate(session), language)} – ${timeLabel(
    sessionEndDate(session),
    language,
  )}`;
}

export function formatSessionDay(
  session: Pick<GameSession, "date">,
  language: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  return sessionEndDate(session).toLocaleDateString(language, options);
}

export interface SessionDayGroup {
  day: string;
  sessions: GameSession[];
  minutes: number;
}

/**
 * Group a date-sorted list into local day buckets. The caller is responsible
 * for sorting; this preserves the incoming order inside each group.
 */
export function groupSessionsByDay(sessions: GameSession[]): SessionDayGroup[] {
  const groups = new Map<string, SessionDayGroup>();
  for (const session of sessions) {
    const day = sessionDayKey(session);
    const existing = groups.get(day);
    if (existing) {
      existing.sessions.push(session);
      existing.minutes += session.durationMin;
    } else {
      groups.set(day, { day, sessions: [session], minutes: session.durationMin });
    }
  }
  return Array.from(groups.values());
}

/** Local-day streak from a set of active day keys (consecutive runs). */
export function longestDayStreak(days: Iterable<string>): number {
  const sorted = Array.from(new Set(days)).sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of sorted) {
    const [year, month, day] = key.split("-").map(Number);
    const time = new Date(year, month - 1, day).getTime();
    if (!Number.isFinite(time)) continue;
    run = previous !== null && time - previous === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

/** Streak that includes today or yesterday, counted backwards. */
export function currentDayStreak(days: Iterable<string>, today = new Date()): number {
  const set = new Set(days);
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const key = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  if (!set.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(key(cursor))) return 0;
  }
  let run = 0;
  while (set.has(key(cursor))) {
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}
