import type { NewsCluster, NewsCardItem, NewsFilterState, NewsTimeRange } from "../../types/news";

/** Everything the filter needs that is not part of the raw article set. */
export interface FilterContext {
  /** Multiplier so saved/history views can share the same predicate. */
  categoryBySource: Map<string, string>;
}

const RANGE_MS: Record<Exclude<NewsTimeRange, "all">, number> = {
  today: 24 * 60 * 60 * 1000,
  "3days": 3 * 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

function matchesQuery(cluster: NewsCluster, query: string): boolean {
  if (!query) return true;
  const haystack = [
    cluster.lead.title,
    cluster.lead.description,
    cluster.lead.sourceName,
    ...cluster.topics,
    ...cluster.related.map((article) => article.title),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

function clusterHasImage(cluster: NewsCluster): boolean {
  return Boolean(cluster.lead.imageUrl) || cluster.related.some((article) => article.imageUrl);
}

function clusterSources(cluster: NewsCluster): string[] {
  const sources = new Set([cluster.lead.sourceName]);
  for (const article of cluster.related) sources.add(article.sourceName);
  return [...sources];
}

function newestTime(cluster: NewsCluster): number {
  return cluster.latestAt;
}

/**
 * Apply the toolbar's filters and sort. Pure and order-stable: `signal` keeps
 * whatever order the caller handed over (ranking happens upstream), every other
 * sort re-orders deterministically.
 */
export function filterClusters(
  clusters: NewsCluster[],
  state: NewsFilterState,
  _context?: FilterContext,
): NewsCluster[] {
  const cutoff =
    state.timeRange === "all" ? 0 : Date.now() - RANGE_MS[state.timeRange];

  const filtered = clusters.filter((cluster) => {
    if (state.unreadOnly && !cluster.unread) return false;
    if (state.hasImagesOnly && !clusterHasImage(cluster)) return false;
    if (cutoff > 0 && newestTime(cluster) < cutoff) return false;
    if (state.source && !clusterSources(cluster).includes(state.source)) return false;
    if (state.topics.length > 0) {
      const hasTopic = state.topics.some((topic) => cluster.topics.includes(topic));
      if (!hasTopic) return false;
    }
    return matchesQuery(cluster, state.query.trim());
  });

  switch (state.sort) {
    case "newest":
      return [...filtered].sort((a, b) => b.latestAt - a.latestAt);
    case "oldest":
      return [...filtered].sort((a, b) => a.latestAt - b.latestAt);
    case "source":
      return [...filtered].sort(
        (a, b) =>
          a.lead.sourceName.localeCompare(b.lead.sourceName) || b.latestAt - a.latestAt,
      );
    case "signal":
    default:
      return filtered;
  }
}

/** How many filters are active, for the toolbar's "Filters N" badge. */
export function activeFilterCount(state: NewsFilterState): number {
  return [
    state.timeRange !== "all",
    state.hasImagesOnly,
    state.unreadOnly,
    state.sort !== "signal",
    state.source !== null,
    state.topics.length > 0,
  ].filter(Boolean).length;
}

/** True when any filter or search would narrow the feed. */
export function isFiltered(state: NewsFilterState): boolean {
  return state.query.trim().length > 0 || activeFilterCount(state) > 0;
}

export function emptyFilterState(overrides: Partial<NewsFilterState> = {}): NewsFilterState {
  return {
    query: "",
    source: null,
    topics: [],
    unreadOnly: false,
    timeRange: "all",
    hasImagesOnly: false,
    sort: "signal",
    ...overrides,
  };
}

/**
 * The same predicates applied to saved/history cards, which are plain
 * articles rather than clusters. `signal` sort keeps the incoming order (saved
 * = newest bookmarked, history = most recently read).
 */
export function filterCardItems<T extends NewsCardItem>(
  items: T[],
  state: NewsFilterState,
  options: { ignoreUnread?: boolean; ignoreTime?: boolean } = {},
): T[] {
  const cutoff = options.ignoreTime || state.timeRange === "all" ? 0 : Date.now() - RANGE_MS[state.timeRange];
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);

  const filtered = items.filter((item) => {
    const article = item.article;
    if (state.unreadOnly && !options.ignoreUnread && !item.unread) return false;
    if (state.hasImagesOnly && !article.imageUrl) return false;
    if (state.source && article.sourceName !== state.source) return false;
    if (state.topics.length > 0 && !state.topics.some((topic) => item.topics.includes(topic))) {
      return false;
    }
    if (cutoff > 0) {
      const published = new Date(article.pubDate).getTime();
      if (!Number.isNaN(published) && published < cutoff) return false;
    }
    if (terms.length > 0) {
      const haystack = [article.title, article.description, article.sourceName, ...item.topics]
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    return true;
  });

  switch (state.sort) {
    case "newest":
      return [...filtered].sort(
        (a, b) => new Date(b.article.pubDate).getTime() - new Date(a.article.pubDate).getTime(),
      );
    case "oldest":
      return [...filtered].sort(
        (a, b) => new Date(a.article.pubDate).getTime() - new Date(b.article.pubDate).getTime(),
      );
    case "source":
      return [...filtered].sort(
        (a, b) => a.article.sourceName.localeCompare(b.article.sourceName),
      );
    case "signal":
    default:
      return filtered;
  }
}
