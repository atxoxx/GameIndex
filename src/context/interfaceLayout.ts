// interfaceLayout — the shared model behind the Interface settings tab and
// the Layout Studio modal.
//
// The Interface settings surface lets the user hide and rearrange the app's
// chrome. This module is the single declaration of *what* can be arranged so
// the settings tab, the studio modal and the runtime bridge (PageLayoutBridge)
// all agree on the same keys, shipped order and localStorage normalization:
//
//  • PageWidgetKey     — the page-level widget categories pages already mark
//                        with `.ui-item-*` classes (see theme.css). The studio
//                        can hide and reorder them per page.
//  • InterfacePageKey  — one entry per app page, plus "global" for the header
//                        and sidebar chrome shared by every page.
//  • SidebarSectionKey — the sidebar's top-level elements.
//
// localStorage is append-only, so the normalizers below drop unknown keys and
// append anything new — an upgrade never leaves a freshly-added element
// unrendered.

// ── Page widgets ────────────────────────────────────────────────────────────

/** Widget categories a page can render. Mirrors the `.ui-item-*` markers. */
export type PageWidgetKey =
  // Generic legacy / shared
  | "hero"
  | "kpis"
  | "filters"
  | "subtabs"
  | "dashboard"
  // Home
  | "homeQuickStats"
  | "homeContinuePlaying"
  | "homeRecentlyAdded"
  | "homeQuickLaunch"
  | "homeActivity"
  | "homeAchievements"
  | "homeFriends"
  | "homeDownloads"
  | "homeWishlist"
  | "homeDeals"
  | "homeNews"
  // Library
  | "libContinuePlaying"
  | "libRecentlyAdded"
  | "libToolbar"
  | "libFilterChips"
  | "libPresets"
  | "libFilterRail"
  | "libGrid"
  // Game Detail
  | "gameHero"
  | "gameTabs"
  | "gameQuickStats"
  | "gameAbout"
  | "gameStoryline"
  | "gameMedia"
  | "gameSysReq"
  | "gameRelations"
  | "gamePulse"
  | "gameSidebarKpis"
  | "gameSpecs"
  // Store
  | "storeHeader"
  | "storeFilters"
  | "storeToolbar"
  | "storeGrid"
  // Wishlist
  | "wishlistHeader"
  | "wishlistToolbar"
  | "wishlistGrid"
  // Deals
  | "dealsHeader"
  | "dealsGrid"
  // News
  | "newsHeader"
  | "newsToolbar"
  | "newsGrid"
  // Activity
  | "activityHeader"
  | "activityToolbar"
  | "activityKpis"
  | "activityPersona"
  | "activityRecords"
  | "activityChart"
  | "activityInsights"
  | "activityBacklog"
  | "activityBreakdown"
  // Storage
  | "storageHeader"
  | "storageHero"
  | "storageControls"
  | "storageList"
  // Downloads
  | "downloadsHeader"
  | "downloadsHero"
  | "downloadsSparkline"
  | "downloadsFilter"
  | "downloadsQueue"
  // Achievements
  | "achievementsHeader"
  | "achievementsHero"
  | "achievementsCharts"
  | "achievementsSourceBreakdown"
  | "achievementsShelves"
  | "achievementsList"
  // Friends
  | "friendsHeader"
  | "friendsHero"
  | "friendsTabs"
  // Emulators
  | "emuHeader"
  | "emuStats"
  | "emuSidebar"
  | "emuDetail"
  // Mods
  | "modsHeader"
  | "modsCockpit"
  | "modsRail"
  | "modsWorkspace"
  // Community
  | "communityHeader"
  | "communityTabs"
  | "communityContent";

