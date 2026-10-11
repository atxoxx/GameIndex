import { useState, useEffect } from "react";
import {
  Accessibility,
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
import {
  OverlayFieldChips,
  OverlayFieldSlider,
  OverlayFieldToggle,
} from "../settings/fields";

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

          <OverlayFieldSlider
            className="overlay-setting-row"
            infoClassName="overlay-setting-row__info"
            labelClassName="overlay-setting-row__label"
            valueClassName="overlay-setting-row__val"
            inputClassName="overlay-slider"
            label={t("overlay.settings.opacity")}
            display={`${Math.round(settings.opacity * 100)}%`}
            value={settings.opacity}
            min={0.3}
            max={1.0}
            step={0.05}
            onChange={(value) => void updateSettings({ opacity: value })}
          />

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.corner")}
            </span>
            <OverlayFieldChips
              className="overlay-corner-grid"
              chipClassName="overlay-corner-cell"
              options={CORNERS.map((c) => ({
                id: c.id,
                content: (
                  <>
                    <div className={`corner-dot corner-dot--${c.id}`} />
                    <span>{t(c.labelKey)}</span>
                  </>
                ),
              }))}
              value={settings.corner}
              onChange={(corner) => handleCornerSelect(corner as OverlayCorner)}
            />
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.layout")}
            </span>
            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              labelWrap
              options={TICKER_LAYOUTS.map((option) => ({
                id: option.id,
                label: t(option.labelKey),
                title: t(option.hintKey),
              }))}
              value={settings.tickerLayout ?? "strip"}
              onChange={(layout) => void updateSettings({ tickerLayout: layout })}
            />
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
            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              labelWrap
              options={(["glass", "solid", "dim"] as const).map((mode) => ({
                id: mode,
                label: t(BG_KEYS[mode]),
              }))}
              value={settings.backgroundStyle ?? "glass"}
              onChange={(style) => void updateSettings({ backgroundStyle: style })}
            />
          </div>

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            nativeBlurSupported && (
              <OverlayFieldToggle
                className="overlay-toggle-item"
                label={t("overlay.settings.nativeBlur")}
                checked={settings.nativeBlur ?? true}
                onChange={(on) => void updateSettings({ nativeBlur: on })}
              />
            )}

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            !(
              nativeBlurSupported &&
              (settings.nativeBlur ?? true) &&
              !settings.reduceEffects
            ) && (
              <OverlayFieldSlider
                className="overlay-setting-row"
                infoClassName="overlay-setting-row__info"
                labelClassName="overlay-setting-row__label"
                valueClassName="overlay-setting-row__val"
                inputClassName="overlay-slider"
                label={t("overlay.settings.bgBlur")}
                display={`${Math.round(settings.backgroundBlur ?? 14)}px`}
                value={settings.backgroundBlur ?? 14}
                min={0}
                max={30}
                step={1}
                onChange={(value) => void updateSettings({ backgroundBlur: value })}
              />
            )}

          <OverlayFieldSlider
            className="overlay-setting-row"
            infoClassName="overlay-setting-row__info"
            labelClassName="overlay-setting-row__label"
            valueClassName="overlay-setting-row__val"
            inputClassName="overlay-slider"
            label={t("overlay.settings.bgOpacity")}
            display={`${Math.round((settings.backgroundOpacity ?? 0.72) * 100)}%`}
            value={settings.backgroundOpacity ?? 0.72}
            min={0.2}
            max={1}
            step={0.02}
            onChange={(value) => void updateSettings({ backgroundOpacity: value })}
          />

          <OverlayFieldToggle
            className="overlay-toggle-item"
            label={t("overlay.settings.reduceEffects")}
            checked={settings.reduceEffects ?? false}
            onChange={(on) => void updateSettings({ reduceEffects: on })}
          />

          <OverlayFieldToggle
            className="overlay-toggle-item"
            label={t("overlay.settings.clickThrough")}
            checked={settings.tickerClickThrough ?? false}
            onChange={(on) => void updateSettings({ tickerClickThrough: on })}
          />
        </div>

        {/* Section: Accessibility */}
        <div className="overlay-settings-section">
          <div className="overlay-settings-section__title">
            <Accessibility size={13} />
            <span>{t("overlay.settings.accessibility")}</span>
          </div>

          <OverlayFieldToggle
            className="overlay-toggle-item"
            label={t("overlay.settings.highContrast")}
            checked={settings.highContrast ?? false}
            onChange={(on) => void updateSettings({ highContrast: on })}
          />

          <OverlayFieldSlider
            className="overlay-setting-row"
            infoClassName="overlay-setting-row__info"
            labelClassName="overlay-setting-row__label"
            valueClassName="overlay-setting-row__val"
            inputClassName="overlay-slider"
            label={t("overlay.settings.textScale")}
            display={`${Math.round((settings.textScale ?? 1) * 100)}%`}
            value={settings.textScale ?? 1}
            min={0.9}
            max={1.4}
            step={0.05}
            onChange={(value) => void updateSettings({ textScale: value })}
          />
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
              <OverlayFieldToggle
                className="overlay-toggle-item"
                label={t("overlay.settings.showTemps")}
                checked={settings.showTemps}
                onChange={(on) => void updateSettings({ showTemps: on })}
              />
              <OverlayFieldToggle
                className="overlay-toggle-item"
                label={t("overlay.settings.showGraphs")}
                checked={settings.showGraphs}
                onChange={(on) => void updateSettings({ showGraphs: on })}
              />
              <OverlayFieldToggle
                className="overlay-toggle-item"
                label={t("overlay.settings.detectCurrentGame")}
                checked={settings.detectCurrentGame ?? true}
                onChange={(on) => void updateSettings({ detectCurrentGame: on })}
              />
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
            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              options={["png", "jpg"].map((fmt) => ({
                id: fmt,
                content: fmt.toUpperCase(),
              }))}
              value={settings.screenshotFormat}
              onChange={(format) => void updateSettings({ screenshotFormat: format })}
            />
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
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.screenshotSound")}
              checked={settings.screenshotSound}
              onChange={(on) => void updateSettings({ screenshotSound: on })}
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.screenshotFlash")}
              checked={settings.screenshotFlash}
              onChange={(on) => void updateSettings({ screenshotFlash: on })}
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.screenshotClipboard")}
              checked={settings.screenshotCopyToClipboard}
              onChange={(on) =>
                void updateSettings({ screenshotCopyToClipboard: on })
              }
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.screenshotIncludeOverlay")}
              checked={settings.screenshotIncludeOverlay}
              onChange={(on) =>
                void updateSettings({ screenshotIncludeOverlay: on })
              }
            />
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              <Video size={12} className="mr-1 inline-block" />
              {t("overlay.settings.video")}
            </span>

            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.videoEnable")}
              checked={settings.videoEnabled}
              onChange={(on) => void updateSettings({ videoEnabled: on })}
            />

            <OverlayFieldChips
              className="overlay-corner-grid"
              chipClassName="overlay-corner-cell"
              labelWrap
              style={{ marginTop: "0.4rem" }}
              options={[30, 60, 120].map((fps) => ({
                id: fps,
                label: `${fps} FPS`,
              }))}
              value={settings.videoFps}
              onChange={(fps) => void updateSettings({ videoFps: fps })}
            />

            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              style={{ marginTop: "0.4rem" }}
              options={[
                { kbps: 6000, key: "overlay.settings.qualityLow" },
                { kbps: 12000, key: "overlay.settings.qualityMedium" },
                { kbps: 24000, key: "overlay.settings.qualityHigh" },
              ].map((opt) => ({
                id: opt.kbps,
                content: t(opt.key),
              }))}
              value={settings.videoBitrateKbps}
              onChange={(kbps) => void updateSettings({ videoBitrateKbps: kbps })}
            />
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
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.videoGameAudio")}
              checked={settings.videoGameAudio}
              onChange={(on) => void updateSettings({ videoGameAudio: on })}
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.videoMicrophone")}
              checked={settings.videoMicrophone}
              onChange={(on) => void updateSettings({ videoMicrophone: on })}
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.videoShowCursor")}
              checked={settings.videoShowCursor}
              onChange={(on) => void updateSettings({ videoShowCursor: on })}
            />
            <OverlayFieldToggle
              className="overlay-toggle-item"
              label={t("overlay.settings.videoHideOverlay")}
              checked={settings.videoHideOverlay}
              onChange={(on) => void updateSettings({ videoHideOverlay: on })}
            />
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
            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              options={TICKER_WIDGETS.map((key) => ({
                id: key,
                title: t(TICKER_LABELS[key] ?? key),
                content: (
                  <>
                    {tickerIcon(key)}
                    <span>{t(TICKER_LABELS[key] ?? key)}</span>
                  </>
                ),
              }))}
              isActive={(key) => settings.tickerWidgets.includes(key)}
              onChange={(key) =>
                handleToggleWidget(
                  "tickerWidgets",
                  key,
                  !settings.tickerWidgets.includes(key),
                )
              }
            />
          </div>

          <div className="overlay-setting-block">
            <span className="overlay-setting-block__label">
              {t("overlay.settings.panelWidgets")}
            </span>
            <OverlayFieldChips
              className="overlay-chips-list"
              chipClassName="overlay-chip"
              options={PANEL_WIDGETS.map((key) => ({
                id: key,
                label: key.charAt(0).toUpperCase() + key.slice(1),
              }))}
              labelWrap
              isActive={(key) => settings.panelWidgets.includes(key)}
              onChange={(key) =>
                handleToggleWidget(
                  "panelWidgets",
                  key,
                  !settings.panelWidgets.includes(key),
                )
              }
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
