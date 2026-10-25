import type { NewsArticle } from "../../../types/news";
import { buildClusters } from "../../../utils/news/clusters";
import { articleTime, classifyArticle } from "./gameNewsTypes";

export interface GameNewsBriefing {
  hero: NewsArticle | null;
  /** Unread articles published since the previous visit (capped). */
  unread: NewsArticle[];
  /** Recent patch notes / hotfixes / major updates (capped). */
  patchNotes: NewsArticle[];
  unreadCount: number;
}

const BRIEFING_LIMIT = 4;

/**
 * Collapse near-identical headlines into one lead article per story.
 *
 * The per-game tab merges Steam posts, custom feeds and matched global
 * headlines, so the same announcement can arrive from three outlets. The
 * shared clusterer already solves the matching; here we keep only the lead
 * and remember how many other outlets carry it.
 */
export function clusterLeads(
  articles: NewsArticle[],
  readLinks: ReadonlySet<string>,
): { leads: NewsArticle[]; alsoByLink: Map<string, number> } {
  const clusters = buildClusters(articles, new Set(readLinks), new Map());
  const alsoByLink = new Map<string, number>();
  const leads: NewsArticle[] = [];
  for (const cluster of clusters) {
    leads.push(cluster.lead);
    if (cluster.related.length > 0) {
      alsoByLink.set(cluster.lead.link, cluster.related.length);
    }
  }
  return { leads, alsoByLink };
}

/**
 * Select the pieces of the briefing from the already-filtered article pool.
 * A cluster lead represents its whole story, so duplicates never appear in
 * either the "new" row or the patch-note list.
 */
export function buildGameNewsBriefing(
  articles: NewsArticle[],
  readLinks: ReadonlySet<string>,
  lastVisit: number,
): GameNewsBriefing {
  const sorted = [...articles].sort((a, b) => articleTime(b) - articleTime(a));
  const unreadSince = lastVisit
    ? sorted.filter(
        (article) => articleTime(article) > lastVisit && !readLinks.has(article.link),
      )
    : sorted.filter((article) => !readLinks.has(article.link));

  const patchNotes = sorted.filter((article) => {
    const classification = classifyArticle(article);
    return (
      classification === "patch" ||
      classification === "major" ||
      classification === "hotfix"
    );
  });

  return {
    hero: sorted[0] ?? null,
    unread: unreadSince.slice(0, BRIEFING_LIMIT),
    patchNotes: patchNotes.slice(0, BRIEFING_LIMIT),
    unreadCount: unreadSince.length,
  };
}

/** True when an article belongs to the requested news category. */
export function matchesNewsCategory(
  article: NewsArticle,
  category: string,
  savedLinks: ReadonlySet<string>,
  unreadLinks: ReadonlySet<string>,
): boolean {
  switch (category) {
    case "unread":
      return unreadLinks.has(article.link);
    case "patch_notes": {
      const classification = classifyArticle(article);
      return (
        classification === "patch" ||
        classification === "major" ||
        classification === "hotfix"
      );
    }
    case "official":
      return (
        classifyArticle(article) === "announcement" ||
        article.sourceName.toLowerCase().includes("steam")
      );
    case "press":
      return classifyArticle(article) === "press";
    case "saved":
      return savedLinks.has(article.link);
    default:
      return true;
  }
}
