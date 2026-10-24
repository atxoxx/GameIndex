import { invoke } from "@tauri-apps/api/core";
import type {
  HistoryEntry,
  NewsArticle,
  NewsFeed,
  SavedArticle,
} from "../../types/news";
import { hasTauri } from "./feed";

/**
 * Durable news store.
 *
 * Inside Tauri this is the `news` domain database (see `src-tauri/src/db/news.rs`).
 * Plain-browser dev has no backend, so the same API falls back to a single
 * localStorage document built from the keys the old hook used — that keeps
 * `npm run dev` usable and gives existing installs something to migrate from.
 */

export interface NewsPrefs {
  [key: string]: string;
}

export interface NewsSnapshot {
  feeds: NewsFeed[];
  articles: NewsArticle[];
  read: string[];
  saved: SavedArticle[];
  history: HistoryEntry[];
  prefs: NewsPrefs;
}

export interface FeedPayload {
  sourceUrl: string;
  sourceName: string;
  articles: NewsArticle[];
}

export interface NewsStorage {
  snapshot(): Promise<NewsSnapshot>;
  replaceFeeds(feeds: NewsFeed[]): Promise<void>;
  ingest(payloads: FeedPayload[]): Promise<NewsArticle[]>;
  /** Full article body (list rows intentionally omit it). */
  article(link: string): Promise<NewsArticle | null>;
  setRead(link: string, read: boolean): Promise<void>;
  markAllRead(links: string[]): Promise<void>;
  toggleSaved(article: NewsArticle): Promise<boolean>;
  addHistory(article: NewsArticle): Promise<void>;
  clearHistory(): Promise<void>;
  removeHistory(link: string): Promise<void>;
  setPref(key: string, value: string): Promise<void>;
  clearArticles(): Promise<void>;
}

// Legacy keys (pre-store). Read once for the migration, never written again.
export const LEGACY_KEYS = {
  feeds: "gamelib-news-feeds",
  cache: "gamelib-news-cache",
  read: "gamelib-news-read",
  history: "gamelib-news-history",
  saved: "gamelib.community.saved_articles",
} as const;

const LOCAL_STORE_KEY = "gamelib.news.store.v2";
const LOCAL_ARTICLE_LIMIT = 2000;
const LOCAL_ARTICLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type LocalStore = NewsSnapshot;

function emptySnapshot(): NewsSnapshot {
  return { feeds: [], articles: [], read: [], saved: [], history: [], prefs: {} };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — the UI keeps working in memory */
  }
}

/** Import the old hook's localStorage keys into the new local document. */
function importLegacyLocal(): LocalStore {
  const snapshot = emptySnapshot();
  snapshot.feeds = readJson<NewsFeed[]>(LEGACY_KEYS.feeds, []);
  snapshot.read = readJson<string[]>(LEGACY_KEYS.read, []);
  snapshot.history = readJson<HistoryEntry[]>(LEGACY_KEYS.history, []);
  snapshot.saved = readJson<SavedArticle[]>(LEGACY_KEYS.saved, []);
  const cache = readJson<{ articles?: NewsArticle[] }>(LEGACY_KEYS.cache, {});
  snapshot.articles = Array.isArray(cache.articles) ? cache.articles : [];
  return snapshot;
}

function loadLocal(): LocalStore {
  const existing = readJson<LocalStore | null>(LOCAL_STORE_KEY, null);
  if (existing && Array.isArray(existing.articles)) return existing;
  const imported = importLegacyLocal();
  writeJson(LOCAL_STORE_KEY, imported);
  return imported;
}

function saveLocal(store: LocalStore): void {
  writeJson(LOCAL_STORE_KEY, store);
}

function pruneLocalArticles(articles: NewsArticle[]): NewsArticle[] {
  const cutoff = Date.now() - LOCAL_ARTICLE_TTL_MS;
  return articles
    .filter((article) => {
      const seen = article.firstSeen ? article.firstSeen * 1000 : Date.now();
      return seen >= cutoff;
    })
    .slice(0, LOCAL_ARTICLE_LIMIT);
}

