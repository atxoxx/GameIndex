import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLanguage } from "./LanguageContext";
import { useGames } from "./GameContext";
import { useWishlist } from "../hooks/useWishlist";
import type {
  FeedHealthStatus,
  HistoryEntry,
  NewsArticle,
  NewsCluster,
  NewsFeed,
  NewsTopicId,
  SavedArticle,
} from "../types/news";
import {
  CURATED_FEED_PACKS,
  ALL_MANAGED_FEEDS,
  mergeFeeds,
} from "../utils/news/catalogues";
import { fetchUrlText, hasTauri, parseRSS } from "../utils/news/feed";
import { buildClusters } from "../utils/news/clusters";
import { rankClusters, type RankContext } from "../utils/news/ranking";
import { categoryMapFromFeeds, isNewsTopicId } from "../utils/news/topics";
import {
  LEGACY_KEYS,
  newsStorage,
  type FeedPayload,
  type NewsPrefs,
} from "../utils/news/storage";

/**
 * NewsProvider — the single news store.
 *
 * Every surface (News page, Home rail, per-game News tab, Big Screen) reads
 * this context instead of calling its own hook, so a story marked read in one
 * place is read everywhere, and one refresh feeds the whole app. The durable
 * copy lives in SQLite through `newsStorage`; this context is the in-memory
 * projection, refreshed optimistically and written through on every action.
 */

const REFRESH_TTL_MS = 5 * 60 * 1000;
const CLOCK_TICK_MS = 5 * 60 * 1000;

export interface NewsContextValue {
  /** Catalogue + stored decisions, in display order. */
  feeds: NewsFeed[];
  customFeeds: NewsFeed[];
  sourceNames: string[];
  enabledFeeds: NewsFeed[];
  articles: NewsArticle[];
  clusters: NewsCluster[];
  /** Clusters ordered by signal (library matches, followed topics, recency). */
  rankedClusters: NewsCluster[];
  readLinks: Set<string>;
  saved: SavedArticle[];
  savedLinks: Set<string>;
  history: HistoryEntry[];
  prefs: NewsPrefs;
  /** Article link → owned/wishlisted game title. */
  relatedGames: Map<string, string>;
  followedTopics: Set<NewsTopicId>;
  mutedTopics: Set<NewsTopicId>;
  loading: boolean;
  refreshing: boolean;
  /** True once the durable store has been read into memory. */
  hydrated: boolean;
  error: string | null;
  failedFeeds: string[];
  lastRefreshedAt: number | null;
  /** Unix ms of the previous session's last visit; 0 on a fresh install. */
  previousVisit: number;
  feedHealth: Map<string, FeedHealthStatus>;
  testingHealth: boolean;

  /** Register demand; the first consumer starts the initial network fetch. */
  start: () => void;
  refresh: (force?: boolean) => Promise<void>;
  markRead: (link: string) => void;
  setRead: (link: string, read: boolean) => void;
  markAllRead: (links?: string[]) => void;
  toggleSaved: (article: NewsArticle) => Promise<boolean>;
  /** Fetch the full body for one story and merge it into the store. */
  loadArticle: (link: string) => Promise<NewsArticle | null>;
  addToHistory: (article: NewsArticle) => void;
  clearHistory: () => void;
  removeHistoryItem: (link: string) => void;
  toggleFeed: (url: string) => void;
  addCustomFeed: (name: string, url: string, category?: string) => boolean;
  addCustomFeeds: (feeds: { name: string; url: string; category?: string }[]) => number;
  removeCustomFeed: (url: string) => void;
  importFeedPack: (packId: string) => number;
  setPref: (key: string, value: string) => void;
  toggleFollowTopic: (id: NewsTopicId) => void;
  toggleMuteTopic: (id: NewsTopicId) => void;
  testFeedHealth: () => Promise<FeedHealthStatus[]>;
  clearCachedArticles: () => Promise<void>;
}

const NewsContext = createContext<NewsContextValue | null>(null);

function parseTopicPref(raw: string | undefined): Set<NewsTopicId> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is NewsTopicId => typeof value === "string" && isNewsTopicId(value)));
  } catch {
    return new Set();
  }
}

