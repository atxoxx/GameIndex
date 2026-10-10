import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Bell,
  Clock,
  Cpu,
  Download,
  Gauge,
  Monitor,
  StickyNote,
  Trophy,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import {
  DEFAULT_OVERLAY_SETTINGS,
  PANEL_WIDGETS,
  TICKER_WIDGETS,
  normalizeOverlaySettings,
  type OverlayCorner,
  type OverlaySettings,
} from "../../context/OverlayContext";
import { Button, Skeleton } from "../../components/ui";
import { OverlayIcon } from "./settingsIcons";
import SettingsSection from "./SettingsSection";
import SettingsToggleCard from "./SettingsToggleCard";

const TICKER_LABELS: Record<string, string> = {
  fps: "overlay.metric.fps",
  cpu: "overlay.metric.cpu",
  gpu: "overlay.metric.gpu",
  session: "overlay.widget.session",
};

const PANEL_LABELS: Record<string, string> = {
  session: "overlay.widget.session",
  performance: "overlay.widget.performance",
  achievements: "overlay.widget.achievements",
  downloads: "overlay.widget.downloads",
  notifications: "overlay.widget.notifications",
  notes: "overlay.widget.notes",
};

function tickerIcon(key: string) {
  switch (key) {
    case "fps":
      return <Gauge />;
    case "cpu":
      return <Cpu />;
    case "gpu":
      return <Monitor />;
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
  const [recording, setRecording] = useState(false);
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

  // Capture the next key combination while recording.
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
      applyHotkeyRef.current(accelerator);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

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
              onClick={() => setRecording((r) => !r)}
              aria-label={t("settings.overlay.aria.hotkey")}
            >
              {recording
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
