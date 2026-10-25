import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  FolderOpen,
  Gamepad2,
  Hourglass,
  Loader2,
  Play,
  Activity,
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Card, KpiTile } from "../../ui";
import { safeArtworkUrl, resolveGameLogo } from "../../../utils/artworkUrl";
import { parsePlayTime } from "../../../types/game";
import { formatClock, useSessionElapsed } from "../overlayTime";
import { findSessionGame } from "../useOverlayGame";

export { formatClock, useSessionElapsed } from "../overlayTime";

/**
 * Session overview for the expanded panel: the running game, a live session
 * clock and the numbers worth glancing at mid-game. Library KPIs use the
 * shared `KpiTile` so the HUD and the desktop app read the same.
 */
export default function SessionWidget() {
  const {
    session,
    metrics,
    captureScreenshot,
    isCapturing,
    openScreenshotsFolder,
  } = useOverlay();
  const { games, runningGameIds } = useGames();
  const { t } = useLanguage();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);

  const game = useMemo(
    () => findSessionGame(session, games, runningGameIds),
    [session, games, runningGameIds],
  );

  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [game?.id]);

  const logo = useMemo(() => {
    if (!game || logoFailed) return null;
    return resolveGameLogo(game);
  }, [game, logoFailed]);

  const bannerUrl = useMemo(() => {
    if (!game) return null;
    return safeArtworkUrl(game.bannerUrl || game.coverArtUrl);
  }, [game]);

  const totalPlaytimeSeconds = useMemo(() => {
    const baseMinutes = game?.playTime ? parsePlayTime(game.playTime) : 0;
    return Math.max(0, baseMinutes * 60 + Math.floor(elapsed));
  }, [game?.playTime, elapsed]);

  const totalPlaytimeFormatted = useMemo(() => {
    const hours = Math.floor(totalPlaytimeSeconds / 3600);
    const minutes = Math.floor((totalPlaytimeSeconds % 3600) / 60);
    return hours > 0
      ? `${hours}h ${String(minutes).padStart(2, "0")}m`
      : `${minutes}m`;
  }, [totalPlaytimeSeconds]);

  const startedAtFormatted = useMemo(() => {
    if (!session?.startedAt) return "—";
    try {
      return new Date(session.startedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "—";
    }
  }, [session?.startedAt]);

  const displayName = game?.name || session?.name || t("overlay.widget.session");
  const fpsValue =
    typeof metrics?.fps === "number" && metrics.fps > 0
      ? `${Math.round(metrics.fps)} FPS`
      : "—";
  const usage =
    typeof metrics?.cpu === "number"
      ? `CPU ${Math.round(metrics.cpu)}% · GPU ${Math.round(metrics.gpu ?? 0)}%`
      : t("overlay.session.live");

  if (!session && !game) {
    return (
      <Card
        variant="glass"
        className="overlay-widget overlay-session-widget overlay-session-empty"
        data-testid="overlay-session-empty"
      >
        <div className="overlay-session-empty__content">
          <div className="overlay-session-empty__icon">
            <Gamepad2 size={32} />
          </div>
          <h3 className="overlay-session-empty__title">{t("overlay.noSession")}</h3>
          <p className="overlay-session-empty__desc">
            {t("overlay.session.noGameDesc")}
          </p>
        </div>
      </Card>
    );
  }

  const handleCapture = () => {
    void captureScreenshot(game?.name ?? session?.name);
  };

  return (
    <Card
      variant="glass"
      className="overlay-widget overlay-session-widget"
      data-testid="overlay-session-widget"
    >
      <div className="overlay-session-hero">
        {bannerUrl && (
          <div
            className="overlay-session-hero__bg"
            style={{ backgroundImage: `url(${bannerUrl})` }}
            aria-hidden="true"
          />
        )}
        <div className="overlay-session-hero__overlay" />
        <div className="overlay-session-hero__content">
          <div className="overlay-session-hero__branding">
            {logo ? (
              <img
                src={logo}
                alt={game?.name || ""}
                className="overlay-session-hero__logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="overlay-session-hero__title-wrap">
                <Gamepad2 size={22} className="overlay-session-hero__title-icon" />
                <h2 className="overlay-session-hero__title">{displayName}</h2>
              </div>
            )}
          </div>

          <div className="overlay-session-hero__badges">
            {game?.platform && (
              <Badge variant="default" size="sm" className="overlay-session-badge">
                {game.platform}
              </Badge>
            )}
            <span className="overlay-session-status-pill">
              <span className="overlay-session-pulse-dot" />
              <span>{t("overlay.session.active")}</span>
            </span>
            {session?.pid ? (
              <span className="overlay-session-pid-pill">PID {session.pid}</span>
            ) : null}
          </div>
        </div>

        <div className="overlay-session-hero__clock">
          <span className="overlay-session-hero__clock-label">
            {t("overlay.session.currentSession")}
          </span>
          <strong className="overlay-session-hero__clock-value">
            {formatClock(elapsed)}
          </strong>
        </div>
      </div>

      <div className="overlay-session-kpis">
        <KpiTile
          size="sm"
          glass
          icon={<Hourglass size={13} />}
          label={t("overlay.session.totalPlaytime")}
          value={totalPlaytimeFormatted}
          subtext={t("overlay.session.lifetime")}
        />
        <KpiTile
          size="sm"
          glass
          icon={<Play size={13} />}
          label={t("overlay.session.startedAt")}
          value={startedAtFormatted}
        />
        <KpiTile
          size="sm"
          glass
          icon={<Activity size={13} />}
          label={t("overlay.metric.fps")}
          value={fpsValue}
          subtext={usage}
        />
      </div>

      <div className="overlay-session-actions">
        <button
          type="button"
          className="overlay-session-btn overlay-session-btn--primary"
          onClick={handleCapture}
          disabled={isCapturing}
          title={t("overlay.action.screenshotHint")}
        >
          {isCapturing ? (
            <Loader2 size={14} className="overlay-spin" />
          ) : (
            <Camera size={14} />
          )}
          <span>{t("overlay.session.takeScreenshot")}</span>
        </button>

        <button
          type="button"
          className="overlay-session-btn"
          onClick={() => void openScreenshotsFolder()}
          title={t("overlay.screenshot.openFolder")}
        >
          <FolderOpen size={14} />
          <span>{t("overlay.session.openCaptures")}</span>
        </button>
      </div>

      {game && (game.developer || (game.genres && game.genres.length > 0)) && (
        <div className="overlay-session-meta-row">
          {game.developer && (
            <span className="overlay-session-meta-item">
              <span className="overlay-session-meta-label">Dev:</span>{" "}
              <span className="overlay-session-meta-value">{game.developer}</span>
            </span>
          )}
          {game.genres && game.genres.length > 0 && (
            <span className="overlay-session-meta-item">
              <span className="overlay-session-meta-label">Genre:</span>{" "}
              <span className="overlay-session-meta-value">
                {game.genres.slice(0, 3).join(", ")}
              </span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
