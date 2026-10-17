import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Hourglass,
  Play,
  Activity,
  Camera,
  FolderOpen,
  Gamepad2,
  Loader2,
} from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Card } from "../../ui";
import { safeArtworkUrl, resolveGameLogo } from "../../../utils/artworkUrl";
import { parsePlayTime } from "../../../types/game";

/** Format elapsed seconds as `mm:ss`, or `h:mm:ss` past an hour. */
export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Local 1 s elapsed timer anchored to a session's `startedAt`. Returns 0
 * when no session is running. Shared by the ticker and the session widget so
 * the two readouts stay in lockstep.
 */
export function useSessionElapsed(startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}

/** Session / playtime hero dashboard for the expanded overlay panel. */
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

  const game = useMemo(() => {
    if (session?.gameId) {
      const match = games.find(
        (g) => g.id === session.gameId || String(g.id) === String(session.gameId),
      );
      if (match) return match;
    }
    if (runningGameIds.length > 0) {
      return (
        games.find(
          (g) =>
            g.id === runningGameIds[0] ||
            String(g.id) === String(runningGameIds[0]),
        ) ?? null
      );
    }
    return null;
  }, [session?.gameId, games, runningGameIds]);

  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [game?.id]);

  const effectiveLogo = useMemo(() => {
    if (!game || logoFailed) return null;
    return resolveGameLogo(game);
  }, [game, logoFailed]);

  const bannerUrl = useMemo(() => {
    if (!game) return null;
    return safeArtworkUrl(game.bannerUrl || game.coverArtUrl);
  }, [game]);

  const baseMinutes = useMemo(() => {
    if (!game?.playTime) return 0;
    return parsePlayTime(game.playTime);
  }, [game?.playTime]);

  const totalLifetimeSeconds = Math.max(0, baseMinutes * 60 + Math.floor(elapsed));
  const totalLifetimeHours = Math.floor(totalLifetimeSeconds / 3600);
  const totalLifetimeMins = Math.floor((totalLifetimeSeconds % 3600) / 60);
  const totalPlaytimeFormatted =
    totalLifetimeHours > 0
      ? `${totalLifetimeHours}h ${String(totalLifetimeMins).padStart(2, "0")}m`
      : `${totalLifetimeMins}m`;

  const startedAtFormatted = useMemo(() => {
    if (!session?.startedAt) return "—";
    try {
      const d = new Date(session.startedAt);
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "—";
    }
  }, [session?.startedAt]);

  const handleCapture = () => {
    void captureScreenshot(game?.name ?? session?.name);
  };

  const handleOpenFolder = () => {
    void openScreenshotsFolder();
  };

  if (!session && !game) {
    return (
      <Card
        variant="glass"
        className="overlay-widget overlay-session-widget overlay-session-empty"
        data-testid="overlay-session-empty"
      >
        <div className="overlay-session-empty__content">
          <div className="overlay-session-empty__icon">
            <Gamepad2 size={36} />
          </div>
          <h3 className="overlay-session-empty__title">{t("overlay.noSession")}</h3>
          <p className="overlay-session-empty__desc">
            {t("overlay.session.noGameDesc")}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      variant="glass"
      className="overlay-widget overlay-session-widget"
      data-testid="overlay-session-widget"
    >
      {/* Game Hero Banner with Logo & Status */}
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
            {effectiveLogo ? (
              <img
                src={effectiveLogo}
                alt={game?.name || ""}
                className="overlay-session-hero__logo"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div className="overlay-session-hero__title-wrap">
                <Gamepad2 size={24} className="overlay-session-hero__title-icon" />
                <h2 className="overlay-session-hero__title">
                  {game?.name || session?.name || t("overlay.widget.session")}
                </h2>
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
      </div>

      {/* 4-Tile Session KPI Grid */}
      <div className="overlay-session-kpis">
        <div className="overlay-session-kpi overlay-session-kpi--hero">
          <div className="overlay-session-kpi__header">
            <Clock size={15} className="overlay-session-kpi__icon text-accent" />
            <span className="overlay-session-kpi__label">{t("overlay.session.playtime")}</span>
            <span className="overlay-session-kpi__live-tag">{t("overlay.session.live")}</span>
          </div>
          <div className="overlay-session-kpi__value">{formatClock(elapsed)}</div>
          <div className="overlay-session-kpi__subtext">{t("overlay.session.currentSession")}</div>
        </div>

        <div className="overlay-session-kpi">
          <div className="overlay-session-kpi__header">
            <Hourglass size={15} className="overlay-session-kpi__icon" />
            <span className="overlay-session-kpi__label">{t("overlay.session.totalPlaytime")}</span>
          </div>
          <div className="overlay-session-kpi__value">{totalPlaytimeFormatted}</div>
          <div className="overlay-session-kpi__subtext">{t("overlay.session.lifetime")}</div>
        </div>

        <div className="overlay-session-kpi">
          <div className="overlay-session-kpi__header">
            <Play size={15} className="overlay-session-kpi__icon" />
            <span className="overlay-session-kpi__label">{t("overlay.session.startedAt")}</span>
          </div>
          <div className="overlay-session-kpi__value overlay-session-kpi__value--sm">
            {startedAtFormatted}
          </div>
          <div className="overlay-session-kpi__subtext">{t("overlay.session.status")}</div>
        </div>

        <div className="overlay-session-kpi">
          <div className="overlay-session-kpi__header">
            <Activity size={15} className="overlay-session-kpi__icon" />
            <span className="overlay-session-kpi__label">{t("overlay.metric.fps")}</span>
          </div>
          <div className="overlay-session-kpi__value overlay-session-kpi__value--sm">
            {typeof metrics?.fps === "number" && metrics.fps > 0
              ? `${Math.round(metrics.fps)} FPS`
              : "—"}
          </div>
          <div className="overlay-session-kpi__subtext">
            {typeof metrics?.cpu === "number"
              ? `CPU ${Math.round(metrics.cpu)}% • GPU ${Math.round(metrics.gpu ?? 0)}%`
              : t("overlay.session.live")}
          </div>
        </div>
      </div>

      {/* Quick Session Actions */}
      <div className="overlay-session-actions-panel">
        <div className="overlay-session-actions-label">
          {t("overlay.session.quickActions")}
        </div>
        <div className="overlay-session-actions-row">
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
            onClick={handleOpenFolder}
            title={t("overlay.screenshot.openFolder")}
          >
            <FolderOpen size={14} />
            <span>{t("overlay.session.openCaptures")}</span>
          </button>
        </div>
      </div>

      {/* Optional Metadata Row (developer / genres) */}
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
