// Section navigation for the Big Screen shell.
//
// One DOM for every layout preset: a list of icon+label buttons. The
// preset decides where the list sits (top row / left rail / centred
// hub row / icon tiles) and how much of it is visible at rest, purely
// through `[data-preset]` + `[data-nav]` CSS on the shell root.
//
// "Compact, expands on focus": labels for inactive items stay hidden
// until the nav is engaged (controller focus, keyboard focus or the
// pointer). The nav reports that to the shell, which flips
// `data-nav-engaged` so the CSS can grow the bar without React
// re-rendering every section.

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  PRIMARY_SECTIONS,
  sectionForPath,
  type BigScreenSection,
} from "../../../bigscreen/registry";
import { useFocusable } from "../../../hooks/useFocusable";
import { useLanguage } from "../../../context/LanguageContext";

interface NavItemProps {
  section: BigScreenSection;
  active: boolean;
}

function NavItem({ section, active }: NavItemProps) {
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
  /** Reports engagement so the shell can expand/collapse the nav. */
  onEngagedChange?: (engaged: boolean) => void;
  /** A side rail must not be treated as a horizontal track. */
  orientation?: "horizontal" | "vertical";
}

export default function BigScreenNav({
  onEngagedChange,
  orientation = "horizontal",
}: BigScreenNavProps) {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  const navRef = useRef<HTMLElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const activeId = sectionForPath(pathname);

  useEffect(() => {
    onEngagedChange?.(engaged);
  }, [engaged, onEngagedChange]);

  // Engagement is "focus is somewhere in the nav". focusout fires
  // before the next element receives focus, so defer the check one
  // frame and look at the live activeElement.
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

  return (
    <nav
      ref={navRef}
      className="bs-nav"
      data-engaged={engaged ? "true" : undefined}
      aria-label={t("bigscreen.mainSections")}
    >
      <div className="bs-nav-track" data-orientation={orientation}>
        {PRIMARY_SECTIONS.map((section) => (
          <NavItem
            key={section.id}
            section={section}
            active={section.id === activeId}
          />
        ))}
      </div>
    </nav>
  );
}
