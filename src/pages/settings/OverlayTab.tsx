import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Bell,
  Camera,
  Circle,
  Clapperboard,
  Clock,
  Cpu,
  Download,
  Gauge,
  MemoryStick,
  Mic,
  Monitor,
  Sliders,
  StickyNote,
  Thermometer,
  Timer,
  Trophy,
  Video,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import {
  DEFAULT_OVERLAY_SETTINGS,
  PANEL_WIDGETS,
  TICKER_WIDGETS,
  normalizeOverlaySettings,
  type AudioDeviceList,
  type OverlayCorner,
  type OverlaySettings,
} from "../../context/OverlayContext";
import { Button, Skeleton } from "../../components/ui";
import { TICKER_LAYOUTS } from "../../components/overlay/overlayLayout";
import { OverlayIcon } from "./settingsIcons";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";

const TICKER_LABELS: Record<string, string> = {
  fps: "overlay.metric.fps",
  cpu: "overlay.metric.cpu",
  gpu: "overlay.metric.gpu",
  cpuTemp: "overlay.metric.cpuTemp",
  gpuTemp: "overlay.metric.gpuTemp",
  ram: "overlay.metric.ram",
  sparkline: "overlay.ticker.sparkline",
  session: "overlay.widget.session",
  mic: "overlay.ticker.mic",
  record: "overlay.ticker.record",
  replay: "overlay.ticker.replay",
  screenshot: "overlay.action.screenshot",
};

const PANEL_LABELS: Record<string, string> = {
  session: "overlay.widget.session",
  performance: "overlay.widget.performance",
  achievements: "overlay.widget.achievements",
  downloads: "overlay.widget.downloads",
  notifications: "overlay.widget.notifications",
  notes: "overlay.widget.notes",
  captures: "overlay.widget.captures",
  recording: "overlay.widget.recording",
  timer: "overlay.widget.timer",
  settings: "overlay.widget.settings",
};

function tickerIcon(key: string) {
  switch (key) {
    case "fps":
      return <Gauge />;
    case "cpu":
      return <Cpu />;
    case "gpu":
      return <Monitor />;
    case "cpuTemp":
    case "gpuTemp":
      return <Thermometer />;
    case "ram":
      return <MemoryStick />;
    case "sparkline":
      return <Activity />;
    case "mic":
      return <Mic />;
    case "record":
      return <Circle />;
    case "replay":
      return <Clapperboard />;
    case "screenshot":
      return <Camera />;
    default:
      return <Clock />;
  }
}

function panelIcon(key: string) {
  switch (key) {
    case "performance":
      return <Activity />;
    case "achievements":
      return <Trophy />;
    case "downloads":
      return <Download />;
    case "notifications":
      return <Bell />;
    case "notes":
      return <StickyNote />;
    case "captures":
      return <Camera />;
    case "recording":
      return <Video />;
    case "timer":
      return <Timer />;
    case "settings":
      return <Sliders />;
    default:
      return <Clock />;
  }
}

const CORNERS: { id: OverlayCorner; labelKey: string }[] = [
  { id: "top-left", labelKey: "settings.overlay.corner.topLeft" },
  { id: "top-right", labelKey: "settings.overlay.corner.topRight" },
  { id: "bottom-left", labelKey: "settings.overlay.corner.bottomLeft" },
  { id: "bottom-right", labelKey: "settings.overlay.corner.bottomRight" },
];

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** Build a Tauri accelerator string from a keydown, or null for modifiers. */
function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  const key = event.key === " " ? "Space" : event.key;
  if (!key) return null;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join("+");
}

/**
 * OverlayTab — Settings → Overlay. Configures the in-game HUD: the master
 * toggle, the global hotkey, screen corner, opacity, and which widgets the
 * ticker and panel show. Discrete edits autosave through
 * `overlay_save_settings`; the hotkey goes through `overlay_set_hotkey` so a
 * conflicting binding is surfaced instead of silently persisted.
 */
