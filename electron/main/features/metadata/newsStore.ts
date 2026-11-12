/**
 * Durable news store.
 *
 * Mirrors `db/news.rs` + `news.rs` on top of `state/jsonStore.ts`:
 * feeds, merged article rows, read links, bookmarks, reading history and
 * reader preferences live in one document (`userData/news.json`).
 *
 * Article bodies are stored but omitted from `news_snapshot`/`news_ingest`
 * responses; the reader fetches the one body it opens through `news_article`.
 */
import { createJsonStore } from "../../state/jsonStore";

export interface NewsFeedRecord {
  url: string;
  name: string;
  category: string;
  region?: string | null;
  isDefault: boolean;
  enabled: boolean;
}

export interface NewsArticleRecord {
  link: string;
  title: string;
  description: string;
  content: string;
  pubDate: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  firstSeen: number;
  /** Internal: last fetch time, used only to order the snapshot. */
  fetchedAt?: number;
}

export interface NewsArticleInput {
  link: string;
  title: string;
  description?: string;
  content?: string;
  pubDate?: string;
  sourceName: string;
  sourceUrl?: string;
  imageUrl?: string | null;
}

export interface NewsSavedRecord {
  link: string;
  title: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  pubDate: string;
  imageUrl: string | null;
  savedAt: number;
}

export interface NewsHistoryRecord {
  link: string;
  title: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  pubDate: string;
  imageUrl: string | null;
  readAt: number;
}

export interface FeedPayload {
  sourceUrl: string;
  sourceName: string;
  articles: NewsArticleInput[];
}

export interface NewsSnapshot {
  feeds: NewsFeedRecord[];
  articles: NewsArticleRecord[];
  read: string[];
  saved: NewsSavedRecord[];
  history: NewsHistoryRecord[];
  prefs: Record<string, string>;
}

interface NewsDocument extends NewsSnapshot {
  version: 1;
  updatedAt: string;
}

const ARTICLE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ARTICLES = 2000;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_CONTENT_CHARS = 40_000;
const MAX_READ_LINKS = 2000;
const MAX_HISTORY = 100;

function emptyDocument(): NewsDocument {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    feeds: [],
    articles: [],
    read: [],
    saved: [],
    history: [],
    prefs: {},
  };
}

