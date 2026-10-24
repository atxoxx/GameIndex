import type { NewsArticle, NewsTopic, NewsTopicId } from "../../types/news";

/**
 * Topic vocabulary.
 *
 * The old page treated PC / Console / Tech / Indie / Deals / Esports as
 * mutually exclusive tabs while classifying them with keyword regexes, so one
 * article could be counted in several tabs and still live in none. Topics are
 * closer to the truth: an article carries whatever applies, the Feed filters on
 * them, and the user can pin or mute them.
 */
export const NEWS_TOPICS: NewsTopic[] = [
  {
    id: "pc",
    labelKey: "news.tabPc",
    feedCategories: ["pc"],
    patterns: [
      /\bpc gaming\b/i,
      /\bsteam deck\b/i,
      /\bsteam\b/i,
      /\bepic games store\b/i,
      /\bgog\b/i,
      /\bbattle\.net\b/i,
      /\bwindows\b/i,
      /\bgeforce\b/i,
      /\brtx\b/i,
      /\bdlss\b/i,
    ],
  },
  {
    id: "console",
    labelKey: "news.tabConsole",
    feedCategories: ["console"],
    patterns: [
      /\bplaystation\b/i,
      /\bps5\b/i,
      /\bps4\b/i,
      /\bxbox\b/i,
      /\bnintendo\b/i,
      /\bswitch 2\b/i,
      /\bswitch\b/i,
      /\bsony\b/i,
      /\bgame pass\b/i,
    ],
  },
  {
    id: "tech",
    labelKey: "news.tabTech",
    feedCategories: ["tech"],
    patterns: [
      /\bgpu\b/i,
      /\bcpu\b/i,
      /\bnvidia\b/i,
      /\bamd\b/i,
      /\bintel\b/i,
      /\bhardware\b/i,
      /\bmonitor\b/i,
      /\bmotherboard\b/i,
      /\bhandheld\b/i,
      /\bfirmware\b/i,
    ],
  },
  {
    id: "indie",
    labelKey: "news.tabIndie",
    feedCategories: ["indie"],
    patterns: [/\bindie\b/i, /\bearly access\b/i, /\bitch\.io\b/i],
  },
  {
    id: "deals",
    labelKey: "news.tabDeals",
    feedCategories: ["deals"],
    patterns: [
      /\bdeal\b/i,
      /\bdiscount\b/i,
      /\bsale\b/i,
      /\bgiveaway\b/i,
      /\bfree game\b/i,
      /\bprice drop\b/i,
      /\d+% off\b/i,
    ],
  },
  {
    id: "esports",
    labelKey: "news.tabEsports",
    feedCategories: ["esports"],
    patterns: [/\besports?\b/i, /\btournament\b/i, /\bchampionship\b/i, /\bworlds\b/i, /\bmajor\b/i],
  },
  {
    id: "patches",
    labelKey: "news.topicPatches",
    feedCategories: [],
    patterns: [
      /\bpatch notes\b/i,
      /\bhotfix\b/i,
      /\bupdate \d/i,
      /\bseason \d/i,
      /\broadmap\b/i,
      /\bbalance changes\b/i,
    ],
  },
  {
    id: "reviews",
    labelKey: "news.topicReviews",
    feedCategories: [],
    patterns: [/\breview\b/i, /\bverdict\b/i, /\bhands-on\b/i, /\bimpressions\b/i, /\bpreview\b/i],
  },
];

const TOPIC_BY_ID = new Map<string, NewsTopic>(NEWS_TOPICS.map((topic) => [topic.id, topic]));

export function isNewsTopicId(value: string): value is NewsTopicId {
  return TOPIC_BY_ID.has(value);
}

/**
 * Every topic an article belongs to: the feed's own category plus whatever the
 * headline and summary match. Ordered by the vocabulary, so chips are stable.
 */
export function topicsForArticle(
  article: Pick<NewsArticle, "title" | "description">,
  feedCategory?: string | null,
): NewsTopicId[] {
  const text = `${article.title} ${article.description ?? ""}`;
  const category = (feedCategory ?? "").toLowerCase();
  const matched: NewsTopicId[] = [];

  for (const topic of NEWS_TOPICS) {
    if (category && topic.feedCategories.includes(category)) {
      matched.push(topic.id);
      continue;
    }
    if (topic.patterns.some((pattern) => pattern.test(text))) {
      matched.push(topic.id);
    }
  }
  return matched;
}

/** Topics with how many articles carry them, most frequent first. */
export function countTopics(
  articles: NewsArticle[],
  categoryBySource: Map<string, string>,
): { id: NewsTopicId; count: number }[] {
  const counts = new Map<NewsTopicId, number>();
  for (const article of articles) {
    for (const id of topicsForArticle(article, categoryBySource.get(article.sourceName))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return NEWS_TOPICS.map((topic) => ({ id: topic.id, count: counts.get(topic.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Source → feed category, used for topic inference and the source filter. */
export function categoryMapFromFeeds(feeds: { name: string; category?: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const feed of feeds) {
    if (feed.category) map.set(feed.name.toLowerCase(), feed.category.toLowerCase());
  }
  return map;
}