export default function OverlayTab() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceList>({
    output: [],
    input: [],
  });
  const [nativeBlurSupported, setNativeBlurSupported] = useState(false);
  const [recordingField, setRecordingField] = useState<
    "toggle" | "screenshot" | "video" | "replay" | null
  >(null);
  const hydratedRef = useRef(false);
  const applyHotkeyRef = useRef<(accelerator: string) => void>(() => {});

  const update = useCallback((patch: Partial<OverlaySettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const toggleWidget = useCallback(
    (field: "tickerWidgets" | "panelWidgets", key: string, on: boolean) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const current = prev[field];
        const next = on
          ? Array.from(new Set([...current, key]))
          : current.filter((k) => k !== key);
        return { ...prev, [field]: next };
      });
    },
    [],
  );

  // Load once; keep defaults if the backend is unavailable.
  useEffect(() => {
    let disposed = false;
    invoke<OverlaySettings>("overlay_get_settings")
      .then((value) => {
        if (!disposed) setSettings(normalizeOverlaySettings(value));
      })
      .catch((err) => {
        if (disposed) return;
        setSettings(DEFAULT_OVERLAY_SETTINGS);
        showToast(
          t("settings.overlay.loadFailed", { error: String(err) }),
          "error",
        );
      });
    return () => {
      disposed = true;
    };
  }, [showToast, t]);

  // Enumerate audio endpoints for the device dropdowns.
  useEffect(() => {
    let disposed = false;
    invoke<AudioDeviceList>("capture_list_audio_devices")
      .then((list) => {
        if (!disposed && list) {
          setAudioDevices({
            output: list.output ?? [],
            input: list.input ?? [],
          });
        }
      })
      .catch(() => {
        /* unsupported platform */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Whether the platform offers a native window backdrop (real blur).
  useEffect(() => {
    let disposed = false;
    invoke<boolean>("overlay_native_blur_supported")
      .then((value) => {
        if (!disposed) setNativeBlurSupported(Boolean(value));
      })
      .catch(() => {
        /* no Tauri runtime */
      });
    return () => {
      disposed = true;
    };
  }, []);

  // Debounced autosave for every discrete edit (skip the initial hydrate).
  useEffect(() => {
    if (!settings) return;
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }
    const snapshot = settings;
    const timer = setTimeout(() => {
      void invoke("overlay_save_settings", { settings: snapshot }).catch((err) =>
        showToast(
          t("settings.overlay.saveFailed", { error: String(err) }),
          "error",
        ),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [settings, showToast, t]);

  // Hotkey re-registration: a failure keeps the previous binding.
  const applyHotkey = useCallback(
    (accelerator: string) => {
      invoke<OverlaySettings>("overlay_set_hotkey", { accelerator })
        .then((next) => {
          setSettings(normalizeOverlaySettings(next));
          showToast(
            t("settings.overlay.hotkeySaved", { accelerator }),
            "success",
          );
        })
        .catch((err) =>
          showToast(
            t("settings.overlay.hotkeyFailed", {
              accelerator,
              error: String(err),
            }),
            "error",
          ),
        );
    },
    [showToast, t],
  );
  applyHotkeyRef.current = applyHotkey;

  // Capture the next key combination while recording a binding. The overlay
  // toggle goes through `overlay_set_hotkey` (which validates conflicts); the
  // capture bindings are plain settings that autosave through
  // `overlay_save_settings`.
  useEffect(() => {
    if (!recordingField) return;
    const CAPTURE_FIELDS: Record<string, keyof OverlaySettings> = {
      screenshot: "screenshotHotkey",
      video: "videoHotkey",
      replay: "replayHotkey",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingField(null);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      const field = recordingField;
      setRecordingField(null);
      if (field === "toggle") {
        applyHotkeyRef.current(accelerator);
      } else {
        update({ [CAPTURE_FIELDS[field]]: accelerator } as Partial<OverlaySettings>);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingField, update]);

  if (!settings) {
    return (
      <SettingsSection
        id="overlay-general"
        icon={<OverlayIcon />}
        title={t("settings.tab.overlay")}
        desc={t("settings.overlay.desc")}
      >
        <Skeleton shape="rect" height="6em" />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        id="overlay-general"
        icon={<OverlayIcon />}
        title={t("settings.overlay.sectionGeneral")}
        desc={t("settings.overlay.desc")}
      >
        <SettingsToggleCard
          title={t("settings.overlay.enable")}
          desc={t("settings.overlay.enableHint")}
          checked={settings.enabled}
          onChange={(on) => update({ enabled: on })}
        />

        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.hotkey")}
              </label>
              <span className="hw-card-value">{settings.hotkey}</span>
            </div>
            <p className="hw-card-help">{t("settings.overlay.hotkeyDesc")}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRecordingField((f) => (f === "toggle" ? null : "toggle"))
              }
              aria-label={t("settings.overlay.aria.hotkey")}
            >
              {recordingField === "toggle"
                ? t("settings.overlay.hotkeyRecording")
                : t("settings.overlay.hotkeyRecord")}
            </Button>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.corner")}
              </label>
            </div>
            <p className="hw-card-help">{t("settings.overlay.cornerDesc")}</p>
            <div
              className="settings-segmented hw-seg"
              role="group"
              aria-label={t("settings.overlay.aria.corner")}
            >
              {CORNERS.map((corner) => (
                <button
                  key={corner.id}
                  type="button"
                  className={settings.corner === corner.id ? "active" : ""}
                  onClick={() => update({ corner: corner.id })}
                >
                  {t(corner.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.opacity")}
            </label>
            <span className="hw-card-value">
              {Math.round(settings.opacity * 100)}%
            </span>
          </div>
          <p className="hw-card-help">{t("settings.overlay.opacityDesc")}</p>
          <input
            type="range"
            className="hw-range"
            min={0.2}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={(event) => update({ opacity: Number(event.target.value) })}
            aria-label={t("settings.overlay.aria.opacity")}
          />
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.layout")}
            </label>
          </div>
          <p className="hw-card-help">{t("settings.overlay.layoutDesc")}</p>
          <div
            className="settings-segmented hw-seg"
            role="group"
            aria-label={t("settings.overlay.aria.layout")}
          >
            {TICKER_LAYOUTS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  (settings.tickerLayout ?? "strip") === option.id ? "active" : ""
                }
                onClick={() => update({ tickerLayout: option.id })}
                title={t(option.hintKey)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.background")}
            </label>
          </div>
          <p className="hw-card-help">{t("settings.overlay.backgroundDesc")}</p>
          <div
            className="settings-segmented hw-seg"
            role="group"
            aria-label={t("settings.overlay.aria.background")}
          >
            {(["glass", "solid", "dim"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={
                  (settings.backgroundStyle ?? "glass") === mode ? "active" : ""
                }
                onClick={() => update({ backgroundStyle: mode })}
              >
                {t(
                  `overlay.settings.bg${mode[0].toUpperCase()}${mode.slice(1)}`,
                )}
              </button>
            ))}
          </div>

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            nativeBlurSupported && (
              <label
                className="overlay-toggle-item"
                style={{ marginTop: "0.75rem" }}
              >
                <input
                  type="checkbox"
                  checked={settings.nativeBlur ?? true}
                  onChange={(event) =>
                    update({ nativeBlur: event.target.checked })
                  }
                />
                <span>{t("overlay.settings.nativeBlur")}</span>
              </label>
            )}

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            !(
              nativeBlurSupported &&
              (settings.nativeBlur ?? true) &&
              !settings.reduceEffects
            ) && (
              <div style={{ marginTop: "0.75rem" }}>
                <div className="hw-card-head">
                  <label className="hw-card-label">
                    {t("overlay.settings.bgBlur")}
                  </label>
                  <span className="hw-card-value">
                    {Math.round(settings.backgroundBlur ?? 14)}px
                  </span>
                </div>
                <input
                  type="range"
                  className="hw-range"
                  min={0}
                  max={30}
                  step={1}
                  value={settings.backgroundBlur ?? 14}
                  onChange={(event) =>
                    update({ backgroundBlur: Number(event.target.value) })
                  }
                  aria-label={t("overlay.settings.bgBlur")}
                />
              </div>
            )}

          <div style={{ marginTop: "0.75rem" }}>
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("overlay.settings.bgOpacity")}
              </label>
              <span className="hw-card-value">
                {Math.round((settings.backgroundOpacity ?? 0.72) * 100)}%
              </span>
            </div>
            <input
              type="range"
              className="hw-range"
              min={0.2}
              max={1}
              step={0.02}
              value={settings.backgroundOpacity ?? 0.72}
              onChange={(event) =>
                update({ backgroundOpacity: Number(event.target.value) })
              }
              aria-label={t("overlay.settings.bgOpacity")}
            />
          </div>
        </div>

        <SettingsToggleCard
          title={t("overlay.settings.reduceEffects")}
          desc={t("settings.overlay.reduceEffectsDesc")}
          checked={settings.reduceEffects ?? false}
          onChange={(on) => update({ reduceEffects: on })}
        />

        <SettingsToggleCard
          title={t("settings.overlay.showTemps")}
          desc={t("settings.overlay.showTempsDesc")}
          checked={settings.showTemps}
          onChange={(on) => update({ showTemps: on })}
        />

        <SettingsToggleCard
          title={t("settings.overlay.showGraphs")}
          desc={t("settings.overlay.showGraphsDesc")}
          checked={settings.showGraphs}
          onChange={(on) => update({ showGraphs: on })}
        />
      </SettingsSection>

      <SettingsSection
        id="overlay-capture"
        icon={<Camera />}
        title={t("settings.overlay.sectionCapture")}
        desc={t("settings.overlay.captureDesc")}
      >
        {/* Screenshot */}
        <div className="hw-pane-head">
          <h3 className="hw-pane-title">
            {t("settings.overlay.screenshot")}
          </h3>
          <p className="hw-pane-desc">
            {t("settings.overlay.screenshotDesc")}
          </p>
        </div>

        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.screenshotHotkey")}
              </label>
              <span className="hw-card-value">
                {settings.screenshotHotkey || "—"}
              </span>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.screenshotHotkeyDesc")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRecordingField((f) =>
                  f === "screenshot" ? null : "screenshot",
                )
              }
            >
              {recordingField === "screenshot"
                ? t("settings.overlay.hotkeyRecording")
                : t("settings.overlay.hotkeyRecord")}
            </Button>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.screenshotFormat")}
              </label>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.screenshotFormatDesc")}
            </p>
            <div className="settings-segmented hw-seg" role="group">
              {["png", "jpg"].map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={settings.screenshotFormat === fmt ? "active" : ""}
                  onClick={() => update({ screenshotFormat: fmt })}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.screenshotFolder")}
            </label>
          </div>
          <p className="hw-card-help">
            {t("settings.overlay.screenshotFolderDesc")}
          </p>
          <input
            type="text"
            className="settings-input"
            value={settings.screenshotFolder ?? ""}
            placeholder={t("settings.overlay.folderPlaceholder")}
            onChange={(event) =>
              update({ screenshotFolder: event.target.value || null })
            }
          />
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.screenshotDelay")}
            </label>
            <span className="hw-card-value">{settings.screenshotDelayMs} ms</span>
          </div>
          <p className="hw-card-help">
            {t("settings.overlay.screenshotDelayDesc")}
          </p>
          <input
            type="range"
            className="hw-range"
            min={20}
            max={1000}
            step={20}
            value={settings.screenshotDelayMs}
            onChange={(event) =>
              update({ screenshotDelayMs: Number(event.target.value) })
            }
          />
        </div>

        <SettingsToggleCard
          title={t("settings.overlay.screenshotSound")}
          desc={t("settings.overlay.screenshotSoundDesc")}
          checked={settings.screenshotSound}
          onChange={(on) => update({ screenshotSound: on })}
        />
        <SettingsToggleCard
          title={t("settings.overlay.screenshotFlash")}
          desc={t("settings.overlay.screenshotFlashDesc")}
          checked={settings.screenshotFlash}
          onChange={(on) => update({ screenshotFlash: on })}
        />
        <SettingsToggleCard
          title={t("settings.overlay.screenshotClipboard")}
          desc={t("settings.overlay.screenshotClipboardDesc")}
          checked={settings.screenshotCopyToClipboard}
          onChange={(on) => update({ screenshotCopyToClipboard: on })}
        />
        <SettingsToggleCard
          title={t("settings.overlay.screenshotIncludeOverlay")}
          desc={t("settings.overlay.screenshotIncludeOverlayDesc")}
          checked={settings.screenshotIncludeOverlay}
          onChange={(on) => update({ screenshotIncludeOverlay: on })}
        />

        {/* Video */}
        <div className="hw-pane-head" style={{ marginTop: "2rem" }}>
          <h3 className="hw-pane-title">{t("settings.overlay.video")}</h3>
          <p className="hw-pane-desc">{t("settings.overlay.videoDesc")}</p>
        </div>

        <SettingsToggleCard
          title={t("settings.overlay.videoEnable")}
          desc={t("settings.overlay.videoEnableHint")}
          checked={settings.videoEnabled}
          onChange={(on) => update({ videoEnabled: on })}
        />

        <div className="hw-duo">
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.videoHotkey")}
              </label>
              <span className="hw-card-value">
                {settings.videoHotkey || "—"}
              </span>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.videoHotkeyDesc")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRecordingField((f) => (f === "video" ? null : "video"))
              }
            >
              {recordingField === "video"
                ? t("settings.overlay.hotkeyRecording")
                : t("settings.overlay.hotkeyRecord")}
            </Button>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.replayHotkey")}
              </label>
              <span className="hw-card-value">
                {settings.replayHotkey || "—"}
              </span>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.replayHotkeyDesc")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setRecordingField((f) => (f === "replay" ? null : "replay"))
              }
            >
              {recordingField === "replay"
                ? t("settings.overlay.hotkeyRecording")
                : t("settings.overlay.hotkeyRecord")}
            </Button>
          </div>
        </div>

        <div className="hw-duo" style={{ marginTop: "1rem" }}>
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.videoFps")}
              </label>
            </div>
            <p className="hw-card-help">{t("settings.overlay.videoFpsDesc")}</p>
            <div className="settings-segmented hw-seg" role="group">
              {[30, 60, 120].map((fps) => (
                <button
                  key={fps}
                  type="button"
                  className={settings.videoFps === fps ? "active" : ""}
                  onClick={() => update({ videoFps: fps })}
                >
                  {fps}
                </button>
              ))}
            </div>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.videoBitrate")}
              </label>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.videoBitrateDesc")}
            </p>
            <div className="settings-segmented hw-seg" role="group">
              {[
                { kbps: 6000, label: t("settings.overlay.qualityLow") },
                { kbps: 12000, label: t("settings.overlay.qualityMedium") },
                { kbps: 24000, label: t("settings.overlay.qualityHigh") },
              ].map((opt) => (
                <button
                  key={opt.kbps}
                  type="button"
                  className={settings.videoBitrateKbps === opt.kbps ? "active" : ""}
                  onClick={() => update({ videoBitrateKbps: opt.kbps })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.videoScale")}
            </label>
            <span className="hw-card-value">
              {Math.round(settings.videoResolutionScale * 100)}%
            </span>
          </div>
          <p className="hw-card-help">{t("settings.overlay.videoScaleDesc")}</p>
          <div className="settings-segmented hw-seg" role="group">
            {[
              { scale: 1, label: "100%" },
              { scale: 0.75, label: "75%" },
              { scale: 0.5, label: "50%" },
            ].map((opt) => (
              <button
                key={opt.scale}
                type="button"
                className={settings.videoResolutionScale === opt.scale ? "active" : ""}
                onClick={() => update({ videoResolutionScale: opt.scale })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hw-duo" style={{ marginTop: "1rem" }}>
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.replaySeconds")}
              </label>
              <span className="hw-card-value">
                {settings.replayBufferSeconds}s
              </span>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.replaySecondsDesc")}
            </p>
            <input
              type="range"
              className="hw-range"
              min={15}
              max={300}
              step={15}
              value={settings.replayBufferSeconds}
              onChange={(event) =>
                update({ replayBufferSeconds: Number(event.target.value) })
              }
            />
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.maxClip")}
              </label>
              <span className="hw-card-value">
                {settings.videoMaxClipSeconds === 0
                  ? t("settings.overlay.unlimited")
                  : `${settings.videoMaxClipSeconds}s`}
              </span>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.maxClipDesc")}
            </p>
            <div className="settings-segmented hw-seg" role="group">
              {[0, 60, 300, 900].map((secs) => (
                <button
                  key={secs}
                  type="button"
                  className={settings.videoMaxClipSeconds === secs ? "active" : ""}
                  onClick={() => update({ videoMaxClipSeconds: secs })}
                >
                  {secs === 0 ? t("settings.overlay.unlimited") : `${secs}s`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "1rem" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.videoFolder")}
            </label>
          </div>
          <p className="hw-card-help">
            {t("settings.overlay.videoFolderDesc")}
          </p>
          <input
            type="text"
            className="settings-input"
            value={settings.videoFolder ?? ""}
            placeholder={t("settings.overlay.folderPlaceholder")}
            onChange={(event) =>
              update({ videoFolder: event.target.value || null })
            }
          />
        </div>

        <SettingsToggleCard
          title={t("settings.overlay.videoGameAudio")}
          desc={t("settings.overlay.videoGameAudioDesc")}
          checked={settings.videoGameAudio}
          onChange={(on) => update({ videoGameAudio: on })}
        />
        <SettingsToggleCard
          title={t("settings.overlay.videoMicrophone")}
          desc={t("settings.overlay.videoMicrophoneDesc")}
          checked={settings.videoMicrophone}
          onChange={(on) => update({ videoMicrophone: on })}
        />

        <div className="hw-duo" style={{ marginTop: "1rem" }}>
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.audioDevice")}
              </label>
            </div>
            <p className="hw-card-help">
              {t("settings.overlay.audioDeviceDesc")}
            </p>
            <select
              className="settings-input"
              value={settings.videoAudioDevice ?? ""}
              onChange={(event) =>
                update({ videoAudioDevice: event.target.value || null })
              }
              aria-label={t("settings.overlay.audioDevice")}
            >
              <option value="">{t("settings.overlay.deviceDefault")}</option>
              {audioDevices.output.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.micDevice")}
              </label>
            </div>
            <p className="hw-card-help">{t("settings.overlay.micDeviceDesc")}</p>
            <select
              className="settings-input"
              value={settings.videoMicDevice ?? ""}
              onChange={(event) =>
                update({ videoMicDevice: event.target.value || null })
              }
              aria-label={t("settings.overlay.micDevice")}
            >
              <option value="">{t("settings.overlay.deviceDefault")}</option>
              {audioDevices.input.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <SettingsToggleCard
          title={t("settings.overlay.videoShowCursor")}
          desc={t("settings.overlay.videoShowCursorDesc")}
          checked={settings.videoShowCursor}
          onChange={(on) => update({ videoShowCursor: on })}
        />
        <SettingsToggleCard
          title={t("settings.overlay.videoHideOverlay")}
          desc={t("settings.overlay.videoHideOverlayDesc")}
          checked={settings.videoHideOverlay}
          onChange={(on) => update({ videoHideOverlay: on })}
        />
      </SettingsSection>

      <SettingsSection
        id="overlay-widgets"
        icon={<OverlayIcon />}
        title={t("settings.overlay.sectionWidgets")}
        desc={t("settings.overlay.desc")}
      >
        <div className="hw-pane-head">
          <h3 className="hw-pane-title">
            {t("settings.overlay.tickerWidgets")}
          </h3>
          <p className="hw-pane-desc">
            {t("settings.overlay.tickerWidgetsDesc")}
          </p>
        </div>
        <div className="hw-metric-grid">
          {TICKER_WIDGETS.map((key) => {
            const on = settings.tickerWidgets.includes(key);
            return (
              <label
                key={key}
                className={"hw-metric" + (on ? " on" : "")}
                data-on={on}
              >
                <span className="hw-metric-icon" aria-hidden>
                  {tickerIcon(key)}
                </span>
                <span className="hw-metric-label">{t(TICKER_LABELS[key])}</span>
                <span className="hw-metric-switch" aria-hidden>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) =>
                      toggleWidget("tickerWidgets", key, event.target.checked)
                    }
                  />
                  <span className="hw-metric-knob" />
                </span>
              </label>
            );
          })}
        </div>

        <div className="hw-pane-head" style={{ marginTop: "1.5rem" }}>
          <h3 className="hw-pane-title">
            {t("settings.overlay.panelWidgets")}
          </h3>
          <p className="hw-pane-desc">{t("settings.overlay.panelWidgetsDesc")}</p>
        </div>
        <div className="hw-metric-grid">
          {PANEL_WIDGETS.map((key) => {
            const on = settings.panelWidgets.includes(key);
            return (
              <label
                key={key}
                className={"hw-metric" + (on ? " on" : "")}
                data-on={on}
              >
                <span className="hw-metric-icon" aria-hidden>
                  {panelIcon(key)}
                </span>
                <span className="hw-metric-label">{t(PANEL_LABELS[key])}</span>
                <span className="hw-metric-switch" aria-hidden>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) =>
                      toggleWidget("panelWidgets", key, event.target.checked)
                    }
                  />
                  <span className="hw-metric-knob" />
                </span>
              </label>
            );
          })}
        </div>
      </SettingsSection>
    </>
  );
}
