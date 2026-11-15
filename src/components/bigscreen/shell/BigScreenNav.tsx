// Section navigation for the Big Screen shell.
//
// The active interface layout owns the navigation paradigm:
//   gameindex    floating glass strip with icon + label
//   xbox         wide dashboard tiles
//   steam        persistent vertical rail
//   playstation  centred hub row
//   switch       bottom icon dock
//
// One DOM shape (a list of section buttons) with layout-specific
// wrappers and CSS, so focus registration, section resolution and
// keyboard behaviour stay identical.

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PRIMARY_SECTIONS,
  sectionForPath,
  type BigScreenSection,
} from "../../../bigscreen/registry";
import { useFocusable } from "../../../hooks/useFocusable";
import { useLanguage } from "../../../context/LanguageContext";
import { useActivePreset } from "../../../context/BigScreenPrefsContext";

function NavItem({ section, active }: { section: BigScreenSection; active: boolean }) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const focusProps = useFocusable(() => navigate(section.path));

  return (
    <button
      {...focusProps}
      type="button"
      className="bs-nav-item"
      data-section={section.id}
      data-active={active ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      title={t(section.labelKey)}
    >
      <span className="bs-nav-icon" aria-hidden="true">
        {section.icon}
      </span>
      <span className="bs-nav-label">{t(section.labelKey)}</span>
    </button>
  );
}

interface BigScreenNavProps {
  onEngagedChange?: (engaged: boolean) => void;
}

export default function BigScreenNav({ onEngagedChange }: BigScreenNavProps) {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  const { id: layout } = useActivePreset();
  const navRef = useRef<HTMLElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const activeId = sectionForPath(pathname);

  useEffect(() => {
    onEngagedChange?.(engaged);
  }, [engaged, onEngagedChange]);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const onFocusIn = () => setEngaged(true);
    const onFocusOut = () => {
      window.requestAnimationFrame(() => {
        if (!el.contains(document.activeElement)) setEngaged(false);
      });
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("pointerenter", onFocusIn);
    el.addEventListener("pointerleave", onFocusOut);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("pointerenter", onFocusIn);
      el.removeEventListener("pointerleave", onFocusOut);
    };
  }, []);

  const isRail = layout === "steam";
  const isDock = layout === "switch";

  return (
    <nav
      ref={navRef}
      className="bs-nav"
      data-layout={layout}
      data-engaged={engaged ? "true" : undefined}
      aria-label={t("bigscreen.mainSections")}
    >
      {isRail ? (
        <div className="bs-nav-brand" aria-hidden="true">
          <span className="bs-brand-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5Z" />
              <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
            </svg>
          </span>
          <span>GameIndex</span>
        </div>
      ) : null}

      <div
        className="bs-nav-track"
        data-orientation={isRail ? "vertical" : "horizontal"}
        data-axis={isRail ? "y" : undefined}
      >
        {PRIMARY_SECTIONS.map((section) => (
          <NavItem key={section.id} section={section} active={section.id === activeId} />
        ))}
      </div>

      {isDock ? (
        <span className="bs-nav-dock-mark" aria-hidden="true">
          <span />
        </span>
      ) : null}
    </nav>
  );
}
