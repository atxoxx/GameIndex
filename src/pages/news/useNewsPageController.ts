import { useCallback, useEffect, useMemo, useState } from "react";
import { useNewsDemand } from "../../context/NewsContext";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useViewDensity } from "../../hooks/useViewDensity";
import type {
  NewsCardItem,
  NewsCluster,
  NewsFilterState,
  NewsTab,
  NewsTopicId,
} from "../../types/news";
import { clusterToCardItem, historyToCardItem, savedToCardItem } from "../../utils/news/cards";
import { activeFilterCount, emptyFilterState, filterCardItems, filterClusters } from "../../utils/news/filters";
import { categoryMapFromFeeds, countTopics } from "../../utils/news/topics";
import { clustersSince } from "../../utils/news/ranking";

const PAGE_SIZE = 24;
const TAB_KEY = "gamelib.news.tab_v2";
const FILTER_KEY = "gamelib.news.filters_v2";
const TABS: NewsTab[] = ["overview", "feed", "saved", "history"];

function readFilters(): NewsFilterState {
  const base = emptyFilterState();
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<NewsFilterState>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : base.query,
      source: typeof parsed.source === "string" ? parsed.source : null,
      topics: Array.isArray(parsed.topics)
        ? (parsed.topics.filter((topic) => typeof topic === "string") as NewsTopicId[])
        : [],
      unreadOnly: parsed.unreadOnly === true,
      timeRange:
        parsed.timeRange === "today" || parsed.timeRange === "3days" || parsed.timeRange === "week"
          ? parsed.timeRange
          : "all",
      hasImagesOnly: parsed.hasImagesOnly === true,
      sort:
        parsed.sort === "newest" || parsed.sort === "oldest" || parsed.sort === "source"
          ? parsed.sort
          : "signal",
    };
  } catch {
    return base;
  }
}

/**
 * All News page state in one place.
 *
 * The page itself only renders: tabs, tab content, reader and drawer. Filters,
 * persistence, the catch-up queue and pagination live here so the page stays a
 * layout file and the behaviour can be reasoned about (and tested) on its own.
 */
