import { useCallback, useId, useRef, useState, useEffect } from "react";
import type { MouseEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
 * control, not the empty drag region. Anchor matching collapses
 * the whole interactive subtree (e.g. a tab icon inside the
 * `<a>`) without us having to touch the SVG `<line>` it contains.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // "no-drag" on the children stops a window-drag from starting,
  // but onDoubleClick still bubbles — so we still want this guard
  // for any future control. "a[href]" (vs just "a") keeps hover-only
  // anchors without `href` from blocking the user; role="tab/menuitem"
  // covers ARIA-tagged controls; contenteditable="true" covers any
  // future rich-text editor embedded in the chrome; the rest are the
  // straight DOM form/control tags.
  return target.closest(
    'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], input, select, textarea'
  ) !== null;
}

function LibraryIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

interface Tab {
  path: string;
  icon: React.ReactNode;
}

function ActivityIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function WishlistIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function DealsIcon() {
  // Tag-with-down-arrow icon: a price tag with an inward-pointing
  // arrow, signaling "discount/deal" at a glance. Matches the inline
  // icon style used by every other tab in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 7h-3a2 2 0 0 1-2-2V3" />
      <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M9 7H4a2 2 0 0 0-2 2v1" />
      <path d="M14 14l-3 3-3-3" />
      <path d="M11 17V7" />
    </svg>
  );
}

