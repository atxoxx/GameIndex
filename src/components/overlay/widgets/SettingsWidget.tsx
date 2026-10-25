import { useEffect, useState } from "react";
import {
  Activity,
  Camera,
  Circle,
  Clapperboard,
  Cpu,
  Gauge,
  Loader2,
  MemoryStick,
  Mic,
  Monitor,
  Thermometer,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useOverlay,
  TICKER_WIDGETS,
  type OverlaySettings,
} from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../ui";
import {
  DENSITY_OPTIONS,
  TICKER_LAYOUTS,
  normalizeDensity,
  normalizeTickerLayout,
} from "../overlayLayout";
import {
  OverlayFieldChips,
  OverlayFieldSlider,
  OverlayFieldToggle,
} from "../settings/fields";

const TICKER_LABELS: Record<string, string> = {
  fps: "overlay.metric.fps",
  cpu: "overlay.metric.cpu",
  gpu: "overlay.metric.gpu",
  cpuTemp: "overlay.metric.cpuTemp",
  gpuTemp: "overlay.metric.gpuTemp",
  ram: "overlay.metric.ram",
  sparkline: "overlay.ticker.sparkline",
  session: "overlay.widget.session",
  mic: "overlay.chip.mic",
  record: "overlay.chip.record",
  replay: "overlay.chip.replay",
  screenshot: "overlay.chip.screenshot",
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
      return <Activity size={12} />;
  }
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

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

type HotkeyField = "toggle" | "screenshot" | "video" | "replay";

const CAPTURE_FIELDS: Record<
  Exclude<HotkeyField, "toggle">,
  keyof OverlaySettings
> = {
  screenshot: "screenshotHotkey",
  video: "videoHotkey",
  replay: "replayHotkey",
};

/**
 * Quick settings inside the panel: the handful of switches worth touching
 * mid-game, split into layout, appearance, hotkeys and capture. The long tail
 * (folders, devices, quality, per-panel widget visibility) stays on the full
 * Settings → Overlay page, reachable with one button.
 */
