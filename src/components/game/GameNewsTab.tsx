import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import {
  useNewsFeeds,
  parseRSS,
  type NewsArticle,
} from "../../hooks/useNewsFeeds";
import { useLanguage } from "../../context/LanguageContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import NewsArticleCard, {
  NewsArticleCardSkeleton,
} from "../news/NewsArticleCard";
import NewsArticlePreview from "../news/NewsArticlePreview";
import {
  loadSavedArticles,
  toggleSavedArticle,
  type SavedArticle,
} from "../../pages/communityStorage";

import {
  classifyArticle,
  loadGameCustomFeeds,
  saveGameCustomFeeds,
  type CustomGameFeed,
  type GameNewsFilterCategory,
  type GameNewsViewMode,
  type GameNewsSortOption,
} from "./news/gameNewsTypes";
import GameNewsHero from "./news/GameNewsHero";
import GameNewsToolbar from "./news/GameNewsToolbar";
import GameNewsTimeline, {
  GameNewsTimelineSkeleton,
} from "./news/GameNewsTimeline";
import GameNewsListView, {
  GameNewsListSkeleton,
} from "./news/GameNewsListView";
import GameNewsCustomFeedsModal from "./news/GameNewsCustomFeedsModal";

/** Steam publishes a per-app RSS feed (patch notes, announcements, etc.). */
function steamFeedUrl(appId: number, langCode: string): string {
  const langMap: Record<string, string> = {
    en: "english",
    de: "german",
    fr: "french",
    es: "spanish",
    ru: "russian",
    "zh-CN": "schinese",
  };
  const steamLang = langMap[langCode] || "english";
  return `https://store.steampowered.com/feeds/news/app/${appId}/?cc=us&l=${steamLang}&format=rss`;
}

/**
 * Derive search keys for a game name to match real-world headlines:
 * full name first, then stripped of edition suffixes / parentheticals,
 * then base name before colon or dash.
 */
