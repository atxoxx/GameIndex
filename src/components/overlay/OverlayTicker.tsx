import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  Download,
  Maximize2,
  Camera,
  Loader2,
  Gauge,
  Cpu,
  Monitor,
  Clock,
  Circle,
  Square,
  Clapperboard,
  Save,
  Mic,
  Thermometer,
  MemoryStick,
} from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import { Badge } from "../ui";
import OverlaySparkline from "./OverlaySparkline";
import { useOverlayNotifications } from "./widgets/NotificationsWidget";
import { formatClock, useSessionElapsed } from "./widgets/SessionWidget";

function formatPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "—";
}

function formatTemp(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}°`
    : "—";
}

/**
 * Keep the overlay window sized to the ticker's rendered content. The HUD is
 * content-driven (elements come and go with the settings), so whenever its
 * box changes we ask the backend to resize the window to match.
 */
function useTickerAutoFit() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const fit = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      void invoke("overlay_fit_ticker", {
        width: Math.ceil(rect.width) + 2,
        height: Math.ceil(rect.height) + 2,
      }).catch(() => {
        /* no Tauri runtime */
      });
    };

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el);
    fit();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
}

/**
 * The collapsed "reduced" HUD: a two-row strip. The top row is live telemetry
 * (FPS/CPU/GPU/temps/RAM/session/sparkline/mic) and the bottom row is the
 * capture controls — a record toggle with a live REC timer, replay arm/save, a
 * quick screenshot, and the activity badges. Every element is opt-in via
 * `settings.tickerWidgets`, and the window grows to fit whatever is enabled.
 */
export default function OverlayTicker() {
  const {
    settings,
    metrics,
    history,
    session,
    corner,
    expand,
    captureScreenshot,
    isCapturing,
    flashScreen,
    captureSupported,
    recordingState,
    isRecording,
    isReplayBuffering,
    toggleRecording,
    startReplay,
    stopReplay,
    saveReplay,
  } = useOverlay();
  const gameCtx = useOptionalGames();
  const games = gameCtx?.games ?? [];
  const { activeCount } = useDownloads();
  const notifications = useOverlayNotifications();
  const { t } = useLanguage();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);
  const fitRef = useTickerAutoFit();

  const activeGame = games.find((g) => g.id === session?.gameId);

  // Live REC timer, ticked locally so the chip updates between state pushes.
  const [recSeconds, setRecSeconds] = useState(0);
  useEffect(() => {
    if (!isRecording || !recordingState.startedAt) {
      setRecSeconds(0);
      return;
    }
    const startedAt = recordingState.startedAt;
    const tick = () => setRecSeconds((Date.now() - startedAt) / 1000);
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [isRecording, recordingState.startedAt]);

  const show = (key: string) => settings.tickerWidgets.includes(key);

  const fps = metrics?.fps;
  const fpsClass =
    typeof fps === "number" && fps > 0
      ? fps >= 60
        ? "overlay-fps--good"
        : fps >= 30
          ? "overlay-fps--fair"
          : "overlay-fps--low"
      : "";

  const fpsSeries = useMemo(
    () =>
      history
        .map((sample) => sample.fps)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    [history],
  );

  const micOn = settings.videoMicrophone && (isRecording || isReplayBuffering);

  const handleSnap = (event: React.MouseEvent) => {
    event.stopPropagation();
    void captureScreenshot(activeGame?.name);
  };

  const pill = (key: string, icon: ReactNode, text: string) => (
    <span
      key={key}
      className="overlay-ticker__pill"
      data-testid={`overlay-ticker-${key}`}
    >
      {icon}
      <span>{text}</span>
    </span>
  );

  return (
    <div
      ref={fitRef}
      className={`overlay-ticker${isRecording ? " overlay-ticker--recording" : ""}`}
      data-testid="overlay-ticker"
      data-corner={corner}
      data-tauri-drag-region="deep"
      style={{ opacity: `var(--overlay-opacity, ${settings.opacity})` }}
    >
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      {/* Row 1 — live telemetry */}
      <div
        className="overlay-ticker__row overlay-ticker__row--metrics"
        data-tauri-drag-region="deep"
      >
        {show("fps") && (
          <span
            className={`overlay-ticker__pill overlay-ticker__fps ${fpsClass}`}
            data-testid="overlay-ticker-fps"
          >
            <Gauge size={12} />
            <span>
              {t("overlay.metric.fps")}{" "}
              {typeof fps === "number" && Number.isFinite(fps)
                ? Math.round(fps)
                : "—"}
            </span>
          </span>
        )}

        {show("cpu") && pill("cpu", <Cpu size={12} />, formatPercent(metrics?.cpu))}
        {show("gpu") && pill("gpu", <Monitor size={12} />, formatPercent(metrics?.gpu))}
        {show("cpuTemp") &&
          pill("cpuTemp", <Thermometer size={12} />, formatTemp(metrics?.cpuTemp))}
        {show("gpuTemp") &&
          pill("gpuTemp", <Thermometer size={12} />, formatTemp(metrics?.gpuTemp))}
        {show("ram") && pill("ram", <MemoryStick size={12} />, formatPercent(metrics?.ram))}
        {show("session") && pill("session", <Clock size={12} />, formatClock(elapsed))}

        {show("sparkline") && (
          <span
            className="overlay-ticker__spark"
            data-testid="overlay-ticker-sparkline"
          >
            <OverlaySparkline
              values={fpsSeries}
              max={Math.max(120, ...(fpsSeries.length ? fpsSeries : [0]))}
              testId="overlay-ticker-spark"
            />
          </span>
        )}

        {show("mic") && (
          <span
            className={`overlay-ticker__pill overlay-ticker__mic${micOn ? " is-on" : ""}`}
            data-testid="overlay-ticker-mic"
            title={micOn ? t("overlay.ticker.micOn") : t("overlay.ticker.micOff")}
          >
            <Mic size={12} />
          </span>
        )}
      </div>

      {/* Row 2 — capture controls + activity */}
      <div
        className="overlay-ticker__row overlay-ticker__row--actions"
        data-tauri-drag-region="false"
      >
        <div className="overlay-ticker__actions" data-tauri-drag-region="false">
          {isRecording && (
            <span
              className="overlay-ticker__rec-chip"
              data-testid="overlay-ticker-rec-timer"
              role="status"
            >
              <span className="overlay-ticker__rec-dot" aria-hidden />
              <span>
                {t("overlay.ticker.rec")} {formatClock(recSeconds)}
              </span>
            </span>
          )}
          {!isRecording && isReplayBuffering && (
            <span
              className="overlay-ticker__rec-chip overlay-ticker__rec-chip--replay"
              data-testid="overlay-ticker-replay-chip"
            >
              <Clapperboard size={11} />
              <span>{t("overlay.ticker.replayArmed")}</span>
            </span>
          )}

          {show("record") && captureSupported && (
            <button
              type="button"
              className={`overlay-ticker__action-btn${
                isRecording ? " overlay-ticker__action-btn--recording" : ""
              }`}
              onClick={() => void toggleRecording()}
              title={
                isRecording
                  ? t("overlay.recording.stop")
                  : t("overlay.recording.start")
              }
              aria-label={
                isRecording
                  ? t("overlay.recording.stop")
                  : t("overlay.recording.start")
              }
              data-testid="overlay-ticker-record"
            >
              {isRecording ? <Square size={12} /> : <Circle size={12} />}
            </button>
          )}

          {show("replay") && captureSupported && (
            <button
              type="button"
              className={`overlay-ticker__action-btn${
                isReplayBuffering ? " overlay-ticker__action-btn--active" : ""
              }`}
              onClick={() =>
                isReplayBuffering ? void stopReplay() : void startReplay()
              }
              title={
                isReplayBuffering
                  ? t("overlay.recording.disableReplay")
                  : t("overlay.recording.enableReplay")
              }
              aria-label={
                isReplayBuffering
                  ? t("overlay.recording.disableReplay")
                  : t("overlay.recording.enableReplay")
              }
              data-testid="overlay-ticker-replay-arm"
            >
              <Clapperboard size={12} />
            </button>
          )}

          {show("replay") && captureSupported && isReplayBuffering && (
            <button
              type="button"
              className="overlay-ticker__action-btn"
              onClick={() => void saveReplay()}
              title={t("overlay.recording.saveReplay")}
              aria-label={t("overlay.recording.saveReplay")}
              data-testid="overlay-ticker-replay-save"
            >
              <Save size={12} />
            </button>
          )}

          {show("screenshot") && (
            <button
              type="button"
              className="overlay-ticker__action-btn"
              onClick={handleSnap}
              disabled={isCapturing}
              title={t("overlay.action.screenshotHint")}
              aria-label={t("overlay.action.screenshot")}
              data-testid="overlay-ticker-screenshot"
            >
              {isCapturing ? (
                <Loader2 size={13} className="overlay-spin" />
              ) : (
                <Camera size={13} />
              )}
            </button>
          )}
        </div>

        <div className="overlay-ticker__activity" data-tauri-drag-region="false">
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
    </div>
  );
}
