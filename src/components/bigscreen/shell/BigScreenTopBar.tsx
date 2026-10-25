// Top chrome for the Big Screen shell: brand, live clock, connection
// state and the utility cluster (search, guide, pointer, exit).
//
// The section nav is a sibling element (see BigScreenNav) so a preset
// can move it from a top row to a side rail without re-mounting it and
// without a second DOM tree.

import { useEffect, useState } from "react";
import { useGamepad } from "../../../hooks/GamepadProvider";
import { useLanguage } from "../../../context/LanguageContext";

interface BigScreenTopBarProps {
  onOpenSearch: () => void;
  onOpenGuide: () => void;
  onRequestExit: () => void;
}

export default function BigScreenTopBar({
  onOpenSearch,
  onOpenGuide,
  onRequestExit,
}: BigScreenTopBarProps) {
  const { t, language } = useLanguage();
  const gamepad = useGamepad();
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () =>
      setTime(
        new Intl.DateTimeFormat(language, {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      );
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [language]);

  return (
    <header className="bs-topbar">
      <div className="bs-brand">
        <span className="bs-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
            <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
          </svg>
        </span>
        <span className="bs-brand-word">GameIndex</span>
      </div>

      <div className="bs-utilities">
        <span
          className="bs-connection"
          data-connected={gamepad.connected ? "true" : undefined}
          title={t(
            gamepad.connected ? "bigscreen.shell.ready" : "bigscreen.shell.noPad",
          )}
        >
          <span className="bs-connection-dot" aria-hidden="true" />
          <span className="bs-sr-only">
            {t(
              gamepad.connected
                ? "bigscreen.shell.ready"
                : "bigscreen.shell.noPad",
            )}
          </span>
        </span>

        <button
          type="button"
          className="bs-utility"
          onClick={onOpenSearch}
          aria-label={t("bigscreen.search")}
          title={t("bigscreen.search")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
        </button>

        <button
          type="button"
          className="bs-utility"
          onClick={onOpenGuide}
          aria-label={t("bigscreen.guide.open")}
          title={t("bigscreen.guide.open")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="3" y="6" width="18" height="12" rx="3" />
            <path d="M8 10h2M9 9v2M15 10h.01M17 12h.01" />
          </svg>
        </button>

        <button
          type="button"
          className="bs-utility"
          data-active={gamepad.virtualMouse.visible ? "true" : undefined}
          onClick={gamepad.toggleVirtualMouse}
          aria-label={t(
            gamepad.virtualMouse.visible
              ? "bigscreen.shell.pointerMode"
              : "bigscreen.shell.focusMode",
          )}
          title={t(
            gamepad.virtualMouse.visible
              ? "bigscreen.shell.pointerMode"
              : "bigscreen.shell.focusMode",
          )}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 3 6.5 16 2.4-6.1L20 10.5Z" />
          </svg>
        </button>

        <span className="bs-clock">{time}</span>

        <button
          type="button"
          className="bs-utility bs-utility--exit"
          onClick={onRequestExit}
          aria-label={t("bigscreen.exitBigScreen")}
          title={t("bigscreen.exitBigScreen")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
            <path d="M10 8l-4 4 4 4M6 12h9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
