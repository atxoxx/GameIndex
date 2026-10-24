import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { usePersistedState } from "../../hooks/usePersistedState";
import { usePersistedJson } from "../../hooks/usePersistedJson";
import { useVisibleInterval } from "../../hooks/useVisibleInterval";
import { useOwnedTitles } from "../../hooks/useOwnedTitles";
import { useWishlistContext } from "../../context/WishlistContext";
import type { DealItem, GamePassGame, Giveaway, PlaytesterFeed, PlaytesterGame } from "../../types/deals";
import {
  DEALS_FILTER_KEYS,
  DEFAULT_DEAL_FILTERS,
  DEFAULT_GIVEAWAY_FILTERS,
  DEFAULT_GP_FILTERS,
  DEFAULT_PLAYTESTER_FILTERS,
  ENDING_SOON_MS,
  PLAYTESTER_PAGE_SIZE,
  SUB_TABS,
  buildDealsPayload,
  buildGamePassPayload,
  groupDealsByTitle,
  type DealGroup,
  type DealsFiltersState,
  type GamePassFiltersState,
  type GiveawaysFiltersState,
  type PlaytesterFiltersState,
  type SubTab,
} from "./dealsConstants";
import {
  endingSoonGiveaways,
  filterDealGroups,
  filterGamePassGames,
  filterGiveaways,
  filterPlaytesterGames,
  wishlistGroups,
  type DealFilterContext,
} from "./dealsFilters";

interface FeedState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface DealsFeed<T> extends FeedState<T> {
  reload: () => void;
}

/** Sources the page can fetch. "overview" fans out to all four. */
export type DealsSource = "deals" | "gamepass" | "giveaways" | "playtester";

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * One feed with a signature-based cache.
 *
 * A feed refetches only when its backend payload changes (`signature`) or the
 * user asks for a reload — switching tabs back and forth keeps the card grid
 * on screen instead of flashing a skeleton. `enabled` lets the Overview tab
 * warm all four feeds at once while the source tabs stay lazy.
 */
function useSourceFeed<T>(
  signature: string,
  enabled: boolean,
  load: () => Promise<T>,
  fallbackError: string,
): DealsFeed<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<FeedState<T> & { key: string | null }>({
    data: null,
    loading: false,
    error: null,
    key: null,
  });

  const requestRef = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const fallbackRef = useRef(fallbackError);
  fallbackRef.current = fallbackError;

  const key = `${signature}#${nonce}`;

  useEffect(() => {
    if (!enabled) return;
    if (state.key === key) return;

    const request = ++requestRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    void (async () => {
      try {
        const data = await loadRef.current();
        if (request !== requestRef.current) return;
        setState({ data, loading: false, error: null, key });
      } catch (err) {
        if (request !== requestRef.current) return;
        setState({
          data: null,
          loading: false,
          error: errorMessage(err, fallbackRef.current),
          key: null,
        });
      }
    })();
  }, [enabled, key, state.key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data: state.data, loading: state.loading, error: state.error, reload };
}

/**
 * useDealsPageController - all deals page state in one place.
 *
 * Owns the persisted tab + per-tab filters, the four feeds, playtester
 * pagination, the live clock the giveaways count down against, and the
 * cross-store grouping of ITAD rows. The page itself stays a composition of
 * presentational panels.
 */
