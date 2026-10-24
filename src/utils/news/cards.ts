import type {
  HistoryEntry,
  NewsCardItem,
  NewsCluster,
  SavedArticle,
} from "../../types/news";
import { topicsForArticle } from "./topics";

/** Cluster → card item (feed and rail rows). */
export function clusterToCardItem(cluster: NewsCluster): NewsCardItem {
  return {
    key: cluster.id,
    article: cluster.lead,
    related: cluster.related,
    topics: cluster.topics,
    unread: cluster.unread,
  };
}

/** Saved article → card item; topics are re-inferred because they are not stored. */
export function savedToCardItem(
  entry: SavedArticle,
  readLinks: Set<string>,
  categoryBySource?: Map<string, string>,
): NewsCardItem {
  return {
    key: `saved:${entry.link}`,
    article: {
      title: entry.title,
      link: entry.link,
      description: entry.description ?? "",
      content: "",
      pubDate: entry.pubDate ?? "",
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl ?? "",
      imageUrl: entry.imageUrl ?? null,
      firstSeen: entry.savedAt,
    },
    related: [],
    topics: topicsForArticle(entry, categoryBySource?.get(entry.sourceName)),
    unread: !readLinks.has(entry.link),
    occurredAt: entry.savedAt,
  };
}

/** Reading-history entry → card item. */
export function historyToCardItem(
  entry: HistoryEntry,
  categoryBySource?: Map<string, string>,
): NewsCardItem {
  return {
    key: `history:${entry.link}`,
    article: {
      title: entry.title,
      link: entry.link,
      description: entry.description ?? "",
      content: "",
      pubDate: entry.pubDate ?? "",
      sourceName: entry.sourceName,
      sourceUrl: entry.sourceUrl ?? "",
      imageUrl: entry.imageUrl ?? null,
      firstSeen: entry.readAt,
    },
    related: [],
    topics: topicsForArticle(entry, categoryBySource?.get(entry.sourceName)),
    unread: false,
    occurredAt: entry.readAt,
  };
}