export const PAGE_WIDGET_KEYS: PageWidgetKey[] = [
  "hero",
  "kpis",
  "filters",
  "subtabs",
  "dashboard",
  // Home
  "homeQuickStats",
  "homeContinuePlaying",
  "homeRecentlyAdded",
  "homeQuickLaunch",
  "homeActivity",
  "homeAchievements",
  "homeFriends",
  "homeDownloads",
  "homeWishlist",
  "homeDeals",
  "homeNews",
  // Library
  "libContinuePlaying",
  "libRecentlyAdded",
  "libToolbar",
  "libFilterChips",
  "libPresets",
  "libFilterRail",
  "libGrid",
  // Game Detail
  "gameHero",
  "gameTabs",
  "gameQuickStats",
  "gameAbout",
  "gameStoryline",
  "gameMedia",
  "gameSysReq",
  "gameRelations",
  "gamePulse",
  "gameSidebarKpis",
  "gameSpecs",
  // Store
  "storeHeader",
  "storeFilters",
  "storeToolbar",
  "storeGrid",
  // Wishlist
  "wishlistHeader",
  "wishlistToolbar",
  "wishlistGrid",
  // Deals
  "dealsHeader",
  "dealsGrid",
  // News
  "newsHeader",
  "newsToolbar",
  "newsGrid",
  // Activity
  "activityHeader",
  "activityToolbar",
  "activityKpis",
  "activityPersona",
  "activityRecords",
  "activityChart",
  "activityInsights",
  "activityBacklog",
  "activityBreakdown",
  // Storage
  "storageHeader",
  "storageHero",
  "storageControls",
  "storageList",
  // Downloads
  "downloadsHeader",
  "downloadsHero",
  "downloadsSparkline",
  "downloadsFilter",
  "downloadsQueue",
  // Achievements
  "achievementsHeader",
  "achievementsHero",
  "achievementsCharts",
  "achievementsSourceBreakdown",
  "achievementsShelves",
  "achievementsList",
  // Friends
  "friendsHeader",
  "friendsHero",
  "friendsTabs",
  // Emulators
  "emuHeader",
  "emuStats",
  "emuSidebar",
  "emuDetail",
  // Mods
  "modsHeader",
  "modsCockpit",
  "modsRail",
  "modsWorkspace",
  // Community
  "communityHeader",
  "communityTabs",
  "communityContent",
];

/** Widget key → the CSS class the pages mark their blocks with. */
export const WIDGET_CLASS: Record<PageWidgetKey, string> = {
  hero: "ui-item-hero",
  kpis: "ui-item-kpis",
  filters: "ui-item-filters",
  subtabs: "ui-item-subtabs",
  dashboard: "ui-item-dashboard",
  // Home
  homeQuickStats: "ui-item-homeQuickStats",
  homeContinuePlaying: "ui-item-homeContinuePlaying",
  homeRecentlyAdded: "ui-item-homeRecentlyAdded",
  homeQuickLaunch: "ui-item-homeQuickLaunch",
  homeActivity: "ui-item-homeActivity",
  homeAchievements: "ui-item-homeAchievements",
  homeFriends: "ui-item-homeFriends",
  homeDownloads: "ui-item-homeDownloads",
  homeWishlist: "ui-item-homeWishlist",
  homeDeals: "ui-item-homeDeals",
  homeNews: "ui-item-homeNews",
  // Library
  libContinuePlaying: "ui-item-libContinuePlaying",
  libRecentlyAdded: "ui-item-libRecentlyAdded",
  libToolbar: "ui-item-libToolbar",
  libFilterChips: "ui-item-libFilterChips",
  libPresets: "ui-item-libPresets",
  libFilterRail: "ui-item-libFilterRail",
  libGrid: "ui-item-libGrid",
  // Game Detail
  gameHero: "ui-item-gameHero",
  gameTabs: "ui-item-gameTabs",
  gameQuickStats: "ui-item-gameQuickStats",
  gameAbout: "ui-item-gameAbout",
  gameStoryline: "ui-item-gameStoryline",
  gameMedia: "ui-item-gameMedia",
  gameSysReq: "ui-item-gameSysReq",
  gameRelations: "ui-item-gameRelations",
  gamePulse: "ui-item-gamePulse",
  gameSidebarKpis: "ui-item-gameSidebarKpis",
  gameSpecs: "ui-item-gameSpecs",
  // Store
  storeHeader: "ui-item-storeHeader",
  storeFilters: "ui-item-storeFilters",
  storeToolbar: "ui-item-storeToolbar",
  storeGrid: "ui-item-storeGrid",
  // Wishlist
  wishlistHeader: "ui-item-wishlistHeader",
  wishlistToolbar: "ui-item-wishlistToolbar",
  wishlistGrid: "ui-item-wishlistGrid",
  // Deals
  dealsHeader: "ui-item-dealsHeader",
  dealsGrid: "ui-item-dealsGrid",
  // News
  newsHeader: "ui-item-newsHeader",
  newsToolbar: "ui-item-newsToolbar",
  newsGrid: "ui-item-newsGrid",
  // Activity
  activityHeader: "ui-item-activityHeader",
  activityToolbar: "ui-item-activityToolbar",
  activityKpis: "ui-item-activityKpis",
  activityPersona: "ui-item-activityPersona",
  activityRecords: "ui-item-activityRecords",
  activityChart: "ui-item-activityChart",
  activityInsights: "ui-item-activityInsights",
  activityBacklog: "ui-item-activityBacklog",
  activityBreakdown: "ui-item-activityBreakdown",
  // Storage
  storageHeader: "ui-item-storageHeader",
  storageHero: "ui-item-storageHero",
  storageControls: "ui-item-storageControls",
  storageList: "ui-item-storageList",
  // Downloads
  downloadsHeader: "ui-item-downloadsHeader",
  downloadsHero: "ui-item-downloadsHero",
  downloadsSparkline: "ui-item-downloadsSparkline",
  downloadsFilter: "ui-item-downloadsFilter",
  downloadsQueue: "ui-item-downloadsQueue",
  // Achievements
  achievementsHeader: "ui-item-achievementsHeader",
  achievementsHero: "ui-item-achievementsHero",
  achievementsCharts: "ui-item-achievementsCharts",
  achievementsSourceBreakdown: "ui-item-achievementsSourceBreakdown",
  achievementsShelves: "ui-item-achievementsShelves",
  achievementsList: "ui-item-achievementsList",
  // Friends
  friendsHeader: "ui-item-friendsHeader",
  friendsHero: "ui-item-friendsHero",
  friendsTabs: "ui-item-friendsTabs",
  // Emulators
  emuHeader: "ui-item-emuHeader",
  emuStats: "ui-item-emuStats",
  emuSidebar: "ui-item-emuSidebar",
  emuDetail: "ui-item-emuDetail",
  // Mods
  modsHeader: "ui-item-modsHeader",
  modsCockpit: "ui-item-modsCockpit",
  modsRail: "ui-item-modsRail",
  modsWorkspace: "ui-item-modsWorkspace",
  // Community
  communityHeader: "ui-item-communityHeader",
  communityTabs: "ui-item-communityTabs",
  communityContent: "ui-item-communityContent",
};

