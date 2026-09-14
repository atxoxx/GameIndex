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
  | "gameInfoKpi"
  | "gameSteamFeatures"
  | "gameRatings"
  | "gameTimeToBeat"
  | "gameSpecsCard"
  | "gameProtonDb"
  | "gameCrackwatch"
  | "gameReleases"
  | "gameLanguages"
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
  "gameInfoKpi",
  "gameSteamFeatures",
  "gameRatings",
  "gameTimeToBeat",
  "gameSpecsCard",
  "gameProtonDb",
  "gameCrackwatch",
  "gameReleases",
  "gameLanguages",
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
  gameInfoKpi: "ui-item-gameInfoKpi",
  gameSteamFeatures: "ui-item-gameSteamFeatures",
  gameRatings: "ui-item-gameRatings",
  gameTimeToBeat: "ui-item-gameTimeToBeat",
  gameSpecsCard: "ui-item-gameSpecsCard",
  gameProtonDb: "ui-item-gameProtonDb",
  gameCrackwatch: "ui-item-gameCrackwatch",
  gameReleases: "ui-item-gameReleases",
  gameLanguages: "ui-item-gameLanguages",
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
  gameInfoKpi: "settings.interface.widgetGameInfoKpi",
  gameSteamFeatures: "settings.interface.widgetGameSteamFeatures",
  gameRatings: "settings.interface.widgetGameRatings",
  gameTimeToBeat: "settings.interface.widgetGameTimeToBeat",
  gameSpecsCard: "settings.interface.widgetGameSpecsCard",
  gameProtonDb: "settings.interface.widgetGameProtonDb",
  gameCrackwatch: "settings.interface.widgetGameCrackwatch",
  gameReleases: "settings.interface.widgetGameReleases",
  gameLanguages: "settings.interface.widgetGameLanguages",
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
  | "storeGame"
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
      "gameInfoKpi",
      "gameSteamFeatures",
      "gameRatings",
      "gameTimeToBeat",
      "gameSpecsCard",
      "gameProtonDb",
      "gameCrackwatch",
      "gameReleases",
      "gameLanguages",
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
    key: "storeGame",
    labelKey: "settings.interface.studioPageStoreGame",
    routes: ["/store/"],
    items: [
      "gameHero",
      "gameTabs",
      "gameQuickStats",
      "gameAbout",
      "gameStoryline",
      "gameMedia",
      "gameSysReq",
      "gameRelations",
      "gameInfoKpi",
      "gameSteamFeatures",
      "gameRatings",
      "gameTimeToBeat",
      "gameSpecsCard",
      "gameProtonDb",
      "gameCrackwatch",
      "gameReleases",
      "gameLanguages",
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
  if (pathname.startsWith("/store/")) return "storeGame";
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

/**
 * Legacy page widgets that were retired in favour of one key per card.
 * Persisted orders/visibility that still name these must migrate forward:
 * the grouped keys expand to the individual keys that replaced them. Kept as
 * plain string literals only — they are no longer valid `PageWidgetKey`s.
 */
const RETIRED_PAGE_WIDGET_EXPANSION: Partial<
  Record<InterfacePageKey, Record<string, PageWidgetKey[]>>
> = {
  game: {
    gameSidebarKpis: ["gameInfoKpi", "gameSteamFeatures", "gameRatings", "gameTimeToBeat"],
    gameSpecs: ["gameSpecsCard", "gameProtonDb", "gameCrackwatch", "gameReleases", "gameLanguages"],
  },
};

/** Normalize a persisted per-page order: drop unknown/duplicates, migrate
 *  retired grouped keys to the individual cards that replaced them, and append
 *  the page's remaining widgets so an upgrade never hides a newly added block.
 *
 *  A retired key expands only when the raw order does not already name any of
 *  its targets (an explicit choice wins); its targets are appended after the
 *  page's explicitly-ordered keys, preserving the user's relative ordering. */
export function normalizePageItemOrder(
  page: InterfacePageKey,
  raw: unknown,
): PageWidgetKey[] {
  const known = interfacePageDef(page)?.items ?? [];
  const allowed = new Set<string>(known);
  const retired = RETIRED_PAGE_WIDGET_EXPANSION[page] ?? {};
  const seen = new Set<string>();
  const ordered: PageWidgetKey[] = [];
  const expansions: PageWidgetKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const expansion = retired[value];
      if (expansion) {
        // Drop the retired value when one of its targets is already named.
        if (!expansion.some((key) => raw.includes(key))) expansions.push(...expansion);
        continue;
      }
      if (!allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as PageWidgetKey);
    }
  }
  for (const key of expansions) {
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
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
    const rawEntry = value as Record<string, unknown>;
    const retired = RETIRED_PAGE_WIDGET_EXPANSION[page.key] ?? {};
    const entry: Partial<Record<PageWidgetKey, boolean>> = {};
    for (const [key, visible] of Object.entries(rawEntry)) {
      if (visible !== false) continue;
      if (allowed.has(key)) {
        entry[key as PageWidgetKey] = false;
        continue;
      }
      const expansion = retired[key];
      if (!expansion) continue;
      // A retired OFF group hides each individual card it contained, unless
      // the raw entry names that card explicitly (the explicit value wins).
      for (const target of expansion) {
        if (!allowed.has(target)) continue;
        if (Object.prototype.hasOwnProperty.call(rawEntry, target)) continue;
        entry[target] = false;
      }
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

// ── Detail-page tabs (game + store detail) ─────────────────────────────
export type DetailTabScope = "game" | "store";
export type DetailTabKey =
  | "overview" | "reviews" | "activity" | "notes"
  | "achievements" | "mods" | "weblinks" | "news";

export const DETAIL_TABS: Record<DetailTabScope, DetailTabKey[]> = {
  game: ["overview", "reviews", "activity", "notes", "achievements", "mods", "weblinks", "news"],
  store: ["overview", "reviews", "achievements", "weblinks", "news"],
};
export const DEFAULT_DETAIL_TAB_ORDER = DETAIL_TABS; // shipped order

const DETAIL_TAB_SCOPES = Object.keys(DETAIL_TABS) as DetailTabScope[];

// Tab label i18n keys (reuse existing keys — do NOT invent new ones here).
export const DETAIL_TAB_LABEL_KEY: Record<DetailTabKey, string> = {
  overview: "game.tab.overview",
  reviews: "game.tab.reviews",
  activity: "game.tab.activity",
  notes: "notes.title",
  achievements: "game.tab.achievements",
  mods: "game.tab.mods",
  weblinks: "game.tab.weblinks",
  news: "game.tab.news",
};

export type DetailTabOrderMap = Partial<Record<DetailTabScope, DetailTabKey[]>>;

/** Normalize like normalizePageItemOrder: drop unknown/dupes, append missing known keys. */
export function normalizeDetailTabOrder(
  scope: DetailTabScope,
  raw: unknown,
): DetailTabKey[] {
  const known = DETAIL_TABS[scope];
  const allowed = new Set<string>(known);
  const seen = new Set<string>();
  const ordered: DetailTabKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as DetailTabKey);
    }
  }
  for (const key of known) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize the whole persisted detail-tab order map. */
