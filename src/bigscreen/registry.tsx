// Big Screen v3 — section/route registry + ShellSwitch.
//
// The console shell's navigation is driven by two ordered lists:
//   • PRIMARY_SECTIONS — the 8 top-level sections in the header strip.
//   • SYSTEM_SECTIONS  — the 7 entries behind the System hub entry.
//
// Every big-screen route is declared once in BIGSCREEN_ROUTE_PAIRS as a
// { desktop, bigscreen? } element-factory pair. App.tsx maps over that
// table inside <ShellSwitch>, which renders the bigscreen factory when
// Big Screen is active and falls back to the desktop factory otherwise —
// so a route whose `bigscreen` is still undefined (owned by a later
// lane) keeps working through the desktop page's internal swap.
//
// Route paths must stay identical to the pre-registry table: this file
// only moves the wiring, it never adds or removes routes.

import type { ReactNode } from "react";
import { useBigScreen } from "../context/BigScreenContext";

import HomePage from "../pages/HomePage";
import LibraryPage from "../pages/LibraryPage";
import GamePage from "../pages/GamePage";
import StorePage from "../pages/StorePage";
import StoreGameDetail from "../pages/StoreGameDetail";
import CommunityPage from "../pages/CommunityPage";
import SettingsPage from "../pages/SettingsPage";
import DocsPage from "../pages/DocsPage";
import FriendsPage from "../pages/FriendsPage";
import ActivityPage from "../pages/ActivityPage";
import StoragePage from "../pages/StoragePage";
import WishlistPage from "../pages/WishlistPage";
import NewsPage from "../pages/NewsPage";
import DealsPage from "../pages/deals/DealsPage";
import DownloadsPage from "../pages/DownloadsPage";
import AchievementsPage from "../pages/AchievementsPage";
import EmulatorsPage from "../pages/EmulatorsPage";
import ModsPage from "../pages/mods/ModsPage";

import BigScreenHome from "../components/bigscreen/BigScreenHome";
import BigScreenNews from "../components/bigscreen/BigScreenNews";
import BigScreenDeals from "../components/bigscreen/BigScreenDeals";
import BigScreenStore from "../components/store/BigScreenStore";
import BigScreenStoreGamePage from "../components/store/BigScreenStoreGamePage";
import BigScreenCommunity from "../components/bigscreen/BigScreenCommunity";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";
import BigScreenFriends from "../components/bigscreen/BigScreenFriends";
import BigScreenModsPage from "../components/bigscreen/BigScreenModsPage";
import BigScreenEmulatorsPage from "../components/bigscreen/BigScreenEmulatorsPage";
import BigScreenDocsPage from "../components/bigscreen/BigScreenDocsPage";
import BigScreenLibrary from "../components/library/BigScreenLibrary";
import BigScreenGamePage from "../components/game/BigScreenGamePage";

// ── Section model ─────────────────────────────────────────────────

export interface BigScreenSection {
  /** Route the section navigates to. */
  path: string;
  /** i18n key for the section label (reuses the desktop nav.* keys). */
  labelKey: string;
  /** Inline stroke icon (24×24 grid, currentColor). */
  icon: ReactNode;
}

