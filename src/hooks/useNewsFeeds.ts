import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────

export type NewsCategory =
  | "all"
  | "for_you"
  | "pc"
  | "console"
  | "tech"
  | "indie"
  | "deals"
  | "esports"
  | "saved"
  | "history";

export interface NewsFeed {
  name: string;
  url: string;
  isDefault: boolean;
  enabled: boolean;
  category?: string;
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

export interface HistoryEntry {
  link: string;
  title: string;
  sourceName: string;
  pubDate: string;
  imageUrl: string | null;
  readAt: number;
}

// ── Default Gaming News RSS Feeds ──────────────────────────────────────

export const DEFAULT_FEEDS: NewsFeed[] = [
  {
    name: "PC Gamer",
    url: "https://www.pcgamer.com/rss/",
    isDefault: true,
    enabled: true,
    category: "pc",
  },
  {
    name: "Rock Paper Shotgun",
    url: "https://www.rockpapershotgun.com/feed",
    isDefault: true,
    enabled: true,
    category: "pc",
  },
  {
    name: "Eurogamer",
    url: "https://www.eurogamer.net/feed",
    isDefault: true,
    enabled: true,
    category: "general",
  },
  {
    name: "Gematsu",
    url: "https://www.gematsu.com/feed",
    isDefault: true,
    enabled: true,
    category: "console",
  },
  {
    name: "Kotaku",
    url: "https://kotaku.com/rss",
    isDefault: true,
    enabled: true,
    category: "general",
  },
  {
    name: "IGN",
    url: "https://feeds.feedburner.com/ign/all",
    isDefault: true,
    enabled: true,
    category: "general",
  },
  {
    name: "VGC",
    url: "https://www.videogameschronicle.com/feed/",
    isDefault: true,
    enabled: true,
    category: "general",
  },
];

export const CURATED_FEED_PACKS: CuratedFeedPack[] = [
  {
    id: "deals_pack",
    nameKey: "news.packDealsTitle",
    descKey: "news.packDealsDesc",
    icon: "🏷️",
    category: "deals",
    feeds: [
      { name: "Reddit r/GameDeals", url: "https://www.reddit.com/r/GameDeals/.rss" },
      { name: "PC Gamer Deals", url: "https://www.pcgamer.com/tag/deals/rss/" },
    ],
  },
  {
    id: "indie_pack",
    nameKey: "news.packIndieTitle",
    descKey: "news.packIndieDesc",
    icon: "🕹️",
    category: "indie",
    feeds: [
      { name: "Indie Games Plus", url: "https://indiegamesplus.com/feed" },
      { name: "Alpha Beta Gamer", url: "https://www.alphabetagamer.com/feed/" },
    ],
  },
  {
    id: "hardware_pack",
    nameKey: "news.packTechTitle",
    descKey: "news.packTechDesc",
    icon: "⚡",
    category: "tech",
    feeds: [
      { name: "Tom's Hardware", url: "https://www.tomshardware.com/feeds/all" },
      { name: "Ars Technica Gaming", url: "https://feeds.arstechnica.com/arstechnica/gaming" },
    ],
  },
  {
    id: "pc_pack",
    nameKey: "news.packPcTitle",
    descKey: "news.packPcDesc",
    icon: "💻",
    category: "pc",
    feeds: [
      { name: "PCGamesN", url: "https://www.pcgamesn.com/feed" },
      { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed" },
    ],
  },
  {
    id: "console_pack",
    nameKey: "news.packConsoleTitle",
    descKey: "news.packConsoleDesc",
    icon: "🎮",
    category: "console",
    feeds: [
      { name: "Push Square", url: "https://www.pushsquare.com/feeds/latest" },
      { name: "Pure Xbox", url: "https://www.purexbox.com/feeds/latest" },
      { name: "Nintendo Life", url: "https://www.nintendolife.com/feeds/latest" },
    ],
  },
  {
    id: "rpg_japan_pack",
    nameKey: "news.packRpgJapanTitle",
    descKey: "news.packRpgJapanDesc",
    icon: "🌸",
    category: "console",
    feeds: [
      { name: "Gematsu", url: "https://www.gematsu.com/feed" },
      { name: "Siliconera", url: "https://www.siliconera.com/feed/" },
    ],
  },
  {
    id: "esports_pack",
    nameKey: "news.packEsportsTitle",
    descKey: "news.packEsportsDesc",
    icon: "🏆",
    category: "esports",
    feeds: [
      { name: "Dexerto Gaming", url: "https://www.dexerto.com/feed/" },
      { name: "Dot Esports", url: "https://dotesports.com/feed" },
    ],
  },
];

const STORAGE_KEY = "gamelib-news-feeds";
const CACHE_KEY = "gamelib-news-cache";
const READ_KEY = "gamelib-news-read";
const HISTORY_KEY = "gamelib-news-history";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY = 100;

// ── Helpers ────────────────────────────────────────────────────────────

/** Calculate estimated reading time in minutes. */
export function estimateReadingTime(text: string): number {
  if (!text) return 1;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 180));
}

