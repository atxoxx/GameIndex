/**
 * Time helpers shared by the Saves hub, the per-game Saves tab and the
 * Game Overview card.
 *
 * Relative labels always receive the app language: passing `undefined` would
 * fall back to the OS locale and mix languages (e.g. "il y a 5 minutes" under
 * an English UI).
 */

/** Compact relative time, localized via `Intl.RelativeTimeFormat`. */
export function formatRelative(ms: number, locale?: string): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return rtf.format(0, "second");
  if (abs < hour) return rtf.format(-Math.round(diff / minute), "minute");
  if (abs < day) return rtf.format(-Math.round(diff / hour), "hour");
  if (abs < 30 * day) return rtf.format(-Math.round(diff / day), "day");
  if (abs < 365 * day) return rtf.format(-Math.round(diff / (30 * day)), "month");
  return rtf.format(-Math.round(diff / (365 * day)), "year");
}

/** Local calendar day as a stable key (`YYYY-MM-DD`, no timezone math). */
export function localDayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local day key for today, used by the timeline to label "Today". */
export function todayKey(): string {
  return localDayKey(Date.now());
}

/** Local day key for yesterday. */
export function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return localDayKey(date.getTime());
}

/**
 * Localized date for a day key, e.g. "Wednesday, 22 October".
 * The year is only included when the day is not in the current year.
 */
export function formatDayKey(dayKey: string, locale?: string): string {
  const [year, month, day] = dayKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) return dayKey;
  const date = new Date(year, month - 1, day);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(locale || undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** Wall-clock time for a snapshot, e.g. "14:32". */
export function formatClockTime(ms: number, locale?: string): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat(locale || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
