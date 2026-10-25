// Shared area tabs for the three Discover screens.
//
// Keeps Deals / News / Community feeling like one section: a back
// crumb to the hub plus LB/RB paging between the three areas. The
// shell's own strip cycler is outranked by this page-level cycler
// while a Discover screen is mounted.

import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { DISCOVER_AREAS } from "../../bigscreen/registry";
import { useBumperScopeDeclaration } from "./bigscreenLegend";

function AreaTab({
  path,
  label,
  active,
}: {
  path: string;
  label: string;
  active: boolean;
}) {
  const navigate = useNavigate();
  return (
    <button
      {...useFocusable(() => navigate(path))}
      type="button"
      role="tab"
      aria-selected={active}
      className="bs-discover-tab"
      data-active={active ? "true" : undefined}
      data-focus-key={`discover:tab:${path}`}
      onClick={() => navigate(path)}
    >
      {label}
    </button>
  );
}

export default function DiscoverTabs() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const gamepad = useGamepad();
  const backProps = useFocusable(() => navigate("/discover"));

  useBumperScopeDeclaration("tabs");

  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const index = DISCOVER_AREAS.findIndex((area) => area.path === pathname);
      if (index < 0) return;
      const step = direction === "forward" ? 1 : -1;
      const next =
        DISCOVER_AREAS[(index + step + DISCOVER_AREAS.length) % DISCOVER_AREAS.length];
      if (next) navigate(next.path);
    });
  }, [gamepad.registerTabCycler, pathname, navigate]);

  return (
    <div className="bs-discover-tabs">
      <button
        {...backProps}
        type="button"
        className="bs-discover-back"
        data-focus-key="discover:back"
        onClick={() => navigate("/discover")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        {t("bigscreen.discover.title")}
      </button>

      <div className="bs-discover-tabs-list" role="tablist">
        {DISCOVER_AREAS.map((area) => (
          <AreaTab
            key={area.path}
            path={area.path}
            label={t(area.labelKey)}
            active={pathname === area.path}
          />
        ))}
      </div>
    </div>
  );
}