/** Load custom feeds from localStorage. */
function loadCustomFeeds(): NewsFeed[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NewsFeed[];
  } catch {
    return [];
  }
}

/** Save custom feeds to localStorage. */
function saveCustomFeeds(feeds: NewsFeed[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
}

/** Load the set of read article links from localStorage. */
function loadReadLinks(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Persist the set of read article links to localStorage. */
function saveReadLinks(links: Set<string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Array.from(links)));
  } catch { /* ignore */ }
}

/** Load reading history from localStorage. */
function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

/** Persist reading history to localStorage. */
function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* ignore */ }
}

/**
 * Auto-discover a feed URL from a site homepage by looking for
 * <link rel="alternate" type="application/rss+xml|atom+xml"> tags.
 */
export async function discoverFeedUrl(homepage: string): Promise<string | null> {
  const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
  let html: string;
  try {
    if (hasTauri) {
      html = await invoke<string>("fetch_url", { url: homepage });
    } else {
      const res = await fetch(homepage, {
        headers: { Accept: "text/html, */*" },
      });
      if (!res.ok) return null;
      html = await res.text();
    }
  } catch {
    return null;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(
    doc.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"], link[rel="alternate"]')
  );
  for (const link of links) {
    const type = link.getAttribute("type") ?? "";
    const rel = link.getAttribute("rel") ?? "";
    if (/rss\+xml|atom\+xml/i.test(type) || rel === "alternate") {
      const href = link.getAttribute("href");
      if (href) {
        try {
          return new URL(href, homepage).toString();
        } catch {
          return href;
        }
      }
    }
  }
  return null;
}

export interface DiscoveredFeed {
  name: string;
  url: string;
}

/** Parse an OPML document string into a list of feed sources. */
export function parseOpml(opmlText: string): DiscoveredFeed[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  const outlines = doc.querySelectorAll("outline");
  for (const outline of Array.from(outlines)) {
    const type = outline.getAttribute("type");
    const xmlUrl =
      outline.getAttribute("xmlUrl") ??
      outline.getAttribute("xmlurl") ??
      outline.getAttribute("url");
    if ((!type || /^rss|atom$/i.test(type)) && xmlUrl) {
      const normalized = xmlUrl.trim();
      if (seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      feeds.push({
        name: (outline.getAttribute("title") || outline.getAttribute("text") || normalized).trim(),
        url: normalized,
      });
    }
  }
  return feeds;
}

/** Serialize a list of feeds into an OPML document string. */
export function buildOpml(feeds: NewsFeed[]): string {
  const now = new Date().toUTCString();
  const body = feeds
    .map((f) => {
      const name = f.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const url = f.url.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `    <outline type="rss" text="${name}" title="${name}" xmlUrl="${url}"/>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>GameIndex News Feeds</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>`;
}

/** Export saved articles as formatted Markdown document. */
export function exportSavedArticlesMarkdown(articles: NewsArticle[]): string {
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  let md = `# GameIndex Saved News Digest\n\n*Exported on ${dateStr} — ${articles.length} bookmarked article(s)*\n\n---\n\n`;

  for (const a of articles) {
    const time = a.pubDate ? new Date(a.pubDate).toLocaleDateString() : "";
    md += `### [${a.title}](${a.link})\n`;
    md += `**Source:** ${a.sourceName}${time ? ` | **Date:** ${time}` : ""}\n\n`;
    if (a.description) {
      md += `> ${a.description}\n\n`;
    }
    md += `---\n\n`;
  }
  return md;
}

/** Extract trending keywords / tags from an article. */
export function extractArticleTags(article: NewsArticle): string[] {
  const fullText = (article.title + " " + (article.description || "")).toLowerCase();
  const tagPatterns: { tag: string; re: RegExp }[] = [
    { tag: "Steam", re: /\bsteam\b/i },
    { tag: "PlayStation", re: /\b(playstation|ps5|ps4|sony)\b/i },
    { tag: "Xbox", re: /\b(xbox|game pass|microsoft)\b/i },
    { tag: "Nintendo", re: /\b(nintendo|switch|mario|zelda|pokemon)\b/i },
    { tag: "PC", re: /\b(pc gaming|steam deck|rtx|geforce|radeon)\b/i },
    { tag: "Hardware", re: /\b(hardware|gpu|cpu|nvidia|amd|intel|monitor)\b/i },
    { tag: "Indie", re: /\bindie\b/i },
    { tag: "Deals", re: /\b(deal|discount|free|giveaway|sale)\b/i },
    { tag: "Patch", re: /\b(patch|update|hotfix|notes)\b/i },
    { tag: "Review", re: /\b(review|score|verdict)\b/i },
    { tag: "RPG", re: /\b(rpg|jrpg|role-playing)\b/i },
    { tag: "Esports", re: /\b(esports|tournament|championship|major)\b/i },
  ];

  const matched: string[] = [];
  for (const { tag, re } of tagPatterns) {
    if (re.test(fullText)) {
      matched.push(tag);
    }
  }
  return matched;
}

/** Get all enabled feed URLs. */
function getEnabledUrls(customFeeds: NewsFeed[]): NewsFeed[] {
  const all = [...DEFAULT_FEEDS, ...customFeeds.filter((f) => !f.isDefault)];
  return all.filter((f) => f.enabled);
}

/** Parse RSS XML into NewsArticle array. */
function parseRSS(xmlText: string, sourceName: string, sourceUrl: string): NewsArticle[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) return [];

  // Handle both RSS 2.0 and Atom feeds
  const rssItems = doc.querySelectorAll("item");
  const atomEntries = doc.querySelectorAll("entry");

  if (rssItems.length > 0) {
    return Array.from(rssItems).map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() ?? "Untitled",
      link: item.querySelector("link")?.textContent?.trim() ?? sourceUrl,
      description: stripHtml(item.querySelector("description")?.textContent ?? ""),
      content: item.querySelector("content\\:encoded, encoded, content")?.textContent
        ?? item.querySelector("description")?.textContent
        ?? "",
      pubDate: item.querySelector("pubDate")?.textContent
        ?? item.querySelector("dc\\:date, date")?.textContent
        ?? "",
      sourceName,
      sourceUrl,
      imageUrl: extractImageUrl(item),
    }));
  }

  if (atomEntries.length > 0) {
    return Array.from(atomEntries).map((entry) => ({
      title: entry.querySelector("title")?.textContent?.trim() ?? "Untitled",
      link: getAtomLink(entry) ?? sourceUrl,
      description: stripHtml(
        entry.querySelector("summary")?.textContent
        ?? entry.querySelector("content")?.textContent
        ?? ""
      ),
      content: entry.querySelector("content")?.textContent
        ?? entry.querySelector("summary")?.textContent
        ?? "",
      pubDate: entry.querySelector("published")?.textContent
        ?? entry.querySelector("updated")?.textContent
        ?? "",
      sourceName,
      sourceUrl,
      imageUrl: extractAtomImage(entry),
    }));
  }

  return [];
}

