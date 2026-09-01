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
  "/news": () => import("../pages/NewsPage"),
  "/achievements": () => import("../pages/AchievementsPage"),
  "/downloads": () => import("../pages/DownloadsPage"),
  "/storage": () => import("../pages/StoragePage"),
  "/community": () => import("../pages/CommunityPage"),
  "/friends": () => import("../pages/FriendsPage"),
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

/** Schedule sequential background preloading across idle browser frames. */
export function scheduleIdleRoutePreloading(): () => void {
  let cancelled = false;
  let timerId: number | null = null;
  let idleId: number | null = null;

  const runIdle = (fn: () => void, timeout = 2000) => {
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(fn, { timeout });
    } else {
      timerId = window.setTimeout(fn, 800);
    }
  };

  // Phase 1: High priority core routes
  runIdle(() => {
    if (cancelled) return;
    for (const key of HIGH_PRIORITY_KEYS) {
      preloadRoute(key);
    }

    // Phase 2: Secondary routes in next idle window
    runIdle(() => {
      if (cancelled) return;
        for (const key of SECONDARY_KEYS) {
        preloadRoute(key);
      }
    }, 3000);
  }, 1200);

  return () => {
    cancelled = true;
    if (idleId != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
    if (timerId != null) {
      window.clearTimeout(timerId);
    }
  };
}
