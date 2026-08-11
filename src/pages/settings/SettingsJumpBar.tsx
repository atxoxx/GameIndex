import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SettingsSectionDef } from "./types";

interface SettingsJumpBarProps {
  sections: SettingsSectionDef[];
  t: (key: string, vars?: Record<string, unknown>) => string;
}

/**
 * SettingsJumpBar — the "on this page" chip row rendered above every
 * multi-section tab. Each chip deep-links to its section via
 * `?section=<id>` (same path the search results use), and a scrollspy
 * keeps the chip for the section currently in view highlighted.
 */
export default function SettingsJumpBar({ sections, t }: SettingsJumpBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [inView, setInView] = useState<string | null>(null);

  const target = searchParams.get("section");
  const activeId = inView ?? target ?? sections[0]?.id;

  // Scrollspy: track which section is currently on screen.
  useEffect(() => {
    if (sections.length < 2) return;
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b,
        );
        setInView(topmost.target.id);
      },
      { rootMargin: "-12% 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const jumpTo = (id: string) => {
    setSearchParams({ section: id }, { replace: true });
  };

  return (
    <nav className="settings-jumpbar" aria-label={t("settings.onThisPage")}>
      <span className="settings-jumpbar-label">{t("settings.onThisPage")}</span>
      <div className="settings-jumpbar-chips">
        {sections.map((section) => {
          const isActive = activeId === section.id;
          return (
            <button
              key={section.id}
              type="button"
              className={`settings-jumpbar-chip${isActive ? " active" : ""}`}
              aria-current={isActive ? "true" : undefined}
              onClick={() => jumpTo(section.id)}
            >
              {section.icon && (
                <span className="settings-jumpbar-chip-icon" aria-hidden>
                  {section.icon}
                </span>
              )}
              {t(section.labelKey)}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
