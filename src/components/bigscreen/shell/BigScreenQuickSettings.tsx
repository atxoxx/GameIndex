// Quick settings panel — the TV-side control room.
//
// Opened from the Guide (or the System hub) so a couch user can change
// the layout preset, navigation visibility, theme, UI scale and motion
// budget without leaving Big Screen Mode. Every control is a focusable
// button, so the panel is fully driveable with a D-pad.

import { useEffect, useRef } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useTheme } from "../../../context/ThemeContext";
import {
  useBigScreenPrefs,
  useActivePreset,
} from "../../../context/BigScreenPrefsContext";
import { useSettings, type UiScale } from "../../../context/SettingsContext";
import type { NavVisibility } from "../../../bigscreen/presets";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGamepad } from "../../../hooks/GamepadProvider";
import PresetPicker from "./PresetPicker";

const UI_SCALES: UiScale[] = ["auto", "85", "100", "110", "125", "150", "175", "200"];

interface ValueRowProps {
  label: string;
  value: string;
  onClick: () => void;
}

function ValueRow({ label, value, onClick }: ValueRowProps) {
  return (
    <button
      {...useFocusable(onClick)}
      type="button"
      className="bs-quick-row"
      onClick={onClick}
    >
      <span className="bs-quick-row-label">{label}</span>
      <span className="bs-quick-row-value">{value}</span>
    </button>
  );
}

interface SegmentButtonProps {
  label: string;
  pressed: boolean;
  onSelect: () => void;
}

function SegmentButton({ label, pressed, onSelect }: SegmentButtonProps) {
  return (
    <button
      {...useFocusable(onSelect)}
      type="button"
      className="bs-quick-segment-btn"
      aria-pressed={pressed}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

interface BigScreenQuickSettingsProps {
  open: boolean;
  onClose: () => void;
}

export default function BigScreenQuickSettings({
  open,
  onClose,
}: BigScreenQuickSettingsProps) {
  const { t } = useLanguage();
  const { currentTheme, themes, setTheme } = useTheme();
  const { prefs, setPreset, setNavVisibility, resetPrefs } = useBigScreenPrefs();
  const preset = useActivePreset();
  const {
    reduceMotion,
    setReduceMotion,
    animatedMediaEnabled,
    setAnimatedMediaEnabled,
    uiScale,
    setUiScale,
  } = useSettings();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const gamepad = useGamepad();
  const closeProps = useFocusable(onClose);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Land on the active preset so Left/Right immediately compares
      // layouts instead of starting on the close button.
      const selected = panel.querySelector<HTMLElement>(
        '.bs-preset[data-selected="true"]',
      );
      if (selected) selected.focus({ preventScroll: true });
      else gamepad.focusFirst(panel);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, gamepad.focusFirst]);

  if (!open) return null;

  const theme = themes.find((entry) => entry.id === currentTheme);
  const nextTheme = themes[(themes.findIndex((entry) => entry.id === currentTheme) + 1) % Math.max(themes.length, 1)];
  const scaleIndex = UI_SCALES.indexOf(uiScale);

  const navOptions: Array<{ id: NavVisibility; key: string }> = [
    { id: "always", key: "bigscreen.quickSettings.navAlways" },
    { id: "compact", key: "bigscreen.quickSettings.navCompact" },
    { id: "auto", key: "bigscreen.quickSettings.navAuto" },
  ];

  return (
    <div className="bs-quick-layer">
      <div className="bs-quick-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="bs-quick"
        role="dialog"
        aria-modal="true"
        aria-label={t("bigscreen.quickSettings.title")}
        data-bigscreen-overlay="true"
        data-arrow-nav="true"
        tabIndex={-1}
      >
        <header className="bs-quick-head">
          <h2 className="bs-quick-title">{t("bigscreen.quickSettings.title")}</h2>
          <button
            {...closeProps}
            type="button"
            className="bs-quick-close"
            aria-label={t("common.close")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="bs-quick-body">
          <section className="bs-quick-group">
            <h3 className="bs-quick-group-title">
              {t("bigscreen.quickSettings.layout")}
            </h3>
            <PresetPicker value={prefs.preset} onChange={setPreset} />
            <p className="bs-quick-note">{t(preset.blurbKey)}</p>
          </section>

          <section className="bs-quick-group">
            <h3 className="bs-quick-group-title">
              {t("bigscreen.quickSettings.navVisibility")}
            </h3>
            <div className="bs-quick-segment" role="group">
              {navOptions.map((option) => (
                <SegmentButton
                  key={option.id}
                  label={t(option.key)}
                  pressed={prefs.navVisibility === option.id}
                  onSelect={() => setNavVisibility(option.id)}
                />
              ))}
            </div>
          </section>

          <section className="bs-quick-group">
            <h3 className="bs-quick-group-title">
              {t("bigscreen.quickSettings.display")}
            </h3>
            <ValueRow
              label={t("bigscreen.quickSettings.theme")}
              value={theme ? theme.meta.name : currentTheme}
              onClick={() => nextTheme && setTheme(nextTheme.id)}
            />
            <ValueRow
              label={t("bigscreen.quickSettings.uiScale")}
              value={uiScale === "auto" ? t("bigscreen.quickSettings.auto") : `${uiScale}%`}
              onClick={() =>
                setUiScale(
                  UI_SCALES[(scaleIndex + 1) % UI_SCALES.length] ?? "auto",
                )
              }
            />
          </section>

          <section className="bs-quick-group">
            <h3 className="bs-quick-group-title">
              {t("bigscreen.quickSettings.motion")}
            </h3>
            <ValueRow
              label={t("bigscreen.quickSettings.reduceMotion")}
              value={t(
                reduceMotion
                  ? "bigscreen.quickSettings.on"
                  : "bigscreen.quickSettings.off",
              )}
              onClick={() => setReduceMotion(!reduceMotion)}
            />
            <ValueRow
              label={t("bigscreen.quickSettings.animatedArt")}
              value={t(
                animatedMediaEnabled
                  ? "bigscreen.quickSettings.on"
                  : "bigscreen.quickSettings.off",
              )}
              onClick={() => setAnimatedMediaEnabled(!animatedMediaEnabled)}
            />
          </section>

          <section className="bs-quick-group">
            <ValueRow
              label={t("bigscreen.quickSettings.reset")}
              value=""
              onClick={resetPrefs}
            />
          </section>
        </div>

        <footer className="bs-quick-foot" aria-hidden="true">
          <span className="bs-hint">
            <b className="bs-key">B</b>
            {t("common.close")}
          </span>
        </footer>
      </div>
    </div>
  );
}
