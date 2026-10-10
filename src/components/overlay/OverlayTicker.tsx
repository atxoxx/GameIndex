import { Bell, Download, Maximize2, Camera, Loader2, Gauge, Cpu, Monitor, Clock } from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import { Badge } from "../ui";
import { useOverlayNotifications } from "./widgets/NotificationsWidget";
import { formatClock, useSessionElapsed } from "./widgets/SessionWidget";

export default function OverlayTicker() {
  const {
    settings,
    metrics,
    session,
    corner,
    expand,
    captureScreenshot,
    isCapturing,
    flashScreen,
  } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const { activeCount } = useDownloads();
  const notifications = useOverlayNotifications();
  const { t } = useLanguage();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);

  const activeGame = games.find((g) => g.id === session?.gameId);

  const handleSnap = (e: React.MouseEvent) => {
    e.stopPropagation();
    void captureScreenshot(activeGame?.name);
  };

  const fps = metrics?.fps;
  const fpsClass =
    typeof fps === "number" && fps > 0
      ? fps >= 60
        ? "overlay-fps--good"
        : fps >= 30
          ? "overlay-fps--fair"
          : "overlay-fps--low"
      : "";

  return (
    <div
      className="overlay-ticker"
      data-testid="overlay-ticker"
      data-corner={corner}
      data-tauri-drag-region="deep"
      style={{
        opacity: `var(--overlay-opacity, ${settings.opacity})`,
      }}
    >
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      <div className="overlay-ticker__segments" data-tauri-drag-region="deep">
        {settings.tickerWidgets.includes("fps") && (
          <span className={`overlay-ticker__pill overlay-ticker__fps ${fpsClass}`}>
            <Gauge size={12} />
            <span>{t("overlay.metric.fps")} {typeof fps === "number" && Number.isFinite(fps) ? Math.round(fps) : "—"}</span>
          </span>
        )}

        {settings.tickerWidgets.includes("cpu") && (
          <span className="overlay-ticker__pill">
            <Cpu size={12} />
            <span>{typeof metrics?.cpu === "number" ? `${Math.round(metrics.cpu)}%` : "—"}</span>
          </span>
        )}

        {settings.tickerWidgets.includes("gpu") && (
          <span className="overlay-ticker__pill">
            <Monitor size={12} />
            <span>{typeof metrics?.gpu === "number" ? `${Math.round(metrics.gpu)}%` : "—"}</span>
          </span>
        )}

        {settings.tickerWidgets.includes("session") && (
          <span className="overlay-ticker__pill">
            <Clock size={12} />
            <span>{formatClock(elapsed)}</span>
          </span>
        )}
      </div>

      <div className="overlay-ticker__tail" data-tauri-drag-region="false">
        {/* Instant snap camera button */}
        <button
          type="button"
          className="overlay-ticker__action-btn"
          onClick={handleSnap}
          disabled={isCapturing}
          title={t("overlay.action.screenshotHint")}
          aria-label={t("overlay.action.screenshot")}
        >
          {isCapturing ? <Loader2 size={13} className="overlay-spin" /> : <Camera size={13} />}
        </button>

        {activeCount > 0 && (
          <Badge variant="info" className="overlay-ticker__badge">
            <Download aria-hidden size={11} />
            {activeCount}
          </Badge>
        )}

        {notifications.length > 0 && (
          <Badge variant="warning" className="overlay-ticker__badge">
            <Bell aria-hidden size={11} />
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
          <Maximize2 aria-hidden size={13} />
        </button>
      </div>
    </div>
  );
}