const store = createJsonStore<NewsDocument>("news.json", emptyDocument, (value) => {
  const document = value as Partial<NewsDocument>;
  return {
    version: 1,
    updatedAt: document.updatedAt ?? new Date().toISOString(),
    feeds: Array.isArray(document.feeds) ? document.feeds : [],
    articles: Array.isArray(document.articles) ? document.articles : [],
    read: Array.isArray(document.read) ? document.read : [],
    saved: Array.isArray(document.saved) ? document.saved : [],
    history: Array.isArray(document.history) ? document.history : [],
    prefs:
      document.prefs && typeof document.prefs === "object" && !Array.isArray(document.prefs)
        ? document.prefs
        : {},
  };
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clip(value: string | undefined, max: number): string {
  const text = value ?? "";
  return text.length <= max ? text : text.slice(0, max);
}

function normalizeFeed(feed: Partial<NewsFeedRecord>): NewsFeedRecord {
  return {
    url: String(feed.url ?? "").trim(),
    name: String(feed.name ?? "").trim(),
    category: String(feed.category ?? "general"),
    region: feed.region ?? null,
    isDefault: Boolean(feed.isDefault),
    enabled: feed.enabled !== false,
  };
}

function articleRow(article: NewsArticleRecord, includeContent: boolean): NewsArticleRecord {
  return {
    link: article.link,
    title: article.title,
    description: article.description,
    content: includeContent ? article.content : "",
    pubDate: article.pubDate,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    imageUrl: article.imageUrl,
    firstSeen: article.firstSeen,
  };
}

function fetchedAtOf(article: NewsArticleRecord): number {
  return article.fetchedAt ?? article.firstSeen;
}

function snapshotOf(document: NewsDocument): NewsSnapshot {
  return {
    feeds: [...document.feeds],
    articles: [...document.articles]
      .sort((a, b) => fetchedAtOf(b) - fetchedAtOf(a))
      .slice(0, MAX_ARTICLES)
      .map((article) => articleRow(article, false)),
    read: [...document.read],
    saved: [...document.saved].sort((a, b) => b.savedAt - a.savedAt),
    history: [...document.history].sort((a, b) => b.readAt - a.readAt),
    prefs: { ...document.prefs },
  };
}

export function newsSnapshot(): NewsSnapshot {
  return snapshotOf(store.read());
}

export function replaceFeeds(feeds: Partial<NewsFeedRecord>[]): void {
  store.update((document) => ({
    ...document,
    updatedAt: new Date().toISOString(),
    feeds: feeds.map(normalizeFeed).filter((feed) => feed.url && feed.name),
  }));
}

export function ingest(payloads: FeedPayload[]): NewsArticleRecord[] {
  const now = nowSeconds();
  store.update((document) => {
    const byLink = new Map(document.articles.map((article) => [article.link, article]));
    for (const payload of payloads) {
      for (const article of payload.articles) {
        const link = article.link?.trim();
        const title = article.title?.trim();
        if (!link || !title) continue;
        const existing = byLink.get(link);
        byLink.set(link, {
          link,
          title,
          description: clip(article.description, MAX_DESCRIPTION_CHARS),
          content: clip(article.content, MAX_CONTENT_CHARS),
          pubDate: article.pubDate ?? "",
          sourceName: article.sourceName ?? payload.sourceName,
          sourceUrl: article.sourceUrl ?? payload.sourceUrl,
          imageUrl: article.imageUrl ?? null,
          firstSeen: existing?.firstSeen ?? now,
          fetchedAt: now,
        });
      }
    }
    const cutoff = now - ARTICLE_TTL_SECONDS;
    const articles = [...byLink.values()]
      .filter((article) => fetchedAtOf(article) >= cutoff)
      .sort((a, b) => fetchedAtOf(b) - fetchedAtOf(a))
      .slice(0, MAX_ARTICLES);
    return { ...document, updatedAt: new Date().toISOString(), articles };
  });
  return newsSnapshot().articles;
}

export function readArticle(link: string): NewsArticleRecord | null {
  const article = store.read().articles.find((entry) => entry.link === link);
  return article ? { ...article } : null;
}

export function setRead(link: string, read: boolean): void {
  store.update((document) => {
    const links = document.read.filter((entry) => entry !== link);
    if (read) links.push(link);
    return {
      ...document,
      updatedAt: new Date().toISOString(),
      read: links.slice(-MAX_READ_LINKS),
    };
  });
}

export function markAllRead(links: string[]): void {
  store.update((document) => {
    const known = new Set(document.read);
    for (const link of links) known.add(link);
    return {
      ...document,
      updatedAt: new Date().toISOString(),
      read: [...known].slice(-MAX_READ_LINKS),
    };
  });
}

export function toggleSaved(article: NewsArticleInput): boolean {
  let saved = false;
  store.update((document) => {
    const exists = document.saved.some((entry) => entry.link === article.link);
    saved = !exists;
    const next = exists
      ? document.saved.filter((entry) => entry.link !== article.link)
      : [
          {
            link: article.link,
            title: article.title,
            description: article.description ?? "",
            sourceName: article.sourceName,
            sourceUrl: article.sourceUrl ?? "",
            pubDate: article.pubDate ?? "",
            imageUrl: article.imageUrl ?? null,
            savedAt: nowSeconds(),
          },
          ...document.saved,
        ];
    return { ...document, updatedAt: new Date().toISOString(), saved: next };
  });
  return saved;
}

export function addHistory(article: NewsArticleInput): void {
  store.update((document) => {
    const entry: NewsHistoryRecord = {
      link: article.link,
      title: article.title,
      description: article.description ?? "",
      sourceName: article.sourceName,
      sourceUrl: article.sourceUrl ?? "",
      pubDate: article.pubDate ?? "",
      imageUrl: article.imageUrl ?? null,
      readAt: nowSeconds(),
    };
    const history = [entry, ...document.history.filter((item) => item.link !== article.link)].slice(
      0,
      MAX_HISTORY,
    );
    return { ...document, updatedAt: new Date().toISOString(), history };
  });
}

export function clearHistory(): void {
  store.update((document) => ({
    ...document,
    updatedAt: new Date().toISOString(),
    history: [],
  }));
}

export function removeHistory(link: string): void {
  store.update((document) => ({
    ...document,
    updatedAt: new Date().toISOString(),
    history: document.history.filter((entry) => entry.link !== link),
  }));
}

export function setPref(key: string, value: string): void {
  store.update((document) => ({
    ...document,
    updatedAt: new Date().toISOString(),
    prefs: { ...document.prefs, [key]: value },
  }));
}

export function clearArticles(): void {
  store.update((document) => ({
    ...document,
    updatedAt: new Date().toISOString(),
    articles: [],
  }));
}
