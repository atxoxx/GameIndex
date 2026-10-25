// BigScreenSystem — the System hub. `/settings` is a tile landing built
// from SYSTEM_SECTIONS; the hub routes (/downloads, /storage,
// /achievements, /settings/:tab) render their view inside the same
// chrome with a back affordance to the tiles. Mods, Emulators and Docs
// are full routes of their own and unmount the hub.
//
// Bumper scope: the landing grid and the views form one tablist, so
// LB/RB reads TABS in the footer legend while this hub is mounted.

import { useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useBumperScopeDeclaration } from "./bigscreenLegend";
import { SYSTEM_SECTIONS } from "../../bigscreen/registry";
import BigScreenBackHeader from "./BigScreenBackHeader";
import SystemTile from "./system/SystemTile";
import DownloadsView from "./system/DownloadsView";
import StorageView from "./system/StorageView";
import AchievementsView from "./system/AchievementsView";
import SettingsView from "./system/SettingsView";

/** In-hub views: the routes that keep the hub mounted. */
type HubView = "downloads" | "storage" | "achievements" | "settings";

/**
 * Where a tile lands. Preferences opens the first settings tab, because
 * `/settings` is the landing itself — a tile pointing there would only
 * re-render the grid.
 */
function tileTarget(path: string): string {
  return path === "/settings" ? "/settings/general" : path;
}

function viewForPath(pathname: string): HubView | null {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (path.startsWith("/downloads")) return "downloads";
  if (path.startsWith("/storage")) return "storage";
  if (path.startsWith("/achievements")) return "achievements";
  // `/settings/:tab` is a view; `/settings` itself is the tile landing.
  if (path.startsWith("/settings/")) return "settings";
  return null;
}

export default function BigScreenSystem() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const gamepad = useGamepad();

  useBumperScopeDeclaration("tabs");

  const view = viewForPath(location.pathname);

  // The tile the current view belongs to, so Back and the cycler agree
  // on where the hub "is".
  const activeIndex = useMemo(() => {
    if (!view) return -1;
    const path = view === "settings" ? "/settings" : `/${view}`;
    return SYSTEM_SECTIONS.findIndex((section) => section.path === path);
  }, [view]);

  const activeLabel =
    activeIndex >= 0 ? t(SYSTEM_SECTIONS[activeIndex].labelKey) : "";

  // LB/RB cycles the hub's tiles. From the landing, forward starts at
  // the first tile and back at the last one rather than doing nothing.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const step = direction === "forward" ? 1 : -1;
      const count = SYSTEM_SECTIONS.length;
      const next =
        activeIndex < 0
          ? step > 0
            ? 0
            : count - 1
          : (activeIndex + step + count) % count;
      navigate(tileTarget(SYSTEM_SECTIONS[next].path));
    });
  }, [gamepad.registerTabCycler, activeIndex, navigate]);

  if (!view) {
    return (
      <div className="bigscreen-system-hub">
        <div className="bigscreen-system-landing">
          <h1 className="bigscreen-system-title">
            {t("bigscreen.system.title")}
          </h1>
          <div className="bigscreen-system-tiles">
            {SYSTEM_SECTIONS.map((section) => (
              <SystemTile
                key={section.path}
                path={tileTarget(section.path)}
                label={t(section.labelKey)}
                icon={section.icon}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bigscreen-system-hub">
      <BigScreenBackHeader
        title={activeLabel}
        subtitle={t("bigscreen.system.title")}
        onBack={() => navigate("/settings")}
      />
      <div className="bigscreen-system-view">
        {view === "downloads" && <DownloadsView />}
        {view === "storage" && <StorageView />}
        {view === "achievements" && <AchievementsView />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
