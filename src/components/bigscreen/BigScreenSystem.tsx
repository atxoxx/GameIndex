// BigScreenSystem — the System hub. All sub-view behavior lives in
// `system/` next to this file; the hub itself only owns:
//   • the left menu (menu items + LB/RB tab cycler),
//   • route ↔ section sync (deep links from the header strip land on
//     the right sub-view),
//   • which sub-view renders for the active route.
//
// Bumper scope: the menu is a tablist, so LB/RB reads TABS in the
// footer legend while this hub is mounted.

import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useBumperScopeDeclaration } from "./bigscreenLegend";
import { SYSTEM_ICONS, type SystemSectionId } from "./system/SystemIcons";
import SystemMenuItem, { type SystemMenuItemData } from "./system/SystemMenuItem";
import DownloadsView from "./system/DownloadsView";
import StorageView from "./system/StorageView";
import AchievementsView from "./system/AchievementsView";
import SettingsView from "./system/SettingsView";

export default function BigScreenSystem() {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const gamepad = useGamepad();

  // The left menu is a tablist of the hub's sub-views and LB/RB cycles it,
  // so the footer legend must read TABS here rather than the shell default.
  useBumperScopeDeclaration("tabs");

  const SECTIONS = useMemo<SystemMenuItemData[]>(
    () => [
      { id: "downloads", label: t("bigscreen.system.menuDownloads"), icon: SYSTEM_ICONS.downloads },
      { id: "storage", label: t("bigscreen.system.menuStorage"), icon: SYSTEM_ICONS.storage },
      { id: "achievements", label: t("bigscreen.system.menuAchievements"), icon: SYSTEM_ICONS.achievements },
      { id: "settings", label: t("bigscreen.system.menuPreferences"), icon: SYSTEM_ICONS.settings },
      // These three are full routes, not in-hub sub-views — selecting one
      // navigates to its own bigscreen page (wired in the registry).
      { id: "mods", label: t("nav.mods"), icon: SYSTEM_ICONS.mods },
      { id: "emulators", label: t("nav.emulators"), icon: SYSTEM_ICONS.emulators },
      { id: "docs", label: t("nav.docs"), icon: SYSTEM_ICONS.docs },
    ],
    [t],
  );

  // Find initial section from current pathname
  const initialSection = useMemo<SystemSectionId>(() => {
    const path = location.pathname;
    if (path.startsWith("/downloads")) return "downloads";
    if (path.startsWith("/storage")) return "storage";
    if (path.startsWith("/achievements")) return "achievements";
    if (path.startsWith("/mods")) return "mods";
    if (path.startsWith("/emulators")) return "emulators";
    if (path.startsWith("/docs")) return "docs";
    return "settings";
  }, [location.pathname]);

  const [activeSection, setActiveSection] = useState<SystemSectionId>(initialSection);

  // Sync active section with route changes (header/deep-linking). Only the
  // in-hub sub-views keep the hub mounted; /mods, /emulators and /docs swap
  // to their own pages, so the highlights below cover the hub routes only.
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith("/downloads")) {
      setActiveSection("downloads");
    } else if (path.startsWith("/storage")) {
      setActiveSection("storage");
    } else if (path.startsWith("/achievements")) {
      setActiveSection("achievements");
    } else if (path.startsWith("/settings")) {
      setActiveSection("settings");
    }
  }, [location.pathname]);

  // Navigate to appropriate route when section is updated
  const handleSelectSection = useCallback((sec: SystemSectionId) => {
    setActiveSection(sec);
    if (sec === "settings") navigate("/settings");
    else navigate(`/${sec}`);
  }, [navigate]);

  // LB/RB cycles the hub's sub-views. Page-level priority beats the
  // shell strip cycler while this hub is mounted. Selecting a section
  // also navigates: the in-hub views (downloads/storage/achievements/
  // settings) keep the hub mounted, while mods/emulators/docs swap to
  // their own routes.
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const idx = SECTIONS.findIndex((sec) => sec.id === activeSection);
      if (idx < 0) return;
      const nextIdx =
        direction === "forward"
          ? (idx + 1) % SECTIONS.length
          : (idx - 1 + SECTIONS.length) % SECTIONS.length;
      handleSelectSection(SECTIONS[nextIdx].id as SystemSectionId);
    });
  }, [gamepad.registerTabCycler, SECTIONS, activeSection, handleSelectSection]);

  return (
    <div className="bigscreen-system-hub">
      {/* Left Menu Pane */}
      <div className="bigscreen-system-left-pane">
        <h2 className="bigscreen-system-title">{t("bigscreen.system.title")}</h2>
        <div className="bigscreen-system-menu" role="tablist">
          {SECTIONS.map((sec) => (
            <SystemMenuItem
              key={sec.id}
              item={sec}
              isActive={activeSection === sec.id}
              onSelect={() => handleSelectSection(sec.id as SystemSectionId)}
            />
          ))}
        </div>
      </div>

      {/* Right Details View Pane */}
      <div className="bigscreen-system-right-pane">
        {activeSection === "downloads" && <DownloadsView />}
        {activeSection === "storage" && <StorageView />}
        {activeSection === "achievements" && <AchievementsView />}
        {activeSection === "settings" && <SettingsView />}
        {/* mods / emulators / docs navigate to their own pages, so the hub
            unmounts before this pane needs content for them. */}
      </div>
    </div>
  );
}
