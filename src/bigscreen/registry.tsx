// Big Screen section + route registry.
//
// The TV shell navigates six top-level sections. Everything else hangs
// off them:
//
//   Home      /home, /activity (alias)
//   Library   /library, /library/:gameId
//   Store     /store, /store/:gameSlug, /wishlist
//   Discover  /discover → /deals, /news, /community
//   Friends   /friends
//   System    /settings (tile hub) → downloads, storage, saves,
//             achievements, mods, emulators, docs
//
// Every big-screen route is declared once in BIGSCREEN_ROUTE_PAIRS as
// a { desktop, bigscreen? } pair. App.tsx maps over that table inside
// <ShellSwitch>, which renders the bigscreen variant when Big Screen
// Mode is active and the desktop factory otherwise. Route paths must
// stay identical to the desktop table: this file wires variants, it
// never changes the desktop route surface.

import type { ReactNode } from "react";
import { lazy } from "react";
import { Navigate } from "react-router-dom";
import { useBigScreen } from "../context/BigScreenContext";
import { ensureDocsLoaded, getActiveLocale } from "../i18n";

// The in-app guide strings (`docs.*`) ship in a per-locale pack, not the
// base dictionary. Both Docs routes await that pack inside their lazy
// factory so the route's Suspense skeleton covers it — the page then mounts
// fully translated instead of flashing raw keys.
const loadGuideStrings = () =>
  ensureDocsLoaded(getActiveLocale()).catch(() => {
    /* translate() falls back to English */
  });

// Desktop pages — each becomes its own Vite chunk via React.lazy.
const HomePage = lazy(() => import("../pages/HomePage"));
const LibraryPage = lazy(() => import("../pages/LibraryPage"));
const GamePage = lazy(() => import("../pages/GamePage"));
const StorePage = lazy(() => import("../pages/StorePage"));
const StoreGameDetail = lazy(() => import("../pages/StoreGameDetail"));
const CommunityPage = lazy(() => import("../pages/CommunityPage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const DocsPage = lazy(async () => {
  const [mod] = await Promise.all([import("../pages/DocsPage"), loadGuideStrings()]);
  return mod;
});
const FriendsPage = lazy(() => import("../pages/friends/FriendsPage"));
const ActivityPage = lazy(() => import("../pages/ActivityPage"));
const StoragePage = lazy(() => import("../pages/StoragePage"));
const WishlistPage = lazy(() => import("../pages/WishlistPage"));
const NewsPage = lazy(() => import("../pages/news/NewsPage"));
const DealsPage = lazy(() => import("../pages/deals/DealsPage"));
const DownloadsPage = lazy(() => import("../pages/DownloadsPage"));
const SavesPage = lazy(() => import("../pages/saves/SavesPage"));
const AchievementsPage = lazy(() => import("../pages/AchievementsPage"));
const EmulatorsPage = lazy(() => import("../pages/EmulatorsPage"));
const ModsPage = lazy(() => import("../pages/mods/ModsPage"));
const ModsDiscoverPage = lazy(() => import("../pages/mods/ModsDiscoverPage"));
const ReelsPage = lazy(() => import("../pages/ReelsPage"));

// Big Screen variants — bundled into the `bigscreen` chunk via
// vite.config.ts manualChunks, but still lazy so desktop never pays
// for their code until Big Screen Mode is active.
const BigScreenHome = lazy(() => import("../components/bigscreen/BigScreenHome"));
const BigScreenDiscover = lazy(
  () => import("../components/bigscreen/BigScreenDiscover"),
);
const BigScreenNews = lazy(() => import("../components/bigscreen/BigScreenNews"));
const BigScreenDeals = lazy(() => import("../components/bigscreen/BigScreenDeals"));
const BigScreenStore = lazy(() => import("../components/store/BigScreenStore"));
const BigScreenStoreGamePage = lazy(
  () => import("../components/store/BigScreenStoreGamePage"),
);
const BigScreenCommunity = lazy(
  () => import("../components/bigscreen/BigScreenCommunity"),
);
const BigScreenSystem = lazy(() => import("../components/bigscreen/BigScreenSystem"));
const BigScreenFriends = lazy(() => import("../components/bigscreen/BigScreenFriends"));
const BigScreenModsPage = lazy(
  () => import("../components/bigscreen/BigScreenModsPage"),
);
const BigScreenEmulatorsPage = lazy(
  () => import("../components/bigscreen/BigScreenEmulatorsPage"),
);
const BigScreenDocsPage = lazy(async () => {
  const [mod] = await Promise.all([
    import("../components/bigscreen/BigScreenDocsPage"),
    loadGuideStrings(),
  ]);
  return mod;
});
const BigScreenLibrary = lazy(
  () => import("../components/library/BigScreenLibrary"),
);
const BigScreenGamePage = lazy(
  () => import("../components/game/BigScreenGamePage"),
);
// Controller-safe chrome for routes without a dedicated variant yet.
const BigScreenDesktopFallback = lazy(
  () => import("../components/bigscreen/BigScreenDesktopFallback"),
);

