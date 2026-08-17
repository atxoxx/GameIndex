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