export function normalizeDetailTabOrderMap(raw: unknown): DetailTabOrderMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: DetailTabOrderMap = {};
  for (const scope of DETAIL_TAB_SCOPES) {
    const value = source[scope];
    if (value === undefined) continue;
    next[scope] = normalizeDetailTabOrder(scope, value);
  }
  return next;
}

/** Resolve the effective tab order for a scope, falling back to the shipped order. */
export function resolveDetailTabOrder(
  map: DetailTabOrderMap,
  scope: DetailTabScope,
): DetailTabKey[] {
  return map[scope] ?? DETAIL_TABS[scope];
}

// ── Hero elements (game + store detail) ────────────────────────────────
export type HeroScope = "game" | "store";
export type HeroElementKey =
  | "background" | "poster" | "title" | "meta" | "genres" | "kpis" | "actions";

export const HERO_ELEMENTS: HeroElementKey[] = [
  "background", "poster", "title", "meta", "genres", "kpis", "actions",
];
export const DEFAULT_HERO_ELEMENT_ORDER = HERO_ELEMENTS;

const HERO_SCOPES: HeroScope[] = ["game", "store"];

/** Both scopes ship the same element set today; keyed per scope so a future
 *  split doesn't require a call-site change. */
const HERO_ELEMENTS_BY_SCOPE: Record<HeroScope, HeroElementKey[]> = {
  game: HERO_ELEMENTS,
  store: HERO_ELEMENTS,
};

// New i18n keys the Studio lane will add; declare them here.
export const HERO_ELEMENT_LABEL_KEY: Record<HeroElementKey, string> = {
  background: "settings.interface.heroElementBackground",
  poster: "settings.interface.heroElementPoster",
  title: "settings.interface.heroElementTitle",
  meta: "settings.interface.heroElementMeta",
  genres: "settings.interface.heroElementGenres",
  kpis: "settings.interface.heroElementKpis",
  actions: "settings.interface.heroElementActions",
};