/** Widget key → translation key used in the settings UI. */
export const WIDGET_LABEL_KEY: Record<PageWidgetKey, string> = {
  hero: "settings.interface.widgetHero",
  kpis: "settings.interface.widgetKpis",
  filters: "settings.interface.widgetFilters",
  subtabs: "settings.interface.widgetSubtabs",
  dashboard: "settings.interface.widgetDashboard",
  // Home
  homeQuickStats: "settings.interface.widgetHomeQuickStats",
  homeContinuePlaying: "settings.interface.widgetHomeContinuePlaying",
  homeRecentlyAdded: "settings.interface.widgetHomeRecentlyAdded",
  homeQuickLaunch: "settings.interface.widgetHomeQuickLaunch",
  homeActivity: "settings.interface.widgetHomeActivity",
  homeAchievements: "settings.interface.widgetHomeAchievements",
  homeFriends: "settings.interface.widgetHomeFriends",
  homeDownloads: "settings.interface.widgetHomeDownloads",
  homeWishlist: "settings.interface.widgetHomeWishlist",
  homeDeals: "settings.interface.widgetHomeDeals",
  homeNews: "settings.interface.widgetHomeNews",
  // Library
  libContinuePlaying: "settings.interface.widgetLibContinuePlaying",
  libRecentlyAdded: "settings.interface.widgetLibRecentlyAdded",
  libToolbar: "settings.interface.widgetLibToolbar",
  libFilterChips: "settings.interface.widgetLibFilterChips",
  libPresets: "settings.interface.widgetLibPresets",
  libFilterRail: "settings.interface.widgetLibFilterRail",
  libGrid: "settings.interface.widgetLibGrid",
  // Game Detail
  gameHero: "settings.interface.widgetGameHero",
  gameTabs: "settings.interface.widgetGameTabs",
  gameQuickStats: "settings.interface.widgetGameQuickStats",
  gameAbout: "settings.interface.widgetGameAbout",
  gameStoryline: "settings.interface.widgetGameStoryline",
  gameMedia: "settings.interface.widgetGameMedia",
  gameSysReq: "settings.interface.widgetGameSysReq",
  gameRelations: "settings.interface.widgetGameRelations",
  gamePulse: "settings.interface.widgetGamePulse",
  gameSidebarKpis: "settings.interface.widgetGameSidebarKpis",
  gameSpecs: "settings.interface.widgetGameSpecs",
  // Store
  storeHeader: "settings.interface.widgetStoreHeader",
  storeFilters: "settings.interface.widgetStoreFilters",
  storeToolbar: "settings.interface.widgetStoreToolbar",
  storeGrid: "settings.interface.widgetStoreGrid",
  // Wishlist
  wishlistHeader: "settings.interface.widgetWishlistHeader",
  wishlistToolbar: "settings.interface.widgetWishlistToolbar",
  wishlistGrid: "settings.interface.widgetWishlistGrid",
  // Deals
  dealsHeader: "settings.interface.widgetDealsHeader",
  dealsGrid: "settings.interface.widgetDealsGrid",
  // News
  newsHeader: "settings.interface.widgetNewsHeader",
  newsToolbar: "settings.interface.widgetNewsToolbar",
  newsGrid: "settings.interface.widgetNewsGrid",
  // Activity
  activityHeader: "settings.interface.widgetActivityHeader",
  activityToolbar: "settings.interface.widgetActivityToolbar",
  activityKpis: "settings.interface.widgetActivityKpis",
  activityPersona: "settings.interface.widgetActivityPersona",
  activityRecords: "settings.interface.widgetActivityRecords",
  activityChart: "settings.interface.widgetActivityChart",
  activityInsights: "settings.interface.widgetActivityInsights",
  activityBacklog: "settings.interface.widgetActivityBacklog",
  activityBreakdown: "settings.interface.widgetActivityBreakdown",
  // Storage
  storageHeader: "settings.interface.widgetStorageHeader",
  storageHero: "settings.interface.widgetStorageHero",
  storageControls: "settings.interface.widgetStorageControls",
  storageList: "settings.interface.widgetStorageList",
  // Downloads
  downloadsHeader: "settings.interface.widgetDownloadsHeader",
  downloadsHero: "settings.interface.widgetDownloadsHero",
  downloadsSparkline: "settings.interface.widgetDownloadsSparkline",
  downloadsFilter: "settings.interface.widgetDownloadsFilter",
  downloadsQueue: "settings.interface.widgetDownloadsQueue",
  // Achievements
  achievementsHeader: "settings.interface.widgetAchievementsHeader",
  achievementsHero: "settings.interface.widgetAchievementsHero",
  achievementsCharts: "settings.interface.widgetAchievementsCharts",
  achievementsSourceBreakdown: "settings.interface.widgetAchievementsSourceBreakdown",
  achievementsShelves: "settings.interface.widgetAchievementsShelves",
  achievementsList: "settings.interface.widgetAchievementsList",
  // Friends
  friendsHeader: "settings.interface.widgetFriendsHeader",
  friendsHero: "settings.interface.widgetFriendsHero",
  friendsTabs: "settings.interface.widgetFriendsTabs",
  // Emulators
  emuHeader: "settings.interface.widgetEmuHeader",
  emuStats: "settings.interface.widgetEmuStats",
  emuSidebar: "settings.interface.widgetEmuSidebar",
  emuDetail: "settings.interface.widgetEmuDetail",
  // Mods
  modsHeader: "settings.interface.widgetModsHeader",
  modsCockpit: "settings.interface.widgetModsCockpit",
  modsRail: "settings.interface.widgetModsRail",
  modsWorkspace: "settings.interface.widgetModsWorkspace",
  // Community
  communityHeader: "settings.interface.widgetCommunityHeader",
  communityTabs: "settings.interface.widgetCommunityTabs",
  communityContent: "settings.interface.widgetCommunityContent",
};

