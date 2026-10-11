import { useState, useEffect } from "react";
import {
  Sliders,
  RotateCcw,
  Gauge,
  Cpu,
  Monitor,
  Clock,
  Keyboard,
  Compass,
  Activity,
  Layers,
  Blend,
  Camera,
  Video,
  Circle,
  Clapperboard,
  MemoryStick,
  Mic,
  Thermometer,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useOverlay,
  type OverlayCorner,
  type OverlaySettings,
  TICKER_WIDGETS,
  PANEL_WIDGETS,
  DEFAULT_OVERLAY_SETTINGS,
} from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Card, Button } from "../../ui";
import { TICKER_LAYOUTS } from "../overlayLayout";

/** Explicit i18n keys per background mode (kept static so audit:i18n sees them). */
const BG_KEYS: Record<"glass" | "solid" | "dim", string> = {
  glass: "overlay.settings.bgGlass",
  solid: "overlay.settings.bgSolid",
  dim: "overlay.settings.bgDim",
};

const CORNERS: { id: OverlayCorner; labelKey: string }[] = [
  { id: "top-left", labelKey: "settings.overlay.corner.topLeft" },
  { id: "top-right", labelKey: "settings.overlay.corner.topRight" },
  { id: "bottom-left", labelKey: "settings.overlay.corner.bottomLeft" },
  { id: "bottom-right", labelKey: "settings.overlay.corner.bottomRight" },
];

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

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

function tickerIcon(key: string) {
  switch (key) {
    case "fps":
      return <Gauge size={12} />;
    case "cpu":
      return <Cpu size={12} />;
    case "gpu":
      return <Monitor size={12} />;
    case "cpuTemp":
    case "gpuTemp":
      return <Thermometer size={12} />;
    case "ram":
      return <MemoryStick size={12} />;
    case "sparkline":
      return <Activity size={12} />;
    case "mic":
      return <Mic size={12} />;
    case "record":
      return <Circle size={12} />;
    case "replay":
      return <Clapperboard size={12} />;
    case "screenshot":
      return <Camera size={12} />;
    default:
      return <Clock size={12} />;
  }
}

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

