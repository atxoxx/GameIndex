// BigScreenHeader — v3 console shell top strip.
//
// Three-zone chrome, top edge: brand (left), the 8 primary sections
// plus a System entry (center, horizontally scrollable), and utilities
// (right: connection dot, pointer toggle, search, clock, exit).
//
// Controller model:
//   • The strip is fully focusable; LB/RB cycle the strip via the
//     shell tab cycler (low priority — a page-level tab bar takes over
//     while mounted).
//   • Pressing the Start button fires a window "bigscreen:start" event;
//     we listen and jump to the System hub (/settings).
//   • The System entry is the strip's 9th slot, styled as a
//     separator/utility that routes into the System hub.

import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import appIconUrl from "../assets/gameindex-icon.png";
import { useLanguage } from "../context/LanguageContext";
import { useGamepad } from "../hooks/GamepadProvider";
import { useFocusable } from "../hooks/useFocusable";
import { useBigScreen } from "../context/BigScreenContext";
import {
  PRIMARY_SECTIONS,
  SYSTEM_SECTIONS,
  SYSTEM_ENTRY,
  getActiveTabPath,
  type BigScreenSection,
} from "../bigscreen/registry";
import { CYCLER_PRIORITY_SHELL } from "../hooks/gamepad/gamepadUtils";

interface BigScreenHeaderProps {
  onOpenSearch?: () => void;
}

/** Strip targets = 8 primary sections + the System entry (slot 9). */
const STRIP_SECTIONS: BigScreenSection[] = [...PRIMARY_SECTIONS, SYSTEM_ENTRY];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SectionButton({
  section,
  active,
  onActivate,
  system = false,
}: {
  section: BigScreenSection;
  active: boolean;
  onActivate: () => void;
  system?: boolean;
}) {
  const { t } = useLanguage();
  const focusable = useFocusable(onActivate);
  const label = t(section.labelKey);

  return (
    <NavLink
      to={section.path}
      {...focusable}
      className={`bigscreen-v3-section${system ? " bigscreen-v3-section--system" : ""}${active ? " is-active" : ""}`}
      aria-label={label}
      aria-current={active ? "page" : undefined}
    >
      <span className="bigscreen-v3-section-icon">{section.icon}</span>
      <span className="bigscreen-v3-section-label">{label}</span>
    </NavLink>
  );
}

export default function BigScreenHeader({ onOpenSearch }: BigScreenHeaderProps) {
  const { t, language } = useLanguage();
  const { connected, virtualMouse, toggleVirtualMouse, registerTabCycler } = useGamepad();
  const { setBigScreen } = useBigScreen();
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [time, setTime] = useState("");

  const activePath = getActiveTabPath(location.pathname);
  const systemActive = SYSTEM_SECTIONS.some((section) =>
    location.pathname.startsWith(section.path),
  );

  const activeIndex = useMemo(() => {
    if (systemActive) return STRIP_SECTIONS.length - 1;
    return Math.max(0, STRIP_SECTIONS.findIndex((s) => s.path === activePath));
  }, [systemActive, activePath]);

  // Live clock for the header utilities.
  useEffect(() => {
    const update = () => {
      setTime(new Intl.DateTimeFormat([language], { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the active section centered in view when it changes.
  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>(".is-active");
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activePath, systemActive]);

  // Start button → System hub.
  useEffect(() => {
    function onStart() {
      navigate("/settings");
    }
    window.addEventListener("bigscreen:start", onStart);
    return () => window.removeEventListener("bigscreen:start", onStart);
  }, [navigate]);

  // Shell tab cycler — LB/RB sweeps the whole strip (8 + System). Low
  // priority so page-level tab bars take over while mounted.
  useEffect(() => {
    return registerTabCycler((direction) => {
      const next =
        direction === "forward"
          ? (activeIndex + 1) % STRIP_SECTIONS.length
          : (activeIndex - 1 + STRIP_SECTIONS.length) % STRIP_SECTIONS.length;
      navigate(STRIP_SECTIONS[next].path);
    }, CYCLER_PRIORITY_SHELL);
  }, [activeIndex, navigate, registerTabCycler]);

  const searchProps = useFocusable(() => onOpenSearch?.());
  const pointerProps = useFocusable(toggleVirtualMouse);
  const exitProps = useFocusable(() => setBigScreen(false));

  return (
    <header className="bigscreen-v3-header">
      <div className="bigscreen-v3-brand" aria-label="GameIndex Big Screen">
        <span className="bigscreen-v3-brand-mark">
          <img src={appIconUrl} alt="" aria-hidden="true" />
        </span>
        <span className="bigscreen-v3-brand-copy">
          <strong>GAMEINDEX</strong>
          <small>BIG SCREEN</small>
        </span>
      </div>

      <nav ref={navRef} className="bigscreen-v3-sections" aria-label={t("bigscreen.mainSections")}>
        {STRIP_SECTIONS.map((section, index) => {
          const isSystem = index === STRIP_SECTIONS.length - 1;
          const isActive = isSystem ? systemActive : section.path === activePath;
          return (
            <SectionButton
              key={section.path}
              section={section}
              active={isActive}
              system={isSystem}
              onActivate={() => navigate(section.path)}
            />
          );
        })}
      </nav>

      <div className="bigscreen-v3-utilities">
        <div
          className={`bigscreen-v3-connection${connected ? " is-connected" : ""}`}
          title={connected ? t("bigscreen.shell.ready") : t("bigscreen.shell.noPad")}
          aria-hidden="true"
        >
          <span className="bigscreen-v3-connection-dot" />
          <span>{connected ? t("bigscreen.shell.ready") : t("bigscreen.shell.noPad")}</span>
        </div>

        <button
          type="button"
          className={`bigscreen-v3-utility${virtualMouse.visible ? " is-active" : ""}`}
          {...pointerProps}
          aria-pressed={virtualMouse.visible}
          aria-label={t("bigscreen.shell.ariaPointer")}
        >
          <Icon><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></Icon>
          <span>{virtualMouse.visible ? t("bigscreen.shell.pointerMode") : t("bigscreen.shell.focusMode")}</span>
        </button>
        <button
          type="button"
          className="bigscreen-v3-utility"
          {...searchProps}
          aria-label={t("bigscreen.search")}
        >
          <Icon><circle cx="11" cy="11" r="6" /><path d="m16 16 5 5" /></Icon>
          <span>{t("bigscreen.search")}</span>
        </button>
        <span className="bigscreen-v3-clock" aria-hidden="true">{time}</span>
        <button
          type="button"
          className="bigscreen-v3-exit"
          {...exitProps}
          aria-label={t("bigscreen.exitBigScreen")}
        >
          <Icon><path d="M9 6H5v12h4" /><path d="m13 8 4 4-4 4" /><path d="M17 12H9" /></Icon>
        </button>
      </div>
    </header>
  );
}
