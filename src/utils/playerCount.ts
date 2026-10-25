/**
 * Player-count formatting helpers shared by the badge, the drawer and the
 * activity chart. Keeping them out of a component avoids the badge file
 * becoming the de-facto formatting module for every Steam surface.
 */

/** 1234 → "1.2K", 1_350_000 → "1.4M". Below 1000 the raw integer is kept
 *  so small "12 / 47 / 89" counts stay exact. */
export function formatCompactPlayerCount(num: number): string {
  if (num < 1000) return num.toString();
  if (num < 1_000_000) {
    return (
      (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1).replace(/\.0$/, "") + "K"
    );
  }
  return (
    (num / 1_000_000).toFixed(num % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "") +
    "M"
  );
}

/**
 * Percentage change between two averages, rounded to a whole percent.
 * Returns `null` when there is nothing meaningful to compare against
 * (missing or zero baseline), so callers can hide the trend chip instead
 * of rendering a fake "0%".
 */
export function playerCountChangePercent(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (previous == null || !Number.isFinite(previous) || previous <= 0) return null;
  if (!Number.isFinite(current)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export interface SampleTimeOptions {
  /** Append the time of day (hour:minute). */
  withTime?: boolean;
  /** Include the year. Off for recent ranges where it is redundant. */
  withYear?: boolean;
}

/**
 * Locale-aware "Oct 21" / "Oct 21, 21:00" / "Feb 25, 2022" for a steamcharts
 * sample timestamp. Falls back to a plain date string if the runtime rejects
 * the language tag (older WebView on some Linux builds).
 */
export function formatPlayerSampleTime(
  timestamp: number | null | undefined,
  language: string,
  options: SampleTimeOptions = {},
): string {
  if (timestamp == null) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const { withTime = false, withYear = true } = options;
  const formatOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  };

  try {
    return new Intl.DateTimeFormat(language, formatOptions).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Compact axis label for the player-history chart: "Oct 21" for recent
 * ranges, "Wed 22" for a one-week view where month/day repeats, and
 * "Oct '23" for all-time where many years share a month.
 */
export function formatPlayerAxisLabel(
  timestamp: number,
  language: string,
  withYear: boolean,
  withWeekday = false,
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  try {
    if (withYear) {
      const month = new Intl.DateTimeFormat(language, { month: "short" }).format(date);
      return `${month} '${String(date.getFullYear()).slice(-2)}`;
    }
    if (withWeekday) {
      return new Intl.DateTimeFormat(language, {
        weekday: "short",
      }).format(date);
    }
    return new Intl.DateTimeFormat(language, {
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

/**
 * Axis ceiling for concurrent-player charts. `niceCeil` jumps from 5 → 10,
 * which leaves a 68K peak on a 100K axis. This ladder (…4, 5, 6, 8, 10)
 * keeps the line closer to the top of the plot while the grid stays
 * readable (0 / 16K / 32K …).
 */
export function nicePlayerCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((candidate) => fraction <= candidate) ?? 10;
  return step * base;
}