// ── Pages ───────────────────────────────────────────────────────────────────

export type InterfacePageKey =
  | "global"
  | "home"
  | "library"
  | "game"
  | "store"
  | "wishlist"
  | "deals"
  | "news"
  | "activity"
  | "achievements"
  | "downloads"
  | "storage"
  | "community"
  | "friends"
  | "emulators"
  | "mods";

export interface InterfacePageDef {
  key: InterfacePageKey;
  /** Label shown on the studio's page tabs. */
  labelKey: string;
  /** Route prefixes owned by this page; `""` means "never matched". */
  routes: string[];
  /** Widget categories the page actually renders, in shipped order. */
  items: PageWidgetKey[];
}

/**
 * Page registry. `items` lists only the categories each page really marks so
 * the studio never offers a toggle that would be a no-op.
 */
export const INTERFACE_PAGES: InterfacePageDef[] = [
  { key: "global", labelKey: "settings.interface.studioPageGlobal", routes: [], items: [] },
  {
    key: "home",
    labelKey: "nav.home",
    routes: ["/home"],
    items: [
      "hero",
      "homeQuickStats",
      "homeContinuePlaying",
      "homeRecentlyAdded",
      "homeQuickLaunch",
      "homeActivity",
      "homeAchievements",
      "homeFriends",
      "homeDownloads",
      "homeWishlist",
      "homeDeals",
      "homeNews",
    ],
  },
  {
    key: "library",
    labelKey: "nav.library",
    routes: ["/library"],
    items: [
      "hero",
      "libContinuePlaying",
      "libRecentlyAdded",
      "libToolbar",
      "libFilterChips",
      "libPresets",
      "libFilterRail",
      "libGrid",
    ],
  },
  {
    key: "game",
    labelKey: "settings.interface.studioPageGame",
    routes: ["/library/"],
    items: [
      "gameHero",
      "gameTabs",
      "gameQuickStats",
      "gameAbout",
      "gameStoryline",
      "gameMedia",
      "gameSysReq",
      "gameRelations",
      "gamePulse",
      "gameSidebarKpis",
      "gameSpecs",
    ],
  },
  {
    key: "store",
    labelKey: "nav.store",
    routes: ["/store"],
    items: [
      "storeHeader",
      "hero",
      "storeFilters",
      "storeToolbar",
      "storeGrid",
    ],
  },
  {
    key: "wishlist",
    labelKey: "nav.wishlist",
    routes: ["/wishlist"],
    items: [
      "wishlistHeader",
      "wishlistToolbar",
      "filters",
      "wishlistGrid",
    ],
  },
  {
    key: "deals",
    labelKey: "nav.deals",
    routes: ["/deals"],
    items: [
      "dealsHeader",
      "hero",
      "subtabs",
      "dealsGrid",
    ],
  },
  {
    key: "news",
    labelKey: "nav.news",
    routes: ["/news"],
    items: [
      "newsHeader",
      "hero",
      "newsToolbar",
      "filters",
      "newsGrid",
    ],
  },
  {
    key: "activity",
    labelKey: "nav.activity",
    routes: ["/activity"],
    items: [
      "activityHeader",
      "activityToolbar",
      "activityKpis",
      "activityPersona",
      "activityRecords",
      "activityChart",
      "activityInsights",
      "activityBacklog",
      "activityBreakdown",
    ],
  },
  {
    key: "achievements",
    labelKey: "nav.achievements",
    routes: ["/achievements"],
    items: [
      "achievementsHeader",
      "achievementsHero",
      "achievementsCharts",
      "achievementsSourceBreakdown",
      "achievementsShelves",
      "achievementsList",
    ],
  },
  {
    key: "downloads",
    labelKey: "nav.downloads",
    routes: ["/downloads"],
    items: [
      "downloadsHeader",
      "downloadsHero",
      "downloadsSparkline",
      "downloadsFilter",
      "downloadsQueue",
    ],
  },
  {
    key: "storage",
    labelKey: "nav.storage",
    routes: ["/storage"],
    items: [
      "storageHeader",
      "storageHero",
      "storageControls",
      "storageList",
    ],
  },
  {
    key: "community",
    labelKey: "nav.community",
    routes: ["/community"],
    items: [
      "communityHeader",
      "communityTabs",
      "communityContent",
    ],
  },
  {
    key: "friends",
    labelKey: "nav.friends",
    routes: ["/friends"],
    items: [
      "friendsHeader",
      "friendsHero",
      "friendsTabs",
    ],
  },
  {
    key: "emulators",
    labelKey: "nav.emulators",
    routes: ["/emulators"],
    items: [
      "emuHeader",
      "emuStats",
      "emuSidebar",
      "emuDetail",
    ],
  },
  {
    key: "mods",
    labelKey: "nav.mods",
    routes: ["/mods"],
    items: [
      "modsHeader",
      "modsCockpit",
      "modsRail",
      "modsWorkspace",
    ],
  },
];