// ── Icons ────────────────────────────────────────────────────────

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
  discover: <Icon><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></Icon>,
  wishlist: <Icon><path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" /></Icon>,
  deals: <Icon><path d="M20 12a2 2 0 0 0 0-4h-1a2 2 0 0 1-2-2V5a2 2 0 0 0-4 0 2 2 0 0 1-4 0 2 2 0 0 0-4 0v1a2 2 0 0 1-2 2 2 2 0 0 0 0 4 2 2 0 0 1 2 2v1a2 2 0 0 0 4 0 2 2 0 0 1 4 0 2 2 0 0 0 4 0v-1a2 2 0 0 1 2-2Z" /><path d="m9 15 6-6" /><path d="M9 9h.01M15 15h.01" /></Icon>,
  news: <Icon><path d="M5 4h14a2 2 0 0 1 2 2v14H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M7 8h10M7 12h10M7 16h6" /></Icon>,
  friends: <Icon><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3 3 0 0 1 0 6" /><path d="M18 14a5 5 0 0 1 3 6" /></Icon>,
  community: <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 3-4 3 2 5-7" /></Icon>,
  downloads: <Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon>,
  saves: <Icon><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></Icon>,
  storage: <Icon><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></Icon>,
  achievements: <Icon><circle cx="12" cy="8" r="5" /><path d="m8.5 12.5-1 8 4.5-2.5 4.5 2.5-1-8" /></Icon>,
  mods: <Icon><path d="M8 5h8l2 4v10H6V9l2-4Z" /><path d="M9 5v4h6V5" /><path d="M9 13h6M9 16h4" /></Icon>,
  emulators: <Icon><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 12h4M10 10v4M16 11h.01M18 13h.01" /></Icon>,
  docs: <Icon><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h8" /></Icon>,
  settings: <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-2.8-2.8.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.6 1Z" /></Icon>,
  activity: <Icon><path d="M3 12h4l3-8 4 16 3-8h4" /></Icon>,
} as const;

// ── Section model ────────────────────────────────────────────────

export type SectionId =
  | "home"
  | "library"
  | "store"
  | "discover"
  | "friends"
  | "system";

export interface BigScreenSection {
  id: SectionId;
  /** Route the section navigates to. */
  path: string;
  /** i18n key for the section label (reuses the desktop nav.* keys). */
  labelKey: string;
  /** Inline stroke icon (24×24 grid, currentColor). */
  icon: ReactNode;
  /** Paths that belong to this section, longest-prefix wins. */
  matches: readonly string[];
}

/** The six top-level sections, ordered by expected frequency of use. */
export const PRIMARY_SECTIONS: BigScreenSection[] = [
  {
    id: "home",
    path: "/home",
    labelKey: "nav.home",
    icon: ICONS.home,
    matches: ["/home", "/activity"],
  },
  {
    id: "library",
    path: "/library",
    labelKey: "nav.library",
    icon: ICONS.library,
    matches: ["/library"],
  },
  {
    id: "store",
    path: "/store",
    labelKey: "nav.store",
    icon: ICONS.store,
    matches: ["/store", "/wishlist"],
  },
  {
    id: "discover",
    path: "/discover",
    labelKey: "bigscreen.discover.title",
    icon: ICONS.discover,
    matches: ["/discover", "/deals", "/news", "/community"],
  },
  {
    id: "friends",
    path: "/friends",
    labelKey: "nav.friends",
    icon: ICONS.friends,
    matches: ["/friends"],
  },
  {
    id: "system",
    path: "/settings",
    labelKey: "bigscreen.shell.system",
    icon: ICONS.settings,
    matches: [
      "/settings",
      "/downloads",
      "/storage",
      "/saves",
      "/achievements",
      "/mods",
      "/emulators",
      "/docs",
      "/reels",
    ],
  },
];

