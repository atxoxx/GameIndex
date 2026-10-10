import { Bell, Download, Maximize2 } from "lucide-react";
import { TICKER_WIDGETS, useOverlay } from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { Badge } from "../ui";
import { useOverlayNotifications } from "./widgets/NotificationsWidget";
import { formatClock, useSessionElapsed } from "./widgets/SessionWidget";

function readout(
  key: (typeof TICKER_WIDGETS)[number],
  metrics: ReturnType<typeof useOverlay>["metrics"],
  elapsedSeconds: number,
  t: (k: string, v?: Record<string, unknown>) => string,
): string {
  const round = (value: number | undefined, suffix = "") =>
    typeof value === "number" && Number.isFinite(value)
      ? `${Math.round(value)}${suffix}`
      : "—";
  switch (key) {
    case "fps":
      return `${t("overlay.metric.fps")} ${round(metrics?.fps)}`;
    case "cpu":
      return `${t("overlay.metric.cpu")} ${round(metrics?.cpu, "%")}`;
    case "gpu":
      return `${t("overlay.metric.gpu")} ${round(metrics?.gpu, "%")}`;
    case "session":
      return formatClock(elapsedSeconds);
    default:
      return "";
  }
}

/**
 * Collapsed overlay — a compact, translucent pill. The readout follows
 * `settings.tickerWidgets`; trailing badges flag active downloads and pending
 * notifications. The pill is a window drag region; the trailing button
 * (kept out of the drag region) expands the interactive panel.
 */
export default function OverlayTicker() {
  const { settings, metrics, session, corner, expand } = useOverlay();
  const { activeCount } = useDownloads();
  const notifications = useOverlayNotifications();
  const { t } = useLanguage();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);

  const segments = settings.tickerWidgets
    .filter((key): key is (typeof TICKER_WIDGETS)[number] =>
      (TICKER_WIDGETS as readonly string[]).includes(key),
    )
    .map((key) => readout(key, metrics, elapsed, t))
    .filter(Boolean);

  return (
    <div
      className="overlay-ticker"
      data-testid="overlay-ticker"
      data-corner={corner}
      data-tauri-drag-region="deep"
    >
      <span className="overlay-ticker__readout">
        {segments.length > 0 ? segments.join("  ·  ") : t("overlay.noSession")}
      </span>
      {activeCount > 0 && (
        <Badge variant="info" className="overlay-ticker__badge">
          <Download aria-hidden />
          {activeCount}
        </Badge>
      )}
      {notifications.length > 0 && (
        <Badge variant="warning" className="overlay-ticker__badge">
          <Bell aria-hidden />
          {notifications.length}
        </Badge>
      )}
      <button
        type="button"
        className="overlay-ticker__expand"
        data-testid="overlay-ticker-expand"
        data-tauri-drag-region="false"
        onClick={expand}
        aria-label={t("overlay.ticker.expand")}
        title={t("overlay.ticker.expand")}
      >
        <Maximize2 aria-hidden />
      </button>
    </div>
  );
}