/** Page key → default widget order. Derived from the registry above. */
export const DEFAULT_PAGE_ITEM_ORDER: Record<string, PageWidgetKey[]> =
  INTERFACE_PAGES.reduce<Record<string, PageWidgetKey[]>>((acc, page) => {
    acc[page.key] = [...page.items];
    return acc;
  }, {});

export function interfacePageDef(key: InterfacePageKey): InterfacePageDef | undefined {
  return INTERFACE_PAGES.find((page) => page.key === key);
}

/**
 * Resolve the active page for a route. The game detail page (`/library/<id>`)
 * is checked before the library page so the two never shadow each other.
 */
export function resolveInterfacePage(pathname: string): InterfacePageKey {
  if (pathname.startsWith("/library/")) return "game";
  let best: InterfacePageDef | null = null;
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    if (page.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
      if (!best || page.routes[0].length > best.routes[0].length) best = page;
    }
  }
  return best?.key ?? "global";
}

// ── Per-page item visibility & order ────────────────────────────────────────

/** Only OFF entries are persisted, same overrides pattern as the other maps. */
export type PageItemVisibilityMap = Partial<
  Record<InterfacePageKey, Partial<Record<PageWidgetKey, boolean>>>
>;

/** Custom widget order per page; absent entries fall back to the shipped order. */
export type PageItemOrderMap = Partial<Record<InterfacePageKey, PageWidgetKey[]>>;

