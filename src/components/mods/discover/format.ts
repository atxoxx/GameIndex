// Presentation helpers for the Discover browser.

import type { ModSourceId } from "../../../types/mods";

export function formatCount(n?: number): string {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatBytes(n?: number): string {
  if (n == null || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Parse the many timestamp shapes the sites return. */
function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let date: Date;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    date = new Date(num > 1e12 ? num : num * 1000);
  } else {
    date = new Date(trimmed);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Normalize a timestamp into a localized date string. */
export function formatRemoteDate(raw?: string): string | null {
  const date = parseDate(raw);
  return date ? date.toLocaleDateString() : null;
}

/**
 * Localized relative time ("3 days ago", "il y a 3 jours", "vor 3 Tagen").
 * `locale` is the active UI language so the value follows the label.
 * Falls back to a compact numeric form where the API is unavailable.
 */
export function relativeTime(raw?: string, locale?: string): string | null {
  const date = parseDate(raw);
  if (!date) return null;
  const sec = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(sec);
  try {
    const rtf = new Intl.RelativeTimeFormat(locale || undefined, {
      numeric: "auto",
      style: "short",
    });
    if (abs < 60) return rtf.format(-sec, "second");
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return rtf.format(-min, "minute");
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return rtf.format(-hr, "hour");
    const day = Math.round(hr / 24);
    if (Math.abs(day) < 30) return rtf.format(-day, "day");
    const mo = Math.round(day / 30);
    if (Math.abs(mo) < 12) return rtf.format(-mo, "month");
    return rtf.format(-Math.round(mo / 12), "year");
  } catch {
    if (abs < 90) return "now";
    const min = Math.round(sec / 60);
    if (Math.abs(min) < 60) return `${min}m`;
    const hr = Math.round(min / 60);
    if (Math.abs(hr) < 24) return `${hr}h`;
    const day = Math.round(hr / 24);
    if (Math.abs(day) < 30) return `${day}d`;
    const mo = Math.round(day / 30);
    if (Math.abs(mo) < 12) return `${mo}mo`;
    return `${Math.round(mo / 12)}y`;
  }
}

/** Sites return HTML descriptions; render them as readable plain text. */
export function htmlToText(raw?: string): string {
  if (!raw) return "";
  const withBreaks = raw
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, "");
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SOURCE_LABELS: Record<ModSourceId, string> = {
  nexus: "Nexus Mods",
  thunderstore: "Thunderstore",
  gamebanana: "GameBanana",
  moddb: "Mod DB",
  curseforge: "CurseForge",
  modio: "mod.io",
  workshop: "Steam Workshop",
};

export function sourceLabel(id: string): string {
  return SOURCE_LABELS[id as ModSourceId] ?? id;
}

/**
 * Deep link that opens a Steam Workshop item in the Steam client (the
 * subscribe page in the overlay) rather than the browser page. `id` is the
 * published-file id.
 */
export function steamWorkshopUrl(id: string): string {
  return `steam://url/CommunityFilePage/${id}`;
}

/**
 * Count tags across results for the tag facet. `tags` is omitted by the
 * backend when empty, so it must be treated as optional.
 */
export function collectTagCounts(results: { tags?: string[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    for (const tag of r.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/** Whether a result matches the selected tag filter (empty = all). */
export function modHasSelectedTag(mod: { tags?: string[] }, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return (mod.tags ?? []).some((tag) => selected.includes(tag));
}
