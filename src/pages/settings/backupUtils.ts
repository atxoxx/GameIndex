import type { BackupArchiveSummary, BackupConfig, BackupStatus } from "../../types/backup";

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

/** Translate function shape from LanguageContext. */
type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Format relative time from a unix epoch second timestamp. Labels are
 * localized via `t` — the app has no plural-aware relative-time helper that
 * fits this compact "2h ago" style.
 */
export function formatBackupRelative(
  epochSec: number | null | undefined,
  t: Translate,
): string {
  if (!epochSec) return "";
  const diffSec = Math.floor(Date.now() / 1000) - epochSec;
  if (diffSec < 45) return t("settings.backup.relative.justNow");
  if (diffSec < 3600) {
    return t("settings.backup.relative.minutes", { count: Math.floor(diffSec / 60) });
  }
  if (diffSec < 86400) {
    return t("settings.backup.relative.hours", { count: Math.floor(diffSec / 3600) });
  }
  if (diffSec < 86400 * 30) {
    return t("settings.backup.relative.days", { count: Math.floor(diffSec / 86400) });
  }
  return formatBackupDate(epochSec);
}

export interface DomainColorInfo {
  category: string;
  color: string;
}

/** Visual categories and harmonious CSS variables for the storage breakdown meter. */
export const DOMAIN_CATEGORY_MAP: Record<string, DomainColorInfo> = {
  games: { category: "library", color: "var(--domain-color-games, #38bdf8)" },
  sessions: { category: "activity", color: "var(--domain-color-sessions, #818cf8)" },
  wishlist: { category: "library", color: "var(--domain-color-wishlist, #60a5fa)" },
  achievements: { category: "achievements", color: "var(--domain-color-achievements, #facc15)" },
  saves: { category: "saves", color: "var(--domain-color-saves, #2dd4bf)" },
  emulators: { category: "emulators", color: "var(--domain-color-emulators, #34d399)" },
  mods: { category: "mods", color: "var(--domain-color-mods, #f472b6)" },
  plugins: { category: "system", color: "var(--domain-color-plugins, #c084fc)" },
  sources: { category: "system", color: "var(--domain-color-sources, #a855f7)" },
  download_history: { category: "system", color: "var(--domain-color-download, #9333ea)" },
  store_cache: { category: "cache", color: "var(--domain-color-cache, #94a3b8)" },
  news: { category: "cache", color: "var(--domain-color-news, #64748b)" },
  kv: { category: "settings", color: "var(--domain-color-kv, #fb923c)" },
  compatibility: { category: "system", color: "var(--domain-color-compat, #e879f9)" },
};

/** Get the domain color info or a default palette color. */
export function getDomainColor(domain: string): string {
  return DOMAIN_CATEGORY_MAP[domain]?.color ?? "var(--color-accent)";
}

export interface HealthCheckItem {
  id: string;
  /** i18n key for the check name. */
  nameKey: string;
  /** i18n key for the check description. */
  descKey: string;
  /** Optional interpolation values for `descKey`. */
  descParams?: Record<string, number>;
  passed: boolean;
  score: number;
  weight: number;
}

export interface BackupHealthSummary {
  score: number;
  grade: "A+" | "A" | "B" | "C" | "F";
  labelKey: string;
  intent: "accent" | "success" | "warning" | "danger" | "default";
  checks: HealthCheckItem[];
}

export function calculateBackupHealth(
  status: BackupStatus | null,
  archives: BackupArchiveSummary[],
  config: BackupConfig | null
): BackupHealthSummary {
  const checks: HealthCheckItem[] = [];

  // Check 1: Recency (Max 40 points)
  let recencyScore = 0;
  let recencyDescKey = "settings.backup.healthCheck.recency.none";
  if (status?.lastBackupAt) {
    const ageDays = (Date.now() / 1000 - status.lastBackupAt) / 86400;
    if (ageDays <= 2) {
      recencyScore = 40;
      recencyDescKey = "settings.backup.healthCheck.recency.fresh";
    } else if (ageDays <= 7) {
      recencyScore = 32;
      recencyDescKey = "settings.backup.healthCheck.recency.week";
    } else if (ageDays <= 14) {
      recencyScore = 20;
      recencyDescKey = "settings.backup.healthCheck.recency.stale";
    } else {
      recencyScore = 10;
      recencyDescKey = "settings.backup.healthCheck.recency.old";
    }
  }
  checks.push({
    id: "recency",
    nameKey: "settings.backup.healthCheck.recency.name",
    descKey: recencyDescKey,
    passed: recencyScore >= 30,
    score: recencyScore,
    weight: 40,
  });

  // Check 2: Archives Count / Protection Redundancy (Max 25 points)
  let redundancyScore = 0;
  let redundancyDescKey = "settings.backup.healthCheck.redundancy.none";
  if (archives.length >= 3) {
    redundancyScore = 25;
    redundancyDescKey = "settings.backup.healthCheck.redundancy.healthy";
  } else if (archives.length >= 1) {
    redundancyScore = 15;
    redundancyDescKey = "settings.backup.healthCheck.redundancy.low";
  }
  checks.push({
    id: "redundancy",
    nameKey: "settings.backup.healthCheck.redundancy.name",
    descKey: redundancyDescKey,
    descParams: { count: archives.length },
    passed: redundancyScore >= 20,
    score: redundancyScore,
    weight: 25,
  });

  // Check 3: Automation Status (Max 20 points)
  const autoExit = config?.autoBackupOnExit ?? false;
  checks.push({
    id: "automation",
    nameKey: "settings.backup.healthCheck.automation.name",
    descKey: autoExit
      ? "settings.backup.healthCheck.automation.on"
      : "settings.backup.healthCheck.automation.off",
    passed: autoExit,
    score: autoExit ? 20 : 0,
    weight: 20,
  });

  // Check 4: Safety Snapshot Protection (Max 15 points)
  const safety = config?.safetyBackupBeforeRestore ?? true;
  checks.push({
    id: "safety",
    nameKey: "settings.backup.healthCheck.safety.name",
    descKey: safety
      ? "settings.backup.healthCheck.safety.on"
      : "settings.backup.healthCheck.safety.off",
    passed: safety,
    score: safety ? 15 : 0,
    weight: 15,
  });

  const totalScore = checks.reduce((acc, c) => acc + c.score, 0);

  let grade: BackupHealthSummary["grade"] = "F";
  let intent: BackupHealthSummary["intent"] = "danger";
  let labelKey = "settings.backup.health.never";

  if (totalScore >= 90) {
    grade = "A+";
    intent = "accent";
    labelKey = "settings.backup.health.optimal";
  } else if (totalScore >= 75) {
    grade = "A";
    intent = "accent";
    labelKey = "settings.backup.health.recent";
  } else if (totalScore >= 50) {
    grade = "B";
    intent = "warning";
    labelKey = "settings.backup.health.adequate";
  } else if (totalScore >= 25) {
    grade = "C";
    intent = "warning";
    labelKey = "settings.backup.health.stale";
  } else {
    grade = "F";
    intent = "danger";
    labelKey = "settings.backup.health.never";
  }

  return {
    score: totalScore,
    grade,
    labelKey,
    intent,
    checks,
  };
}