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
  ThermometerSun,
  MemoryStick,
  MousePointerClick,
} from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOptionalGames } from "../../context/GameContext";
import { useVisibleInterval } from "../../hooks/useVisibleInterval";
import { Badge } from "../ui";
import OverlaySparkline from "./OverlaySparkline";
import OverlayGauge from "./OverlayGauge";
import { normalizeTickerLayout } from "./overlayLayout";
import { useOverlayNotifications } from "./widgets/NotificationsWidget";
import { formatClock, useSessionElapsed } from "./widgets/SessionWidget";

function formatPercent(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}%`
    : "—";
}

function formatTemp(value: number | undefined): string {
  // A non-positive reading means "no sensor reported"; never show a fake 0°.
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `${Math.round(value)}°`
    : "—";
}

/** Coerce an unknown (non-positive) temperature to `undefined` for gauges. */
function knownTemp(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** Accent ramp shared by the metric pills and the gauge cluster. */
function fpsIntent(fps: number | undefined): "good" | "fair" | "low" {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) return "low";
  return fps >= 60 ? "good" : fps >= 30 ? "fair" : "low";
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

    // A trailing debounce (not just a rAF coalesce): on mixed-DPI monitors a
    // each window resize fires another layout pass, and fitting immediately
    // turned pass → resize → next pass into a continuous resize/fit ping
    // (the backend's churn tolerance only catches exact-size duplicates).
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
      if (timer) clearTimeout(timer);
      timer = setTimeout(fit, 150);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    fit();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ref;
}

/**
 * The collapsed "reduced" HUD. Four presentation presets share one data
 * pipeline and the same capture controls:
 *   • strip   — two rows: live telemetry then capture controls (default)
 *   • single  — everything on one dense row
 *   • gauges  — circular CPU/GPU/RAM/FPS gauge cluster + controls row
 *   • minimal — just the headline FPS and the expand affordance
 * Every element is opt-in via `settings.tickerWidgets`, and the window grows
 * to fit whatever is enabled.
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

  const layout = normalizeTickerLayout(settings.tickerLayout);
  const activeGame = games.find((g) => g.id === session?.gameId);

  // Live REC timer, ticked locally so the chip updates between state pushes.
  const [recSeconds, setRecSeconds] = useState(0);
  const startedAt = recordingState.startedAt;
  const recActive = isRecording && startedAt !== undefined;
  useVisibleInterval(
    () => setRecSeconds((Date.now() - (startedAt ?? Date.now())) / 1000),
    500,
    recActive
  );
  useEffect(() => {
    if (!recActive) setRecSeconds(0);
  }, [recActive]);

  const show = (key: string) => {
    if (!settings.tickerWidgets.includes(key)) return false;
    // Temperature chips/gauges are second-gated by the documented "Show
    // CPU/GPU temperatures" master toggle — TickerLayout used to render them
    // whenever the two widget chips were on, contradicting the toggle's
    // semantics (the Performance widget honours it; so does the ticker now).
    if (key === "cpuTemp" || key === "gpuTemp") return settings.showTemps;
    return true;
  };

  const fps = metrics?.fps;
  const fpsClass = `overlay-fps--${fpsIntent(fps)}`;

  const fpsSeries = useMemo(
    () =>
      history
        .map((sample) => sample.fps)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    [history],
  );

  const micOn = settings.videoMicrophone && (isRecording || isReplayBuffering);
  const clickThrough = Boolean(settings.tickerClickThrough);

  const handleSnap = (event: React.MouseEvent) => {
    event.stopPropagation();
    void captureScreenshot(activeGame?.name);
  };

  const pill = (
    key: string,
    icon: ReactNode,
    text: string,
    tag?: string,
    title?: string,
  ) => (
    <span
      key={key}
      className="overlay-ticker__pill"
      data-testid={`overlay-ticker-${key}`}
      title={title}
    >
      {icon}
      {tag && <span className="overlay-ticker__pill-tag">{tag}</span>}
      <span>{text}</span>
    </span>
  );

  const fpsPill = show("fps") && (
    <span
      className={`overlay-ticker__pill overlay-ticker__fps ${fpsClass}`}
      data-testid="overlay-ticker-fps"
    >
      <Gauge size={12} />
      <span>
        {t("overlay.metric.fps")}{" "}
        {typeof fps === "number" && Number.isFinite(fps) ? Math.round(fps) : "—"}
      </span>
    </span>
  );

  const sparkPill = show("sparkline") && (
    <span className="overlay-ticker__spark" data-testid="overlay-ticker-sparkline">
      <OverlaySparkline
        values={fpsSeries}
        max={Math.max(120, ...(fpsSeries.length ? fpsSeries : [0]))}
        testId="overlay-ticker-spark"
      />
    </span>
  );

  const micPill = show("mic") && (
    <span
      className={`overlay-ticker__pill overlay-ticker__mic${micOn ? " is-on" : ""}`}
      data-testid="overlay-ticker-mic"
      title={micOn ? t("overlay.ticker.micOn") : t("overlay.ticker.micOff")}
    >
      <Mic size={12} />
    </span>
  );

  const recChips = (
    <>
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
    </>
  );

  const actionButtons = (
    <div className="overlay-ticker__actions" data-tauri-drag-region="false">
      {show("record") && captureSupported && (
        <button
          type="button"
          className={`overlay-ticker__action-btn${
            isRecording ? " overlay-ticker__action-btn--recording" : ""
          }`}
          onClick={() => void toggleRecording()}
          title={isRecording ? t("overlay.recording.stop") : t("overlay.recording.start")}
          aria-label={isRecording ? t("overlay.recording.stop") : t("overlay.recording.start")}
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
          onClick={() => (isReplayBuffering ? void stopReplay() : void startReplay())}
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
  );

  const activityBadges = (
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

      {clickThrough ? (
        // The ticker ignores the mouse in click-through mode, so the expand
        // button would be dead; show the toggle hotkey instead.
        <span
          className="overlay-ticker__clickthrough-hint"
          data-testid="overlay-ticker-clickthrough"
          title={t("overlay.settings.clickThroughDesc")}
        >
          <MousePointerClick aria-hidden size={12} />
          <kbd>{settings.hotkey}</kbd>
        </span>
      ) : (
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
      )}
    </div>
  );

  const gaugeCluster = (
    <div className="overlay-ticker__gauges" data-testid="overlay-ticker-gauges">
      {show("fps") && (
        <OverlayGauge
          label={t("overlay.metric.fps")}
          value={typeof fps === "number" && fps > 0 ? fps : undefined}
          max={240}
          intent={fpsIntent(fps)}
          hint={t("overlay.metric.fpsHint")}
          testId="overlay-gauge-fps"
        />
      )}
      {show("cpu") && (
        <OverlayGauge
          label={t("overlay.metric.cpu")}
          value={metrics?.cpu}
          unit="%"
          intent="accent"
          hint={t("overlay.metric.cpuHint")}
          testId="overlay-gauge-cpu"
        />
      )}
      {show("gpu") && (
        <OverlayGauge
          label={t("overlay.metric.gpu")}
          value={metrics?.gpu}
          unit="%"
          intent="accent"
          hint={t("overlay.metric.gpuHint")}
          testId="overlay-gauge-gpu"
        />
      )}
      {show("ram") && (
        <OverlayGauge
          label={t("overlay.metric.ram")}
          value={metrics?.ram}
          unit="%"
          intent="accent"
          hint={t("overlay.metric.ramHint")}
          testId="overlay-gauge-ram"
        />
      )}
      {show("cpuTemp") && (
        <OverlayGauge
          label={t("overlay.metric.cpuTemp")}
          value={knownTemp(metrics?.cpuTemp)}
          unit="°"
          max={100}
          intent="default"
          size={46}
          hint={t("overlay.metric.cpuTempHint")}
          testId="overlay-gauge-cpuTemp"
        />
      )}
      {show("gpuTemp") && (
        <OverlayGauge
          label={t("overlay.metric.gpuTemp")}
          value={knownTemp(metrics?.gpuTemp)}
          unit="°"
          max={100}
          intent="default"
          size={46}
          hint={t("overlay.metric.gpuTempHint")}
          testId="overlay-gauge-gpuTemp"
        />
      )}
    </div>
  );

  const classes = [
    "overlay-ticker",
    `overlay-ticker--${layout}`,
    isRecording ? "overlay-ticker--recording" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={fitRef}
      className={classes}
      data-testid="overlay-ticker"
      data-layout={layout}
      data-corner={corner}
      data-tauri-drag-region="deep"
      style={{ opacity: `var(--overlay-opacity, ${settings.opacity})` }}
    >
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      {layout === "minimal" ? (
        <div className="overlay-ticker__row overlay-ticker__row--minimal" data-tauri-drag-region="deep">
          {fpsPill}
          {recChips}
          {activityBadges}
        </div>
      ) : layout === "gauges" ? (
        <>
          <div className="overlay-ticker__row overlay-ticker__row--gauges" data-tauri-drag-region="deep">
            {gaugeCluster}
            {show("session") && pill("session", <Clock size={12} />, formatClock(elapsed))}
          </div>
          <div className="overlay-ticker__row overlay-ticker__row--actions" data-tauri-drag-region="false">
            {recChips}
            {actionButtons}
            {activityBadges}
          </div>
        </>
      ) : layout === "single" ? (
        <div className="overlay-ticker__row overlay-ticker__row--single" data-tauri-drag-region="deep">
          {fpsPill}
          {show("cpu") && pill("cpu", <Cpu size={12} />, formatPercent(metrics?.cpu), "CPU", t("overlay.metric.cpu"))}
          {show("gpu") && pill("gpu", <Monitor size={12} />, formatPercent(metrics?.gpu), "GPU", t("overlay.metric.gpu"))}
          {show("ram") && pill("ram", <MemoryStick size={12} />, formatPercent(metrics?.ram), "RAM", t("overlay.metric.ram"))}
          {show("cpuTemp") && pill("cpuTemp", <Thermometer size={12} />, formatTemp(metrics?.cpuTemp), "CPU", t("overlay.metric.cpuTemp"))}
          {show("gpuTemp") && pill("gpuTemp", <ThermometerSun size={12} />, formatTemp(metrics?.gpuTemp), "GPU", t("overlay.metric.gpuTemp"))}
          {show("session") && pill("session", <Clock size={12} />, formatClock(elapsed))}
          {sparkPill}
          {micPill}
          {recChips}
          {actionButtons}
          {activityBadges}
        </div>
      ) : (
        <>
          {/* Row 1 — live telemetry */}
          <div className="overlay-ticker__row overlay-ticker__row--metrics" data-tauri-drag-region="deep">
            {fpsPill}
            {show("cpu") && pill("cpu", <Cpu size={12} />, formatPercent(metrics?.cpu), "CPU", t("overlay.metric.cpu"))}
            {show("gpu") && pill("gpu", <Monitor size={12} />, formatPercent(metrics?.gpu), "GPU", t("overlay.metric.gpu"))}
            {show("cpuTemp") && pill("cpuTemp", <Thermometer size={12} />, formatTemp(metrics?.cpuTemp), "CPU", t("overlay.metric.cpuTemp"))}
            {show("gpuTemp") && pill("gpuTemp", <ThermometerSun size={12} />, formatTemp(metrics?.gpuTemp), "GPU", t("overlay.metric.gpuTemp"))}
            {show("ram") && pill("ram", <MemoryStick size={12} />, formatPercent(metrics?.ram), "RAM", t("overlay.metric.ram"))}
            {show("session") && pill("session", <Clock size={12} />, formatClock(elapsed))}
            {sparkPill}
            {micPill}
          </div>

          {/* Row 2 — capture controls + activity */}
          <div className="overlay-ticker__row overlay-ticker__row--actions" data-tauri-drag-region="false">
            {recChips}
            {actionButtons}
            {activityBadges}
          </div>
        </>
      )}
    </div>
  );
}
