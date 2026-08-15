// Persistence helpers for Statistics (Community) page — backed by localStorage.

import type { CustomFolder, ScreenshotGroup, StatsSubtab, TimeframePreset } from "./statsTypes";

const LS_FAVORITES = "gamelib.community.favorites";
const LS_GOAL_MIN = "gamelib.community.monthly_goal_min";
const LS_SCREENSHOT_CACHE = "gamelib.community.screenshot_cache";
const LS_MANUAL_FOLDER = "gamelib.community.manual_folder";
const LS_CUSTOM_FOLDERS = "gamelib.community.custom_folders";
const LS_ACTIVE_TAB = "gamelib.stats.active_tab";
const LS_TIMEFRAME = "gamelib.stats.timeframe";
const LS_SAVED_ARTICLES = "gamelib.community.saved_articles";

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / sandboxed - ignore */
  }
}

// ── Screenshot Favorites ──────────────────────────────────────────
export function loadFavorites(): Set<string> {
  return new Set(readJson<string[]>(LS_FAVORITES, []));
}

export function saveFavorites(favs: Set<string>): void {
  writeJson(LS_FAVORITES, Array.from(favs));
}

// ── Screenshot Cache ──────────────────────────────────────────────
export function loadScreenshotCache(): ScreenshotGroup[] {
  return readJson<ScreenshotGroup[]>(LS_SCREENSHOT_CACHE, []);
}

export function saveScreenshotCache(groups: ScreenshotGroup[]): void {
  writeJson(LS_SCREENSHOT_CACHE, groups);
}

// ── Custom Folders ────────────────────────────────────────────────
export function loadCustomFolders(): CustomFolder[] {
  return readJson<CustomFolder[]>(LS_CUSTOM_FOLDERS, []);
}

export function saveCustomFolders(folders: CustomFolder[]): void {
  writeJson(LS_CUSTOM_FOLDERS, folders);
}

// ── Manual Folder (legacy, migrated to custom folders) ─────────────
export function loadManualFolder(): string | null {
  const v = readJson<string | null>(LS_MANUAL_FOLDER, null);
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function saveManualFolder(folderPath: string | null): void {
  writeJson(LS_MANUAL_FOLDER, folderPath);
}

// ── Monthly Goal ──────────────────────────────────────────────────
export function loadMonthlyGoal(): number {
  const v = readJson<number>(LS_GOAL_MIN, 0);
  return Number.isFinite(v) ? v : 0;
}

export function saveMonthlyGoal(min: number): void {
  writeJson(LS_GOAL_MIN, min);
}

// ── Active Subtab ─────────────────────────────────────────────────
export function loadActiveSubtab(): StatsSubtab {
  const tab = readJson<string>(LS_ACTIVE_TAB, "overview");
  if (tab === "overview" || tab === "trends" || tab === "achievements" || tab === "captures" || tab === "milestones") {
    return tab;
  }
  return "overview";
}

export function saveActiveSubtab(tab: StatsSubtab): void {
  writeJson(LS_ACTIVE_TAB, tab);
}

// ── Timeframe Preset ──────────────────────────────────────────────
export function loadTimeframePreset(): TimeframePreset {
  const p = readJson<string>(LS_TIMEFRAME, "all");
  if (p === "all" || p === "year" || p === "90d" || p === "30d") {
    return p;
  }
  return "all";
}

export function saveTimeframePreset(preset: TimeframePreset): void {
  writeJson(LS_TIMEFRAME, preset);
}

// ── Saved Articles (for backwards compatibility with NewsPage) ────
export interface SavedArticle {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
}

export function loadSavedArticles(): SavedArticle[] {
  return readJson<SavedArticle[]>(LS_SAVED_ARTICLES, []);
}

export function saveSavedArticles(articles: SavedArticle[]): void {
  writeJson(LS_SAVED_ARTICLES, articles);
}

export function isArticleSaved(link: string): boolean {
  return loadSavedArticles().some((a) => a.link === link);
}

export function toggleSavedArticle(article: SavedArticle): SavedArticle[] {
  const current = loadSavedArticles();
  const idx = current.findIndex((a) => a.link === article.link);
  let next: SavedArticle[];
  if (idx >= 0) {
    next = current.filter((a) => a.link !== article.link);
  } else {
    next = [article, ...current];
  }
  saveSavedArticles(next);
  return next;
}

export function removeSavedArticle(link: string): SavedArticle[] {
  const next = loadSavedArticles().filter((a) => a.link !== link);
  saveSavedArticles(next);
  return next;
}
