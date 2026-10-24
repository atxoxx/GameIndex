import type { NewsArticle, NewsCluster, NewsTopicId } from "../../types/news";

/**
 * Feed ordering.
 *
 * "Newest first" is the honest default for a firehose, but it buries the two
 * things a returning reader actually cares about: their own games and the
 * topics they follow. Signal ranking blends recency, unread state, library
 * matches and followed topics, then spreads sources so one outlet cannot own
 * the top of the page. The Feed tab exposes a Newest-first toggle for people
 * who want strict chronology.
 */

export interface RankContext {
  /** Milliseconds; injected so ranking is deterministic in tests. */
  now: number;
  readLinks: Set<string>;
  /** Article link → matched library/wishlist title. */
  relatedGames: Map<string, string>;
  followedTopics: Set<NewsTopicId>;
  mutedTopics: Set<NewsTopicId>;
}

/** Half-life of the recency weight, in hours. */
const RECENCY_HALF_LIFE_HOURS = 36;

function articleTime(article: NewsArticle): number {
  const pub = new Date(article.pubDate).getTime();
  if (!Number.isNaN(pub)) return pub;
  if (article.firstSeen) return article.firstSeen * 1000;
  return 0;
}

export function clusterRelatedGame(
  cluster: NewsCluster,
  relatedGames: Map<string, string>,
): string | null {
  for (const article of [cluster.lead, ...cluster.related]) {
    const match = relatedGames.get(article.link);
    if (match) return match;
  }
  return null;
}

export function scoreCluster(cluster: NewsCluster, context: RankContext): number {
  const articleTimeMs = articleTime(cluster.lead) || cluster.latestAt;
  const hoursOld = articleTimeMs > 0 ? Math.max(0, (context.now - articleTimeMs) / 3_600_000) : 240;
  const recency = Math.pow(0.5, hoursOld / RECENCY_HALF_LIFE_HOURS) * 48;

  let score = recency;
  if (cluster.unread) score += 12;
  if (clusterRelatedGame(cluster, context.relatedGames)) score += 30;
  if (cluster.lead.imageUrl) score += 4;

  const followedHits = cluster.topics.filter((topic) => context.followedTopics.has(topic)).length;
  score += Math.min(followedHits, 2) * 11;

  return Math.round(score * 100) / 100;
}

export function isClusterMuted(cluster: NewsCluster, context: RankContext): boolean {
  return cluster.topics.some((topic) => context.mutedTopics.has(topic));
}

function byNewest(a: NewsCluster, b: NewsCluster): number {
  return b.latestAt - a.latestAt;
}

/**
 * Order clusters by signal, then spread sources: after two consecutive cards
 * from the same outlet, the next different one is pulled forward. Without this
 * a single prolific feed can fill the first screen even when its stories score
 * individually.
 */
function diversifySources(clusters: NewsCluster[]): NewsCluster[] {
  const remaining = [...clusters];
  const ordered: NewsCluster[] = [];
  let lastSource: string | null = null;
  let run = 0;

  while (remaining.length > 0) {
    let pick = 0;
    const firstSource = remaining[0].lead.sourceName;
    if (lastSource === firstSource && run >= 2) {
      const alternative = remaining.findIndex((cluster) => cluster.lead.sourceName !== lastSource);
      if (alternative > 0 && alternative <= 5) pick = alternative;
    }
    const [next] = remaining.splice(pick, 1);
    run = next.lead.sourceName === lastSource ? run + 1 : 1;
    lastSource = next.lead.sourceName;
    ordered.push(next);
  }
  return ordered;
}

export function rankClusters(clusters: NewsCluster[], context: RankContext, now = context.now): NewsCluster[] {
  const visible = clusters.filter((cluster) => !isClusterMuted(cluster, context));
  const scored = visible
    .map((cluster) => ({ cluster, score: scoreCluster(cluster, { ...context, now }) }))
    .sort((a, b) => b.score - a.score || byNewest(a.cluster, b.cluster));
  return diversifySources(scored.map((entry) => entry.cluster));
}

/** A cluster is new when any of its articles arrived after `sinceMs`. */
export function clusterIsNew(cluster: NewsCluster, sinceMs: number): boolean {
  if (sinceMs <= 0) return false;
  return [cluster.lead, ...cluster.related].some(
    (article) => (article.firstSeen ?? 0) * 1000 > sinceMs,
  );
}

/** Clusters whose story arrived after `sinceMs` (0 = nothing is "new"). */
export function countNewSince(clusters: NewsCluster[], sinceMs: number): number {
  if (sinceMs <= 0) return 0;
  return clusters.filter((cluster) => clusterIsNew(cluster, sinceMs)).length;
}

export function clustersSince(clusters: NewsCluster[], sinceMs: number): NewsCluster[] {
  if (sinceMs <= 0) return [];
  return clusters.filter((cluster) => clusterIsNew(cluster, sinceMs));
}
