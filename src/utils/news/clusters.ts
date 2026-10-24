import type { NewsArticle, NewsCluster, NewsTopicId } from "../../types/news";
import { topicsForArticle } from "./topics";

/**
 * Story clustering.
 *
 * The same announcement reaches PC Gamer, Eurogamer and IGN within minutes, so
 * a raw feed shows one story seven times. Clusters collapse near-identical
 * *headlines* (not just matching URLs) into one card and keep the other outlets
 * as "also covered by" links.
 *
 * Kept deliberately dependency-free and linear-ish: token postings narrow the
 * candidate pairs, so 2,000 articles never become a 2,000² comparison.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "as", "at", "by", "from", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "will", "has", "have", "had",
  "after", "before", "over", "into", "up", "out", "how", "why", "what", "who",
  "when", "where", "more", "than", "not", "you", "your", "we", "our", "their",
  "they", "he", "she", "now", "new", "here", "there", "about", "just", "also",
  "says", "said", "could", "would", "should", "can", "may", "might", "get",
  "gets", "got", "make", "makes", "made", "off", "via", "while", "still",
]);

/** Words that carry no story identity but appear in many headlines. */
const GENERIC = new Set([
  "game", "games", "gaming", "news", "update", "report", "official", "first",
  "latest", "today", "week", "launch", "reveal", "revealed", "announced",
]);

/** Lowercase words with punctuation stripped, minus stopwords and generics. */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !GENERIC.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Two headlines describe the same story when they share enough uncommon words.
 * Short headlines need a higher ratio; longer ones tolerate rephrasing.
 */
function sameStory(a: Set<string>, b: Set<string>, shared: number): boolean {
  if (shared < 2) return false;
  const minSize = Math.min(a.size, b.size);
  // Longer headlines get rephrased by each outlet ("…finally gets a release
  // date" / "…release date announced"), so containment matters more than an
  // exact set match.
  if (shared >= 3 && shared / minSize >= 0.6) return true;
  if (minSize <= 3 && shared / minSize >= 0.66) return true;
  return jaccard(a, b) >= 0.65;
}

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }

  find(index: number): number {
    let root = index;
    while (this.parent[root] !== root) root = this.parent[root];
    let cursor = index;
    while (this.parent[cursor] !== cursor) {
      const next = this.parent[cursor];
      this.parent[cursor] = root;
      cursor = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] += 1;
    }
  }
}

function timestamp(article: NewsArticle): number {
  const pub = new Date(article.pubDate).getTime();
  if (!Number.isNaN(pub)) return pub;
  if (article.firstSeen) return article.firstSeen * 1000;
  return 0;
}

/** The article that should represent its cluster on a card. */
function pickLead(articles: NewsArticle[]): NewsArticle {
  return [...articles].sort((a, b) => {
    const imageDelta = Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl));
    if (imageDelta !== 0) return imageDelta;
    const descriptionDelta = (b.description?.length ?? 0) - (a.description?.length ?? 0);
    if (descriptionDelta !== 0) return descriptionDelta;
    const seenA = a.firstSeen ?? Number.MAX_SAFE_INTEGER;
    const seenB = b.firstSeen ?? Number.MAX_SAFE_INTEGER;
    if (seenA !== seenB) return seenA - seenB;
    return timestamp(b) - timestamp(a);
  })[0];
}

/**
 * Group articles into story clusters.
 *
 * `readLinks` decides the cluster's unread flag, `categoryBySource` feeds the
 * topic inference (a pc-gamer story is implicitly a PC story).
 */
export function buildClusters(
  articles: NewsArticle[],
  readLinks: Set<string>,
  categoryBySource: Map<string, string>,
): NewsCluster[] {
  if (articles.length === 0) return [];

  const tokenSets = articles.map((article) => new Set(titleTokens(article.title)));
  const unions = new UnionFind(articles.length);
  const postings = new Map<string, number[]>();

  tokenSets.forEach((tokens, index) => {
    for (const token of tokens) {
      const bucket = postings.get(token);
      if (bucket) bucket.push(index);
      else postings.set(token, [index]);
    }
  });

  tokenSets.forEach((tokens, index) => {
    const shared = new Map<number, number>();
    for (const token of tokens) {
      const bucket = postings.get(token);
      if (!bucket || bucket.length > 60) continue; // too common to be a signal
      for (const other of bucket) {
        if (other <= index) continue;
        shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    for (const [other, count] of shared) {
      if (sameStory(tokens, tokenSets[other], count)) unions.union(index, other);
    }
  });

  const groups = new Map<number, NewsArticle[]>();
  articles.forEach((article, index) => {
    const root = unions.find(index);
    const group = groups.get(root);
    if (group) group.push(article);
    else groups.set(root, [article]);
  });

  const clusters: NewsCluster[] = [];
  for (const group of groups.values()) {
    const lead = pickLead(group);
    const topics: NewsTopicId[] = topicsForArticle(
      lead,
      categoryBySource.get(lead.sourceName),
    );
    const related = group
      .filter((article) => article.link !== lead.link)
      .sort((a, b) => timestamp(b) - timestamp(a));
    const latestAt = Math.max(...group.map(timestamp));
    const unread = group.some((article) => !readLinks.has(article.link));

    clusters.push({
      id: lead.link,
      lead,
      related,
      topics,
      unread,
      latestAt,
    });
  }

  return clusters.sort((a, b) => b.latestAt - a.latestAt);
}

/** One cluster flattened back into ordered articles (lead first). */
export function clusterArticles(cluster: NewsCluster): NewsArticle[] {
  return [cluster.lead, ...cluster.related];
}

/** Every article across every cluster, deduped by link. */
export function flattenClusters(clusters: NewsCluster[]): NewsArticle[] {
  const seen = new Set<string>();
  const out: NewsArticle[] = [];
  for (const cluster of clusters) {
    for (const article of clusterArticles(cluster)) {
      if (seen.has(article.link)) continue;
      seen.add(article.link);
      out.push(article);
    }
  }
  return out;
}