export default function SettingsWidget() {
  const { settings, updateSettings, nativeBlurSupported } = useOverlay();
  const { t } = useLanguage();
  const [recordingField, setRecordingField] = useState<HotkeyField | null>(null);

  const density = normalizeDensity(settings.panelDensity);
  const layout = normalizeTickerLayout(settings.tickerLayout);
  const background = settings.backgroundStyle ?? "glass";

  useEffect(() => {
    if (!recordingField) return;
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
        void invoke<OverlaySettings>("overlay_set_hotkey", { accelerator })
          .then((next) => {
            if (next) void updateSettings({ hotkey: next.hotkey ?? accelerator });
          })
          .catch(() => {
            /* a conflicting binding keeps the previous one */
          });
        return;
      }
      void updateSettings({ [CAPTURE_FIELDS[field]]: accelerator });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingField, updateSettings]);

  const toggleTickerWidget = (key: string, on: boolean) => {
    const next = on
      ? [...settings.tickerWidgets, key]
      : settings.tickerWidgets.filter((value) => value !== key);
    void updateSettings({ tickerWidgets: next });
  };

  return (
    <Card
      variant="glass"
      className="overlay-widget overlay-quick"
      data-testid="overlay-settings-widget"
    >
      <section className="overlay-quick__group">
        <h4 className="overlay-quick__group-title">{t("overlay.settings.layout")}</h4>

        <div className="overlay-quick__row">
          <span className="overlay-quick__label">
            {t("overlay.settings.density")}
          </span>
          <OverlayFieldChips
            options={DENSITY_OPTIONS.map((option) => ({
              id: option.id,
              label: t(option.labelKey),
              title: t(option.hintKey),
            }))}
            value={density}
            onChange={(next) => void updateSettings({ panelDensity: next })}
            className="overlay-quick__chips"
            chipClassName="overlay-quick__chip"
            activeClassName="is-active"
          />
        </div>

        <div className="overlay-quick__row">
          <span className="overlay-quick__label">
            {t("overlay.settings.tickerStyle")}
          </span>
          <OverlayFieldChips
            options={TICKER_LAYOUTS.map((option) => ({
              id: option.id,
              label: t(option.labelKey),
              title: t(option.hintKey),
            }))}
            value={layout}
            onChange={(next) => void updateSettings({ tickerLayout: next })}
            className="overlay-quick__chips"
            chipClassName="overlay-quick__chip"
            activeClassName="is-active"
          />
        </div>

        <div className="overlay-quick__widgets" role="group" aria-label={t("overlay.settings.tickerWidgets")}>
          <span className="overlay-quick__sublabel">
            {t("overlay.settings.tickerWidgets")}
          </span>
          {TICKER_WIDGETS.map((key) => {
            const on = settings.tickerWidgets.includes(key);
            return (
              <button
                key={key}
                type="button"
                className={`overlay-quick__chip overlay-quick__chip--icon${
                  on ? " is-active" : ""
                }`}
                aria-pressed={on}
                onClick={() => toggleTickerWidget(key, !on)}
                title={t(TICKER_LABELS[key] ?? key)}
              >
                {tickerIcon(key)}
                <span>{t(TICKER_LABELS[key] ?? key)}</span>
              </button>
            );
          })}
        </div>

        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={
            <>
              <span>{t("overlay.settings.clickThrough")}</span>
              <small>{t("overlay.settings.clickThroughDesc")}</small>
            </>
          }
          checked={Boolean(settings.tickerClickThrough)}
          onChange={(on) => void updateSettings({ tickerClickThrough: on })}
        />
      </section>

      <section className="overlay-quick__group">
        <h4 className="overlay-quick__group-title">
          {t("overlay.settings.appearance")}
        </h4>

        <div className="overlay-quick__row">
          <span className="overlay-quick__label">
            {t("overlay.settings.background")}
          </span>
          <OverlayFieldChips
            options={[
              { id: "glass", label: t("overlay.settings.bgGlass") },
              { id: "solid", label: t("overlay.settings.bgSolid") },
              { id: "dim", label: t("overlay.settings.bgDim") },
            ]}
            value={background}
            onChange={(next) => void updateSettings({ backgroundStyle: next })}
            className="overlay-quick__chips"
            chipClassName="overlay-quick__chip"
            activeClassName="is-active"
          />
        </div>

        <OverlayFieldSlider
          label={t("overlay.settings.bgOpacity")}
          value={settings.backgroundOpacity ?? 0.72}
          min={0.2}
          max={1}
          step={0.02}
          display={`${Math.round((settings.backgroundOpacity ?? 0.72) * 100)}%`}
          onChange={(value) => void updateSettings({ backgroundOpacity: value })}
          className="overlay-quick__slider"
          infoClassName="overlay-quick__slider-head"
          labelClassName="overlay-quick__label"
          valueClassName="overlay-quick__value"
          inputClassName="overlay-quick__range"
          ariaLabel={t("overlay.settings.bgOpacity")}
        />

        {background === "glass" && (
          <OverlayFieldSlider
            label={t("overlay.settings.bgBlur")}
            value={settings.backgroundBlur ?? 14}
            min={0}
            max={40}
            step={1}
            display={`${Math.round(settings.backgroundBlur ?? 14)}px`}
            onChange={(value) => void updateSettings({ backgroundBlur: value })}
            className="overlay-quick__slider"
            infoClassName="overlay-quick__slider-head"
            labelClassName="overlay-quick__label"
            valueClassName="overlay-quick__value"
            inputClassName="overlay-quick__range"
            ariaLabel={t("overlay.settings.bgBlur")}
          />
        )}

        {nativeBlurSupported && background === "glass" && (
          <OverlayFieldToggle
            className="overlay-quick__toggle"
            labelClassName="overlay-quick__toggle-label"
            label={t("overlay.settings.nativeBlur")}
            checked={Boolean(settings.nativeBlur)}
            onChange={(on) => void updateSettings({ nativeBlur: on })}
          />
        )}

        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.reduceEffects")}
          checked={Boolean(settings.reduceEffects)}
          onChange={(on) => void updateSettings({ reduceEffects: on })}
        />
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.highContrast")}
          checked={Boolean(settings.highContrast)}
          onChange={(on) => void updateSettings({ highContrast: on })}
        />

        <OverlayFieldSlider
          label={t("overlay.settings.textScale")}
          value={settings.textScale ?? 1}
          min={0.9}
          max={1.4}
          step={0.05}
          display={`${Math.round((settings.textScale ?? 1) * 100)}%`}
          onChange={(value) => void updateSettings({ textScale: value })}
          className="overlay-quick__slider"
          infoClassName="overlay-quick__slider-head"
          labelClassName="overlay-quick__label"
          valueClassName="overlay-quick__value"
          inputClassName="overlay-quick__range"
          ariaLabel={t("overlay.settings.textScale")}
        />
      </section>

      <section className="overlay-quick__group">
        <h4 className="overlay-quick__group-title">{t("overlay.settings.hotkeys")}</h4>

        {(
          [
            ["toggle", "overlay.settings.hotkey", settings.hotkey],
            ["screenshot", "overlay.settings.screenshotHotkey", settings.screenshotHotkey],
            ["video", "overlay.settings.videoHotkey", settings.videoHotkey],
            ["replay", "overlay.settings.replayHotkey", settings.replayHotkey],
          ] as const
        ).map(([field, labelKey, accelerator]) => (
          <div className="overlay-quick__hotkey" key={field}>
            <span className="overlay-quick__label">{t(labelKey)}</span>
            <kbd className="overlay-quick__kbd">
              {recordingField === field
                ? t("overlay.settings.hotkeyRecording")
                : accelerator || "—"}
            </kbd>
            <button
              type="button"
              className={`overlay-quick__record${
                recordingField === field ? " is-recording" : ""
              }`}
              onClick={() =>
                setRecordingField((current) => (current === field ? null : field))
              }
              aria-label={t("overlay.settings.hotkeyRecord")}
            >
              {recordingField === field ? <Loader2 size={12} className="overlay-spin" /> : null}
              {t("overlay.settings.hotkeyRecord")}
            </button>
          </div>
        ))}
      </section>

      <section className="overlay-quick__group">
        <h4 className="overlay-quick__group-title">{t("overlay.settings.capture")}</h4>

        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.screenshotSound")}
          checked={Boolean(settings.screenshotSound)}
          onChange={(on) => void updateSettings({ screenshotSound: on })}
        />
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.screenshotFlash")}
          checked={Boolean(settings.screenshotFlash)}
          onChange={(on) => void updateSettings({ screenshotFlash: on })}
        />
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.screenshotClipboard")}
          checked={Boolean(settings.screenshotCopyToClipboard)}
          onChange={(on) => void updateSettings({ screenshotCopyToClipboard: on })}
        />
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.videoEnable")}
          checked={Boolean(settings.videoEnabled)}
          onChange={(on) => void updateSettings({ videoEnabled: on })}
        />

        <OverlayFieldSlider
          label={t("overlay.settings.replayBuffer")}
          value={settings.replayBufferSeconds}
          min={5}
          max={600}
          step={5}
          display={`${settings.replayBufferSeconds}s`}
          onChange={(value) => void updateSettings({ replayBufferSeconds: value })}
          className="overlay-quick__slider"
          infoClassName="overlay-quick__slider-head"
          labelClassName="overlay-quick__label"
          valueClassName="overlay-quick__value"
          inputClassName="overlay-quick__range"
          ariaLabel={t("overlay.settings.replayBuffer")}
        />

        <OverlayFieldSlider
          label={t("overlay.settings.videoCountdown")}
          value={settings.videoCountdownMs}
          min={0}
          max={10_000}
          step={500}
          display={`${(settings.videoCountdownMs / 1000).toFixed(1)}s`}
          onChange={(value) => void updateSettings({ videoCountdownMs: value })}
          className="overlay-quick__slider"
          infoClassName="overlay-quick__slider-head"
          labelClassName="overlay-quick__label"
          valueClassName="overlay-quick__value"
          inputClassName="overlay-quick__range"
          ariaLabel={t("overlay.settings.videoCountdown")}
        />
      </section>

      <section className="overlay-quick__group">
        <h4 className="overlay-quick__group-title">
          {t("overlay.settings.telemetry")}
        </h4>
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.detectCurrentGame")}
          checked={Boolean(settings.detectCurrentGame)}
          onChange={(on) => void updateSettings({ detectCurrentGame: on })}
        />
        <p className="overlay-quick__note">
          {t("overlay.settings.detectCurrentGameDesc")}
        </p>
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.showTemps")}
          checked={Boolean(settings.showTemps)}
          onChange={(on) => void updateSettings({ showTemps: on })}
        />
        <OverlayFieldToggle
          className="overlay-quick__toggle"
          labelClassName="overlay-quick__toggle-label"
          label={t("overlay.settings.showGraphs")}
          checked={Boolean(settings.showGraphs)}
          onChange={(on) => void updateSettings({ showGraphs: on })}
        />
      </section>
    </Card>
  );
}