function buildMatchKeys(gameName: string): string[] {
  const keys = new Set<string>();
  const name = gameName.toLowerCase().trim();
  if (name.length < 3) return [];

  keys.add(name);

  const stripped = name
    .replace(/\(.*?\)/g, " ")
    .replace(
      /\b(?:deluxe|ultimate|game of the year|goty|gold|collector'?s|standard|remastered|remake|definitive|complete|digital|premium|enhanced|edition)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length >= 3 && stripped !== name) keys.add(stripped);

  const base = name.split(/:| - /)[0].trim();
  if (base.length >= 3 && base !== name) keys.add(base);

  return Array.from(keys);
}

function articleMatchesGame(article: NewsArticle, keys: string[]): boolean {
  const text = `${article.title} ${article.description || ""}`.toLowerCase();
  return keys.some((k) => text.includes(k));
}

function articleDateMs(article: NewsArticle): number {
  const ms = new Date(article.pubDate).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export default function GameNewsTab({ game }: { game: Game }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Dynamic Steam App ID lookup
  const { appId: resolvedSteamAppId, isResolving: steamResolving } = useSteamAppId(game);
  const steamAppId = resolvedSteamAppId ?? game.steamAppId ?? null;

  const {
    allArticles,
    loading: feedsLoading,
    error: feedsError,
    refresh: refreshGlobalFeeds,
    markRead,
    addToHistory,
    readLinks,
  } = useNewsFeeds();

  // ── State for custom per-game feeds ─────────────────────────────────
  const [customFeeds, setCustomFeeds] = useState<CustomGameFeed[]>(() =>
    loadGameCustomFeeds(game.id)
  );
  const [showCustomFeedsModal, setShowCustomFeedsModal] = useState(false);
  const [customArticles, setCustomArticles] = useState<NewsArticle[]>([]);
  const [customLoading, setCustomLoading] = useState(false);

  // ── Official Steam news for this app id ─────────────────────────────
  const [steamArticles, setSteamArticles] = useState<NewsArticle[]>([]);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamError, setSteamError] = useState(false);

  // ── Filter, Search, View, Sort states ───────────────────────────────
  const [activeCategory, setActiveCategory] = useState<GameNewsFilterCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<GameNewsViewMode>(() => {
    try {
      const stored = localStorage.getItem("gamelib_news_view_mode");
      if (stored && ["grid", "timeline", "list"].includes(stored)) {
        return stored as GameNewsViewMode;
      }
    } catch {
      // ignore
    }
    return "grid";
  });
  const [sortOption, setSortOption] = useState<GameNewsSortOption>("newest");
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(() =>
    loadSavedArticles()
  );

  const handleViewModeChange = (mode: GameNewsViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("gamelib_news_view_mode", mode);
    } catch {
      // ignore
    }
  };

  // Fetch Steam feed
  useEffect(() => {
    if (!steamAppId) {
      setSteamArticles([]);
      return;
    }
    let active = true;
    setSteamLoading(true);
    setSteamError(false);

    const url = steamFeedUrl(steamAppId, language);
    const sourceName = t("game.news.steamFeed");
    void (async () => {
      try {
        const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
        let xmlText: string;
        if (hasTauri) {
          xmlText = await invoke<string>("fetch_url", { url });
        } else {
          const res = await fetch(url, {
            headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          xmlText = await res.text();
        }
        if (!active) return;
        setSteamArticles(parseRSS(xmlText, sourceName, url));
      } catch (err) {
        console.warn(`[GameNews] Steam feed failed for ${game.name}:`, err);
        if (active) setSteamError(true);
      } finally {
        if (active) setSteamLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [steamAppId, game.name, language, t]);

  // Fetch per-game custom feeds
  const fetchCustomFeeds = useCallback(async () => {
    const enabled = customFeeds.filter((f) => f.enabled);
    if (enabled.length === 0) {
      setCustomArticles([]);
      return;
    }

    setCustomLoading(true);
    const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;

    const results = await Promise.all(
      enabled.map(async (feed) => {
        try {
          let xmlText: string;
          if (hasTauri) {
            xmlText = await invoke<string>("fetch_url", { url: feed.url });
          } else {
            const res = await fetch(feed.url, {
              headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
            });
            if (!res.ok) return [];
            xmlText = await res.text();
          }
          return parseRSS(xmlText, feed.name, feed.url);
        } catch {
          return [];
        }
      })
    );

    setCustomArticles(results.flat());
    setCustomLoading(false);
  }, [customFeeds]);

  useEffect(() => {
    void fetchCustomFeeds();
  }, [fetchCustomFeeds]);

  const handleSaveCustomFeeds = (newFeeds: CustomGameFeed[]) => {
    setCustomFeeds(newFeeds);
    saveGameCustomFeeds(game.id, newFeeds);
    showToast(t("game.news.customFeedsSaved"), "success");
  };

  // ── Merged, de-duplicated article collection ─────────────────────────
  const matchKeys = useMemo(() => buildMatchKeys(game.name), [game.name]);

  const allMergedArticles = useMemo(() => {
    const byLink = new Map<string, NewsArticle>();
    const add = (a: NewsArticle) => {
      const key = a.link.trim().toLowerCase();
      if (!byLink.has(key)) byLink.set(key, a);
    };

    // Official Steam posts first, then custom game feeds, then matched general feeds
    for (const a of steamArticles) add(a);
    for (const a of customArticles) add(a);
    for (const a of allArticles) {
      if (articleMatchesGame(a, matchKeys)) add(a);
    }

    return Array.from(byLink.values()).sort(
      (a, b) => articleDateMs(b) - articleDateMs(a)
    );
  }, [steamArticles, customArticles, allArticles, matchKeys]);

  // Category counts
  const categoryCounts = useMemo(() => {
    let patchCount = 0;
    let officialCount = 0;
    let pressCount = 0;
    let savedCount = 0;

    for (const a of allMergedArticles) {
      const classification = classifyArticle(a);
      if (
        classification === "patch" ||
        classification === "major" ||
        classification === "hotfix"
      ) {
        patchCount++;
      }
      if (
        classification === "announcement" ||
        a.sourceName.toLowerCase().includes("steam")
      ) {
        officialCount++;
      }
      if (classification === "press") {
        pressCount++;
      }
      if (savedArticles.some((s) => s.link === a.link)) {
        savedCount++;
      }
    }

    return {
      all: allMergedArticles.length,
      patch_notes: patchCount,
      official: officialCount,
      press: pressCount,
      saved: savedCount,
    };
  }, [allMergedArticles, savedArticles]);

  // ── Filtered & Sorted Articles ──────────────────────────────────────
  const displayedArticles = useMemo(() => {
    let list = allMergedArticles;

    // Filter by Category
    if (activeCategory === "patch_notes") {
      list = list.filter((a) => {
        const c = classifyArticle(a);
        return c === "patch" || c === "major" || c === "hotfix";
      });
    } else if (activeCategory === "official") {
      list = list.filter(
        (a) =>
          classifyArticle(a) === "announcement" ||
          a.sourceName.toLowerCase().includes("steam")
      );
    } else if (activeCategory === "press") {
      list = list.filter((a) => classifyArticle(a) === "press");
    } else if (activeCategory === "saved") {
      list = list.filter((a) => savedArticles.some((s) => s.link === a.link));
    }

    // Filter by Search Query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.description && a.description.toLowerCase().includes(q)) ||
          a.sourceName.toLowerCase().includes(q)
      );
    }

    // Sort
    return [...list].sort((a, b) => {
      if (sortOption === "oldest") {
        return articleDateMs(a) - articleDateMs(b);
      }
      // default: newest
      return articleDateMs(b) - articleDateMs(a);
    });
  }, [allMergedArticles, activeCategory, searchQuery, sortOption, savedArticles]);

  // Spotlight Hero Article (Top article in Grid mode when on All/PatchNotes and not searching)
  const showHero =
    viewMode === "grid" &&
    !searchQuery &&
    (activeCategory === "all" || activeCategory === "patch_notes") &&
    displayedArticles.length > 0;

  const heroArticle = showHero ? displayedArticles[0] : null;
  const gridArticles = showHero ? displayedArticles.slice(1) : displayedArticles;

  // ── Reader Modal cycling ─────────────────────────────────────────────
  const selectedIndex = useMemo(() => {
    if (!selectedArticle) return -1;
    return displayedArticles.findIndex((a) => a.link === selectedArticle.link);
  }, [selectedArticle, displayedArticles]);

  const handleOpenArticle = useCallback(
    (article: NewsArticle) => {
      markRead(article.link);
      addToHistory(article);
      setSelectedArticle(article);
    },
    [markRead, addToHistory]
  );

  const handleClosePreview = useCallback(() => {
    if (selectedArticle) markRead(selectedArticle.link);
    setSelectedArticle(null);
  }, [selectedArticle, markRead]);

  const handleToggleSave = useCallback((article: NewsArticle) => {
    setSavedArticles(toggleSavedArticle(article));
  }, []);

  const handleToggleRead = useCallback(
    (article: NewsArticle) => {
      markRead(article.link);
    },
    [markRead]
  );

  const handleMarkAllRead = useCallback(() => {
    for (const a of displayedArticles) {
      markRead(a.link);
    }
    showToast(t("game.news.allReadDone"), "success");
  }, [displayedArticles, markRead, showToast, t]);

  const handleRefresh = useCallback(() => {
    refreshGlobalFeeds();
    void fetchCustomFeeds();
    if (steamAppId) {
      setSteamLoading(true);
      const url = steamFeedUrl(steamAppId, language);
      const sourceName = t("game.news.steamFeed");
      void (async () => {
        try {
          const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
          let xmlText: string;
          if (hasTauri) {
            xmlText = await invoke<string>("fetch_url", { url });
          } else {
            const res = await fetch(url);
            xmlText = await res.text();
          }
          setSteamArticles(parseRSS(xmlText, sourceName, url));
        } catch {
          // ignore
        } finally {
          setSteamLoading(false);
        }
      })();
    }
  }, [refreshGlobalFeeds, fetchCustomFeeds, steamAppId, language, t]);

  const loading = feedsLoading || steamLoading || customLoading || steamResolving;
  const hasUnread = useMemo(
    () => displayedArticles.some((a) => !readLinks.has(a.link)),
    [displayedArticles, readLinks]
  );

  const failed =
    allMergedArticles.length === 0 &&
    feedsError &&
    (steamAppId === null || steamError);

  return (
    <div className="game-news-tab">
      {/* Dynamic Toolbar */}
      <GameNewsToolbar
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        counts={categoryCounts}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        sortOption={sortOption}
        onSortChange={setSortOption}
        onMarkAllRead={handleMarkAllRead}
        onOpenCustomFeeds={() => setShowCustomFeedsModal(true)}
        onRefresh={handleRefresh}
        onOpenNewsHub={() => navigate("/news")}
        isRefreshing={loading}
        hasUnread={hasUnread}
      />

      {/* Loading Skeletons */}
      {loading && allMergedArticles.length === 0 ? (
        viewMode === "timeline" ? (
          <GameNewsTimelineSkeleton />
        ) : viewMode === "list" ? (
          <GameNewsListSkeleton />
        ) : (
          <div className="game-news-grid" aria-hidden="true">
            <NewsArticleCardSkeleton density="cinematic" />
            <NewsArticleCardSkeleton density="cozy" />
            <NewsArticleCardSkeleton density="cozy" />
            <NewsArticleCardSkeleton density="cozy" />
          </div>
        )
      ) : displayedArticles.length === 0 ? (
        /* Empty State */
        <div className="game-news-empty">
          <div className="game-news-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
              <path d="M18 14h-8" />
              <path d="M15 18h-5" />
              <path d="M10 6h8v4h-8V6Z" />
            </svg>
          </div>
          <h3>
            {searchQuery || activeCategory !== "all"
              ? t("game.news.noMatchTitle")
              : t("game.news.emptyTitle")}
          </h3>
          <p>
            {searchQuery || activeCategory !== "all"
              ? t("game.news.noMatchSubtitle")
              : failed
              ? t("game.news.emptyError")
              : t("game.news.emptySubtitle", { game: game.name })}
          </p>
          <div className="game-news-empty-actions">
            {searchQuery || activeCategory !== "all" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                }}
              >
                {t("game.news.clearFilter")}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={handleRefresh}>
                {t("common.retry")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCustomFeedsModal(true)}
            >
              {t("game.news.customFeedsTitle")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/news")}>
              {t("game.news.openNewsHub")}
            </Button>
          </div>
        </div>
      ) : (
        /* Active View Modes */
        <div className="game-news-content-area">
          {/* Spotlight Hero (Grid Mode Only) */}
          {heroArticle && (
            <GameNewsHero
              article={heroArticle}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              saved={savedArticles.some((s) => s.link === heroArticle.link)}
              read={readLinks.has(heroArticle.link)}
            />
          )}

          {/* Timeline View */}
          {viewMode === "timeline" ? (
            <GameNewsTimeline
              articles={displayedArticles}
              readLinks={readLinks}
              savedArticles={savedArticles}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              onToggleRead={handleToggleRead}
            />
          ) : viewMode === "list" ? (
            /* List View */
            <GameNewsListView
              articles={displayedArticles}
              readLinks={readLinks}
              savedArticles={savedArticles}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              onToggleRead={handleToggleRead}
            />
          ) : (
            /* Grid View */
            <div className="game-news-grid">
              {gridArticles.map((article) => (
                <NewsArticleCard
                  key={article.link}
                  article={article}
                  onClick={handleOpenArticle}
                  onToggleSave={handleToggleSave}
                  onToggleRead={handleToggleRead}
                  density="cozy"
                  read={readLinks.has(article.link)}
                  saved={savedArticles.some((s) => s.link === article.link)}
                />
              ))}
            </div>
          )}

          {/* Footer Summary */}
          <div className="game-news-footer">
            <span>
              {t("game.news.footer", {
                count: displayedArticles.length,
                game: game.name,
              })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => navigate("/news")}>
              {t("game.news.openNewsHub")}
            </Button>
          </div>
        </div>
      )}

      {/* Reader Modal */}
      <NewsArticlePreview
        article={selectedArticle}
        saved={
          selectedArticle
            ? savedArticles.some((s) => s.link === selectedArticle.link)
            : false
        }
        onClose={handleClosePreview}
        onToggleSave={handleToggleSave}
        onPrevArticle={() => {
          if (selectedIndex > 0) {
            const prev = displayedArticles[selectedIndex - 1];
            markRead(prev.link);
            addToHistory(prev);
            setSelectedArticle(prev);
          }
        }}
        onNextArticle={() => {
          if (
            selectedIndex >= 0 &&
            selectedIndex < displayedArticles.length - 1
          ) {
            const next = displayedArticles[selectedIndex + 1];
            markRead(next.link);
            addToHistory(next);
            setSelectedArticle(next);
          }
        }}
        hasPrev={selectedIndex > 0}
        hasNext={
          selectedIndex >= 0 && selectedIndex < displayedArticles.length - 1
        }
      />

      {/* Custom Game Feeds Manager Modal */}
      <GameNewsCustomFeedsModal
        gameName={game.name}
        isOpen={showCustomFeedsModal}
        onClose={() => setShowCustomFeedsModal(false)}
        feeds={customFeeds}
        onSaveFeeds={handleSaveCustomFeeds}
      />
    </div>
  );
}