function normaliseArticle(article: NewsArticle): NewsArticle {
  return {
    ...article,
    description: article.description ?? "",
    content: article.content ?? "",
    pubDate: article.pubDate ?? "",
    sourceUrl: article.sourceUrl ?? "",
    imageUrl: article.imageUrl ?? null,
  };
}

function readLegacy<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function hasLegacyState(): boolean {
  try {
    return Boolean(
      localStorage.getItem(LEGACY_KEYS.feeds) ||
        localStorage.getItem(LEGACY_KEYS.read) ||
        localStorage.getItem(LEGACY_KEYS.history) ||
        localStorage.getItem(LEGACY_KEYS.saved),
    );
  } catch {
    return false;
  }
}

/**
 * One boot per process, shared by every consumer that mounts.
 *
 * React StrictMode mounts effects twice in development; a per-component
 * "already booting" ref would let the first (cancelled) run block the second and
 * leave the page on skeletons forever. A module-level promise makes the work
 * idempotent instead: both mounts await the same result, and the migration runs
 * exactly once.
 */
let snapshotPromise: Promise<Awaited<ReturnType<typeof newsStorage.snapshot>>> | null = null;

function loadInitialSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      if (hasTauri() && hasLegacyState()) {
        try {
          const probe = await newsStorage.snapshot();
          if (probe.prefs.migratedLocalV1 !== "1") await migrateLegacyState();
        } catch (err) {
          // A failed import must never hide data that is already in the store.
          console.warn("[news] legacy import failed", err);
        }
      }
      return newsStorage.snapshot();
    })().catch((error) => {
      snapshotPromise = null;
      throw error;
    });
  }
  return snapshotPromise;
}

/**
 * Move the pre-store localStorage state into the durable store once.
 * Custom feeds are additive, read links are a set, saved/history are replayed
 * in order so the newest entries stay on top.
 */
async function migrateLegacyState(): Promise<void> {
  const legacyFeeds = readLegacy<NewsFeed[]>(LEGACY_KEYS.feeds, []);
  const legacyRead = readLegacy<string[]>(LEGACY_KEYS.read, []);
  const legacyHistory = readLegacy<HistoryEntry[]>(LEGACY_KEYS.history, []);
  const legacySaved = readLegacy<SavedArticle[]>(LEGACY_KEYS.saved, []);

  const snapshot = await newsStorage.snapshot();
  const knownUrls = new Set(snapshot.feeds.map((feed) => feed.url.toLowerCase()));
  const importedFeeds = legacyFeeds.filter((feed) => !knownUrls.has(feed.url.toLowerCase()));
  if (importedFeeds.length > 0) {
    await newsStorage.replaceFeeds([...snapshot.feeds, ...importedFeeds]);
  }

  const knownRead = new Set(snapshot.read);
  const missingRead = legacyRead.filter((link) => !knownRead.has(link));
  if (missingRead.length > 0) await newsStorage.markAllRead(missingRead);

  const knownSaved = new Set(snapshot.saved.map((entry) => entry.link));
  for (const entry of [...legacySaved].reverse()) {
    if (knownSaved.has(entry.link)) continue;
    await newsStorage.toggleSaved({
      title: entry.title,
      link: entry.link,
      description: entry.description ?? "",
      content: "",
      pubDate: entry.pubDate ?? "",
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl ?? "",
      imageUrl: entry.imageUrl ?? null,
    });
  }

  const knownHistory = new Set(snapshot.history.map((entry) => entry.link));
  for (const entry of [...legacyHistory].reverse()) {
    if (knownHistory.has(entry.link)) continue;
    await newsStorage.addHistory({
      title: entry.title,
      link: entry.link,
      description: entry.description ?? "",
      content: "",
      pubDate: entry.pubDate ?? "",
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl ?? "",
      imageUrl: entry.imageUrl ?? null,
    });
  }

  await newsStorage.setPref("migratedLocalV1", "1");
}

