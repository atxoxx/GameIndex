/**
 * Locale-aware date and number formatting shared by every page.
 *
 * The app has its own display language, so formatting must use that language
 * rather than the OS locale. Passing `undefined` to `toLocaleDateString()` /
 * `Intl.*Format` silently follows the OS: an English UI on a French machine
 * then renders "18 nov." next to English labels. Callers pass
 * `useLanguage().language` here instead.
 *
 * Invalid dates return an empty string so a malformed remote value never
 * reaches the UI as "Invalid Date".
 */

export type DateInput = Date | number | string;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar date, e.g. "Nov 18, 2026". */
export function formatDate(
  value: DateInput,
  locale?: string,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale || undefined, options).format(date);
}

/** Date + wall-clock time, e.g. "Nov 18, 2026, 2:32 PM". */
export function formatDateTime(
  value: DateInput,
  locale?: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  return formatDate(value, locale, options);
}

/** Wall-clock time only, e.g. "14:32". */
export function formatTime(
  value: DateInput,
  locale?: string,
  options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  return formatDate(value, locale, options);
}

/** Grouped, locale-aware number, e.g. 12,345 or 12 345. */
export function formatNumber(
  value: number,
  locale?: string,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale || undefined, options).format(value);
}