export function useNewsPageController() {
  const news = useNewsDemand();
  const { density, setDensity } = useViewDensity();

  const [tab, setTab] = usePersistedState<NewsTab>(TAB_KEY, "overview", TABS);
  const [filters, setFilters] = useState<NewsFilterState>(readFilters);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<NewsCardItem | null>(null);
  const [queue, setQueue] = useState<NewsCardItem[] | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    } catch {
      /* storage unavailable — filters still work for this session */
    }
  }, [filters]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [tab, filters]);

  const categoryBySource = useMemo(() => categoryMapFromFeeds(news.feeds), [news.feeds]);

  const newClusters = useMemo(
    () => clustersSince(news.rankedClusters, news.previousVisit),
    [news.rankedClusters, news.previousVisit],
  );

  const feedItems = useMemo(
    () =>
      filterClusters(news.rankedClusters, filters).map((cluster) => clusterToCardItem(cluster)),
    [news.rankedClusters, filters],
  );

  const savedItems = useMemo(
    () =>
      filterCardItems(
        news.saved.map((entry) => savedToCardItem(entry, news.readLinks, categoryBySource)),
        filters,
        { ignoreUnread: true, ignoreTime: true },
      ),
    [news.saved, news.readLinks, categoryBySource, filters],
  );

  const historyItems = useMemo(
    () =>
      filterCardItems(
        news.history.map((entry) => historyToCardItem(entry, categoryBySource)),
        filters,
        { ignoreUnread: true, ignoreTime: true },
      ),
    [news.history, categoryBySource, filters],
  );

  const overviewClusters = news.rankedClusters;

  const activeItems = useMemo(() => {
    if (tab === "feed") return feedItems;
    if (tab === "saved") return savedItems;
    if (tab === "history") return historyItems;
    return [];
  }, [tab, feedItems, savedItems, historyItems]);

  /** The briefing's reader queue: the head of the ranked feed. */
  const overviewQueue = useMemo(
    () => overviewClusters.slice(0, 40).map((cluster) => clusterToCardItem(cluster)),
    [overviewClusters],
  );

  const visibleItems = useMemo(
    () => (tab === "overview" ? activeItems : activeItems.slice(0, visibleCount)),
    [tab, activeItems, visibleCount],
  );

  const unreadTotal = useMemo(
    () => news.rankedClusters.filter((cluster) => cluster.unread).length,
    [news.rankedClusters],
  );

  const counts = useMemo<Record<NewsTab, number>>(
    () => ({
      overview: newClusters.length > 0 ? newClusters.length : news.rankedClusters.length,
      feed: feedItems.length,
      saved: savedItems.length,
      history: historyItems.length,
    }),
    [newClusters.length, news.rankedClusters.length, feedItems.length, savedItems.length, historyItems.length],
  );

  const topics = useMemo(
    () => countTopics(news.articles, categoryBySource),
    [news.articles, categoryBySource],
  );

  /* ── actions ─────────────────────────────────────────────────────── */

  const updateFilters = useCallback(
    (patch: Partial<NewsFilterState>) => {
      setFilters((prev) => ({ ...prev, ...patch }));
      // Typing a search on the briefing means "find me this story", not
      // "filter the shelf I am looking at".
      if (patch.query !== undefined && tab === "overview") setTab("feed");
    },
    [tab, setTab],
  );

  const resetFilters = useCallback(() => setFilters(emptyFilterState()), []);

  const openItem = useCallback(
    (item: NewsCardItem, nextQueue?: NewsCardItem[] | null) => {
      news.markRead(item.article.link);
      news.addToHistory(item.article);
      setQueue(nextQueue ?? null);
      setSelected(item);
      // List rows carry no body; pull it for the reader only.
      if (!item.article.content) void news.loadArticle(item.article.link);
    },
    [news],
  );

  const openCluster = useCallback(
    (cluster: NewsCluster) => openItem(clusterToCardItem(cluster)),
    [openItem],
  );

  /** Rail cards open with the briefing queue so next/prev stays in context. */
  const openOverviewItem = useCallback(
    (item: NewsCardItem) => openItem(item, overviewQueue),
    [openItem, overviewQueue],
  );

  const closePreview = useCallback(() => {
    setSelected(null);
    setQueue(null);
  }, []);

  const toggleSave = useCallback(
    (item: NewsCardItem) => {
      void news.toggleSaved(item.article);
    },
    [news],
  );

  const toggleRead = useCallback(
    (item: NewsCardItem) => {
      news.setRead(item.article.link, !news.readLinks.has(item.article.link));
    },
    [news],
  );

  const markAllRead = useCallback(() => {
    news.markAllRead(news.articles.map((article) => article.link));
  }, [news]);

  const selectTopic = useCallback(
    (topic: NewsTopicId) => {
      setTab("feed");
      setFilters((prev) => ({
        ...prev,
        topics: prev.topics.includes(topic)
          ? prev.topics.filter((entry) => entry !== topic)
          : [...prev.topics, topic],
      }));
    },
    [setTab],
  );

  const startCatchUp = useCallback(
    (clusters: NewsCluster[]) => {
      const items = clusters.map((cluster) => clusterToCardItem(cluster));
      if (items.length === 0) return;
      setTab("feed");
      openItem(items[0], items);
    },
    [openItem, setTab],
  );

  const openFeed = useCallback(
    (options: { unreadOnly?: boolean; topics?: NewsTopicId[] } = {}) => {
      setTab("feed");
      setFilters((prev) => ({
        ...prev,
        unreadOnly: options.unreadOnly ?? false,
        topics: options.topics ?? [],
        source: null,
      }));
    },
    [setTab],
  );

  /* ── preview navigation ──────────────────────────────────────────── */

  const navigationQueue = queue ?? activeItems;
  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    return navigationQueue.findIndex((item) => item.key === selected.key);
  }, [selected, navigationQueue]);

  /** The reader shows the store's copy so a freshly loaded body is visible. */
  const selectedArticle = useMemo(() => {
    if (!selected) return null;
    return (
      news.articles.find((article) => article.link === selected.article.link) ?? selected.article
    );
  }, [selected, news.articles]);

  const goTo = useCallback(
    (offset: -1 | 1) => {
      if (selectedIndex < 0) return;
      const next = navigationQueue[selectedIndex + offset];
      if (!next) return;
      news.markRead(next.article.link);
      news.addToHistory(next.article);
      setSelected(next);
    },
    [navigationQueue, news, selectedIndex],
  );

  return {
    news,
    density,
    setDensity,
    tab,
    setTab,
    filters,
    updateFilters,
    resetFilters,
    filterCount: activeFilterCount(filters),
    topics,
    counts,
    unreadTotal,
    newClusters,
    overviewClusters,
    feedItems,
    visibleItems,
    totalVisible: activeItems.length,
    hasMore: tab !== "overview" && visibleCount < activeItems.length,
    loadMore: () => setVisibleCount((count) => count + PAGE_SIZE),
    selected,
    selectedArticle,
    savedSelected: selected ? news.savedLinks.has(selected.article.link) : false,
    hasPrev: selectedIndex > 0,
    hasNext: selectedIndex >= 0 && selectedIndex < navigationQueue.length - 1,
    goPrev: () => goTo(-1),
    goNext: () => goTo(1),
    openItem,
    openCluster,
    openOverviewItem,
    closePreview,
    toggleSave,
    toggleRead,
    markAllRead,
    selectTopic,
    startCatchUp,
    openFeed,
    sourcesOpen,
    setSourcesOpen,
  };
}

export type NewsPageController = ReturnType<typeof useNewsPageController>;
