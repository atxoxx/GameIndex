// Full-screen layout selector.
//
// Opened from the top bar (the four-square utility), the Guide and Quick
// Settings. Controller-first: D-pad walks the five cards, A applies the
// layout and closes, B/Escape closes without changing anything. The
// active layout is marked and receives initial focus.

import { useEffect, useRef } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useBigScreenPrefs } from "../../../context/BigScreenPrefsContext";
import { PRESETS } from "../../../bigscreen/presets";
import { useFocusable } from "../../../hooks/useFocusable";
import LayoutPreview from "./LayoutPreview";
import "../../../styles/bigscreen/picker.css";

export default function LayoutPicker({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { prefs, setPreset } = useBigScreenPrefs();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const selected =
        rootRef.current?.querySelector<HTMLElement>(
          '[data-layout-choice][data-selected="true"]',
        ) ??
        rootRef.current?.querySelector<HTMLElement>("[data-layout-choice]");
      selected?.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="bst-layout-overlay"
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-label={t("bigscreen.layouts.title")}
      onClick={onClose}
    >
      <div
        className="bst-layout-panel"
        ref={rootRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="bst-layout-head">
          <div>
            <span className="bst-eyebrow">{t("bigscreen.layouts.eyebrow")}</span>
            <h2>{t("bigscreen.layouts.title")}</h2>
            <p>{t("bigscreen.layouts.subtitle")}</p>
          </div>
          <CloseButton onClose={onClose} />
        </header>

        <div className="bst-layout-grid">
          {PRESETS.map((preset) => (
            <LayoutChoice
              key={preset.id}
              id={preset.id}
              selected={preset.id === prefs.preset}
              onSelect={() => {
                setPreset(preset.id);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LayoutChoice({
  id,
  selected,
  onSelect,
}: {
  id: (typeof PRESETS)[number]["id"];
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const preset = PRESETS.find((entry) => entry.id === id)!;
  const props = useFocusable(onSelect);

  return (
    <button
      {...props}
      type="button"
      className="bst-layout-choice"
      data-layout-choice="true"
      data-layout-id={id}
      data-selected={selected ? "true" : undefined}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <LayoutPreview id={id} />
      <span className="bst-layout-choice-copy">
        <span className="bst-layout-choice-name">
          {t(preset.labelKey)}
          {selected ? (
            <span className="bst-layout-current">{t("bigscreen.layouts.active")}</span>
          ) : null}
        </span>
        <span className="bst-layout-choice-blurb">{t(preset.blurbKey)}</span>
        <span className="bst-layout-choice-meta">
          {t("bigscreen.layouts.home")}: {t(`bigscreen.layouts.homeStyle.${preset.home}`)}
        </span>
      </span>
    </button>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onClose);
  return (
    <button
      {...props}
      type="button"
      className="bst-layout-close"
      onClick={onClose}
      aria-label={t("common.close")}
    >
      ✕
    </button>
  );
}
