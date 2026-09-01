import { useCallback, useId, useRef, useState, useEffect, useMemo } from "react";
import type { MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  BookOpen,
  ChartColumn,
  ChevronDown,
  Download,
  Gamepad2,
  HardDrive,
  Heart,
  Home,
  Monitor,
  MonitorPlay,
  Puzzle,
  Rss,
  Search,
  Settings,
  Store,
  Tag,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useActiveDownloadCount } from "../context/DownloadContext";
import { useGames } from "../context/GameContext";
import { useAppVersion } from "../hooks/useAppVersion";
import { useBigScreen } from "../context/BigScreenContext";
import {
  getUnseenCommunityItems,
  clearUnseenCommunityItems,
  subscribeUnseenCommunity,
} from "../pages/unseenCommunity";
import DownloadPopover from "./DownloadPopover";
import WindowControls from "./WindowControls";
import CommandPalette from "./CommandPalette";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { playTabSound } from "../utils/soundEffects";
import { preloadRoute } from "../utils/routePreload";

/**
 * Mouse-event guard: an interactive element is anything the user
 * would EXPECT to receive their own click without the title-bar
 * doing something else. Buttons, links (NavLinks render `<a>`),
 * elements that are tagged as buttons via ARIA, and form fields
 * all qualify. If a double-click lands inside one of these we
 * don't toggle maximize — the user is interacting with that
 * control, not the empty drag region.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], input, select, textarea'
    ) !== null
  );
}

interface Tab {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

// Primary core tabs always displayed in compact navbar mode
const coreNavTabs: Tab[] = [
  { path: "/home", labelKey: "nav.home", icon: Home },
  { path: "/store", labelKey: "nav.store", icon: Store },
  { path: "/library", labelKey: "nav.library", icon: Monitor },
  { path: "/wishlist", labelKey: "nav.wishlist", icon: Heart },
  { path: "/deals", labelKey: "nav.deals", icon: Tag },
  { path: "/activity", labelKey: "nav.activity", icon: Activity },
];

// Secondary tabs grouped into the 'More' dropdown menu in compact mode
const overflowNavTabs: Tab[] = [
  { path: "/news", labelKey: "nav.news", icon: Rss },
  { path: "/emulators", labelKey: "nav.emulators", icon: Gamepad2 },
  { path: "/mods", labelKey: "nav.mods", icon: Puzzle },
  { path: "/achievements", labelKey: "nav.achievements", icon: Trophy },
  { path: "/storage", labelKey: "nav.storage", icon: HardDrive },
  { path: "/community", labelKey: "nav.community", icon: ChartColumn },
  { path: "/friends", labelKey: "nav.friends", icon: Users },
];

// All pages live as flat tabs in full navbar mode
const allNavTabs: Tab[] = [
  { path: "/home", labelKey: "nav.home", icon: Home },
  { path: "/store", labelKey: "nav.store", icon: Store },
  { path: "/library", labelKey: "nav.library", icon: Monitor },
  { path: "/wishlist", labelKey: "nav.wishlist", icon: Heart },
  { path: "/deals", labelKey: "nav.deals", icon: Tag },
  { path: "/news", labelKey: "nav.news", icon: Rss },
  { path: "/emulators", labelKey: "nav.emulators", icon: Gamepad2 },
  { path: "/mods", labelKey: "nav.mods", icon: Puzzle },
  { path: "/activity", labelKey: "nav.activity", icon: Activity },
  { path: "/achievements", labelKey: "nav.achievements", icon: Trophy },
  { path: "/storage", labelKey: "nav.storage", icon: HardDrive },
  { path: "/community", labelKey: "nav.community", icon: ChartColumn },
  { path: "/friends", labelKey: "nav.friends", icon: Users },
];

export default function TopNav() {
  const { t } = useLanguage();
  const { games, runningGameIds } = useGames();
  const location = useLocation();
  const navigate = useNavigate();
  const activeDownloads = useActiveDownloadCount();
  const version = useAppVersion();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const { navbarMode, showNavbarNowPlaying } = useSettings();
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [unseenCommunity, setUnseenCommunity] = useState<number>(() => getUnseenCommunityItems());
  const [moreOpen, setMoreOpen] = useState(false);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // Find currently running game for live HUD indicator
  const runningGame = useMemo(() => {
    if (runningGameIds.length === 0) return null;
    return games.find((g) => runningGameIds.includes(g.id)) ?? null;
  }, [games, runningGameIds]);

  useEffect(() => {
    return subscribeUnseenCommunity((count) => {
      setUnseenCommunity(count);
    });
  }, []);

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!moreOpen) return;
    const handleClickOutside = (e: MouseEvent | globalThis.MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [moreOpen]);

  // Global Ctrl+K / Cmd+K hotkey
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Scroll active tab into view
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(".topnav-tab.active");
    active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [location.pathname]);

  // Handle double click to maximize
  const handleDoubleClick = useCallback(async (e: MouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(e.target)) return;
    const win = getCurrentWindow();
    const isMax = await win.isMaximized();
    if (isMax) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }, []);

  // Responsive Navbar style selection
  const isCompactNavbar = navbarMode === "compact";
  const displayedTabs = isCompactNavbar ? coreNavTabs : allNavTabs;
  const isOverflowActive = overflowNavTabs.some((tab) => location.pathname.startsWith(tab.path));

  return (
    <>
      <header
        className="topnav"
        onDoubleClick={handleDoubleClick}
        data-tauri-drag-region
      >
        {/* Left cluster: app brand identity + nav items */}
        <div className="topnav-left">
          <NavLink
            to="/home"
            className="topnav-logo"
            aria-label={t("nav.home")}
            title={t("nav.home")}
            onMouseEnter={() => preloadRoute("/home")}
            onFocus={() => preloadRoute("/home")}
          >
            <svg
              className="topnav-logo__mark"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <radialGradient id="topnav-logo-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.8" />
                  <stop offset="60%" stopColor="var(--color-accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="9" cy="9.5" r="5.4" stroke="var(--color-accent)" strokeWidth="2" />
              <circle cx="15" cy="9.5" r="5.4" stroke="var(--color-accent)" strokeWidth="2" />
              <circle cx="12" cy="15" r="5.4" stroke="var(--color-accent)" strokeWidth="2" />
              <circle cx="12" cy="11.5" r="3.4" fill="url(#topnav-logo-glow)" />
              <circle
                cx="12"
                cy="11.5"
                r="1.9"
                fill="var(--color-text-primary)"
                stroke="var(--color-accent)"
                strokeWidth="0.6"
              />
            </svg>
            <span className="topnav-logo__word">GameIndex</span>
            {version && (
              <span className="topnav-logo__version" title={`v${version}`}>
                v{version}
              </span>
            )}
          </NavLink>

          <button
            type="button"
            className="topnav-btn--cmd"
            onClick={() => {
              playTabSound();
              setPaletteOpen(true);
            }}
            title={t("topnav.searchPlaceholder")}
            aria-label={t("topnav.searchPlaceholder")}
          >
            <Search className="topnav-cmd-icon" aria-hidden="true" />
          </button>

          <span className="topnav-divider" aria-hidden="true" />

          <div ref={tabsRef} className="topnav-tabs">
            {displayedTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = location.pathname.startsWith(tab.path);
              const showBadge = tab.path === "/friends" && unseenCommunity > 0;
              return (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  className={`topnav-tab${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onMouseEnter={() => preloadRoute(tab.path)}
                  onFocus={() => preloadRoute(tab.path)}
                  onClick={() => {
                    playTabSound();
                    if (tab.path === "/friends") clearUnseenCommunityItems();
                  }}
                >
                  <Icon className="topnav-tab-icon" strokeWidth={2} aria-hidden="true" />
                  {t(tab.labelKey)}
                  {showBadge && (
                    <span
                      className="topnav-tab-badge"
                      role="status"
                      aria-label={t("topnav.newCommunityItems", { count: unseenCommunity, plural: unseenCommunity !== 1 ? "s" : "" })}
                    >
                      {unseenCommunity > 99 ? "99+" : unseenCommunity}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>

          {/* Compact Mode: 'More' Dropdown Menu */}
          {isCompactNavbar && (
            <div ref={moreRef} className="topnav-more-container">
              <button
                type="button"
                className={`topnav-tab topnav-more-btn${isOverflowActive ? " active" : ""}${moreOpen ? " is-open" : ""}`}
                onClick={() => {
                  playTabSound();
                  setMoreOpen((prev) => !prev);
                }}
                onMouseEnter={() => {
                  overflowNavTabs.forEach((tab) => preloadRoute(tab.path));
                }}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                title={t("nav.more")}
              >
                <span className="topnav-more-btn-label">{t("nav.more")}</span>
                <ChevronDown
                  className={`topnav-more-chevron${moreOpen ? " is-open" : ""}`}
                  size={13}
                  aria-hidden="true"
                />
                {unseenCommunity > 0 && !isOverflowActive && (
                  <span className="topnav-tab-badge" aria-hidden="true">
                    {unseenCommunity > 99 ? "99+" : unseenCommunity}
                  </span>
                )}
              </button>

              {moreOpen && (
                <div className="topnav-more-dropdown" role="menu">
                  {overflowNavTabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = location.pathname.startsWith(tab.path);
                    const showBadge = tab.path === "/friends" && unseenCommunity > 0;
                    return (
                      <NavLink
                        key={tab.path}
                        to={tab.path}
                        className={`topnav-more-item${isActive ? " active" : ""}`}
                        role="menuitem"
                        onMouseEnter={() => preloadRoute(tab.path)}
                        onFocus={() => preloadRoute(tab.path)}
                        onClick={() => {
                          playTabSound();
                          setMoreOpen(false);
                          if (tab.path === "/friends") clearUnseenCommunityItems();
                        }}
                      >
                        <Icon className="topnav-more-item-icon" size={15} aria-hidden="true" />
                        <span className="topnav-more-item-label">{t(tab.labelKey)}</span>
                        {showBadge && (
                          <span className="topnav-tab-badge">
                            {unseenCommunity > 99 ? "99+" : unseenCommunity}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right cluster: page actions (downloads, settings, docs,
         * big-screen) + window controls. */}
        <div className="topnav-right-cluster">
          <div className="topnav-right">
            {/* Live "Now Playing" HUD Chip */}
            {runningGame && showNavbarNowPlaying && (
              <button
                type="button"
                className="topnav-now-playing-chip"
                onClick={() => {
                  playTabSound();
                  navigate(`/library/${runningGame.id}`);
                }}
                title={`${t("topnav.nowPlaying")}: ${runningGame.name}`}
                aria-label={`${t("topnav.nowPlaying")}: ${runningGame.name}`}
              >
                <span className="topnav-now-playing-pulse" aria-hidden="true" />
                <Gamepad2 className="topnav-now-playing-chip-icon" aria-hidden="true" />
                <span className="topnav-now-playing-chip-name">{runningGame.name}</span>
              </button>
            )}

            <button
              ref={downloadBtnRef}
              type="button"
              className={`topnav-btn topnav-btn-downloads${downloadsOpen || location.pathname.startsWith("/downloads") ? " active" : ""}${activeDownloads > 0 ? " is-downloading" : ""}`}
              onClick={() => setDownloadsOpen((o) => !o)}
              onMouseEnter={() => preloadRoute("/downloads")}
              onFocus={() => preloadRoute("/downloads")}
              aria-label={activeDownloads > 0 ? t("topnav.downloadsActive", { count: activeDownloads }) : t("nav.downloads")}
              aria-expanded={downloadsOpen}
              aria-haspopup="dialog"
              aria-controls={popoverId}
              title={t("nav.downloads")}
            >
              <Download />
              {activeDownloads > 0 && (
                <span
                  className="topnav-btn-badge"
                  role="status"
                  aria-label={t("topnav.activeDownloads", { count: activeDownloads })}
                >
                  {activeDownloads}
                </span>
              )}
            </button>
            <DownloadPopover
              open={downloadsOpen}
              onClose={() => {
                setDownloadsOpen(false);
                downloadBtnRef.current?.focus();
              }}
              anchorRef={downloadBtnRef}
              id={popoverId}
            />
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `topnav-btn topnav-btn-settings${isActive ? " active" : ""}`
              }
              onMouseEnter={() => preloadRoute("/settings")}
              onFocus={() => preloadRoute("/settings")}
              aria-label={t("nav.settings")}
              title={t("nav.settings")}
            >
              <Settings />
            </NavLink>
            <NavLink
              to="/docs"
              className={({ isActive }) =>
                `topnav-btn topnav-btn-docs${isActive ? " active" : ""} ui-complete-only`
              }
              onMouseEnter={() => preloadRoute("/docs")}
              onFocus={() => preloadRoute("/docs")}
              aria-label={t("nav.docs")}
              title={t("nav.docs")}
            >
              <BookOpen />
            </NavLink>
            <button
              type="button"
              className={`topnav-btn topnav-btn-bigscreen${isBigScreen ? " active" : ""}`}
              onClick={() => setBigScreen(!isBigScreen)}
              aria-label={isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen")}
              title={isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen")}
            >
              <MonitorPlay />
            </button>
          </div>
          <WindowControls />
        </div>
      </header>
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
