import type { StoreInstall } from "../../types/storeInstalls";

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Rounded percentage, or `null` while the store can't say. */
export function storeInstallPercent(entry: StoreInstall): number | null {
  if (entry.percent == null || !Number.isFinite(entry.percent)) return null;
  return Math.max(0, Math.min(99, Math.round(entry.percent)));
}

/**
 * One line describing what the store is doing: "Downloading · 42%",
 * "Installing · 88%" or "Starting…" before any bytes move.
 */
export function storeInstallHeadline(
  entry: StoreInstall,
  t: Translate,
  updating = false,
): string {
  const percent = storeInstallPercent(entry);
  switch (entry.state) {
    case "pending":
      return t("storeInstall.starting");
    case "installing":
      return percent == null
        ? t("storeInstall.installing")
        : t("storeInstall.installingPercent", { percent });
    default:
      if (updating) {
        return percent == null
          ? t("storeInstall.updating")
          : t("storeInstall.updatingPercent", { percent });
      }
      return percent == null
        ? t("storeInstall.downloading")
        : t("storeInstall.downloadingPercent", { percent });
  }
}

/**
 * Secondary line — transfer rate and time left — or `null` when the store
 * exposes neither.
 */
export function storeInstallDetail(
  entry: StoreInstall,
  formatSpeed: (bytesPerSecond: number) => string,
  formatEta: (seconds: number) => string,
): string | null {
  if (entry.state !== "downloading") return null;
  const parts: string[] = [];
  if (entry.speed && entry.speed > 0) parts.push(formatSpeed(entry.speed));
  if (entry.eta && entry.eta > 0) parts.push(formatEta(entry.eta));
  return parts.length ? parts.join(" · ") : null;
}

/** Human name for the store behind a transfer. */
export function storeInstallSourceName(entry: Pick<StoreInstall, "source">): string {
  return entry.source === "steam" ? "Steam" : "Epic";
}

/**
 * Time left, phrased with the download page's existing strings so the two
 * surfaces never disagree about wording.
 */
export function formatEtaLabel(seconds: number, t: Translate): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return t("download.status.secondsRemaining", { seconds: total });
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return t("download.status.minutesRemaining", {
      minutes,
      remainingSeconds: total % 60,
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("download.status.hoursRemaining", {
      hours,
      remainingMinutes: minutes % 60,
    });
  }
  if (Math.floor(hours / 24) > 30) return t("download.status.over30d");
  return t("download.status.daysRemaining", {
    days: Math.floor(hours / 24),
    remainingHours: hours % 24,
  });
}
