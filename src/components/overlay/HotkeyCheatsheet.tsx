import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { OverlaySettings } from "../../context/OverlayContext";

export interface HotkeyCheatsheetProps {
  settings: OverlaySettings;
  onClose: () => void;
}

/**
 * Read-only list of the overlay's global bindings. Lives inside the panel
 * webview (no portal needed); Escape closes it without also collapsing the
 * panel, so the capture-phase listener stops the page-level handler.
 */
export default function HotkeyCheatsheet({
  settings,
  onClose,
}: HotkeyCheatsheetProps) {
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const rows = [
    { id: "toggle", labelKey: "overlay.help.toggle", keys: settings.hotkey },
    {
      id: "screenshot",
      labelKey: "overlay.help.screenshot",
      keys: settings.screenshotHotkey,
    },
    { id: "record", labelKey: "overlay.help.record", keys: settings.videoHotkey },
    { id: "replay", labelKey: "overlay.help.replay", keys: settings.replayHotkey },
    { id: "collapse", labelKey: "overlay.help.collapse", keys: "Esc" },
  ];

  return (
    <div
      className="overlay-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overlay-hotkeys-title"
      data-testid="overlay-hotkeys"
    >
      <div className="overlay-modal__scrim" aria-hidden="true" onClick={onClose} />
      <div className="overlay-modal__card">
        <header className="overlay-modal__head">
          <span className="overlay-modal__icon" aria-hidden>
            <Keyboard size={16} />
          </span>
          <h2 className="overlay-modal__title" id="overlay-hotkeys-title">
            {t("overlay.help.title")}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="overlay-modal__close"
            onClick={onClose}
            aria-label={t("overlay.help.close")}
            data-testid="overlay-hotkeys-close"
          >
            <X size={15} />
          </button>
        </header>

        <ul className="overlay-hotkeys">
          {rows.map((row) => (
            <li className="overlay-hotkeys__row" key={row.id}>
              <span className="overlay-hotkeys__label">{t(row.labelKey)}</span>
              <kbd className="overlay-hotkeys__keys">
                {(row.keys || "—").split("+").map((key, index) => (
                  <span className="overlay-hotkeys__key" key={`${row.id}-${key}-${index}`}>
                    {key}
                  </span>
                ))}
              </kbd>
            </li>
          ))}
        </ul>

        <p className="overlay-modal__hint">{t("overlay.help.hint")}</p>
      </div>
    </div>
  );
}