/** Get link href from an Atom entry. */
function getAtomLink(entry: Element): string | null {
  const links = entry.querySelectorAll("link");
  for (const link of links) {
    const rel = link.getAttribute("rel");
    if (!rel || rel === "alternate") {
      const href = link.getAttribute("href");
      if (href) return href;
    }
  }
  for (const link of links) {
    const href = link.getAttribute("href");
    if (href) return href;
  }
  return null;
}

/** Extract image from RSS item (enclosure, media:content, media:thumbnail). */
function extractImageUrl(item: Element): string | null {
  const enclosure = item.querySelector("enclosure");
  if (enclosure?.getAttribute("type")?.startsWith("image")) {
    return enclosure.getAttribute("url") ?? null;
  }

  const mediaContent = item.querySelector(
    "media\\:content, content[medium='image'], content[type^='image']"
  );
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  const mediaThumb = item.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  const contentHtml = item.querySelector("content\\:encoded, encoded, content, description")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

/** Extract image from Atom entry. */
function extractAtomImage(entry: Element): string | null {
  const mediaContent = entry.querySelector(
    "media\\:content, content[type^='image']"
  );
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  const mediaThumb = entry.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  const contentHtml = entry.querySelector("content, summary")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

/** Extract first meaningful <img> src from an HTML string. */
function extractFirstImage(html: string): string | null {
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1];
    if (isTinyImage(src)) continue;
    if (/\b(spacer|pixel|tracking|1x1|blank|dot|icon-16|favicon)\b/i.test(src)) continue;
    return src;
  }
  return null;
}

/** Check if a URL likely points to a tiny/tracking image. */
function isTinyImage(url: string): boolean {
  if (/\b(1x1|1\.gif|1\.png|pixel\.gif|spacer\.gif|blank\.gif|dot_clear\.gif)\b/i.test(url)) return true;
  return false;
}

