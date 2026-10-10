import { useState, useEffect } from "react";
import {
  Sliders,
  RotateCcw,
  Gauge,
  Cpu,
  Monitor,
  Clock,
  Keyboard,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useOverlay,
  type OverlayCorner,
  TICKER_WIDGETS,
  PANEL_WIDGETS,
  DEFAULT_OVERLAY_SETTINGS,
} from "../../../context/OverlayContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Card, Button } from "../../ui";

const CORNERS: { id: OverlayCorner; labelKey: string }[] = [
  { id: "top-left", labelKey: "settings.overlay.corner.topLeft" },
  { id: "top-right", labelKey: "settings.overlay.corner.topRight" },
  { id: "bottom-left", labelKey: "settings.overlay.corner.bottomLeft" },
  { id: "bottom-right", labelKey: "settings.overlay.corner.bottomRight" },
];

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

export default function SettingsWidget() {
  const { settings, updateSettings } = useOverlay();
  const { t } = useLanguage();
  const [recording, setRecording] = useState(false);

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
          <RotateCcw size={13} />
          <span>{t("overlay.settings.resetDefaults")}</span>
        </Button>
      </div>

      <div className="overlay-settings-list">
        {/* Opacity slider */}
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

        {/* Screen Corner Grid */}
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

        {/* Global Hotkey */}
        <div className="overlay-setting-row">
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
          >
            {recording
              ? t("overlay.settings.hotkeyRecording")
              : t("overlay.settings.hotkeyRecord")}
          </Button>
        </div>

        {/* Telemetry Toggles */}
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

        {/* Ticker Widgets Selection */}
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
                >
                  {key === "fps" && <Gauge size={12} />}
                  {key === "cpu" && <Cpu size={12} />}
                  {key === "gpu" && <Monitor size={12} />}
                  {key === "session" && <Clock size={12} />}
                  <span>{key.toUpperCase()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Panel Widgets Selection */}
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
    </Card>
  );
}
