import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Accessibility,
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
import {
  OverlayFieldChips,
  OverlayFieldSlider,
  OverlayFieldToggle,
} from "../../components/overlay/settings/fields";
import { OverlayIcon } from "./settingsIcons";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";

/** Explicit i18n keys per background mode (kept static so audit:i18n sees them). */
const BG_KEYS: Record<"glass" | "solid" | "dim", string> = {
  glass: "overlay.settings.bgGlass",
  solid: "overlay.settings.bgSolid",
  dim: "overlay.settings.bgDim",
};

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

  // Capture-hotkey bindings are best-effort in the backend; surface a failure
  // instead of leaving the user wondering why the key does nothing.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    try {
      listen<{ accelerator?: string }>("overlay:hotkey-error", (event) => {
        showToast(
          t("settings.overlay.captureHotkeyFailed", {
            accelerator: event.payload?.accelerator ?? "",
          }),
          "error",
        );
      })
        .then((fn) => {
          if (cancelled) {
            fn();
            return;
          }
          unlisten = fn;
        })
        .catch(() => {
          /* no Tauri runtime */
        });
    } catch {
      /* no Tauri runtime */
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [showToast, t]);

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
            <OverlayFieldChips
              className="settings-segmented hw-seg"
              role="group"
              ariaLabel={t("settings.overlay.aria.corner")}
              options={CORNERS.map((corner) => ({
                id: corner.id,
                label: t(corner.labelKey),
              }))}
              value={settings.corner}
              onChange={(corner) => update({ corner })}
            />
          </div>
        </div>

        <OverlayFieldSlider
          className="hw-card"
          style={{ marginTop: "var(--space-lg)" }}
          infoClassName="hw-card-head"
          labelAs="label"
          labelClassName="hw-card-label"
          valueClassName="hw-card-value"
          inputClassName="hw-range"
          ariaLabel={t("settings.overlay.aria.opacity")}
          help={
            <p className="hw-card-help">{t("settings.overlay.opacityDesc")}</p>
          }
          label={t("settings.overlay.opacity")}
          display={`${Math.round(settings.opacity * 100)}%`}
          value={settings.opacity}
          min={0.2}
          max={1}
          step={0.05}
          onChange={(opacity) => update({ opacity })}
        />

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.layout")}
            </label>
          </div>
          <p className="hw-card-help">{t("settings.overlay.layoutDesc")}</p>
          <OverlayFieldChips
            className="settings-segmented hw-seg"
            role="group"
            ariaLabel={t("settings.overlay.aria.layout")}
            options={TICKER_LAYOUTS.map((option) => ({
              id: option.id,
              label: t(option.labelKey),
              title: t(option.hintKey),
            }))}
            value={settings.tickerLayout ?? "strip"}
            onChange={(tickerLayout) => update({ tickerLayout })}
          />
        </div>

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.background")}
            </label>
          </div>
          <p className="hw-card-help">{t("settings.overlay.backgroundDesc")}</p>
          <OverlayFieldChips
            className="settings-segmented hw-seg"
            role="group"
            ariaLabel={t("settings.overlay.aria.background")}
            options={(["glass", "solid", "dim"] as const).map((mode) => ({
              id: mode,
              label: t(BG_KEYS[mode]),
            }))}
            value={settings.backgroundStyle ?? "glass"}
            onChange={(backgroundStyle) => update({ backgroundStyle })}
          />

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            nativeBlurSupported && (
              <OverlayFieldToggle
                className="overlay-toggle-item"
                style={{ marginTop: "var(--space-md)" }}
                label={t("overlay.settings.nativeBlur")}
                checked={settings.nativeBlur ?? true}
                onChange={(nativeBlur) => update({ nativeBlur })}
              />
            )}

          {(settings.backgroundStyle ?? "glass") === "glass" &&
            !(
              nativeBlurSupported &&
              (settings.nativeBlur ?? true) &&
              !settings.reduceEffects
            ) && (
              <OverlayFieldSlider
                style={{ marginTop: "var(--space-md)" }}
                infoClassName="hw-card-head"
                labelAs="label"
                labelClassName="hw-card-label"
                valueClassName="hw-card-value"
                inputClassName="hw-range"
                ariaLabel={t("overlay.settings.bgBlur")}
                label={t("overlay.settings.bgBlur")}
                display={`${Math.round(settings.backgroundBlur ?? 14)}px`}
                value={settings.backgroundBlur ?? 14}
                min={0}
                max={30}
                step={1}
                onChange={(backgroundBlur) => update({ backgroundBlur })}
              />
            )}

          <OverlayFieldSlider
            style={{ marginTop: "var(--space-md)" }}
            infoClassName="hw-card-head"
            labelAs="label"
            labelClassName="hw-card-label"
            valueClassName="hw-card-value"
            inputClassName="hw-range"
            ariaLabel={t("overlay.settings.bgOpacity")}
            label={t("overlay.settings.bgOpacity")}
            display={`${Math.round((settings.backgroundOpacity ?? 0.72) * 100)}%`}
            value={settings.backgroundOpacity ?? 0.72}
            min={0.2}
            max={1}
            step={0.02}
            onChange={(backgroundOpacity) => update({ backgroundOpacity })}
          />
        </div>

        <SettingsToggleCard
          title={t("overlay.settings.reduceEffects")}
          desc={t("settings.overlay.reduceEffectsDesc")}
          checked={settings.reduceEffects ?? false}
          onChange={(on) => update({ reduceEffects: on })}
        />

        <SettingsToggleCard
          title={t("overlay.settings.clickThrough")}
          desc={t("overlay.settings.clickThroughDesc")}
          checked={settings.tickerClickThrough ?? false}
          onChange={(on) => update({ tickerClickThrough: on })}
        />

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("overlay.settings.resetSize")}
            </label>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              update({
                tickerWidth: DEFAULT_OVERLAY_SETTINGS.tickerWidth,
                tickerHeight: DEFAULT_OVERLAY_SETTINGS.tickerHeight,
                panelWidth: DEFAULT_OVERLAY_SETTINGS.panelWidth,
                panelHeight: DEFAULT_OVERLAY_SETTINGS.panelHeight,
                posX: null,
                posY: null,
              });
              void invoke("overlay_set_corner", { corner: settings.corner });
            }}
          >
            {t("overlay.settings.resetSize")}
          </Button>
        </div>

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

        <SettingsToggleCard
          title={t("overlay.settings.detectCurrentGame")}
          desc={t("settings.overlay.detectCurrentGameDesc")}
          checked={settings.detectCurrentGame ?? true}
          onChange={(on) => update({ detectCurrentGame: on })}
        />
      </SettingsSection>

      <SettingsSection
        id="overlay-accessibility"
        icon={<Accessibility />}
        title={t("overlay.settings.accessibility")}
        desc={t("settings.overlay.desc")}
      >
        <SettingsToggleCard
          title={t("overlay.settings.highContrast")}
          desc={t("settings.overlay.highContrastDesc")}
          checked={settings.highContrast ?? false}
          onChange={(on) => update({ highContrast: on })}
        />

        <OverlayFieldSlider
          className="hw-card"
          style={{ marginTop: "var(--space-lg)" }}
          infoClassName="hw-card-head"
          labelAs="label"
          labelClassName="hw-card-label"
          valueClassName="hw-card-value"
          inputClassName="hw-range"
          help={
            <p className="hw-card-help">
              {t("settings.overlay.textScaleDesc")}
            </p>
          }
          label={t("overlay.settings.textScale")}
          display={`${Math.round((settings.textScale ?? 1) * 100)}%`}
          value={settings.textScale ?? 1}
          min={0.9}
          max={1.4}
          step={0.05}
          onChange={(textScale) => update({ textScale })}
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
            <OverlayFieldChips
              className="settings-segmented hw-seg"
              role="group"
              options={["png", "jpg"].map((fmt) => ({
                id: fmt,
                label: fmt.toUpperCase(),
              }))}
              value={settings.screenshotFormat}
              onChange={(screenshotFormat) => update({ screenshotFormat })}
            />
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
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

        <OverlayFieldSlider
          className="hw-card"
          style={{ marginTop: "var(--space-lg)" }}
          infoClassName="hw-card-head"
          labelAs="label"
          labelClassName="hw-card-label"
          valueClassName="hw-card-value"
          inputClassName="hw-range"
          help={
            <p className="hw-card-help">
              {t("settings.overlay.screenshotDelayDesc")}
            </p>
          }
          label={t("settings.overlay.screenshotDelay")}
          display={`${settings.screenshotDelayMs} ms`}
          value={settings.screenshotDelayMs}
          min={20}
          max={1000}
          step={20}
          onChange={(screenshotDelayMs) => update({ screenshotDelayMs })}
        />

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
        <div className="hw-pane-head" style={{ marginTop: "var(--space-2xl)" }}>
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

        <div className="hw-duo" style={{ marginTop: "var(--space-lg)" }}>
          <div className="hw-card">
            <div className="hw-card-head">
              <label className="hw-card-label">
                {t("settings.overlay.videoFps")}
              </label>
            </div>
            <p className="hw-card-help">{t("settings.overlay.videoFpsDesc")}</p>
            <OverlayFieldChips
              className="settings-segmented hw-seg"
              role="group"
              options={[30, 60, 120].map((fps) => ({
                id: fps,
                label: fps,
              }))}
              value={settings.videoFps}
              onChange={(videoFps) => update({ videoFps })}
            />
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
            <OverlayFieldChips
              className="settings-segmented hw-seg"
              role="group"
              options={[
                { kbps: 6000, label: t("settings.overlay.qualityLow") },
                { kbps: 12000, label: t("settings.overlay.qualityMedium") },
                { kbps: 24000, label: t("settings.overlay.qualityHigh") },
              ].map((opt) => ({
                id: opt.kbps,
                label: opt.label,
              }))}
              value={settings.videoBitrateKbps}
              onChange={(videoBitrateKbps) => update({ videoBitrateKbps })}
            />
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
          <div className="hw-card-head">
            <label className="hw-card-label">
              {t("settings.overlay.videoScale")}
            </label>
            <span className="hw-card-value">
              {Math.round(settings.videoResolutionScale * 100)}%
            </span>
          </div>
          <p className="hw-card-help">{t("settings.overlay.videoScaleDesc")}</p>
          <OverlayFieldChips
            className="settings-segmented hw-seg"
            role="group"
            options={[
              { scale: 1, label: "100%" },
              { scale: 0.75, label: "75%" },
              { scale: 0.5, label: "50%" },
            ].map((opt) => ({
              id: opt.scale,
              label: opt.label,
            }))}
            value={settings.videoResolutionScale}
            onChange={(videoResolutionScale) => update({ videoResolutionScale })}
          />
        </div>

        <div className="hw-duo" style={{ marginTop: "var(--space-lg)" }}>
          <OverlayFieldSlider
            className="hw-card"
            infoClassName="hw-card-head"
            labelAs="label"
            labelClassName="hw-card-label"
            valueClassName="hw-card-value"
            inputClassName="hw-range"
            help={
              <p className="hw-card-help">
                {t("settings.overlay.replaySecondsDesc")}
              </p>
            }
            label={t("settings.overlay.replaySeconds")}
            display={`${settings.replayBufferSeconds}s`}
            value={settings.replayBufferSeconds}
            min={15}
            max={300}
            step={15}
            onChange={(replayBufferSeconds) => update({ replayBufferSeconds })}
          />

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
            <OverlayFieldChips
              className="settings-segmented hw-seg"
              role="group"
              options={[0, 60, 300, 900].map((secs) => ({
                id: secs,
                label:
                  secs === 0
                    ? t("settings.overlay.unlimited")
                    : `${secs}s`,
              }))}
              value={settings.videoMaxClipSeconds}
              onChange={(videoMaxClipSeconds) =>
                update({ videoMaxClipSeconds })
              }
            />
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: "var(--space-lg)" }}>
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

        <div className="hw-duo" style={{ marginTop: "var(--space-lg)" }}>
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

        <div className="hw-pane-head" style={{ marginTop: "var(--space-xl)" }}>
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