/** Strip HTML tags from a string, preserving paragraph-like structure. */
function stripHtml(html: string): string {
  let cleaned = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n");
  cleaned = cleaned.replace(/<[^>]+>/g, "");
  cleaned = cleaned.replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
  cleaned = cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return cleaned.trim();
}

/** Format a date for display. Returns relative or absolute date. */
export function formatArticleDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return dateStr;
  }
}

// ── Cache types ────────────────────────────────────────────────────────

interface NewsCache {
  timestamp: number;
  articles: NewsArticle[];
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useNewsFeeds() {
  const [customFeeds, setCustomFeeds] = useState<NewsFeed[]>(loadCustomFeeds);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failedFeedsList, setFailedFeedsList] = useState<string[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [readLinks, setReadLinks] = useState<Set<string>>(loadReadLinks);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>(loadHistory);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [feedHealthMap, setFeedHealthMap] = useState<Map<string, FeedHealthStatus>>(new Map());
  const [testingHealth, setTestingHealth] = useState(false);

  // All feeds (defaults + custom, respecting enabled state)
  const allFeeds = useMemo(() => {
    const defaults = DEFAULT_FEEDS.map((d) => {
      const override = customFeeds.find((c) => c.url === d.url);
      return override ?? d;
    });
    const customs = customFeeds.filter((c) => !DEFAULT_FEEDS.some((d) => d.url === c.url));
    return [...defaults, ...customs];
  }, [customFeeds]);

  // All unique source names
  const sourceNames = useMemo(() => {
    const names = allFeeds.filter((f) => f.enabled).map((f) => f.name);
    return [...new Set(names)];
  }, [allFeeds]);

  // Filtered articles by active source
  const filteredArticles = useMemo(() => {
    if (!activeSource) return articles;
    return articles.filter((a) => a.sourceName === activeSource);
  }, [articles, activeSource]);

  const mountedRef = useRef(true);

  const fetchFeeds = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed: NewsCache = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
            setArticles(parsed.articles);
            setLastRefreshedAt(parsed.timestamp);
            setLoading(false);
            return;
          }
        }
      } catch { /* ignore cache parse errors */ }
    }

    const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;

    setLoading(true);
    setError(null);
    setFailedFeedsList([]);

    const enabledFeeds = getEnabledUrls(customFeeds);

    const results = await Promise.all(
      enabledFeeds.map(async (feed) => {
        try {
          let xmlText: string;
          if (hasTauri) {
            xmlText = await invoke<string>("fetch_url", { url: feed.url });
          } else {
            const response = await fetch(feed.url, {
              headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
            });
            if (!response.ok) {
              return { feed, ok: false as const, error: `HTTP ${response.status}` };
            }
            xmlText = await response.text();
          }
          const parsed = parseRSS(xmlText, feed.name, feed.url);
          return { feed, ok: true as const, articles: parsed };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { feed, ok: false as const, error: msg };
        }
      })
    );

    const allArticles: NewsArticle[] = [];
    const failed: string[] = [];
    for (const r of results) {
      if (r.ok) {
        allArticles.push(...r.articles);
      } else {
        failed.push(r.feed.name);
        console.warn(`[News] Error fetching ${r.feed.name}: ${r.error}`);
      }
    }

    allArticles.sort((a, b) => {
      const da = new Date(a.pubDate).getTime();
      const db = new Date(b.pubDate).getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    if (!mountedRef.current) return;
    setArticles(allArticles);
    setFailedFeedsList(failed);
    setLastRefreshedAt(Date.now());

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ timestamp: Date.now(), articles: allArticles })
      );
    } catch { /* ignore cache write errors */ }

    if (allArticles.length === 0 && enabledFeeds.length > 0) {
      setError("No articles found. RSS feeds may be unavailable right now.");
    }

    if (mountedRef.current) setLoading(false);
  }, [customFeeds]);

  // Feed health and latency diagnostics
  const testFeedHealth = useCallback(async (): Promise<FeedHealthStatus[]> => {
    const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
    setTestingHealth(true);
    const enabled = allFeeds.filter((f) => f.enabled);

    const results: FeedHealthStatus[] = await Promise.all(
      enabled.map(async (feed) => {
        const start = performance.now();
        try {
          if (hasTauri) {
            await invoke<string>("fetch_url", { url: feed.url });
          } else {
            const res = await fetch(feed.url, { method: "HEAD" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          }
          const latency = Math.round(performance.now() - start);
          return {
            url: feed.url,
            name: feed.name,
            status: latency > 1500 ? ("slow" as const) : ("ok" as const),
            latencyMs: latency,
          };
        } catch (err) {
          const latency = Math.round(performance.now() - start);
          return {
            url: feed.url,
            name: feed.name,
            status: "error" as const,
            latencyMs: latency,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    const map = new Map<string, FeedHealthStatus>();
    for (const r of results) {
      map.set(r.url, r);
    }
    setFeedHealthMap(map);
    setTestingHealth(false);
    return results;
  }, [allFeeds]);

  const setSourceFilter = useCallback((sourceName: string | null) => {
    setActiveSource(sourceName);
  }, []);

  const toggleFeed = useCallback((feedUrl: string) => {
    setCustomFeeds((prev) => {
      const updated = prev.map((f) =>
        f.url === feedUrl ? { ...f, enabled: !f.enabled } : f
      );
      saveCustomFeeds(updated);
      return updated;
    });
  }, []);

  const addCustomFeed = useCallback(
    (name: string, url: string, category = "general") => {
      setCustomFeeds((prev) => {
        if (prev.some((f) => f.url.toLowerCase() === url.toLowerCase())) {
          return prev;
        }
        const updated = [...prev, { name, url, isDefault: false, enabled: true, category }];
        saveCustomFeeds(updated);
        return updated;
      });
    },
    []
  );

  const importFeedPack = useCallback((packId: string) => {
    const pack = CURATED_FEED_PACKS.find((p) => p.id === packId);
    if (!pack) return 0;

    let added = 0;
    setCustomFeeds((prev) => {
      const next = [...prev];
      for (const f of pack.feeds) {
        const existsInDefaults = DEFAULT_FEEDS.some((d) => d.url.toLowerCase() === f.url.toLowerCase());
        const existsInCustom = next.some((c) => c.url.toLowerCase() === f.url.toLowerCase());
        if (!existsInDefaults && !existsInCustom) {
          next.push({ name: f.name, url: f.url, isDefault: false, enabled: true, category: pack.category });
          added++;
        }
      }
      saveCustomFeeds(next);
      return next;
    });
    return added;
  }, []);

  const removeCustomFeed = useCallback((feedUrl: string) => {
    setCustomFeeds((prev) => {
      const updated = prev.filter((f) => f.url !== feedUrl);
      saveCustomFeeds(updated);
      return updated;
    });
  }, []);

  const markRead = useCallback((articleLink: string) => {
    setReadLinks((prev) => {
      if (prev.has(articleLink)) return prev;
      const updated = new Set(prev);
      updated.add(articleLink);
      saveReadLinks(updated);
      return updated;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadLinks((prev) => {
      const updated = new Set(prev);
      for (const a of articles) updated.add(a.link);
      saveReadLinks(updated);
      return updated;
    });
  }, [articles]);

  const toggleReadStatus = useCallback((articleLink: string) => {
    setReadLinks((prev) => {
      const updated = new Set(prev);
      if (updated.has(articleLink)) {
        updated.delete(articleLink);
      } else {
        updated.add(articleLink);
      }
      saveReadLinks(updated);
      return updated;
    });
  }, []);

  const addToHistory = useCallback((article: NewsArticle) => {
    setHistoryEntries((prev) => {
      const filtered = prev.filter((h) => h.link !== article.link);
      const updated: HistoryEntry[] = [
        {
          link: article.link,
          title: article.title,
          sourceName: article.sourceName,
          pubDate: article.pubDate,
          imageUrl: article.imageUrl,
          readAt: Date.now(),
        },
        ...filtered,
      ].slice(0, MAX_HISTORY);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistoryEntries([]);
    saveHistory([]);
  }, []);

  const removeHistoryItem = useCallback((link: string) => {
    setHistoryEntries((prev) => {
      const next = prev.filter((h) => h.link !== link);
      saveHistory(next);
      return next;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchFeeds();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchFeeds]);

  return {
    articles: filteredArticles,
    allArticles: articles,
    loading,
    error,
    failedFeedsList,
    lastRefreshedAt,
    activeSource,
    sourceNames,
    allFeeds,
    customFeeds: customFeeds.filter((f) => !f.isDefault),
    setSourceFilter,
    toggleFeed,
    addCustomFeed,
    importFeedPack,
    removeCustomFeed,
    refresh: () => fetchFeeds(true),
    readLinks,
    markRead,
    markAllRead,
    toggleReadStatus,
    enabledFeedUrls: new Set(allFeeds.filter((f) => f.enabled).map((f) => f.url)),
    historyEntries,
    addToHistory,
    clearHistory,
    removeHistoryItem,
    testFeedHealth,
    feedHealthMap,
    testingHealth,
  };
}