export function NewsProvider({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const { games } = useGames();
  const { wishlist } = useWishlist();

  const [storedFeeds, setStoredFeeds] = useState<NewsFeed[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [readLinks, setReadLinks] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<SavedArticle[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [prefs, setPrefs] = useState<NewsPrefs>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [previousVisit, setPreviousVisit] = useState(0);
  const [feedHealth, setFeedHealth] = useState<Map<string, FeedHealthStatus>>(new Map());
  const [testingHealth, setTestingHealth] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [demand, setDemand] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  const fetchingRef = useRef(false);
  const autoFetchedRef = useRef(false);

  const feeds = useMemo(() => mergeFeeds(storedFeeds, language), [storedFeeds, language]);

  const enabledFeeds = useMemo(() => feeds.filter((feed) => feed.enabled), [feeds]);

  const isoKey = useMemo(
    () => enabledFeeds.map((feed) => feed.url).sort().join("|"),
    [enabledFeeds],
  );
  const previousIsoKeyRef = useRef<string | null>(null);

  const categoryBySource = useMemo(() => categoryMapFromFeeds(feeds), [feeds]);

  const sourceNames = useMemo(
    () => [...new Set(enabledFeeds.map((feed) => feed.name))],
    [enabledFeeds],
  );

  const customFeeds = useMemo(() => feeds.filter((feed) => !feed.isDefault), [feeds]);

  const relatedGames = useMemo(() => {
    const titles: { name: string; lower: string }[] = [];
    const seen = new Set<string>();
    const push = (name: string | undefined) => {
      if (!name || name.length < 4) return;
      const lower = name.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      titles.push({ name, lower });
    };
    for (const game of games) push(game.name);
    for (const entry of wishlist) push(entry.name);
    if (titles.length === 0) return new Map<string, string>();

    const map = new Map<string, string>();
    for (const article of articles) {
      const title = article.title.toLowerCase();
      const match = titles.find((entry) => title.includes(entry.lower));
      if (match) map.set(article.link, match.name);
    }
    return map;
  }, [articles, games, wishlist]);

  const clusters = useMemo(
    () => buildClusters(articles, readLinks, categoryBySource),
    [articles, readLinks, categoryBySource],
  );

  const followedTopics = useMemo(() => parseTopicPref(prefs.followedTopics), [prefs.followedTopics]);
  const mutedTopics = useMemo(() => parseTopicPref(prefs.mutedTopics), [prefs.mutedTopics]);

  const rankContext = useMemo<RankContext>(
    () => ({ now: clock, readLinks, relatedGames, followedTopics, mutedTopics }),
    [clock, readLinks, relatedGames, followedTopics, mutedTopics],
  );

  const rankedClusters = useMemo(
    () => rankClusters(clusters, rankContext),
    [clusters, rankContext],
  );

  const savedLinks = useMemo(() => new Set(saved.map((entry) => entry.link)), [saved]);

  const applySnapshot = useCallback((snapshot: Awaited<ReturnType<typeof newsStorage.snapshot>>) => {
    setStoredFeeds(snapshot.feeds ?? []);
    setArticles((snapshot.articles ?? []).map(normaliseArticle));
    setReadLinks(new Set(snapshot.read ?? []));
    setSaved(snapshot.saved ?? []);
    setHistory(snapshot.history ?? []);
    setPrefs(snapshot.prefs ?? {});

    const refreshAt = Number(snapshot.prefs?.lastRefresh ?? 0) * 1000;
    setLastRefreshedAt(refreshAt > 0 ? refreshAt : null);
    setPreviousVisit(Number(snapshot.prefs?.lastVisit ?? 0) * 1000);
  }, []);

  const fetchAll = useCallback(
    async (currentFeeds: NewsFeed[]) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setRefreshing(true);
      setError(null);
      setFailedFeeds([]);

      const enabled = currentFeeds.filter((feed) => feed.enabled);
      const results = await Promise.all(
        enabled.map(async (feed) => {
          try {
            const xml = await fetchUrlText(feed.url);
            return { feed, articles: parseRSS(xml, feed.name, feed.url), error: null as string | null };
          } catch (err) {
            return {
              feed,
              articles: [] as NewsArticle[],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );

      const payloads: FeedPayload[] = [];
      const failed: string[] = [];
      for (const result of results) {
        if (result.error) {
          failed.push(result.feed.name);
          continue;
        }
        if (result.articles.length > 0) {
          payloads.push({
            sourceUrl: result.feed.url,
            sourceName: result.feed.name,
            articles: result.articles,
          });
        }
      }

      try {
        const merged = await newsStorage.ingest(payloads);
        setArticles(merged.map(normaliseArticle));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }

      const now = Date.now();
      setFailedFeeds(failed);
      setLastRefreshedAt(now);
      const stamp = String(Math.floor(now / 1000));
      setPrefs((prev) => ({ ...prev, lastRefresh: stamp }));
      void newsStorage.setPref("lastRefresh", stamp).catch(() => undefined);
      if (failed.length === enabled.length && enabled.length > 0) {
        setError(`${failed[0]} could not be reached`);
      }
      setRefreshing(false);
      fetchingRef.current = false;
    },
    [],
  );

  // Hydrate from the durable store once. Migration runs before the first read
  // so a user upgrading from the old localStorage hook keeps every bookmark.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await loadInitialSnapshot();
        if (cancelled) return;
        applySnapshot(snapshot);

        const nowSeconds = Math.floor(Date.now() / 1000);
        void newsStorage.setPref("lastVisit", String(nowSeconds)).catch(() => undefined);
        setPrefs((prev) => ({ ...prev, lastVisit: String(nowSeconds) }));
        setHydrated(true);
      } catch (err) {
        if (!cancelled) {
          console.error("[news] store load failed", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  // Refresh when a news surface is on screen, on first demand and when the
  // enabled feed set changes (language switch, feed toggled).
  useEffect(() => {
    if (!hydrated || demand === 0) return;
    const feedSetChanged =
      previousIsoKeyRef.current !== null && previousIsoKeyRef.current !== isoKey;
    previousIsoKeyRef.current = isoKey;

    const stale = !lastRefreshedAt || Date.now() - lastRefreshedAt > REFRESH_TTL_MS;
    const firstDemand = !autoFetchedRef.current;
    if (!firstDemand && !feedSetChanged && !stale) return;

    autoFetchedRef.current = true;
    void fetchAll(feeds);
  }, [hydrated, demand, isoKey, lastRefreshedAt, feeds, fetchAll]);

  // Keep recency ranking honest without re-rendering on every tick.
  useEffect(() => {
    if (demand === 0) return;
    const timer = setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [demand]);

  const start = useCallback(() => {
    setDemand((count) => count + 1);
  }, []);

  const persistFeeds = useCallback((next: NewsFeed[]) => {
    setStoredFeeds(next);
    void newsStorage.replaceFeeds(next).catch((err) => {
      console.warn("[news] could not persist feeds", err);
    });
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      if (!force && lastRefreshedAt && Date.now() - lastRefreshedAt < REFRESH_TTL_MS) return;
      await fetchAll(feeds);
    },
    [fetchAll, feeds, lastRefreshedAt],
  );

  const setRead = useCallback((link: string, read: boolean) => {
    setReadLinks((prev) => {
      if (read === prev.has(link)) return prev;
      const next = new Set(prev);
      if (read) next.add(link);
      else next.delete(link);
      return next;
    });
    void newsStorage.setRead(link, read).catch((err) => {
      console.warn("[news] could not persist read state", err);
    });
  }, []);

  const markRead = useCallback((link: string) => setRead(link, true), [setRead]);

  const markAllRead = useCallback(
    (links?: string[]) => {
      const targets = links ?? articles.map((article) => article.link);
      if (targets.length === 0) return;
      setReadLinks((prev) => {
        const next = new Set(prev);
        for (const link of targets) next.add(link);
        return next;
      });
      void newsStorage.markAllRead(targets).catch((err) => {
        console.warn("[news] could not mark all read", err);
      });
    },
    [articles],
  );

  const toggleSaved = useCallback(
    async (article: NewsArticle) => {
      const exists = saved.some((entry) => entry.link === article.link);
      const optimistic: SavedArticle = {
        link: article.link,
        title: article.title,
        description: article.description,
        sourceName: article.sourceName,
        sourceUrl: article.sourceUrl,
        pubDate: article.pubDate,
        imageUrl: article.imageUrl,
        savedAt: Math.floor(Date.now() / 1000),
      };
      setSaved((prev) =>
        exists ? prev.filter((entry) => entry.link !== article.link) : [optimistic, ...prev],
      );
      try {
        return await newsStorage.toggleSaved(article);
      } catch (err) {
        console.warn("[news] could not persist bookmark", err);
        setSaved((prev) =>
          exists ? [optimistic, ...prev] : prev.filter((entry) => entry.link !== article.link),
        );
        return exists;
      }
    },
    [saved],
  );

  const loadArticle = useCallback(async (link: string) => {
    try {
      const full = await newsStorage.article(link);
      if (!full) return null;
      const normalised = normaliseArticle(full);
      setArticles((prev) =>
        prev.map((article) =>
          article.link === link
            ? { ...normalised, firstSeen: article.firstSeen ?? normalised.firstSeen }
            : article,
        ),
      );
      return normalised;
    } catch (err) {
      console.warn("[news] could not load article body", err);
      return null;
    }
  }, []);

  const addToHistory = useCallback((article: NewsArticle) => {
    const entry: HistoryEntry = {
      link: article.link,
      title: article.title,
      description: article.description,
      sourceName: article.sourceName,
      sourceUrl: article.sourceUrl,
      pubDate: article.pubDate,
      imageUrl: article.imageUrl,
      readAt: Math.floor(Date.now() / 1000),
    };
    setHistory((prev) => [entry, ...prev.filter((item) => item.link !== article.link)].slice(0, 100));
    void newsStorage.addHistory(article).catch((err) => {
      console.warn("[news] could not persist history", err);
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void newsStorage.clearHistory().catch(() => undefined);
  }, []);

  const removeHistoryItem = useCallback((link: string) => {
    setHistory((prev) => prev.filter((entry) => entry.link !== link));
    void newsStorage.removeHistory(link).catch(() => undefined);
  }, []);

  const toggleFeed = useCallback(
    (url: string) => {
      const next = feeds.map((feed) =>
        feed.url === url ? { ...feed, enabled: !feed.enabled } : feed,
      );
      if (!next.some((feed, index) => feed.enabled !== feeds[index].enabled)) return;
      persistFeeds(next);
    },
    [feeds, persistFeeds],
  );

  const addCustomFeeds = useCallback(
    (entries: { name: string; url: string; category?: string }[]) => {
      const known = new Set(feeds.map((feed) => feed.url.toLowerCase()));
      const next = [...feeds];
      let added = 0;

      for (const entry of entries) {
        const url = entry.url.trim();
        const name = entry.name.trim();
        if (!url || !name) continue;
        const lower = url.toLowerCase();
        if (known.has(lower)) continue;
        if (ALL_MANAGED_FEEDS.some((feed) => feed.url.toLowerCase() === lower)) continue;
        known.add(lower);
        next.push({
          name,
          url,
          isDefault: false,
          enabled: true,
          category: entry.category ?? "general",
        });
        added += 1;
      }

      if (added > 0) persistFeeds(next);
      return added;
    },
    [feeds, persistFeeds],
  );

  const addCustomFeed = useCallback(
    (name: string, url: string, category = "general") =>
      addCustomFeeds([{ name, url, category }]) > 0,
    [addCustomFeeds],
  );

  const removeCustomFeed = useCallback(
    (url: string) => {
      persistFeeds(feeds.filter((feed) => feed.url !== url));
    },
    [feeds, persistFeeds],
  );

  const importFeedPack = useCallback(
    (packId: string) => {
      const pack = CURATED_FEED_PACKS.find((entry) => entry.id === packId);
      if (!pack) return 0;
      const known = new Set(feeds.map((feed) => feed.url.toLowerCase()));
      const added = pack.feeds.filter((feed) => !known.has(feed.url.toLowerCase()));
      if (added.length === 0) return 0;
      persistFeeds([
        ...feeds,
        ...added.map((feed) => ({
          name: feed.name,
          url: feed.url,
          isDefault: false,
          enabled: true,
          category: pack.category,
        })),
      ]);
      return added.length;
    },
    [feeds, persistFeeds],
  );

  const setPref = useCallback((key: string, value: string) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    void newsStorage.setPref(key, value).catch((err) => {
      console.warn("[news] could not persist preference", err);
    });
  }, []);

  const toggleFollowTopic = useCallback(
    (id: NewsTopicId) => {
      const next = new Set(followedTopics);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPref("followedTopics", JSON.stringify([...next]));
    },
    [followedTopics, setPref],
  );

  const toggleMuteTopic = useCallback(
    (id: NewsTopicId) => {
      const next = new Set(mutedTopics);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
      }
      setPref("mutedTopics", JSON.stringify([...next]));
    },
    [mutedTopics, setPref],
  );

  const testFeedHealth = useCallback(async () => {
    setTestingHealth(true);
    const results = await Promise.all(
      enabledFeeds.map(async (feed) => {
        const startedAt = performance.now();
        try {
          const ping = fetchUrlText(feed.url);
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("timed out")), 8000);
          });
          await Promise.race([ping, timeout]);
          const latencyMs = Math.round(performance.now() - startedAt);
          return {
            url: feed.url,
            name: feed.name,
            status: latencyMs > 1500 ? ("slow" as const) : ("ok" as const),
            latencyMs,
          };
        } catch (err) {
          return {
            url: feed.url,
            name: feed.name,
            status: "error" as const,
            latencyMs: Math.round(performance.now() - startedAt),
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    setFeedHealth(new Map(results.map((result) => [result.url, result])));
    setTestingHealth(false);
    return results;
  }, [enabledFeeds]);

  const clearCachedArticles = useCallback(async () => {
    setArticles([]);
    setLastRefreshedAt(null);
    autoFetchedRef.current = false;
    try {
      await newsStorage.clearArticles();
    } catch (err) {
      console.warn("[news] could not clear cached articles", err);
    }
  }, []);

  const value = useMemo<NewsContextValue>(
    () => ({
      feeds,
      customFeeds,
      sourceNames,
      enabledFeeds,
      articles,
      clusters,
      rankedClusters,
      readLinks,
      saved,
      savedLinks,
      history,
      prefs,
      relatedGames,
      followedTopics,
      mutedTopics,
      loading: loading || (refreshing && articles.length === 0),
      refreshing,
      hydrated,
      error,
      failedFeeds,
      lastRefreshedAt,
      previousVisit,
      feedHealth,
      testingHealth,
      start,
      refresh,
      markRead,
      setRead,
      markAllRead,
      toggleSaved,
      loadArticle,
      addToHistory,
      clearHistory,
      removeHistoryItem,
      toggleFeed,
      addCustomFeed,
      addCustomFeeds,
      removeCustomFeed,
      importFeedPack,
      setPref,
      toggleFollowTopic,
      toggleMuteTopic,
      testFeedHealth,
      clearCachedArticles,
    }),
    [
      feeds,
      customFeeds,
      sourceNames,
      enabledFeeds,
      articles,
      clusters,
      rankedClusters,
      readLinks,
      saved,
      savedLinks,
      history,
      prefs,
      relatedGames,
      followedTopics,
      mutedTopics,
      loading,
      refreshing,
      hydrated,
      error,
      failedFeeds,
      lastRefreshedAt,
      previousVisit,
      feedHealth,
      testingHealth,
      start,
      refresh,
      markRead,
      setRead,
      markAllRead,
      toggleSaved,
      loadArticle,
      addToHistory,
      clearHistory,
      removeHistoryItem,
      toggleFeed,
      addCustomFeed,
      addCustomFeeds,
      removeCustomFeed,
      importFeedPack,
      setPref,
      toggleFollowTopic,
      toggleMuteTopic,
      testFeedHealth,
      clearCachedArticles,
    ],
  );

  return <NewsContext.Provider value={value}>{children}</NewsContext.Provider>;
}

export function useNews(): NewsContextValue {
  const context = useContext(NewsContext);
  if (!context) throw new Error("useNews must be used inside NewsProvider");
  return context;
}

/**
 * Use inside a component that renders news content. Registers demand on mount
 * so the first surface on screen triggers the fetch, while the provider stays
 * idle on routes that never show news.
 */
export function useNewsDemand(): NewsContextValue {
  const news = useNews();
  const { start } = news;
  useEffect(() => {
    start();
  }, [start]);
  return news;
}