/** Normalize a persisted per-page order: drop unknown/duplicates, append the
 *  page's remaining widgets so an upgrade never hides a newly added block. */
export function normalizePageItemOrder(
  page: InterfacePageKey,
  raw: unknown,
): PageWidgetKey[] {
  const known = interfacePageDef(page)?.items ?? [];
  const allowed = new Set<string>(known);
  const seen = new Set<string>();
  const ordered: PageWidgetKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as PageWidgetKey);
    }
  }
  for (const key of known) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize the whole persisted per-page order map. */
export function normalizePageItemOrderMap(raw: unknown): PageItemOrderMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: PageItemOrderMap = {};
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    const value = source[page.key];
    if (value === undefined) continue;
    next[page.key] = normalizePageItemOrder(page.key, value);
  }
  return next;
}

/** Normalize the persisted per-page visibility map: keep only known pages,
 *  known widget keys and explicit OFF entries. */
export function normalizePageItemVisibilityMap(raw: unknown): PageItemVisibilityMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: PageItemVisibilityMap = {};
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    const value = source[page.key];
    if (!value || typeof value !== "object") continue;
    const allowed = new Set<string>(page.items);
    const entry: Partial<Record<PageWidgetKey, boolean>> = {};
    for (const [key, visible] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.has(key) && visible === false) entry[key as PageWidgetKey] = false;
    }
    if (Object.keys(entry).length > 0) next[page.key] = entry;
  }
  return next;
}

// ── Sidebar sections ────────────────────────────────────────────────────────

export type SidebarSectionKey =
  | "search"
  | "activeFilters"
  | "gameList"
  | "alphabetRail"
  | "statsFooter";

export interface SidebarSectionDef {
  key: SidebarSectionKey;
  labelKey: string;
}

export const SIDEBAR_SECTIONS: SidebarSectionDef[] = [
  { key: "search", labelKey: "settings.interface.sidebarSectionSearch" },
  { key: "activeFilters", labelKey: "settings.interface.sidebarSectionActiveFilters" },
  { key: "gameList", labelKey: "settings.interface.sidebarSectionGameList" },
  { key: "alphabetRail", labelKey: "settings.interface.sidebarSectionAlphabet" },
  { key: "statsFooter", labelKey: "settings.interface.sidebarSectionStats" },
];

export type SidebarSectionVisibility = Record<SidebarSectionKey, boolean>;

export const DEFAULT_SIDEBAR_SECTION_VISIBILITY: SidebarSectionVisibility = {
  search: true,
  activeFilters: true,
  gameList: true,
  alphabetRail: true,
  statsFooter: true,
};

/** Normalize the persisted sidebar section visibility (OFF entries only). */
export function normalizeSidebarSectionVisibility(raw: unknown): SidebarSectionVisibility {
  const next = { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY };
  if (raw && typeof raw === "object") {
    for (const { key } of SIDEBAR_SECTIONS) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "boolean") next[key] = value;
    }
  }
  return next;
}