export default function SettingsWidget() {
  const { settings, updateSettings, audioDevices, nativeBlurSupported } = useOverlay();
  const { t } = useLanguage();
  const [recording, setRecording] = useState(false);
  const [captureField, setCaptureField] = useState<
    "screenshot" | "video" | "replay" | null
  >(null);

  // Key combination capture for hotkey recording
  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      setRecording(false);
      void invoke("overlay_set_hotkey", { accelerator })
        .then(() => {
          void updateSettings({ hotkey: accelerator });
        })
        .catch((err) => {
          console.error("Failed to set hotkey:", err);
        });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, updateSettings]);

  // Capture-binding recording (screenshot / record / replay hotkeys).
  useEffect(() => {
    if (!captureField) return;
    const FIELD_KEY = {
      screenshot: "screenshotHotkey",
      video: "videoHotkey",
      replay: "replayHotkey",
    } as const;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCaptureField(null);
        return;
      }
      const accelerator = acceleratorFromEvent(event);
      if (!accelerator) return;
      const field = captureField;
      setCaptureField(null);
      void updateSettings({
        [FIELD_KEY[field]]: accelerator,
      } as Partial<OverlaySettings>);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [captureField, updateSettings]);

  const handleCornerSelect = (corner: OverlayCorner) => {
    void invoke("overlay_set_corner", { corner })
      .then(() => {
        void updateSettings({ corner, posX: null, posY: null });
      })
      .catch((err) => console.error("Corner update failed:", err));
  };

  const handleToggleWidget = (
    listKey: "tickerWidgets" | "panelWidgets",
    item: string,
    active: boolean,
  ) => {
    const list = settings[listKey];
    const next = active
      ? [...new Set([...list, item])]
      : list.filter((i) => i !== item);
    void updateSettings({ [listKey]: next });
  };

  const handleResetDefaults = () => {
    void updateSettings(DEFAULT_OVERLAY_SETTINGS);
    void invoke("overlay_set_corner", { corner: DEFAULT_OVERLAY_SETTINGS.corner });
    void invoke("overlay_set_hotkey", { accelerator: DEFAULT_OVERLAY_SETTINGS.hotkey });
  };

  // Restore the default footprint and re-anchor to the configured corner
  // (which also clears any dragged position).
  const handleResetSize = () => {
    void updateSettings({
      tickerWidth: DEFAULT_OVERLAY_SETTINGS.tickerWidth,
      tickerHeight: DEFAULT_OVERLAY_SETTINGS.tickerHeight,
      panelWidth: DEFAULT_OVERLAY_SETTINGS.panelWidth,
      panelHeight: DEFAULT_OVERLAY_SETTINGS.panelHeight,
      posX: null,
      posY: null,
    });
    void invoke("overlay_set_corner", { corner: settings.corner });
  };

  return (
    <Card variant="glass" className="overlay-widget overlay-settings-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <Sliders />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.settings.title")}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleResetDefaults}
          title={t("overlay.settings.resetDefaults")}
          className="overlay-reset-btn"
        >
          <RotateCcw size={12} />
          <span>{t("overlay.settings.resetDefaults")}</span>
        </Button>
      </div>

      <div className="overlay-settings-list">
        {/* Section 1: Appearance & Position */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Compass size={13} />
            <span>{t("overlay.settings.opacity")} & {t("overlay.settings.corner")}</span>
          </div>

          <div className="overlay-setting-row">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                {t("overlay.settings.opacity")}
              </span>
              <span className="overlay-setting-row__val">
                {Math.round(settings.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.3"
              max="1.0"
              step="0.05"
              value={settings.opacity}
              onChange={(e) =>
                void updateSettings({ opacity: parseFloat(e.target.value) })
              }
              className="overlay-slider"
            />
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.corner")}
            </span>
            <div className="overlay-corner-grid">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`overlay-corner-cell${
                    settings.corner === c.id ? " active" : ""
                  }`}
                  onClick={() => handleCornerSelect(c.id)}
                >
                  <div className={`corner-dot corner-dot--${c.id}`} />
                  <span>{t(c.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.layout")}
            </span>
            <div className="overlay-chips-list">
              {TICKER_LAYOUTS.map((option) => {
                const active =
                  (settings.tickerLayout ?? "strip") === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`overlay-chip${active ? " active" : ""}`}
                    onClick={() => void updateSettings({ tickerLayout: option.id })}
                    title={t(option.hintKey)}
                  >
                    <span>{t(option.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetSize}
          >
            <RotateCcw size={12} />
            <span>{t("overlay.settings.resetSize")}</span>
          </Button>
        </div>

        {/* Section: Background treatment */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Blend size={13} />
            <span>{t("overlay.settings.background")}</span>
          </div>

          <div className="overlay-setting-block">
            <div className="overlay-chips-list">
              {(["glass", "solid", "dim"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`overlay-chip${
                    (settings.backgroundStyle ?? "glass") === mode ? " active" : ""
                  }`}
                  onClick={() =>
                    void updateSettings({ backgroundStyle: mode })
                  }
                >
                  <span>{t(BG_KEYS[mode])}</span>
                </button>
              ))}
            </div>
          </div>

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            nativeBlurSupported && (
              <label className="overlay-toggle-item">
                <input
                  type="checkbox"
                  checked={settings.nativeBlur ?? true}
                  onChange={(e) =>
                    void updateSettings({ nativeBlur: e.target.checked })
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
              <div className="overlay-setting-row">
                <div className="overlay-setting-row__info">
                  <span className="overlay-setting-row__label">
                    {t("overlay.settings.bgBlur")}
                  </span>
                  <span className="overlay-setting-row__val">
                    {Math.round(settings.backgroundBlur ?? 14)}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={settings.backgroundBlur ?? 14}
                  onChange={(e) =>
                    void updateSettings({ backgroundBlur: Number(e.target.value) })
                  }
                  className="overlay-slider"
                />
              </div>
            )}

          <div className="overlay-setting-row">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                {t("overlay.settings.bgOpacity")}
              </span>
              <span className="overlay-setting-row__val">
                {Math.round((settings.backgroundOpacity ?? 0.72) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1"
              step="0.02"
              value={settings.backgroundOpacity ?? 0.72}
              onChange={(e) =>
                void updateSettings({ backgroundOpacity: Number(e.target.value) })
              }
              className="overlay-slider"
            />
          </div>

          <label className="overlay-toggle-item">
            <input
              type="checkbox"
              checked={settings.reduceEffects ?? false}
              onChange={(e) =>
                void updateSettings({ reduceEffects: e.target.checked })
              }
            />
            <span>{t("overlay.settings.reduceEffects")}</span>
          </label>

          <label className="overlay-toggle-item">
            <input
              type="checkbox"
              checked={settings.tickerClickThrough ?? false}
              onChange={(e) =>
                void updateSettings({ tickerClickThrough: e.target.checked })
              }
            />
            <span>{t("overlay.settings.clickThrough")}</span>
          </label>
        </div>

        {/* Section 2: Shortcuts & Telemetry */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Activity size={13} />
            <span>{t("overlay.settings.hotkey")} & {t("overlay.settings.telemetry")}</span>
          </div>

          <div className="overlay-setting-row overlay-setting-row--hotkey">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                <Keyboard size={14} className="mr-1 inline-block" />
                {t("overlay.settings.hotkey")}
              </span>
              <span className="overlay-hotkey-badge">{settings.hotkey}</span>
            </div>
            <Button
              variant={recording ? "primary" : "secondary"}
              size="sm"
              onClick={() => setRecording(!recording)}
              className="overlay-hotkey-record-btn"
            >
              {recording
                ? t("overlay.settings.hotkeyRecording")
                : t("overlay.settings.hotkeyRecord")}
            </Button>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.telemetry")}
            </span>
            <div className="overlay-toggles-duo">
              <label className="overlay-toggle-item">
                <input
                  type="checkbox"
                  checked={settings.showTemps}
                  onChange={(e) =>
                    void updateSettings({ showTemps: e.target.checked })
                  }
                />
                <span>{t("overlay.settings.showTemps")}</span>
              </label>
              <label className="overlay-toggle-item">
                <input
                  type="checkbox"
                  checked={settings.showGraphs}
                  onChange={(e) =>
                    void updateSettings({ showGraphs: e.target.checked })
                  }
                />
                <span>{t("overlay.settings.showGraphs")}</span>
              </label>
            </div>
          </div>
        </div>

        {/* Section 3: Capture (screenshots + video) */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Camera size={13} />
            <span>{t("overlay.settings.capture")}</span>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.screenshotFormat")}
            </span>
            <div className="overlay-chips-list">
              {["png", "jpg"].map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={`overlay-chip${
                    settings.screenshotFormat === fmt ? " active" : ""
                  }`}
                  onClick={() => void updateSettings({ screenshotFormat: fmt })}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="overlay-setting-row overlay-setting-row--hotkey">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                {t("overlay.settings.screenshotHotkey")}
              </span>
              <span className="overlay-hotkey-badge">
                {settings.screenshotHotkey}
              </span>
            </div>
            <Button
              variant={captureField === "screenshot" ? "primary" : "secondary"}
              size="sm"
              onClick={() =>
                setCaptureField((f) => (f === "screenshot" ? null : "screenshot"))
              }
            >
              {captureField === "screenshot"
                ? t("overlay.settings.hotkeyRecording")
                : t("overlay.settings.hotkeyRecord")}
            </Button>
          </div>

          <div className="overlay-toggles-duo">
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.screenshotSound}
                onChange={(e) =>
                  void updateSettings({ screenshotSound: e.target.checked })
                }
              />
              <span>{t("overlay.settings.screenshotSound")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.screenshotFlash}
                onChange={(e) =>
                  void updateSettings({ screenshotFlash: e.target.checked })
                }
              />
              <span>{t("overlay.settings.screenshotFlash")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.screenshotCopyToClipboard}
                onChange={(e) =>
                  void updateSettings({
                    screenshotCopyToClipboard: e.target.checked,
                  })
                }
              />
              <span>{t("overlay.settings.screenshotClipboard")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.screenshotIncludeOverlay}
                onChange={(e) =>
                  void updateSettings({
                    screenshotIncludeOverlay: e.target.checked,
                  })
                }
              />
              <span>{t("overlay.settings.screenshotIncludeOverlay")}</span>
            </label>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              <Video size={12} className="mr-1 inline-block" />
              {t("overlay.settings.video")}
            </span>

            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.videoEnabled}
                onChange={(e) =>
                  void updateSettings({ videoEnabled: e.target.checked })
                }
              />
              <span>{t("overlay.settings.videoEnable")}</span>
            </label>

            <div className="overlay-corner-grid" style={{ marginTop: "0.4rem" }}>
              {[30, 60, 120].map((fps) => (
                <button
                  key={fps}
                  type="button"
                  className={`overlay-corner-cell${
                    settings.videoFps === fps ? " active" : ""
                  }`}
                  onClick={() => void updateSettings({ videoFps: fps })}
                >
                  <span>{fps} FPS</span>
                </button>
              ))}
            </div>

            <div className="overlay-chips-list" style={{ marginTop: "0.4rem" }}>
              {[
                { kbps: 6000, key: "overlay.settings.qualityLow" },
                { kbps: 12000, key: "overlay.settings.qualityMedium" },
                { kbps: 24000, key: "overlay.settings.qualityHigh" },
              ].map((opt) => (
                <button
                  key={opt.kbps}
                  type="button"
                  className={`overlay-chip${
                    settings.videoBitrateKbps === opt.kbps ? " active" : ""
                  }`}
                  onClick={() =>
                    void updateSettings({ videoBitrateKbps: opt.kbps })
                  }
                >
                  {t(opt.key)}
                </button>
              ))}
            </div>
          </div>

          <div className="overlay-setting-row overlay-setting-row--hotkey">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                {t("overlay.settings.videoHotkey")}
              </span>
              <span className="overlay-hotkey-badge">{settings.videoHotkey}</span>
            </div>
            <Button
              variant={captureField === "video" ? "primary" : "secondary"}
              size="sm"
              onClick={() =>
                setCaptureField((f) => (f === "video" ? null : "video"))
              }
            >
              {captureField === "video"
                ? t("overlay.settings.hotkeyRecording")
                : t("overlay.settings.hotkeyRecord")}
            </Button>
          </div>

          <div className="overlay-setting-row overlay-setting-row--hotkey">
            <div className="overlay-setting-row__info">
              <span className="overlay-setting-row__label">
                {t("overlay.settings.replayHotkey")}
              </span>
              <span className="overlay-hotkey-badge">
                {settings.replayHotkey}
              </span>
            </div>
            <Button
              variant={captureField === "replay" ? "primary" : "secondary"}
              size="sm"
              onClick={() =>
                setCaptureField((f) => (f === "replay" ? null : "replay"))
              }
            >
              {captureField === "replay"
                ? t("overlay.settings.hotkeyRecording")
                : t("overlay.settings.hotkeyRecord")}
            </Button>
          </div>

          <div className="overlay-toggles-duo">
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.videoGameAudio}
                onChange={(e) =>
                  void updateSettings({ videoGameAudio: e.target.checked })
                }
              />
              <span>{t("overlay.settings.videoGameAudio")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.videoMicrophone}
                onChange={(e) =>
                  void updateSettings({ videoMicrophone: e.target.checked })
                }
              />
              <span>{t("overlay.settings.videoMicrophone")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.videoShowCursor}
                onChange={(e) =>
                  void updateSettings({ videoShowCursor: e.target.checked })
                }
              />
              <span>{t("overlay.settings.videoShowCursor")}</span>
            </label>
            <label className="overlay-toggle-item">
              <input
                type="checkbox"
                checked={settings.videoHideOverlay}
                onChange={(e) =>
                  void updateSettings({ videoHideOverlay: e.target.checked })
                }
              />
              <span>{t("overlay.settings.videoHideOverlay")}</span>
            </label>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.audioDevice")}
            </span>
            <select
              className="overlay-device-select"
              value={settings.videoAudioDevice ?? ""}
              onChange={(e) =>
                void updateSettings({ videoAudioDevice: e.target.value || null })
              }
              aria-label={t("overlay.settings.audioDevice")}
            >
              <option value="">{t("overlay.settings.deviceDefault")}</option>
              {audioDevices.output.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>

            <span className="overlay-setting-block__label">
              {t("overlay.settings.micDevice")}
            </span>
            <select
              className="overlay-device-select"
              value={settings.videoMicDevice ?? ""}
              onChange={(e) =>
                void updateSettings({ videoMicDevice: e.target.value || null })
              }
              aria-label={t("overlay.settings.micDevice")}
            >
              <option value="">{t("overlay.settings.deviceDefault")}</option>
              {audioDevices.input.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {device.isDefault ? " ★" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Section 4: Visible Widgets */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Layers size={13} />
            <span>{t("overlay.settings.widgets")}</span>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.tickerWidgets")}
            </span>
            <div className="overlay-chips-list">
              {TICKER_WIDGETS.map((key) => {
                const active = settings.tickerWidgets.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`overlay-chip${active ? " active" : ""}`}
                    onClick={() =>
                      handleToggleWidget("tickerWidgets", key, !active)
                    }
                    title={t(TICKER_LABELS[key] ?? key)}
                  >
                    {tickerIcon(key)}
                    <span>{t(TICKER_LABELS[key] ?? key)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.panelWidgets")}
            </span>
            <div className="overlay-chips-list">
              {PANEL_WIDGETS.map((key) => {
                const active = settings.panelWidgets.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`overlay-chip${active ? " active" : ""}`}
                    onClick={() =>
                      handleToggleWidget("panelWidgets", key, !active)
                    }
                  >
                    <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
