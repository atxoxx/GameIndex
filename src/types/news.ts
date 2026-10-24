/**
 * News domain types.
 *
 * Shared by the store (`NewsContext`), the parsers, the page and every other
 * surface that shows headlines. The Rust side mirrors these shapes with
 * `serde(rename_all = "camelCase")`.
 */

export interface NewsFeed {
  name: string;
  url: string;
  isDefault: boolean;
  enabled: boolean;
  category?: string;
  /** UI language code for regional feeds (e.g. "de"); omitted for international/custom feeds. */
  region?: string;
}

export interface NewsArticle {
  title: string;
  link: string;
  description: string;
  content: string;
  pubDate: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  /** Unix seconds the story first arrived. Persisted, so it survives restarts. */
  firstSeen?: number;
}

export interface SavedArticle {
  link: string;
  title: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  pubDate: string;
  imageUrl: string | null;
  savedAt?: number;
}

export interface HistoryEntry {
  link: string;
  title: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  pubDate: string;
  imageUrl: string | null;
  readAt: number;
}

export interface CuratedFeedPack {
  id: string;
  nameKey: string;
  descKey: string;
  icon: string;
  category: string;
  feeds: { name: string; url: string }[];
}

export interface FeedHealthStatus {
  url: string;
  name: string;
  status: "ok" | "slow" | "error";
  latencyMs: number;
  error?: string;
}

/** Destinations in the page's tab strip. Topics are filters, not tabs. */
export type NewsTab = "overview" | "feed" | "saved" | "history";

export type NewsSort = "signal" | "newest" | "oldest" | "source";

export type NewsTimeRange = "all" | "today" | "3days" | "week";

export type NewsTopicId =
  | "pc"
  | "console"
  | "tech"
  | "indie"
  | "deals"
  | "esports"
  | "patches"
  | "reviews";

export interface NewsTopic {
  id: NewsTopicId;
  /** i18n key for the chip label. */
  labelKey: string;
  /** Feed category values that imply this topic. */
  feedCategories: string[];
  patterns: RegExp[];
}

/** One story, plus the other outlets that ran it. */
export interface NewsCluster {
  /** Stable key: the lead article's link. */
  id: string;
  lead: NewsArticle;
  related: NewsArticle[];
  topics: NewsTopicId[];
  /** True when any article in the cluster is unread. */
  unread: boolean;
  /** Unix seconds of the newest article in the cluster. */
  latestAt: number;
}

export interface NewsFilterState {
  query: string;
  source: string | null;
  topics: NewsTopicId[];
  unreadOnly: boolean;
  timeRange: NewsTimeRange;
  hasImagesOnly: boolean;
  sort: NewsSort;
}

/**
 * One card's worth of data, whichever stream it comes from.
 *
 * Feed rows arrive as clusters (lead + other outlets); saved and history rows
 * have no cluster, so they fill the same shape with `related: []`. The grid and
 * the card therefore only know one type.
 */
export interface NewsCardItem {
  key: string;
  article: NewsArticle;
  related: NewsArticle[];
  topics: NewsTopicId[];
  unread: boolean;
  /** Seconds, for the saved/history meta line. */
  occurredAt?: number;
}
