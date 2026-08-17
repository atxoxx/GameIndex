import { useCallback, useId, useRef, useState, useEffect } from "react";
import type { MouseEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  BookOpen,
  ChartColumn,
  Download,
  Gamepad2,
  HardDrive,
  Heart,
  Monitor,
  MonitorPlay,
  Puzzle,
  Rss,
  Settings,
  Store,
  Tag,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useActiveDownloadCount } from "../context/DownloadContext";
import { useAppVersion } from "../hooks/useAppVersion";
import { useBigScreen } from "../context/BigScreenContext";
import {
  getUnseenCommunityItems,
  clearUnseenCommunityItems,
  subscribeUnseenCommunity,
} from "../pages/friendsStorage";
import DownloadPopover from "./DownloadPopover";
import WindowControls from "./WindowControls";
import { useLanguage } from "../context/LanguageContext";

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
  return target.closest(
    'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], input, select, textarea'
  ) !== null;
}

interface Tab {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

const tabs: Tab[] = [
  { path: "/store", labelKey: "nav.store", icon: Store },
  { path: "/library", labelKey: "nav.library", icon: Monitor },
  { path: "/emulators", labelKey: "nav.emulators", icon: Gamepad2 },
  { path: "/mods", labelKey: "nav.mods", icon: Puzzle },
  { path: "/wishlist", labelKey: "nav.wishlist", icon: Heart },
  { path: "/deals", labelKey: "nav.deals", icon: Tag },
  { path: "/activity", labelKey: "nav.activity", icon: Activity },
  { path: "/achievements", labelKey: "nav.achievements", icon: Trophy },
  { path: "/downloads", labelKey: "nav.downloads", icon: Download },
  { path: "/storage", labelKey: "nav.storage", icon: HardDrive },
  { path: "/news", labelKey: "nav.news", icon: Rss },
  // /community is labelled "Stats" in the desktop UI but shares nav.*.
  { path: "/community", labelKey: "nav.stats", icon: ChartColumn },
  { path: "/friends", labelKey: "nav.friends", icon: Users },
];

export default function TopNav() {
  const activeDownloads = useActiveDownloadCount();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const location = useLocation();
  const { t } = useLanguage();
  const version = useAppVersion();

  // Unseen "new community items" badge. Counts new sessions /
  // recommendations / suggestions pulled from friends. Cleared when the
  // user opens the Friends tab.
  const [unseenCommunity, setUnseenCommunity] = useState<number>(() =>
    getUnseenCommunityItems()
  );
  useEffect(() => {
    setUnseenCommunity(getUnseenCommunityItems());
    return subscribeUnseenCommunity(setUnseenCommunity);
  }, []);

  // Download popover state. We keep the trigger element and the
  // popover as siblings inside `.topnav-right`, so the popover can
  // position itself relative to the trigger via the absolute
  // `.topnav` containing block (set in App.css).
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  // Stable id so the popover div and the trigger button are linked
  // via `aria-controls` for screen readers.
  const popoverId = useId();

  // Double-click the drag region → toggle maximize. This restores
  // the standard Windows title-bar behavior that
  // `decorations: false` removes.
  const tabsRef = useRef<HTMLDivElement>(null);

  const handleTabsWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (tabsRef.current && e.deltaY !== 0) {
      tabsRef.current.scrollLeft += e.deltaY * 0.8;
    }
  }, []);

  useEffect(() => {
    if (tabsRef.current) {
      const activeEl = tabsRef.current.querySelector(".topnav-tab.active");
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    }
  }, [location.pathname]);

  const handleTitleBarDoubleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (isInteractiveTarget(e.target)) return;
      getCurrentWindow().toggleMaximize().catch(() => {});
    },
    [],
  );

  return (
    <nav
      className="topnav"
      aria-label={t("bigscreen.nav.mainNav")}
      onDoubleClick={handleTitleBarDoubleClick}
    >
      <div className="topnav-left">
        <div className="topnav-logo">
          {/*
           * Brand mark — three interlocking rings (purple, cyan, orange)
           * with a small sphere at the triple intersection. Painter's
           * order back → front is purple → cyan → orange so the orange
           * ring sits in front at the bottom intersection; the gradient
           * id is namespaced to this component to avoid collisions.
           */}
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
          {version !== "" && (
            <span className="topnav-logo__version">v{version}</span>
          )}
        </div>
        <div className="topnav-tabs" ref={tabsRef} onWheel={handleTabsWheel} role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = location.pathname.startsWith(tab.path);
            const showCommunityBadge =
              tab.path === "/friends" && unseenCommunity > 0;
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={`topnav-tab${isActive ? " active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                role="tab"
                aria-selected={isActive ? "true" : "false"}
                onClick={() => {
                  if (tab.path === "/friends") clearUnseenCommunityItems();
                }}
              >
                <Icon className="topnav-tab-icon" strokeWidth={2} aria-hidden="true" />
                {t(tab.labelKey)}
                {showCommunityBadge && (
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
      </div>

      {/* Right cluster: page actions (downloads, settings, docs,
       * big-screen) + window controls. Bundled into one flex unit so
       * `.topnav`'s `justify-content: space-between` anchors them to
       * the right edge instead of drifting to the geometric center. */}
      <div className="topnav-right-cluster">
        <div className="topnav-right">
          <button
            ref={downloadBtnRef}
            type="button"
            className={`topnav-btn topnav-btn-downloads${downloadsOpen ? " active" : ""}${activeDownloads > 0 ? " is-downloading" : ""}`}
            onClick={() => setDownloadsOpen((o) => !o)}
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
            aria-label={t("nav.settings")}
            title={t("nav.settings")}
          >
            <Settings />
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) =>
              `topnav-btn topnav-btn-docs${isActive ? " active" : ""}`
            }
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

        <div className="topnav-window-chrome">
          <WindowControls />
        </div>
      </div>
    </nav>
  );
}