/** Minimal inline-SVG wrapper shared by every section/utility icon. */
function Icon({ children }: { children: ReactNode }) {
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

const ICONS = {
  home: <Icon><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></Icon>,
  library: <Icon><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 18v3" /></Icon>,
  store: <Icon><path d="M4 8h16l-1 12H5L4 8Z" /><path d="m7 8 2-5h6l2 5" /><path d="M9 12h6" /></Icon>,
  wishlist: <Icon><path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" /></Icon>,
  deals: <Icon><path d="M20 12a2 2 0 0 0 0-4h-1a2 2 0 0 1-2-2V5a2 2 0 0 0-4 0 2 2 0 0 1-4 0 2 2 0 0 0-4 0v1a2 2 0 0 1-2 2 2 2 0 0 0 0 4 2 2 0 0 1 2 2v1a2 2 0 0 0 4 0 2 2 0 0 1 4 0 2 2 0 0 0 4 0v-1a2 2 0 0 1 2-2Z" /><path d="m9 15 6-6" /><path d="M9 9h.01M15 15h.01" /></Icon>,
  news: <Icon><path d="M5 4h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M7 8h10M7 12h10M7 16h6" /></Icon>,
  friends: <Icon><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6" /><path d="M18 14a5 5 0 0 1 3 6" /></Icon>,
  community: <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></Icon>,
  downloads: <Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon>,
  storage: <Icon><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></Icon>,
  achievements: <Icon><circle cx="12" cy="8" r="5" /><path d="m8.5 12.5-1 8 4.5-2.5 4.5 2.5-1-8" /></Icon>,
  mods: <Icon><path d="M8 5h8l2 4v10H6V9l2-4Z" /><path d="M9 5v4h6V5" /><path d="M9 13h6M9 16h4" /></Icon>,
  emulators: <Icon><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" /></Icon>,
  docs: <Icon><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h8" /></Icon>,
  settings: <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" /></Icon>,
} as const;

// ── Section lists ────────────────────────────────────────────────

/** Top-level strip, ordered by expected frequency of use. */
export const PRIMARY_SECTIONS: BigScreenSection[] = [
  { path: "/home", labelKey: "nav.home", icon: ICONS.home },
  { path: "/library", labelKey: "nav.library", icon: ICONS.library },
  { path: "/store", labelKey: "nav.store", icon: ICONS.store },
  { path: "/wishlist", labelKey: "nav.wishlist", icon: ICONS.wishlist },
  { path: "/deals", labelKey: "nav.deals", icon: ICONS.deals },
  { path: "/news", labelKey: "nav.news", icon: ICONS.news },
  { path: "/friends", labelKey: "nav.friends", icon: ICONS.friends },
  { path: "/community", labelKey: "nav.stats", icon: ICONS.community },
];

/** Entries behind the System hub entry (the "system submenu"). */
export const SYSTEM_SECTIONS: BigScreenSection[] = [
  { path: "/downloads", labelKey: "nav.downloads", icon: ICONS.downloads },
  { path: "/storage", labelKey: "nav.storage", icon: ICONS.storage },
  { path: "/achievements", labelKey: "nav.achievements", icon: ICONS.achievements },
  { path: "/mods", labelKey: "nav.mods", icon: ICONS.mods },
  { path: "/emulators", labelKey: "nav.emulators", icon: ICONS.emulators },
  { path: "/settings", labelKey: "nav.settings", icon: ICONS.settings },
  { path: "/docs", labelKey: "nav.docs", icon: ICONS.docs },
];

/** Every navigable section, primary first. */
export const SECTIONS: BigScreenSection[] = [
  ...PRIMARY_SECTIONS,
  ...SYSTEM_SECTIONS,
];

/** The System hub entry rendered as the strip's 9th slot. */
export const SYSTEM_ENTRY: BigScreenSection = {
  path: "/settings",
  labelKey: "bigscreen.shell.system",
  icon: ICONS.settings,
};

/**
 * Resolve a pathname to the active primary section path. Matches on
 * segment boundaries (`/store` and `/store/:slug` light up /store,
 * but `/storage` does NOT match /store). Falls back to `/home`.
 */
export function getActiveTabPath(pathname: string): string {
  return (
    PRIMARY_SECTIONS.find(
      (section) =>
        pathname === section.path || pathname.startsWith(section.path + "/"),
    )?.path ?? "/home"
  );
}

// ── ShellSwitch ──────────────────────────────────────────────────

interface ShellSwitchProps {
  /** Always-rendered desktop page (also the bigscreen fallback). */
  desktop: ReactNode;
  /** Optional controller-first variant shown when Big Screen is on. */
  bigscreen?: ReactNode;
}

/**
 * Route-level switcher: renders the bigscreen variant when Big Screen
 * Mode is active, otherwise the desktop page. Routes without a
 * `bigscreen` variant fall through to the desktop page, which still
 * performs its own internal bigscreen swap until a later lane wires it.
 */
export function ShellSwitch({ desktop, bigscreen }: ShellSwitchProps) {
  const { isBigScreen } = useBigScreen();
  return <>{isBigScreen ? bigscreen ?? desktop : desktop}</>;
}

// ── Route table ──────────────────────────────────────────────────

export interface RoutePair {
  /** Route path (no leading slash — React Router child route). */
  path: string;
  /** Factory for the desktop page. */
  desktop: () => ReactNode;
  /** Factory for the controller-first variant (optional). */
  bigscreen?: () => ReactNode;
}

/**
 * Single source of truth for the route table. Kept in the same order
 * as the historical App.tsx table. Routes with a `bigscreen` variant
 * are wired here; the rest fall back to the desktop page.
 */
export const BIGSCREEN_ROUTE_PAIRS: RoutePair[] = [
  { path: "home", desktop: () => <HomePage />, bigscreen: () => <BigScreenHome /> },
  { path: "library", desktop: () => <LibraryPage />, bigscreen: () => <BigScreenLibrary /> },
  { path: "library/:gameId", desktop: () => <GamePage />, bigscreen: () => <BigScreenGamePage /> },
  { path: "wishlist", desktop: () => <WishlistPage />, bigscreen: () => <BigScreenStore /> },
  { path: "news", desktop: () => <NewsPage />, bigscreen: () => <BigScreenNews /> },
  { path: "deals", desktop: () => <DealsPage />, bigscreen: () => <BigScreenDeals /> },
  { path: "activity", desktop: () => <ActivityPage />, bigscreen: () => <BigScreenHome /> },
  { path: "achievements", desktop: () => <AchievementsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "downloads", desktop: () => <DownloadsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "storage", desktop: () => <StoragePage />, bigscreen: () => <BigScreenSystem /> },
  { path: "store", desktop: () => <StorePage />, bigscreen: () => <BigScreenStore /> },
  { path: "store/:gameSlug", desktop: () => <StoreGameDetail />, bigscreen: () => <BigScreenStoreGamePage /> },
  { path: "community", desktop: () => <CommunityPage />, bigscreen: () => <BigScreenCommunity /> },
  { path: "friends", desktop: () => <FriendsPage />, bigscreen: () => <BigScreenFriends /> },
  { path: "emulators", desktop: () => <EmulatorsPage />, bigscreen: () => <BigScreenEmulatorsPage /> },
  { path: "mods", desktop: () => <ModsPage />, bigscreen: () => <BigScreenModsPage /> },
  { path: "settings", desktop: () => <SettingsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "settings/:tab", desktop: () => <SettingsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "docs", desktop: () => <DocsPage />, bigscreen: () => <BigScreenDocsPage /> },
];
