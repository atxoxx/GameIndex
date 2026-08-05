import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { FlagIcon } from "../../components/ui";
import SettingsSection from "./SettingsSection";
import { GlobeIcon } from "./settingsIcons";

/**
 * GeneralTab — app-wide preferences. Currently hosts the display
 * language listbox picker (flag pill + native label + code badge),
 * with full keyboard navigation and click-outside dismissal.
 */
export default function GeneralTab() {
  const { language, setLanguage, languages, t } = useLanguage();

  // Custom-language-picker state. The native <select> was replaced with
  // a richer listbox-style picker, so we need an open/close flag plus a
  // "hovered option index" so ArrowUp/ArrowDown keyboard nav feels like
  // a real listbox.
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [languagePickerHoverIdx, setLanguagePickerHoverIdx] = useState(0);
  const languagePickerRef = useRef<HTMLDivElement>(null);
  const languagePickerTriggerRef = useRef<HTMLButtonElement>(null);

  const currentLanguage =
    languages.find((l) => l.code === language) ?? languages[0];

  // Click-outside + keyboard navigation for the language picker.
  useEffect(() => {
    if (!languagePickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        languagePickerRef.current &&
        !languagePickerRef.current.contains(e.target as Node)
      ) {
        setLanguagePickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setLanguagePickerOpen(false);
        languagePickerTriggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setLanguagePickerHoverIdx((i) =>
          Math.min(i + 1, languages.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setLanguagePickerHoverIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const target = languages[languagePickerHoverIdx];
        if (target) {
          const pickedIdx = languages.findIndex((l) => l.code === target.code);
          void setLanguage(target.code);
          setLanguagePickerOpen(false);
          setLanguagePickerHoverIdx(pickedIdx >= 0 ? pickedIdx : 0);
          languagePickerTriggerRef.current?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [languagePickerOpen, languagePickerHoverIdx, languages, setLanguage]);

  return (
    <SettingsSection
      icon={<GlobeIcon />}
      title={t("settings.language")}
      desc={t("settingsPage.languageDesc")}
    >
      <div
        ref={languagePickerRef}
        className={`settings-language-picker${languagePickerOpen ? " open" : ""}`}
      >
        <button
          ref={languagePickerTriggerRef}
          type="button"
          className="language-trigger"
          aria-haspopup="listbox"
          aria-expanded={languagePickerOpen}
          aria-controls="settings-language-listbox"
          aria-activedescendant={
            languagePickerOpen
              ? `language-option-${languages[languagePickerHoverIdx]?.code ?? ""}`
              : undefined
          }
          aria-label={t("settings.language")}
          onClick={() => {
            setLanguagePickerOpen((wasOpen) => {
              if (!wasOpen) {
                const idx = languages.findIndex(
                  (l) => l.code === language,
                );
                setLanguagePickerHoverIdx(idx >= 0 ? idx : 0);
              }
              return !wasOpen;
            });
          }}
        >
          <span className="language-trigger-flag" aria-hidden="true">
            <FlagIcon code={currentLanguage.flag} size={22} />
          </span>
          <span className="language-trigger-info">
            <span className="language-trigger-label">
              {currentLanguage.label}
            </span>
            <span className="language-trigger-code">
              {currentLanguage.code.toUpperCase()}
            </span>
          </span>
          <svg
            className="language-trigger-chevron"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 15 12 9 18 15" />
          </svg>
        </button>
        {languagePickerOpen && (
          <div
            id="settings-language-listbox"
            className="language-panel"
            role="listbox"
            aria-label={t("settings.language")}
          >
            {languages.map((l, idx) => {
              const isActive = l.code === language;
              const isHovered = idx === languagePickerHoverIdx;
              return (
                <button
                  key={l.code}
                  type="button"
                  id={`language-option-${l.code}`}
                  role="option"
                  aria-selected={isActive}
                  className={`language-option${isActive ? " active" : ""}${isHovered ? " hovered" : ""}`}
                  onClick={() => {
                    void setLanguage(l.code);
                    setLanguagePickerOpen(false);
                  }}
                  onMouseEnter={() =>
                    setLanguagePickerHoverIdx(idx)
                  }
                >
                  <span
                    className="language-option-flag"
                    aria-hidden="true"
                  >
                    <FlagIcon code={l.flag} size={18} />
                  </span>
                  <span className="language-option-text">
                    <span className="language-option-label">
                      {l.label}
                    </span>
                    <span className="language-option-native">
                      {l.code.toUpperCase()}
                    </span>
                  </span>
                  {isActive && (
                    <svg
                      className="language-option-check"
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
