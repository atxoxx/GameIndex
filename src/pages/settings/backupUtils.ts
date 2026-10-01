/** Format a byte count for the Backup tab (B / KB / MB / GB). */
export function formatBackupBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

/** Format a unix epoch second timestamp to localized date/time string. */
export function formatBackupDate(epochSec: number | null | undefined): string {
  if (!epochSec) return "";
  return new Date(epochSec * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Format relative time from a unix epoch second timestamp. */
export function formatBackupRelative(epochSec: number | null | undefined): string {
  if (!epochSec) return "";
  const diffSec = Math.floor(Date.now() / 1000) - epochSec;
  if (diffSec < 45) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)}d ago`;
  return formatBackupDate(epochSec);
}

export interface DomainColorInfo {
  category: string;
  color: string;
}

/** Visual categories and harmonious accent colors for the storage breakdown meter. */
export const DOMAIN_CATEGORY_MAP: Record<string, DomainColorInfo> = {
  games: { category: "library", color: "#38bdf8" }, // sky
  sessions: { category: "activity", color: "#818cf8" }, // indigo
  wishlist: { category: "library", color: "#60a5fa" }, // blue
  achievements: { category: "achievements", color: "#facc15" }, // yellow
  saves: { category: "saves", color: "#2dd4bf" }, // teal
  emulators: { category: "emulators", color: "#34d399" }, // emerald
  mods: { category: "mods", color: "#f472b6" }, // pink
  plugins: { category: "system", color: "#c084fc" }, // purple
  sources: { category: "system", color: "#a855f7" }, // violet
  download_history: { category: "system", color: "#9333ea" },
  store_cache: { category: "cache", color: "#94a3b8" }, // slate
  news: { category: "cache", color: "#64748b" },
  kv: { category: "settings", color: "#fb923c" }, // orange
  compatibility: { category: "system", color: "#e879f9" }, // fuchsia
};

/** Get the domain color info or a default palette color. */
export function getDomainColor(domain: string): string {
  return DOMAIN_CATEGORY_MAP[domain]?.color ?? "var(--color-primary)";
}