const localStore: NewsStorage = {
  async snapshot() {
    return loadLocal();
  },
  async replaceFeeds(feeds) {
    const store = loadLocal();
    saveLocal({ ...store, feeds });
  },
  async ingest(payloads) {
    const store = loadLocal();
    const now = Math.floor(Date.now() / 1000);
    const byLink = new Map(store.articles.map((article) => [article.link, article]));
    for (const payload of payloads) {
      for (const article of payload.articles) {
        if (!article.link || !article.title) continue;
        const existing = byLink.get(article.link);
        byLink.set(article.link, {
          ...article,
          firstSeen: existing?.firstSeen ?? now,
        });
      }
    }
    const articles = pruneLocalArticles([...byLink.values()]);
    saveLocal({ ...store, articles });
    return articles;
  },
  async article(link) {
    const store = loadLocal();
    return store.articles.find((article) => article.link === link) ?? null;
  },
  async setRead(link, read) {
    const store = loadLocal();
    const next = new Set(store.read);
    if (read) next.add(link);
    else next.delete(link);
    saveLocal({ ...store, read: [...next].slice(-2000) });
  },
  async markAllRead(links) {
    const store = loadLocal();
    const next = new Set(store.read);
    for (const link of links) next.add(link);
    saveLocal({ ...store, read: [...next].slice(-2000) });
  },
  async toggleSaved(article) {
    const store = loadLocal();
    const exists = store.saved.some((entry) => entry.link === article.link);
    const saved = exists
      ? store.saved.filter((entry) => entry.link !== article.link)
      : [
          {
            link: article.link,
            title: article.title,
            description: article.description,
            sourceName: article.sourceName,
            sourceUrl: article.sourceUrl,
            pubDate: article.pubDate,
            imageUrl: article.imageUrl,
            savedAt: Math.floor(Date.now() / 1000),
          },
          ...store.saved,
        ];
    saveLocal({ ...store, saved });
    return !exists;
  },
  async addHistory(article) {
    const store = loadLocal();
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
    const history = [entry, ...store.history.filter((item) => item.link !== article.link)].slice(
      0,
      100,
    );
    saveLocal({ ...store, history });
  },
  async clearHistory() {
    const store = loadLocal();
    saveLocal({ ...store, history: [] });
  },
  async removeHistory(link) {
    const store = loadLocal();
    saveLocal({ ...store, history: store.history.filter((item) => item.link !== link) });
  },
  async setPref(key, value) {
    const store = loadLocal();
    saveLocal({ ...store, prefs: { ...store.prefs, [key]: value } });
  },
  async clearArticles() {
    const store = loadLocal();
    saveLocal({ ...store, articles: [] });
  },
};

const tauriStore: NewsStorage = {
  snapshot: () => invoke<NewsSnapshot>("news_snapshot"),
  replaceFeeds: (feeds) => invoke<void>("news_replace_feeds", { feeds }),
  ingest: (payloads) =>
    invoke<NewsArticle[]>("news_ingest", {
      payloads: payloads.map((payload) => ({
        sourceUrl: payload.sourceUrl,
        sourceName: payload.sourceName,
        articles: payload.articles.map(stripInternalFields),
      })),
    }),
  article: (link) => invoke<NewsArticle | null>("news_article", { link }),
  setRead: (link, read) => invoke<void>("news_set_read", { link, read }),
  markAllRead: (links) => invoke<void>("news_mark_all_read", { links }),
  toggleSaved: (article) => invoke<boolean>("news_toggle_saved", { article: stripInternalFields(article) }),
  addHistory: (article) => invoke<void>("news_add_history", { article: stripInternalFields(article) }),
  clearHistory: () => invoke<void>("news_clear_history"),
  removeHistory: (link) => invoke<void>("news_remove_history", { link }),
  setPref: (key, value) => invoke<void>("news_set_pref", { key, value }),
  clearArticles: () => invoke<void>("news_clear_articles"),
};

/** `firstSeen` is owned by the store, never sent back to it. */
function stripInternalFields(article: NewsArticle) {
  return {
    link: article.link,
    title: article.title,
    description: article.description,
    content: article.content,
    pubDate: article.pubDate,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    imageUrl: article.imageUrl,
  };
}

export const newsStorage: NewsStorage = hasTauri() ? tauriStore : localStore;
