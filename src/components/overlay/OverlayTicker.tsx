import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Bell,
  Camera,
  Circle,
  Clapperboard,
  Clock,
  Cpu,
  Download,
  Gauge,
  Loader2,
  Maximize2,
  MemoryStick,
  Mic,
  Monitor,
  MousePointerClick,
  Save,
  Square,
  Thermometer,
  ThermometerSun,
} from "lucide-react";
import { useOverlay } from "../../context/OverlayContext";
import { useDownloads } from "../../context/DownloadContext";
import { useLanguage } from "../../context/LanguageContext";
import { useVisibleInterval } from "../../hooks/useVisibleInterval";
import { Badge } from "../ui";
import OverlaySparkline from "./OverlaySparkline";
import OverlayGauge from "./OverlayGauge";
import { normalizeTickerLayout } from "./overlayLayout";
import { useOverlayGame } from "./useOverlayGame";
import { useOverlayNotifications } from "./overlayNotifications";
import { formatClock, useSessionElapsed } from "./overlayTime";

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

/** Accent ramp shared by the metric chips and the gauge cluster. */
function fpsIntent(
  fps: number | undefined,
): "good" | "fair" | "low" | "default" {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    return "default";
  }
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
    // turned pass → resize → next pass into a continuous resize/fit ping.
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
 * The collapsed HUD. Two presets share one data pipeline:
 *   • strip  — a single condensed row: metrics, capture controls, expand
 *   • gauges — a ring cluster for the headline numbers plus a control row
 * Every element is opt-in via `settings.tickerWidgets` and the window grows
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
  const { activeCount } = useDownloads();
  const { unreadCount } = useOverlayNotifications();
  const { t } = useLanguage();
  const activeGame = useOverlayGame(session);
  const elapsed = useSessionElapsed(session?.startedAt ?? null);
  const fitRef = useTickerAutoFit();

  const layout = normalizeTickerLayout(settings.tickerLayout);

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
    // Temperature chips are second-gated by the documented "Show CPU/GPU
    // temperatures" master toggle.
    if (key === "cpuTemp" || key === "gpuTemp") return settings.showTemps;
    return true;
  };

  const fps = metrics?.fps;
  const fpsClass = `overlay-ticker__chip--${fpsIntent(fps)}`;

  const fpsSeries = useMemo(
    () =>
      history
        .map((sample) => sample.fps)
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
        ),
    [history],
  );

  const micOn = settings.videoMicrophone && (isRecording || isReplayBuffering);
  const clickThrough = Boolean(settings.tickerClickThrough);

  const handleSnap = () => {
    void captureScreenshot(activeGame?.name ?? session?.name);
  };

  const chip = (
    key: string,
    icon: ReactNode,
    tag: string | null,
    value: string,
    title?: string,
  ) => (
    <span
      key={key}
      className="overlay-ticker__chip"
      data-testid={`overlay-ticker-${key}`}
      title={title}
    >
      <span className="overlay-ticker__chip-icon" aria-hidden>
        {icon}
      </span>
      {tag && <span className="overlay-ticker__chip-tag">{tag}</span>}
      {tag ? " " : null}
      <span className="overlay-ticker__chip-value">{value}</span>
    </span>
  );

  const fpsChip = show("fps") && (
    <span
      className={`overlay-ticker__chip overlay-ticker__chip--fps ${fpsClass}`}
      data-testid="overlay-ticker-fps"
    >
      <Gauge size={12} aria-hidden />
      <span className="overlay-ticker__chip-tag">{t("overlay.metric.fps")}</span>{" "}
      <span className="overlay-ticker__chip-value">
        {typeof fps === "number" && Number.isFinite(fps) ? Math.round(fps) : "—"}
      </span>
    </span>
  );

  const spark = show("sparkline") && fpsSeries.length > 1 && (
    <span className="overlay-ticker__spark" data-testid="overlay-ticker-sparkline">
      <OverlaySparkline
        values={fpsSeries}
        max={Math.max(120, ...(fpsSeries.length ? fpsSeries : [0]))}
        testId="overlay-ticker-spark"
      />
    </span>
  );

  const micChip = show("mic") && (
    <span
      className={`overlay-ticker__chip overlay-ticker__chip--icon${
        micOn ? " is-on" : ""
      }`}
      data-testid="overlay-ticker-mic"
      title={micOn ? t("overlay.ticker.micOn") : t("overlay.ticker.micOff")}
    >
      <Mic size={12} aria-hidden />
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
          <Clapperboard size={11} aria-hidden />
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

      {unreadCount > 0 && (
        <Badge
          variant="warning"
          className="overlay-ticker__badge"
          data-testid="overlay-ticker-notifications"
        >
          <Bell aria-hidden size={11} />
          {unreadCount > 9 ? "9+" : unreadCount}
        </Badge>
      )}
    </div>
  );

  const expandControl = clickThrough ? (
    // The ticker ignores the mouse in click-through mode, so the expand button
    // would be dead; show the toggle hotkey instead.
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
      <Maximize2 aria-hidden size={14} />
    </button>
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
      data-density={settings.panelDensity ?? "comfortable"}
      data-tauri-drag-region="deep"
      style={{ opacity: `var(--overlay-opacity, ${settings.opacity})` }}
    >
      {flashScreen && <div className="overlay-screen-flash" aria-hidden />}

      {layout === "gauges" ? (
        <>
          <div className="overlay-ticker__row overlay-ticker__row--gauges">
            {gaugeCluster}
            {show("session") && (
              <span className="overlay-ticker__chip overlay-ticker__chip--session">
                <Clock size={12} aria-hidden />
                <span className="overlay-ticker__chip-value">
                  {formatClock(elapsed)}
                </span>
              </span>
            )}
          </div>
          <div className="overlay-ticker__row overlay-ticker__row--gauges-actions">
            {recChips}
            {actionButtons}
            {activityBadges}
            {expandControl}
          </div>
        </>
      ) : (
        <>
          <div className="overlay-ticker__group overlay-ticker__group--metrics">
            {fpsChip}
            {spark}
            {show("cpu") &&
              chip("cpu", <Cpu size={12} />, "CPU", formatPercent(metrics?.cpu), t("overlay.metric.cpu"))}
            {show("gpu") &&
              chip("gpu", <Monitor size={12} />, "GPU", formatPercent(metrics?.gpu), t("overlay.metric.gpu"))}
            {show("cpuTemp") &&
              chip(
                "cpuTemp",
                <Thermometer size={12} />,
                "CPU°",
                formatTemp(metrics?.cpuTemp),
                t("overlay.metric.cpuTemp"),
              )}
            {show("gpuTemp") &&
              chip(
                "gpuTemp",
                <ThermometerSun size={12} />,
                "GPU°",
                formatTemp(metrics?.gpuTemp),
                t("overlay.metric.gpuTemp"),
              )}
            {show("ram") &&
              chip("ram", <MemoryStick size={12} />, "RAM", formatPercent(metrics?.ram), t("overlay.metric.ram"))}
            {show("session") &&
              chip("session", <Clock size={12} />, null, formatClock(elapsed), t("overlay.group.session"))}
            {micChip}
          </div>

          <div className="overlay-ticker__group overlay-ticker__group--capture">
            {recChips}
            {activityBadges}
            {actionButtons}
            {expandControl}
          </div>
        </>
      )}
    </div>
  );
}
