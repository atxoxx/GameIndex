// bigscreenFormat — pure string / number helpers used by the
// Big Screen hero, spotlight, and meta strip.
//
// All functions are deterministic, side-effect-free, and have no
// React or DOM dependencies — they're trivially testable and safe
// to import from any layer (component, hook, context).

/**
 * Truncate a string to at most `max` characters, appending a
 * single-character ellipsis if the input was longer. Whitespace at
 * the cut boundary is trimmed so the ellipsis lands flush against
 * a real letter (no "Hello …" with a dangling space).
 */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

/**
 * One time bin of the relative "time ago" ladder. `key` points at an
 * i18n string that interpolates `{n}` (e.g. `"{n}m ago"`); callers
 * localize it with `t()`.
 */
export interface RelativeTimePart {
  key: string;
  n?: number;
}

/**
 * Bin a Unix-ms timestamp into relative "time ago" i18n keys.
 * Bins chosen for TV viewing distance: minutes, hours, days, weeks,
 * months, years — anything past two years rounds to "2y ago" without
 * becoming noisy. Returns the "just now" bin even for a slightly
 * negative drift (clock skew), so callers never render a bare number.
 */
export function formatLastPlayedParts(ts: number): RelativeTimePart {
  const diffMs = Date.now() - ts;
  if (diffMs <= 0) return { key: "game.quickStats.justNow" };
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { key: "game.quickStats.justNow" };
  if (minutes < 60) return { key: "game.quickStats.minutesAgo", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "game.quickStats.hoursAgo", n: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { key: "game.quickStats.daysAgo", n: days };
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return { key: "game.quickStats.weeksAgo", n: weeks };
  const months = Math.floor(days / 30);
  if (months < 24) return { key: "game.quickStats.monthsAgo", n: months };
  const years = Math.floor(days / 365);
  return { key: "game.quickStats.yearsAgo", n: years };
}

/**
 * Localized `formatLastPlayed` — the version every rendering surface
 * should use. Falls back to the localized "never played" string for
 * a zero/absent timestamp so the helper stays safe on partial data.
 */
export function formatLastPlayedLocalized(
  ts: number,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string {
  if (!ts || ts <= 0) return t("game.quickStats.neverPlayed");
  const part = formatLastPlayedParts(ts);
  return part.n === undefined ? t(part.key) : t(part.key, { n: part.n });
}

/**
 * Pull a 4-digit year out of an IGDB date string.
 *
 * ISO `YYYY-MM-DD` is the most common shape; we also accept the
 * first 4-digit run for free-form strings like "Q4 2025". Returns
 * `null` for missing or unparseable input — callers conditionally
 * render the year pill rather than emitting a placeholder.
 */
export function extractYear(date: string | undefined): number | null {
  if (!date) return null;
  const m = date.match(/(19|20)\d{2}/);
  return m ? Number.parseInt(m[0], 10) : null;
}

/**
 * Test whether a URL points to a directly-playable video file
 * (.mp4 / .webm / .mov / .m3u8). Used by the lightbox to decide
 * between `<video>` and `<img>`. Excludes YouTube / Twitch / Vimeo
 * link URLs because those can't play in a regular video element.
 */
export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m3u8)(\?|#|$)/i.test(url);
}

/**
 * Format a deal price with the user's locale via Intl.NumberFormat.
 * ITAD prices are EUR (backend contract), so EUR is the default when
 * no store-specific currency is available — the symbol/grouping/
 * placement still follow the active UI locale.
 */
export function formatPrice(
  price: number,
  locale: string,
  currency?: string,
): string {
  if (!Number.isFinite(price)) return "—";
  const resolvedCurrency = currency ?? "EUR";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: resolvedCurrency,
    }).format(price);
  } catch {
    return `${resolvedCurrency} ${price.toFixed(2)}`;
  }
}