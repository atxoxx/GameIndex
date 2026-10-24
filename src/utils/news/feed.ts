import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NewsArticle, SavedArticle } from "../../types/news";

/**
 * True only when a working Tauri IPC bridge is present.
 *
 * `"__TAURI__" in window` is not a reliable signal (the global API is opt-in),
 * and a bare truthiness check made `npm run dev` pick the SQLite store and sit
 * on a pending `invoke` forever. `isTauri()` is what the Tauri API itself uses.
 */
export function hasTauri(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (isTauri()) return true;
  } catch {
    /* fall through to the internals probe */
  }
  // `withGlobalTauri` exposes `__TAURI__`, but the browser-only dev harness can
  // define it without a working IPC bridge. Only trust it when the invoke
  // internals are actually installed.
  const internals = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  return Boolean(internals) && "__TAURI__" in window;
}

// Single-feed ceiling. A dead/stuck RSS endpoint must never hold the whole
// page hostage, so every fetch races against this timeout.
const FEED_TIMEOUT_MS = 8000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Fetch a URL through the native client (CORS-free) or plain `fetch` in dev. */
export async function fetchUrlText(url: string, timeoutMs = FEED_TIMEOUT_MS): Promise<string> {
  return withTimeout(
    (async () => {
      if (hasTauri()) {
        return await invoke<string>("fetch_url", { url });
      }
      const response = await fetch(url, {
        headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    })(),
    timeoutMs,
  );
}

/** Estimated reading time in minutes (180 words per minute). */
export function estimateReadingTime(text: string): number {
  if (!text) return 1;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(wordCount / 180));
}

/** Word count for the reader footer. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

let relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Relative date for cards ("2h ago"), falling back to an absolute date after a
 * week. `locale` should be the app's UI language so dates follow the language
 * switch instead of the operating system.
 */
export function formatArticleDate(dateStr: string, locale?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  try {
    const key = locale ?? "";
    let formatter = relativeFormatters.get(key);
    if (!formatter) {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      relativeFormatters.set(key, formatter);
    }
    if (diffMinutes < 1) return formatter.format(0, "minute");
    if (diffMinutes < 60) return formatter.format(-diffMinutes, "minute");
    const hours = Math.floor(diffMinutes / 60);
    if (hours < 24) return formatter.format(-hours, "hour");
    const days = Math.floor(hours / 24);
    if (days < 7) return formatter.format(-days, "day");
  } catch {
    /* Intl.RelativeTimeFormat is missing in a few embedded engines. */
  }

  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

/** Parse an RSS 2.0 or Atom document into articles. */
export function parseRSS(xmlText: string, sourceName: string, sourceUrl: string): NewsArticle[] {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const rssItems = doc.querySelectorAll("item");
  if (rssItems.length > 0) {
    return Array.from(rssItems).map((item) => ({
      title: item.querySelector("title")?.textContent?.trim() || "Untitled",
      link: item.querySelector("link")?.textContent?.trim() || sourceUrl,
      description: stripHtml(item.querySelector("description")?.textContent ?? ""),
      content:
        item.querySelector("content\\:encoded, encoded, content")?.textContent ??
        item.querySelector("description")?.textContent ??
        "",
      pubDate:
        item.querySelector("pubDate")?.textContent ??
        item.querySelector("dc\\:date, date")?.textContent ??
        "",
      sourceName,
      sourceUrl,
      imageUrl: extractImageUrl(item),
    }));
  }

  const atomEntries = doc.querySelectorAll("entry");
  if (atomEntries.length > 0) {
    return Array.from(atomEntries).map((entry) => ({
      title: entry.querySelector("title")?.textContent?.trim() || "Untitled",
      link: getAtomLink(entry) ?? sourceUrl,
      description: stripHtml(
        entry.querySelector("summary")?.textContent ??
          entry.querySelector("content")?.textContent ??
          "",
      ),
      content:
        entry.querySelector("content")?.textContent ??
        entry.querySelector("summary")?.textContent ??
        "",
      pubDate:
        entry.querySelector("published")?.textContent ??
        entry.querySelector("updated")?.textContent ??
        "",
      sourceName,
      sourceUrl,
      imageUrl: extractAtomImage(entry),
    }));
  }

  return [];
}

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

function extractImageUrl(item: Element): string | null {
  const enclosure = item.querySelector("enclosure");
  if (enclosure?.getAttribute("type")?.startsWith("image")) {
    return enclosure.getAttribute("url") ?? null;
  }

  const mediaContent = item.querySelector(
    "media\\:content, content[medium='image'], content[type^='image']",
  );
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  const mediaThumb = item.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  const contentHtml =
    item.querySelector("content\\:encoded, encoded, content, description")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

function extractAtomImage(entry: Element): string | null {
  const mediaContent = entry.querySelector("media\\:content, content[type^='image']");
  if (mediaContent) return mediaContent.getAttribute("url") ?? null;

  const mediaThumb = entry.querySelector("media\\:thumbnail, thumbnail");
  if (mediaThumb) return mediaThumb.getAttribute("url") ?? null;

  const contentHtml = entry.querySelector("content, summary")?.textContent ?? "";
  return extractFirstImage(contentHtml);
}

/** First meaningful `<img src>` in an HTML string. */
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

function isTinyImage(url: string): boolean {
  return /\b(1x1|1\.gif|1\.png|pixel\.gif|spacer\.gif|blank\.gif|dot_clear\.gif)\b/i.test(url);
}

/** Strip tags and collapse whitespace for card summaries. */
function stripHtml(html: string): string {
  let cleaned = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
  return cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/** Parse an OPML document into feed sources. */
export function parseOpml(opmlText: string): { name: string; url: string }[] {
  const doc = new DOMParser().parseFromString(opmlText, "text/xml");
  if (doc.querySelector("parsererror")) return [];

  const feeds: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const outline of Array.from(doc.querySelectorAll("outline"))) {
    const type = outline.getAttribute("type");
    const xmlUrl =
      outline.getAttribute("xmlUrl") ??
      outline.getAttribute("xmlurl") ??
      outline.getAttribute("url");
    if ((!type || /^rss|atom$/i.test(type)) && xmlUrl) {
      const normalized = xmlUrl.trim();
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      feeds.push({
        name: (outline.getAttribute("title") || outline.getAttribute("text") || normalized).trim(),
        url: normalized,
      });
    }
  }
  return feeds;
}

/** Serialize feeds into an OPML document. */
export function buildOpml(feeds: { name: string; url: string }[]): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = feeds
    .map(
      (feed) =>
        `    <outline type="rss" text="${escape(feed.name)}" title="${escape(feed.name)}" xmlUrl="${escape(feed.url)}"/>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>GameIndex News Feeds</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>`;
}

/** Export bookmarked articles as a Markdown digest. */
export function exportSavedArticlesMarkdown(articles: SavedArticle[]): string {
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  let md = `# GameIndex Saved News Digest\n\n*Exported on ${dateStr} — ${articles.length} bookmarked article(s)*\n\n---\n\n`;
  for (const article of articles) {
    const time = article.pubDate ? new Date(article.pubDate).toLocaleDateString() : "";
    md += `### [${article.title}](${article.link})\n`;
    md += `**Source:** ${article.sourceName}${time ? ` | **Date:** ${time}` : ""}\n\n`;
    if (article.description) md += `> ${article.description}\n\n`;
    md += `---\n\n`;
  }
  return md;
}

/** Auto-discover a feed URL from a site homepage. */
export async function discoverFeedUrl(homepage: string): Promise<string | null> {
  let html: string;
  try {
    html = await fetchUrlText(homepage);
  } catch {
    return null;
  }
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(
    doc.querySelectorAll(
      'link[type="application/rss+xml"], link[type="application/atom+xml"], link[rel="alternate"]',
    ),
  );
  for (const link of links) {
    const type = link.getAttribute("type") ?? "";
    const rel = link.getAttribute("rel") ?? "";
    if (/rss\+xml|atom\+xml/i.test(type) || rel === "alternate") {
      const href = link.getAttribute("href");
      if (!href) continue;
      try {
        return new URL(href, homepage).toString();
      } catch {
        return href;
      }
    }
  }
  return null;
}
