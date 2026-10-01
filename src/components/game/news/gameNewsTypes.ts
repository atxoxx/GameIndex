import type { NewsArticle } from "../../../hooks/useNewsFeeds";

export type GameNewsFilterCategory =
  | "all"
  | "patch_notes"
  | "official"
  | "press"
  | "saved";

export type GameNewsViewMode = "grid" | "timeline" | "list";

export type GameNewsSortOption = "newest" | "oldest" | "read_time";

export type ArticleClassification =
  | "patch"
  | "major"
  | "hotfix"
  | "announcement"
  | "press"
  | "general";

export interface CustomGameFeed {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

/**
 * Classifies an article into a semantic category (patch, hotfix, major update, announcement, press).
 */
export function classifyArticle(article: NewsArticle): ArticleClassification {
  const titleLower = (article.title || "").toLowerCase();
  const descLower = (article.description || "").toLowerCase();
  const fullText = `${titleLower} ${descLower}`;

  if (/\b(hotfix|bugfix|emergency\s*patch|quickfix)\b/i.test(fullText)) {
    return "hotfix";
  }

  if (
    /\b(patch\s*notes|release\s*notes|changelog|patch\s*v?\d|update\s*notes|notes\s*de\s*mise\s*à\s*jour|patchnotizen|notas\s*del\s*parche)\b/i.test(
      fullText
    ) ||
    /\bv?\d+\.\d+(\.\d+)?\b/i.test(titleLower)
  ) {
    return "patch";
  }

  if (
    /\b(major\s*update|season\s*\d+|expansion|content\s*update|anniversary|roadmap|dlc\s*release|overhaul)\b/i.test(
      fullText
    )
  ) {
    return "major";
  }

  if (
    article.sourceName.toLowerCase().includes("steam") ||
    /\b(announcement|developer\s*update|dev\s*diary|community\s*update|maintenance|beta\s*update)\b/i.test(
      fullText
    )
  ) {
    return "announcement";
  }

  const isPressSource =
    !article.sourceName.toLowerCase().includes("steam") &&
    !article.sourceName.toLowerCase().includes("reddit");
  if (isPressSource) {
    return "press";
  }

  return "general";
}

/**
 * Extract a version string (e.g. "v1.4.2", "Patch 1.05", "Update 3", "Hotfix #2")
 * from the article headline if one exists.
 */
export function extractVersionString(title: string): string | null {
  if (!title) return null;

  // Match e.g. "v1.2.3" or "v1.2"
  const vMatch = title.match(/\b(v\d+\.\d+(\.\d+)?(-[a-z0-9]+)?)\b/i);
  if (vMatch) return vMatch[1];

  // Match e.g. "Patch 1.2" or "Patch #3"
  const patchMatch = title.match(/\b(Patch\s*(?:#|\b)?\d+(?:\.\d+)*)\b/i);
  if (patchMatch) return patchMatch[1];

  // Match e.g. "Hotfix 1.2" or "Hotfix #4"
  const hotfixMatch = title.match(/\b(Hotfix\s*(?:#|\b)?\d+(?:\.\d+)*)\b/i);
  if (hotfixMatch) return hotfixMatch[1];

  // Match e.g. "Update 12" or "Update 1.4"
  const updateMatch = title.match(/\b(Update\s*(?:#|\b)?\d+(?:\.\d+)*)\b/i);
  if (updateMatch) return updateMatch[1];

  // Match pure semver in title e.g. "1.12.0"
  const semverMatch = title.match(/\b(\d+\.\d+\.\d+)\b/);
  if (semverMatch) return `v${semverMatch[1]}`;

  return null;
}

/**
 * Storage key for custom feeds for a given game.
 */
export function getCustomFeedsStorageKey(gameId: string): string {
  return `gamelib_custom_game_feeds_${gameId}`;
}

export function loadGameCustomFeeds(gameId: string): CustomGameFeed[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getCustomFeedsStorageKey(gameId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveGameCustomFeeds(
  gameId: string,
  feeds: CustomGameFeed[]
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getCustomFeedsStorageKey(gameId), JSON.stringify(feeds));
  } catch {
    // ignore
  }
}

/* ── Steam Web API news ───────────────────────────────────────────────
 * The per-app RSS feed Steam publishes is hard-capped at 10 items. The
 * Web API (`ISteamNews/GetNewsForApp`) accepts a `count`, so older posts
 * can be pulled in on demand behind a "Load more" button. Its `contents`
 * field is BBCode-flavoured with occasional raw HTML, so both need a
 * light cleanup pass before they land in a card. */

interface SteamNewsApiItem {
  gid?: string | number;
  title?: string;
  contents?: string;
  feedlabel?: string;
  feedname?: string;
  feed_type?: number | string;
  date?: number;
}

interface SteamNewsApiResponse {
  appnews?: {
    newsitems?: SteamNewsApiItem[];
    count?: number;
  };
}

/** Build the Steam Web API URL for `count` news items of an app. */
export function steamNewsApiUrl(appId: number, count: number): string {
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=${count}&maxlength=0&format=json`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

/** Flatten a Steam `contents` blob (BBCode + raw HTML) into plain text. */
export function steamContentsToText(raw: string): string {
  if (!raw) return "";
  let text = raw.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  text = text.replace(/\[video[^\]]*\][\s\S]*?\[\/video\]/gi, " ");
  text = text.replace(/\[img[^\]]*\][\s\S]*?\[\/img\]/gi, " ");
  text = text.replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1");
  text = text.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, "$1");
  text = text.replace(/\[\/?\*\]/g, " ");
  text = text.replace(
    /\[\/?(?:p|b|i|u|s|strike|spoiler|quote|code|table|tr|td|th|h[1-6]|heading|hr|list|font|color|size|noparse|parsehtml|center|left|right|readmore)\b[^\]]*\]/gi,
    " "
  );
  text = text.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

/** Pull the first image URL out of a Steam `contents` blob. */
export function extractSteamImage(raw: string): string | null {
  if (!raw) return null;
  const html = /<img[^>]+src=["']([^"']+)["']/i.exec(raw);
  if (html && html[1] && !/^data:/i.test(html[1])) return html[1];
  const bb = /\[img[^\]]*\]([^\s\]]+)\[\/img\]/i.exec(raw);
  if (bb) {
    const url = bb[1].trim();
    if (url && !/^data:/i.test(url)) return url;
  }
  return null;
}

/**
 * Parse a Steam `GetNewsForApp` JSON payload into articles.
 * `officialSourceName` labels Valve's own announcements; external press
 * items keep their own `feedlabel` so classification can tell them apart.
 */
export function parseSteamNewsApi(
  jsonText: string,
  appId: number,
  officialSourceName: string
): { articles: NewsArticle[]; total: number } {
  let data: SteamNewsApiResponse;
  try {
    data = JSON.parse(jsonText) as SteamNewsApiResponse;
  } catch {
    return { articles: [], total: 0 };
  }

  const appnews = data.appnews;
  const items = Array.isArray(appnews?.newsitems) ? appnews.newsitems : [];
  const articles: NewsArticle[] = [];

  for (const item of items) {
    const gid = item.gid != null ? String(item.gid) : "";
    if (!gid) continue;

    const contents = typeof item.contents === "string" ? item.contents : "";
    const isOfficial =
      Number(item.feed_type) === 1 ||
      /steam_community_announcements/i.test(item.feedname ?? "");
    const sourceName = isOfficial
      ? officialSourceName
      : item.feedlabel || officialSourceName;

    articles.push({
      title: item.title || officialSourceName,
      link: `https://store.steampowered.com/news/app/${appId}/view/${gid}`,
      description: steamContentsToText(contents),
      content: contents,
      pubDate: item.date ? new Date(item.date * 1000).toUTCString() : "",
      sourceName,
      sourceUrl: `https://store.steampowered.com/news/app/${appId}`,
      imageUrl: extractSteamImage(contents),
    });
  }

  const total = Number(appnews?.count) || articles.length;
  return { articles, total };
}