export function useDealsPageController() {
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = usePersistedState<SubTab>(
    DEALS_FILTER_KEYS.tab,
    "overview",
    SUB_TABS,
  );

  const [dealFilters, setDealFilters] = usePersistedJson<DealsFiltersState>(
    DEALS_FILTER_KEYS.deals,
    DEFAULT_DEAL_FILTERS,
  );
  const [gpFilters, setGpFilters] = usePersistedJson<GamePassFiltersState>(
    DEALS_FILTER_KEYS.gamepass,
    DEFAULT_GP_FILTERS,
  );
  const [giveawayFilters, setGiveawayFilters] = usePersistedJson<GiveawaysFiltersState>(
    DEALS_FILTER_KEYS.giveaways,
    DEFAULT_GIVEAWAY_FILTERS,
  );
  const [ptFilters, setPtFilters] = usePersistedJson<PlaytesterFiltersState>(
    DEALS_FILTER_KEYS.playtester,
    DEFAULT_PLAYTESTER_FILTERS,
  );

  // The overview needs every source; a source tab only needs its own.
  const wantsAll = activeTab === "overview";
  const dealsEnabled = wantsAll || activeTab === "deals";
  const gpEnabled = wantsAll || activeTab === "gamepass";
  const giveawaysEnabled = wantsAll || activeTab === "giveaways";
  const ptEnabled = wantsAll || activeTab === "playtester";

  const gpPayload = useMemo(() => buildGamePassPayload(gpFilters), [gpFilters]);
  const dealsPayload = useMemo(() => buildDealsPayload(dealFilters), [dealFilters]);

  const gamepass = useSourceFeed<GamePassGame[]>(
    JSON.stringify(gpPayload),
    gpEnabled,
    () => invoke<GamePassGame[]>("fetch_gamepass_catalog", { filters: gpPayload }),
    t("deals.errorGamepass"),
  );

  const deals = useSourceFeed<DealItem[]>(
    JSON.stringify(dealsPayload),
    dealsEnabled,
    () => invoke<DealItem[]>("fetch_isthereanydeal_deals", { filters: dealsPayload }),
    t("deals.errorDeals"),
  );

  const giveaways = useSourceFeed<Giveaway[]>(
    "giveaways",
    giveawaysEnabled,
    () => invoke<Giveaway[]>("fetch_giveaways"),
    t("deals.errorGiveaways"),
  );

  const playtester = useSourceFeed<PlaytesterFeed>(
    "playtester",
    ptEnabled,
    () =>
      invoke<PlaytesterFeed>("fetch_playtester_games", {
        offset: 0,
        limit: PLAYTESTER_PAGE_SIZE,
      }),
    t("deals.errorPlaytester"),
  );

  // ── Playtester pagination ────────────────────────────────────────────────
  const [ptExtra, setPtExtra] = useState<PlaytesterGame[]>([]);
  const [ptMore, setPtMore] = useState(false);
  const [ptCursor, setPtCursor] = useState(0);
  const [ptLoadingMore, setPtLoadingMore] = useState(false);

  // A fresh first page invalidates the appended pages.
  useEffect(() => {
    setPtExtra([]);
    setPtMore(false);
    setPtCursor(playtester.data?.nextOffset ?? 0);
  }, [playtester.data]);

  const loadMorePlaytester = useCallback(async () => {
    if (ptLoadingMore) return;
    const base = playtester.data?.games ?? [];
    const hasMore = ptExtra.length > 0 ? ptMore : playtester.data?.hasMore ?? false;
    const offset = ptExtra.length > 0 ? ptCursor : playtester.data?.nextOffset ?? 0;
    if (!hasMore) return;

    setPtLoadingMore(true);
    try {
      const page = await invoke<PlaytesterFeed>("fetch_playtester_games", {
        offset,
        limit: PLAYTESTER_PAGE_SIZE,
      });
      const seen = new Set([...base, ...ptExtra].map((game) => game.id));
      const fresh = page.games.filter((game) => !seen.has(game.id));
      if (fresh.length > 0) setPtExtra((prev) => [...prev, ...fresh]);
      setPtMore(page.hasMore);
      setPtCursor(page.nextOffset);
    } catch {
      // The first page is already on screen; a failed "load more" leaves it be.
    } finally {
      setPtLoadingMore(false);
    }
  }, [playtester.data, ptCursor, ptExtra, ptLoadingMore, ptMore]);

  const playtesterGames = useMemo(() => {
    const base = playtester.data?.games ?? [];
    if (ptExtra.length === 0) return base;
    const seen = new Set(base.map((game) => game.id));
    return [...base, ...ptExtra.filter((game) => !seen.has(game.id))];
  }, [playtester.data, ptExtra]);

  const ptHasMore =
    ptExtra.length > 0 ? ptMore : playtester.data?.hasMore ?? false;

  // ── Cross-store grouping ────────────────────────────────────────────────
  const dealGroups = useMemo<DealGroup[]>(
    () => groupDealsByTitle(deals.data ?? []),
    [deals.data],
  );

  // ── Client-side filtering ───────────────────────────────────────────────
  const { isWishlisted } = useWishlistContext();
  const isOwned = useOwnedTitles();

  const filterContext = useMemo<DealFilterContext>(
    () => ({ isWishlisted, isOwned }),
    [isWishlisted, isOwned],
  );

  // Live clock: countdowns tick while the page is open instead of freezing at
  // first render. Paused while the window is hidden (see useVisibleInterval).
  const [now, setNow] = useState(() => Date.now());
  useVisibleInterval(() => setNow(Date.now()), 30_000, giveawaysEnabled);

  const filteredDeals = useMemo(
    () => filterDealGroups(dealGroups, dealFilters, filterContext),
    [dealGroups, dealFilters, filterContext],
  );

  const filteredGamepass = useMemo(
    () => filterGamePassGames(gamepass.data ?? [], gpFilters, filterContext),
    [gamepass.data, gpFilters, filterContext],
  );

  const filteredGiveaways = useMemo(
    () => filterGiveaways(giveaways.data ?? [], giveawayFilters, now),
    [giveaways.data, giveawayFilters, now],
  );

  const filteredPlaytester = useMemo(
    () => filterPlaytesterGames(playtesterGames, ptFilters, filterContext),
    [playtesterGames, ptFilters, filterContext],
  );

  // ── Overview rails ──────────────────────────────────────────────────────
  const rails = useMemo(
    () => ({
      bestDiscounts: [...dealGroups].sort((a, b) => b.maxDiscount - a.maxDiscount),
      freeNow: [...(giveaways.data ?? [])]
        .filter((giveaway) => {
          if (!giveaway.expiry) return true;
          const end = new Date(giveaway.expiry).getTime();
          return !Number.isFinite(end) || end > now;
        })
        .sort((a, b) => {
          const ta = a.expiry ? new Date(a.expiry).getTime() : Infinity;
          const tb = b.expiry ? new Date(b.expiry).getTime() : Infinity;
          return ta - tb;
        }),
      endingSoon: endingSoonGiveaways(giveaways.data ?? [], now, ENDING_SOON_MS),
      newOnGamePass: [...(gamepass.data ?? [])].sort((a, b) => {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return db - da;
      }),
      playtests: playtesterGames
        .filter((game) => game.status.toLowerCase() === "active")
        .sort((a, b) => {
          const da = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
          const db = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
          return db - da;
        }),
      wishlistOnSale: wishlistGroups(dealGroups, (slug) =>
        isWishlisted(slug),
      ),
    }),
    [dealGroups, gamepass.data, giveaways.data, isWishlisted, now, playtesterGames],
  );

  const reloadSource = useCallback(
    (source: DealsSource) => {
      if (source === "deals") deals.reload();
      else if (source === "gamepass") gamepass.reload();
      else if (source === "giveaways") giveaways.reload();
      else playtester.reload();
    },
    [deals, gamepass, giveaways, playtester],
  );

  const reloadAll = useCallback(() => {
    deals.reload();
    gamepass.reload();
    giveaways.reload();
    playtester.reload();
  }, [deals, gamepass, giveaways, playtester]);

  return {
    activeTab,
    setActiveTab,
    filters: {
      deals: dealFilters,
      gamepass: gpFilters,
      giveaways: giveawayFilters,
      playtester: ptFilters,
    },
    setFilters: {
      deals: setDealFilters,
      gamepass: setGpFilters,
      giveaways: setGiveawayFilters,
      playtester: setPtFilters,
    },
    feeds: {
      deals: {
        ...deals,
        groups: dealGroups,
        items: filteredDeals,
        total: dealGroups.length,
      },
      gamepass: {
        ...gamepass,
        items: filteredGamepass,
        total: (gamepass.data ?? []).length,
      },
      giveaways: {
        ...giveaways,
        items: filteredGiveaways,
        total: (giveaways.data ?? []).length,
      },
      playtester: {
        ...playtester,
        items: filteredPlaytester,
        total: playtesterGames.length,
        hasMore: ptHasMore,
        loadingMore: ptLoadingMore,
        loadMore: loadMorePlaytester,
      },
    },
    rails,
    reloadSource,
    reloadAll,
    now,
  };
}

export type DealsPageController = ReturnType<typeof useDealsPageController>;
