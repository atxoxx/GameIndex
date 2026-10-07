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

/** Normalize the many timestamp shapes the sites return. */
export function formatRemoteDate(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let date: Date;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    const ms = num > 1e12 ? num : num * 1000;
    date = new Date(ms);
  } else {
    date = new Date(trimmed);
  }
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

/** Compact relative time ("3d", "2mo") for timestamps in cards. */
export function relativeTime(raw?: string): string | null {
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
  if (Number.isNaN(date.getTime())) return null;
  const sec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 90) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(mo / 12)}y`;
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