export const SECTION_BY_ID = new Map(
  PRIMARY_SECTIONS.map((section) => [section.id, section]),
);

/** Entries behind the System hub (its tile grid, in display order). */
export const SYSTEM_SECTIONS: BigScreenSection[] = [
  { id: "system", path: "/downloads", labelKey: "nav.downloads", icon: ICONS.downloads, matches: ["/downloads"] },
  { id: "system", path: "/storage", labelKey: "nav.storage", icon: ICONS.storage, matches: ["/storage"] },
  { id: "system", path: "/saves", labelKey: "nav.saves", icon: ICONS.saves, matches: ["/saves"] },
  { id: "system", path: "/achievements", labelKey: "nav.achievements", icon: ICONS.achievements, matches: ["/achievements"] },
  { id: "system", path: "/mods", labelKey: "nav.mods", icon: ICONS.mods, matches: ["/mods"] },
  { id: "system", path: "/emulators", labelKey: "nav.emulators", icon: ICONS.emulators, matches: ["/emulators"] },
  { id: "system", path: "/docs", labelKey: "nav.docs", icon: ICONS.docs, matches: ["/docs"] },
  { id: "system", path: "/settings", labelKey: "bigscreen.system.preferences", icon: ICONS.settings, matches: ["/settings"] },
];

/** Every navigable entry, primary first. */
export const SECTIONS: BigScreenSection[] = [
  ...PRIMARY_SECTIONS,
  ...SYSTEM_SECTIONS,
];

/** Discover's three areas, in tab order. */
export interface DiscoverArea {
  path: string;
  labelKey: string;
  blurbKey: string;
  icon: ReactNode;
}

export const DISCOVER_AREAS: DiscoverArea[] = [
  { path: "/deals", labelKey: "nav.deals", blurbKey: "bigscreen.discover.dealsBlurb", icon: ICONS.deals },
  { path: "/news", labelKey: "nav.news", blurbKey: "bigscreen.discover.newsBlurb", icon: ICONS.news },
  { path: "/community", labelKey: "bigscreen.discover.community", blurbKey: "bigscreen.discover.communityBlurb", icon: ICONS.community },
];

function normalize(pathname: string): string {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return path || "/";
}

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

/**
 * Resolve a pathname to its section. Matches on segment boundaries so
 * `/storage` (System) never lights `/store`, and `/library/:id` keeps
 * the library section active.
 */
export function sectionForPath(pathname: string): SectionId {
  const path = normalize(pathname);
  // Longest matching prefix wins (e.g. `/mods/discover` is still System).
  let best: { id: SectionId; length: number } | null = null;
  for (const section of PRIMARY_SECTIONS) {
    for (const base of section.matches) {
      if (within(path, base) && (!best || base.length > best.length)) {
        best = { id: section.id, length: base.length };
      }
    }
  }
  return best?.id ?? "home";
}

/** Path of the section that owns `pathname` (used for nav highlight). */
export function getActiveTabPath(pathname: string): string {
  const section = SECTION_BY_ID.get(sectionForPath(pathname));
  return section?.path ?? "/home";
}

/** The section record owning `pathname`. */
export function activeSection(pathname: string): BigScreenSection {
  return SECTION_BY_ID.get(sectionForPath(pathname)) ?? PRIMARY_SECTIONS[0];
}

/**
 * Resolve a Big Screen pathname to the route Back should return to.
 *
 *   • `/library/<id>`   → `/library`
 *   • `/store/<slug>`   → `/store`
 *   • `/settings/<tab>` → `/settings`
 *   • `/mods/discover`  → `/mods`
 *   • `/deals`, `/news`, `/community` → `/discover` (the hub)
 *   • `/mods`, `/emulators`, `/docs`, `/saves`, `/downloads`,
 *     `/storage`, `/achievements` → `/settings` (the System hub)
 *   • `/emulators/<id>` → `/emulators`
 *   • everything else   → `null` (top-level: Back offers the exit)
 */