export type HeroElementOrderMap = Partial<Record<HeroScope, HeroElementKey[]>>;
export type HeroElementVisibilityMap =
  Partial<Record<HeroScope, Partial<Record<HeroElementKey, boolean>>>>;

/** Normalize a persisted hero order: drop unknown/dupes, append missing known keys. */
export function normalizeHeroElementOrder(
  scope: HeroScope,
  raw: unknown,
): HeroElementKey[] {
  const known = HERO_ELEMENTS_BY_SCOPE[scope];
  const allowed = new Set<string>(known);
  const seen = new Set<string>();
  const ordered: HeroElementKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as HeroElementKey);
    }
  }
  for (const key of known) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize the whole persisted hero element order map. */
export function normalizeHeroElementOrderMap(raw: unknown): HeroElementOrderMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: HeroElementOrderMap = {};
  for (const scope of HERO_SCOPES) {
    const value = source[scope];
    if (value === undefined) continue;
    next[scope] = normalizeHeroElementOrder(scope, value);
  }
  return next;
}

/** OFF-only persistence, same as normalizePageItemVisibilityMap: keep only
 *  known scopes, known element keys and explicit OFF entries. */
export function normalizeHeroElementVisibilityMap(raw: unknown): HeroElementVisibilityMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const allowed = new Set<string>(HERO_ELEMENTS);
  const next: HeroElementVisibilityMap = {};
  for (const scope of HERO_SCOPES) {
    const value = source[scope];
    if (!value || typeof value !== "object") continue;
    const entry: Partial<Record<HeroElementKey, boolean>> = {};
    for (const [key, visible] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.has(key) && visible === false) entry[key as HeroElementKey] = false;
    }
    if (Object.keys(entry).length > 0) next[scope] = entry;
  }
  return next;
}

/** Resolve the effective hero order for a scope, falling back to the shipped order. */
export function resolveHeroElementOrder(
  map: HeroElementOrderMap,
  scope: HeroScope,
): HeroElementKey[] {
  return map[scope] ?? HERO_ELEMENTS;
}

/** Resolve the OFF-only hidden entries for a scope. */
export function resolveHeroElementHidden(
  map: HeroElementVisibilityMap,
  scope: HeroScope,
): Partial<Record<HeroElementKey, boolean>> {
  return map[scope] ?? {};
}

// ── Detail-page top bar (game + store detail) ──────────────────────────
//
// Mirrors the hero-element lane above: per-scope order (append-only
// normalization) plus OFF-only visibility overrides. Hidden buttons are meant
// to be *removed* from the bar by the consumer, not merely styled away.
export type DetailTopBarScope = "game" | "store";

export type DetailTopBarKey =
  | "back"
  | "wineLogs"
  | "editDetails"
  | "editMedia"
  | "editLaunch"
  | "editCompatibility"
  | "quickActions";

/** Shipped order per scope. */
export const DETAIL_TOP_BAR: Record<DetailTopBarScope, DetailTopBarKey[]> = {
  game: ["back", "wineLogs", "editDetails", "editMedia", "editLaunch", "editCompatibility", "quickActions"],
  store: ["back", "quickActions"],
};
export const DEFAULT_DETAIL_TOP_BAR_ORDER: Record<DetailTopBarScope, DetailTopBarKey[]> = DETAIL_TOP_BAR;

/** Label key per scope (the back link differs: game vs store). */
export const DETAIL_TOP_BAR_LABEL_KEY: Record<DetailTopBarScope, Partial<Record<DetailTopBarKey, string>>> = {
  game: {
    back: "page.game.returnToLibrary",
    wineLogs: "wineLogs.button",
    editDetails: "edit.tab.details",
    editMedia: "edit.tab.media",
    editLaunch: "edit.tab.launch",
    editCompatibility: "edit.tab.compatibility",
    quickActions: "gamePage.quickActions",
  },
  store: {
    back: "nav.store",
    quickActions: "gamePage.quickActions",
  },
};

export type DetailTopBarOrderMap = Partial<Record<DetailTopBarScope, DetailTopBarKey[]>>;
export type DetailTopBarVisibilityMap =
  Partial<Record<DetailTopBarScope, Partial<Record<DetailTopBarKey, boolean>>>>;

const DETAIL_TOP_BAR_SCOPES: DetailTopBarScope[] = ["game", "store"];

/** Type guard: is a value a top-bar key shipped for this scope? */
export function isDetailTopBarKeyForScope(
  scope: DetailTopBarScope,
  key: unknown,
): key is DetailTopBarKey {
  return typeof key === "string" && DETAIL_TOP_BAR[scope].includes(key as DetailTopBarKey);
}

