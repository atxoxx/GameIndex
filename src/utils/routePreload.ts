/**
 * Route Chunk Preloader
 * ─────────────────────
 * Ensures instant page transitions with zero loading flashes or hangs.
 *
 * 1. Warm core pages on application idle callback.
 * 2. Warm secondary pages in background idle frames.
 * 3. Warm targeted pages immediately when the user hovers or focuses
 *    navigation tabs in TopNav or links in the Sidebar.
 */

type Importer = () => Promise<unknown>;

const routePromises = new Map<string, Promise<unknown>>();

const ROUTE_CHUNK_MAP: Record<string, Importer> = {
  "/library": () => import("../pages/LibraryPage"),
  "/home": () => import("../pages/HomePage"),
  "/store": () => import("../pages/StorePage"),
  "/wishlist": () => import("../pages/WishlistPage"),
  "/deals": () => import("../pages/deals/DealsPage"),
  "/activity": () => import("../pages/ActivityPage"),
  "/news": () => import("../pages/news/NewsPage"),
  "/achievements": () => import("../pages/AchievementsPage"),
  "/downloads": () => import("../pages/DownloadsPage"),
  "/storage": () => import("../pages/StoragePage"),
  "/community": () => import("../pages/CommunityPage"),
  "/friends": () => import("../pages/friends/FriendsPage"),
  "/emulators": () => import("../pages/EmulatorsPage"),
  "/mods": () => import("../pages/mods/ModsPage"),
  "/settings": () => import("../pages/SettingsPage"),
  "/docs": () => import("../pages/DocsPage"),
  "/game-detail": () => import("../pages/GamePage"),
  "/store-detail": () => import("../pages/StoreGameDetail"),
};

const preloadedSet = new Set<string>();

/** Preload a specific route chunk immediately (e.g. on link hover/focus). */
export function preloadRoute(path: string): void {
  const normPath = path.startsWith("/") ? path : `/${path}`;
  const baseSegment = `/${normPath.split("/")[1] || ""}`;

  const importer = ROUTE_CHUNK_MAP[normPath] || ROUTE_CHUNK_MAP[baseSegment];
  if (importer && !preloadedSet.has(normPath)) {
    preloadedSet.add(normPath);
    const promise = importer();
    routePromises.set(normPath, promise);
    promise.catch(() => {
      preloadedSet.delete(normPath);
      routePromises.delete(normPath);
    });
  }
}

/** Preload detail pages on hover of game cards / list rows */
export function preloadGameDetail(): void {
  if (!preloadedSet.has("/game-detail")) {
    preloadedSet.add("/game-detail");
    const promise = ROUTE_CHUNK_MAP["/game-detail"]?.();
    if (promise) routePromises.set("/game-detail", promise);
    promise?.catch(() => {
      preloadedSet.delete("/game-detail");
      routePromises.delete("/game-detail");
    });
  }
}

export function preloadStoreDetail(): void {
  if (!preloadedSet.has("/store-detail")) {
    preloadedSet.add("/store-detail");
    const promise = ROUTE_CHUNK_MAP["/store-detail"]?.();
    if (promise) routePromises.set("/store-detail", promise);
    promise?.catch(() => {
      preloadedSet.delete("/store-detail");
      routePromises.delete("/store-detail");
    });
  }
}

const HIGH_PRIORITY_KEYS = [
  "/library",
  "/home",
];

const SECONDARY_KEYS = [
  "/store",
  "/wishlist",
  "/deals",
  "/activity",
];

/**
 * Schedule sequential background preloading well after the app is
 * interactive.
 *
 * The previous implementation passed a delay as `requestIdleCallback`'s
 * `timeout`, which is a deadline, not a wait — on an idle page it fired
 * immediately and pulled every page chunk in during the first paint. This
 * version waits a real couple of seconds, then warms one route at a time so
 * the work never lands in one burst.
 */
export function scheduleIdleRoutePreloading(): () => void {
  let cancelled = false;
  const timers = new Set<number>();

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!cancelled) fn();
    }, ms);
    timers.add(id);
  };

  const warm = (keys: string[]) => {
    let index = 0;
    const next = () => {
      if (cancelled || index >= keys.length) return;
      preloadRoute(keys[index++]);
      later(next, 450);
    };
    next();
  };

  // Phase 1: the two pages a session almost always opens.
  later(() => warm(HIGH_PRIORITY_KEYS), 2500);
  // Phase 2: the next most visited surfaces, once the shell has settled.
  later(() => warm(SECONDARY_KEYS), 7000);

  return () => {
    cancelled = true;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };
}