export function bigScreenParentOf(pathname: string): string | null {
  const path = normalize(pathname);
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 2) {
    if (segments[0] === "library") return "/library";
    if (segments[0] === "store") return "/store";
    if (segments[0] === "mods") return "/mods";
    if (segments[0] === "settings") return "/settings";
    if (segments[0] === "emulators") return "/emulators";
  }

  if (segments.length === 1) {
    const [segment] = segments;
    if (segment === "deals" || segment === "news" || segment === "community") {
      return "/discover";
    }
    if (
      segment === "mods" ||
      segment === "emulators" ||
      segment === "docs" ||
      segment === "saves" ||
      segment === "downloads" ||
      segment === "storage" ||
      segment === "achievements"
    ) {
      return "/settings";
    }
    if (segment === "activity") return "/home";
  }

  return null;
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
 * `bigscreen` variant fall through to the desktop page.
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
 * as the historical App.tsx table, with the Discover hub added.
 */
export const BIGSCREEN_ROUTE_PAIRS: RoutePair[] = [
  { path: "home", desktop: () => <HomePage />, bigscreen: () => <BigScreenHome /> },
  { path: "library", desktop: () => <LibraryPage />, bigscreen: () => <BigScreenLibrary /> },
  { path: "library/:gameId", desktop: () => <GamePage />, bigscreen: () => <BigScreenGamePage /> },
  { path: "wishlist", desktop: () => <WishlistPage />, bigscreen: () => <BigScreenStore /> },
  // Discover hub: the desktop app keeps Deals/News/Community as their
  // own pages, so the canonical desktop target is Deals.
  { path: "discover", desktop: () => <Navigate to="/deals" replace />, bigscreen: () => <BigScreenDiscover /> },
  { path: "news", desktop: () => <NewsPage />, bigscreen: () => <BigScreenNews /> },
  { path: "deals", desktop: () => <DealsPage />, bigscreen: () => <BigScreenDeals /> },
  { path: "activity", desktop: () => <ActivityPage />, bigscreen: () => <BigScreenHome /> },
  { path: "achievements", desktop: () => <AchievementsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "downloads", desktop: () => <DownloadsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "storage", desktop: () => <StoragePage />, bigscreen: () => <BigScreenSystem /> },
  { path: "saves", desktop: () => <SavesPage />, bigscreen: () => <BigScreenDesktopFallback titleKey="nav.saves"><SavesPage /></BigScreenDesktopFallback> },
  { path: "store", desktop: () => <StorePage />, bigscreen: () => <BigScreenStore /> },
  { path: "store/:gameSlug", desktop: () => <StoreGameDetail />, bigscreen: () => <BigScreenStoreGamePage /> },
  { path: "community", desktop: () => <CommunityPage />, bigscreen: () => <BigScreenCommunity /> },
  { path: "friends", desktop: () => <FriendsPage />, bigscreen: () => <BigScreenFriends /> },
  { path: "emulators", desktop: () => <EmulatorsPage />, bigscreen: () => <BigScreenEmulatorsPage /> },
  { path: "emulators/:emulatorId", desktop: () => <EmulatorsPage />, bigscreen: () => <BigScreenEmulatorsPage /> },
  { path: "mods", desktop: () => <ModsPage />, bigscreen: () => <BigScreenModsPage /> },
  { path: "mods/discover", desktop: () => <ModsDiscoverPage />, bigscreen: () => <BigScreenDesktopFallback titleKey="mods.discover.title" subtitleKey="mods.discover.subtitle"><ModsDiscoverPage /></BigScreenDesktopFallback> },
  { path: "reels", desktop: () => <ReelsPage />, bigscreen: () => <BigScreenDesktopFallback titleKey="reels.title" subtitleKey="reels.subtitle"><ReelsPage /></BigScreenDesktopFallback> },
  { path: "settings", desktop: () => <SettingsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "settings/:tab", desktop: () => <SettingsPage />, bigscreen: () => <BigScreenSystem /> },
  { path: "docs", desktop: () => <DocsPage />, bigscreen: () => <BigScreenDocsPage /> },
];