/** Normalize a persisted top-bar order: drop unknown/dupes, append missing
 *  known keys (append-only, so newly shipped buttons still render). */
export function normalizeDetailTopBarOrder(
  scope: DetailTopBarScope,
  raw: unknown,
): DetailTopBarKey[] {
  const known = DETAIL_TOP_BAR[scope];
  const allowed = new Set<string>(known);
  const seen = new Set<string>();
  const ordered: DetailTopBarKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as DetailTopBarKey);
    }
  }
  for (const key of known) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize the whole persisted top-bar order map. */
export function normalizeDetailTopBarOrderMap(raw: unknown): DetailTopBarOrderMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: DetailTopBarOrderMap = {};
  for (const scope of DETAIL_TOP_BAR_SCOPES) {
    const value = source[scope];
    if (value === undefined) continue;
    next[scope] = normalizeDetailTopBarOrder(scope, value);
  }
  return next;
}

/** OFF-only persistence, same as normalizeHeroElementVisibilityMap: keep only
 *  known top-bar keys and explicit OFF entries for one scope. */
export function normalizeDetailTopBarVisibility(
  scope: DetailTopBarScope,
  raw: unknown,
): Partial<Record<DetailTopBarKey, boolean>> {
  if (!raw || typeof raw !== "object") return {};
  const allowed = new Set<string>(DETAIL_TOP_BAR[scope]);
  const entry: Partial<Record<DetailTopBarKey, boolean>> = {};
  for (const [key, visible] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed.has(key) && visible === false) entry[key as DetailTopBarKey] = false;
  }
  return entry;
}

/** Normalize the whole persisted top-bar visibility map. */
export function normalizeDetailTopBarVisibilityMap(raw: unknown): DetailTopBarVisibilityMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: DetailTopBarVisibilityMap = {};
  for (const scope of DETAIL_TOP_BAR_SCOPES) {
    const value = source[scope];
    if (!value || typeof value !== "object") continue;
    const entry = normalizeDetailTopBarVisibility(scope, value);
    if (Object.keys(entry).length > 0) next[scope] = entry;
  }
  return next;
}

/** Resolve the effective top-bar order for a scope, falling back to the shipped order. */
export function resolveDetailTopBarOrder(
  map: DetailTopBarOrderMap,
  scope: DetailTopBarScope,
): DetailTopBarKey[] {
  return map[scope] ?? DETAIL_TOP_BAR[scope];
}

/** Resolve the OFF-only hidden entries for a scope. */
export function resolveDetailTopBarHidden(
  map: DetailTopBarVisibilityMap,
  scope: DetailTopBarScope,
): Partial<Record<DetailTopBarKey, boolean>> {
  return map[scope] ?? {};
}

// ── Detail-UI capability gates (shared by runtime + Layout Studio) ──────
//
// `showFullLinuxUi` / `showDeckVerified` are derived in SettingsContext from
// the host platform + the user's Linux support level. These helpers turn those
// two flags into a single source of truth so the runtime detail pages and the
// Layout Studio can never disagree about which items a host can actually offer.

/** Host capabilities that gate Linux-only / Deck detail UI. */
export interface DetailUiCapabilities {
  showFullLinuxUi: boolean;
  showDeckVerified: boolean;
}

/** Top-bar keys that require the full Linux UI (Wine/Proton tooling). */
export const LINUX_ONLY_DETAIL_TOP_BAR_KEYS: readonly DetailTopBarKey[] = [
  "wineLogs",
  "editCompatibility",
];

/** True when the host can actually offer this top-bar key. */
export function isDetailTopBarKeyAvailable(
  key: DetailTopBarKey,
  caps: { showFullLinuxUi: boolean },
): boolean {
  return caps.showFullLinuxUi || !LINUX_ONLY_DETAIL_TOP_BAR_KEYS.includes(key);
}

/**
 * Detail sections that require the Deck-verified capability. Typed as plain
 * `string` rather than `DetailSectionKey`: the latter lives in
 * SettingsContext.tsx, which imports this module, so a type-only import here
 * would introduce a circular dependency.
 */
export const DECK_ONLY_DETAIL_SECTION_KEYS: readonly string[] = ["protonDb"];

/** True when the host can actually offer this detail section. */
export function isDetailSectionKeyAvailable(
  key: string,
  caps: { showDeckVerified: boolean },
): boolean {
  return caps.showDeckVerified || !DECK_ONLY_DETAIL_SECTION_KEYS.includes(key);
}