function StorageIcon() {
  // Hard-drive icon: a rectangular drive with a small activity dot,
  // mirroring the inline icon style of every other tab in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}

function NewsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function DownloadIcon() {
  // Down-into-tray icon, matches the inline icon style of every
  // other tab button in this file.
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function AchievementsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}

function FriendsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function EmulatorsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="6" width="20" height="12" rx="4" />
      <line x1="7" y1="12" x2="11" y2="12" />
      <circle cx="16" cy="10" r="1" fill="currentColor" />
      <circle cx="18.5" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function ModsIcon() {
  return (
    <svg
      className="topnav-tab-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  );
}

const tabs: Tab[] = [
  { path: "/store", icon: <StoreIcon /> },
  { path: "/library", icon: <LibraryIcon /> },
  { path: "/emulators", icon: <EmulatorsIcon /> },
  { path: "/mods", icon: <ModsIcon /> },
  { path: "/wishlist", icon: <WishlistIcon /> },
  { path: "/deals", icon: <DealsIcon /> },
  { path: "/activity", icon: <ActivityIcon /> },
  { path: "/achievements", icon: <AchievementsIcon /> },
  { path: "/downloads", icon: <DownloadIcon /> },
  { path: "/storage", icon: <StorageIcon /> },
  { path: "/news", icon: <NewsIcon /> },
  { path: "/community", icon: <CommunityIcon /> },
  { path: "/friends", icon: <FriendsIcon /> },
];

export default function TopNav() {
  const activeDownloads = useActiveDownloadCount();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const location = useLocation();
  const { t } = useLanguage();
  const version = useAppVersion();

  // Map a nav route to its i18n key (the /community tab is labelled
  // "Stats" in the desktop UI but shares the nav.* namespace).
  const navKeyForPath = (path: string): string => {
    switch (path) {
      case "/store": return "nav.store";
      case "/library": return "nav.library";
      case "/wishlist": return "nav.wishlist";
      case "/deals": return "nav.deals";
      case "/activity": return "nav.activity";
      case "/achievements": return "nav.achievements";
      case "/downloads": return "nav.downloads";
      case "/storage": return "nav.storage";
      case "/news": return "nav.news";
      case "/community": return "nav.stats";
      case "/friends": return "nav.friends";
      case "/emulators": return "nav.emulators";
      case "/mods": return "nav.mods";
      default: return "nav.library";
    }
  };

  // Unseen "new community items" badge. Counts new sessions /
  // recommendations / suggestions pulled from friends. Cleared when the
  // user opens the Community tab.
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
  //
  // We listen on the topnav <nav> itself (the only DOM element
  // with the entire drag region) so a user double-clicking the
  // empty space between tabs and the window controls gets the
  // expected "grow to fullscreen" gesture. The handler skips
  // events whose target is inside an interactive child — the
  // `-webkit-app-region: no-drag` rule on those children stops
  // a *drag* from starting, but `onDoubleClick` still bubbles, so
  // without this filter a double-click on a tab would both fire
  // navigate and toggle maximize.
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
           * with a small white sphere at the triple intersection. The
           * rings echo the Vision Pro-style icon while staying legible
           * inside the 22×22 slot governed by `.topnav-logo__mark` (CSS
           * keeps the rotate/scale hover, the wordmark gradient, and the
           * the app-region: no-drag behaviour — no CSS changes needed).
           *
           * Painter's order: back → front is purple → cyan → orange so
           * the orange ring appears in front of the other two at the
           * bottom intersection, and the white sphere paints on top of
           * the triple intersection. The gradient `id` is namespaced to
           * this component so it can never collide with another mark on
           * the page; `aria-hidden` keeps the SVG out of the accessible
           * name (the adjacent <span>wordmark already labels the link).
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
              fill="#ffffff"
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
                {tab.icon}
                {t(navKeyForPath(tab.path))}
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

      {/* Right cluster: bundles .topnav-right (page actions:
       *  downloads + settings) and .topnav-window-chrome (min/max/
       *  close + the vertical divider). We render them inside a
       *  single flex unit because the parent `.topnav` uses
       *  `justify-content: space-between` and would otherwise
       *  distribute equal space on both sides of the middle child,
       *  pushing .topnav-right into the geometric center of the
       *  topnav on wide windows (large empty gap between settings
       *  and the divider). With the cluster wrapper, .topnav has
       *  only two children — `.topnav-left` on the left, this
       *  cluster on the right — and the inner members stay flush
       *  regardless of window width. */}
      <div className="topnav-right-cluster">
        {/* Contextual actions live on the far right (system-style
         *  actions like Settings, Downloads). Icon-only so they
         *  don't compete with the primary nav for attention. The
         *  Download button opens a popover (below) that lists every
         *  active and completed torrent; the Settings button uses
         *  NavLink so the "active" treatment matches the regular
         *  tabs. */}
        <div className="topnav-right">
          <button
            ref={downloadBtnRef}
            type="button"
            className={`topnav-btn topnav-btn-downloads${downloadsOpen ? " active" : ""}`}
            onClick={() => setDownloadsOpen((o) => !o)}
            aria-label={activeDownloads > 0 ? t("topnav.downloadsActive", { count: activeDownloads }) : t("nav.downloads")}
            aria-expanded={downloadsOpen}
            aria-haspopup="dialog"
            aria-controls={popoverId}
            title={t("nav.downloads")}
          >
            <DownloadIcon />
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
              // Restore focus to the trigger so keyboard users don't
              // get stranded after Escape / click-outside closes the
              // popover.
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
            <SettingsIcon />
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) =>
              `topnav-btn topnav-btn-docs${isActive ? " active" : ""}`
            }
            aria-label={t("nav.docs")}
            title={t("nav.docs")}
          >
            <DocIcon />
          </NavLink>
          <button
            type="button"
            className={`topnav-btn topnav-btn-bigscreen${isBigScreen ? " active" : ""}`}
            onClick={() => setBigScreen(!isBigScreen)}
            aria-label={isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen")}
            title={isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 18, height: 18 }}
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        </div>

        {/* Custom window controls (min / max / close) — see
         *  `./WindowControls.tsx` for the implementation. They live
         *  INSIDE `.topnav-right-cluster` so the divider on
         *  `.topnav-window-chrome`'s left edge renders flush against
         *  the settings cog, no wide-window drift to the geometric
         *  center of the row. */}
        <div className="topnav-window-chrome">
          <WindowControls />
        </div>
      </div>
    </nav>
  );
}
