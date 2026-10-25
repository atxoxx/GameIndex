import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Newspaper } from "lucide-react";
import type { Game } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import type { NewsArticle } from "../../types/news";
import { parseRSS } from "../../utils/news/feed";
import { useNewsDemand } from "../../context/NewsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import { GameTabEmpty, GameTabSkeleton, GameTabShell, useGameTabState } from "./tabs";
import GameNewsCard from "./news/GameNewsCard";
import NewsArticlePreview from "../news/NewsArticlePreview";
import GameNewsHero from "./news/GameNewsHero";
import GameNewsToolbar from "./news/GameNewsToolbar";
import GameNewsBriefing from "./news/GameNewsBriefing";
import GameNewsTimeline, { GameNewsTimelineSkeleton } from "./news/GameNewsTimeline";
import GameNewsListView, { GameNewsListSkeleton } from "./news/GameNewsListView";
import GameNewsCustomFeedsModal from "./news/GameNewsCustomFeedsModal";
import {
  articleTime,
  loadGameCustomFeeds,
  parseSteamNewsApi,
  readGameNewsLastVisit,
  saveGameCustomFeeds,
  steamNewsApiUrl,
  writeGameNewsLastVisit,
  type CustomGameFeed,
  type GameNewsFilterCategory,
  type GameNewsPageView,
  type GameNewsSortOption,
  type GameNewsViewMode,
} from "./news/gameNewsTypes";
import {
  buildGameNewsBriefing,
  clusterLeads,
  matchesNewsCategory,
} from "./news/gameNewsBriefingData";

/** How many Steam news items to request per "load more" page. */
const STEAM_PAGE_SIZE = 20;
/** How many merged articles are revealed per "load more" page. */
const LIST_PAGE_SIZE = 12;

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

/** Derive search keys for a game name to match real-world headlines. */
function buildMatchKeys(gameName: string): string[] {
  const keys = new Set<string>();
  const name = gameName.toLowerCase().trim();
  if (name.length < 3) return [];

  keys.add(name);

  const stripped = name
    .replace(/\(.*?\)/g, " ")
    .replace(
      /\b(?:deluxe|ultimate|game of the year|goty|gold|collector'?s|standard|remastered|remake|definitive|complete|digital|premium|enhanced|edition)\b/g,
      " ",
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
  return keys.some((key) => text.includes(key));
}

interface NewsTabState {
  view: GameNewsPageView;
  category: GameNewsFilterCategory;
  density: GameNewsViewMode;
  sort: GameNewsSortOption;
}

const DEFAULT_STATE: NewsTabState = {
  view: "briefing",
  category: "all",
  density: "grid",
  sort: "newest",
};

/**
 * News & Updates for one game.
 *
 * The tab opens on a briefing (headline, what changed since the last visit,
 * latest patch notes) and keeps the full merged feed one switch away. Steam's
 * official posts, custom per-game feeds and matching global headlines are
 * merged, de-duplicated by URL and clustered by story.
 */
export default function GameNewsTab({ game }: { game: Game }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { appId: resolvedSteamAppId, isResolving: steamResolving } = useSteamAppId(game);
  const steamAppId = resolvedSteamAppId ?? game.steamAppId ?? null;

  const {
    articles: allArticles,
    loading: feedsLoading,
    error: feedsError,
    refresh: refreshGlobalFeeds,
    markRead,
    setRead,
    addToHistory,
    readLinks,
    savedLinks,
    saved: savedArticles,
    toggleSaved,
    loadArticle,
  } = useNewsDemand();

  const [state, setState] = useGameTabState<NewsTabState>({
    prefix: "news",
    defaults: DEFAULT_STATE,
    allowed: {
      view: ["briefing", "feed"],
      category: ["all", "unread", "patch_notes", "official", "press", "saved"],
      density: ["grid", "list", "timeline"],
      sort: ["newest", "oldest"],
    },
  });

  const [customFeeds, setCustomFeeds] = useState<CustomGameFeed[]>(() =>
    loadGameCustomFeeds(game.id),
  );
  const [showCustomFeedsModal, setShowCustomFeedsModal] = useState(false);
  const [customArticles, setCustomArticles] = useState<NewsArticle[]>([]);
  const [customLoading, setCustomLoading] = useState(false);

  const [steamArticles, setSteamArticles] = useState<NewsArticle[]>([]);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamError, setSteamError] = useState(false);

  const [steamApiArticles, setSteamApiArticles] = useState<NewsArticle[]>([]);
  const [steamNewsCount, setSteamNewsCount] = useState(0);
  const [steamTotal, setSteamTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const [lastVisit, setLastVisit] = useState(0);
  const visitedGameRef = useRef<string | null>(null);

  // Capture the previous visit before stamping the new one.
  useEffect(() => {
    if (visitedGameRef.current === game.id) return;
    visitedGameRef.current = game.id;
    setLastVisit(readGameNewsLastVisit(game.id));
    writeGameNewsLastVisit(game.id);
  }, [game.id]);

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
          const response = await fetch(url, {
            headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          xmlText = await response.text();
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

  useEffect(() => {
    setSteamApiArticles([]);
    setSteamTotal(null);
    setSteamNewsCount(0);
    setVisibleCount(LIST_PAGE_SIZE);
  }, [steamAppId]);

  useEffect(() => {
    if (!steamAppId || steamNewsCount <= 0) return;
    let active = true;
    setLoadingMore(true);

    const url = steamNewsApiUrl(steamAppId, steamNewsCount);
    const sourceName = t("game.news.steamFeed");
    void (async () => {
      try {
        const hasTauri = typeof window !== "undefined" && "__TAURI__" in window;
        let jsonText: string;
        if (hasTauri) {
          jsonText = await invoke<string>("fetch_url", { url });
        } else {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          jsonText = await response.text();
        }
        if (!active) return;
        const { articles, total } = parseSteamNewsApi(jsonText, steamAppId, sourceName);
        setSteamApiArticles(articles);
        setSteamTotal(total);
      } catch (err) {
        console.warn(`[GameNews] Steam news API failed for ${game.name}:`, err);
      } finally {
        if (active) setLoadingMore(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [steamAppId, steamNewsCount, game.name, t]);

  const fetchCustomFeeds = useCallback(async () => {
    const enabled = customFeeds.filter((feed) => feed.enabled);
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
            const response = await fetch(feed.url, {
              headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
            });
            if (!response.ok) return [];
            xmlText = await response.text();
          }
          return parseRSS(xmlText, feed.name, feed.url);
        } catch {
          return [];
        }
      }),
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

  const matchKeys = useMemo(() => buildMatchKeys(game.name), [game.name]);

  const allMergedArticles = useMemo(() => {
    const byLink = new Map<string, NewsArticle>();
    const add = (article: NewsArticle) => {
      const key = article.link.trim().toLowerCase();
      if (!byLink.has(key)) byLink.set(key, article);
    };

    for (const article of steamArticles) add(article);
    for (const article of steamApiArticles) add(article);
    for (const article of customArticles) add(article);
    for (const article of allArticles) {
      if (articleMatchesGame(article, matchKeys)) add(article);
    }

    return Array.from(byLink.values()).sort((a, b) => articleTime(b) - articleTime(a));
  }, [steamArticles, steamApiArticles, customArticles, allArticles, matchKeys]);

  const unreadLinks = useMemo(() => {
    const set = new Set<string>();
    for (const article of allMergedArticles) {
      if (readLinks.has(article.link)) continue;
      if (lastVisit > 0 && articleTime(article) <= lastVisit) continue;
      set.add(article.link);
    }
    return set;
  }, [allMergedArticles, readLinks, lastVisit]);

  const filteredArticles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = allMergedArticles.filter((article) => {
      if (
        !matchesNewsCategory(article, state.category, savedLinks, unreadLinks)
      ) {
        return false;
      }
      if (!query) return true;
      return (
        article.title.toLowerCase().includes(query) ||
        (article.description ?? "").toLowerCase().includes(query) ||
        article.sourceName.toLowerCase().includes(query)
      );
    });
    return state.sort === "oldest"
      ? [...list].sort((a, b) => articleTime(a) - articleTime(b))
      : list;
  }, [allMergedArticles, state.category, state.sort, searchQuery, savedLinks, unreadLinks]);

  const { leads, alsoByLink } = useMemo(
    () => clusterLeads(filteredArticles, readLinks),
    [filteredArticles, readLinks],
  );

  const orderedLeads = useMemo(
    () =>
      state.sort === "oldest"
        ? [...leads].sort((a, b) => articleTime(a) - articleTime(b))
        : leads,
    [leads, state.sort],
  );

  const briefing = useMemo(
    () => buildGameNewsBriefing(orderedLeads, readLinks, lastVisit),
    [orderedLeads, readLinks, lastVisit],
  );

  const categoryCounts = useMemo(() => {
    const base = {
      all: allMergedArticles.length,
      unread: unreadLinks.size,
      patch_notes: 0,
      official: 0,
      press: 0,
      saved: 0,
    };
    for (const article of allMergedArticles) {
      if (matchesNewsCategory(article, "patch_notes", savedLinks, unreadLinks)) {
        base.patch_notes += 1;
      }
      if (matchesNewsCategory(article, "official", savedLinks, unreadLinks)) {
        base.official += 1;
      }
      if (matchesNewsCategory(article, "press", savedLinks, unreadLinks)) {
        base.press += 1;
      }
      if (savedLinks.has(article.link)) base.saved += 1;
    }
    return base;
  }, [allMergedArticles, savedLinks, unreadLinks]);

  const totalDisplayed = orderedLeads.length;
  const hasMoreLocal = totalDisplayed > visibleCount;
  const steamHasMore =
    steamAppId != null && (steamTotal === null || steamApiArticles.length < steamTotal);
  const hasMore = hasMoreLocal || steamHasMore;

  const paginatedArticles = useMemo(
    () => orderedLeads.slice(0, visibleCount),
    [orderedLeads, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [state.category, state.sort, searchQuery, state.view]);

  const handleLoadMore = useCallback(() => {
    setVisibleCount((count) => count + LIST_PAGE_SIZE);
    if (steamHasMore) {
      setSteamNewsCount((count) => (count <= 0 ? STEAM_PAGE_SIZE : count + STEAM_PAGE_SIZE));
    }
  }, [steamHasMore]);

  const showHero =
    state.view === "feed" &&
    state.density === "grid" &&
    !searchQuery &&
    (state.category === "all" || state.category === "patch_notes") &&
    paginatedArticles.length > 0;

  const heroArticle = showHero ? paginatedArticles[0] : null;
  const gridArticles = showHero ? paginatedArticles.slice(1) : paginatedArticles;

  const selectedIndex = useMemo(() => {
    if (!selectedArticle) return -1;
    return orderedLeads.findIndex((article) => article.link === selectedArticle.link);
  }, [selectedArticle, orderedLeads]);

  const handleOpenArticle = useCallback(
    (article: NewsArticle) => {
      markRead(article.link);
      addToHistory(article);
      setSelectedArticle(article);
      if (!article.content) {
        void loadArticle(article.link).then((full) => {
          if (full) {
            setSelectedArticle((prev) =>
              prev && prev.link === full.link ? full : prev,
            );
          }
        });
      }
    },
    [addToHistory, loadArticle, markRead],
  );

  const handleClosePreview = useCallback(() => {
    if (selectedArticle) markRead(selectedArticle.link);
    setSelectedArticle(null);
  }, [selectedArticle, markRead]);

  const handleToggleSave = useCallback(
    (article: NewsArticle) => {
      void toggleSaved(article);
    },
    [toggleSaved],
  );

  const handleToggleRead = useCallback(
    (article: NewsArticle) => {
      setRead(article.link, !readLinks.has(article.link));
    },
    [readLinks, setRead],
  );

  const handleMarkAllRead = useCallback(() => {
    for (const article of filteredArticles) markRead(article.link);
    showToast(t("game.news.allReadDone"), "success");
  }, [filteredArticles, markRead, showToast, t]);

  const handleRefresh = useCallback(() => {
    void refreshGlobalFeeds(true);
    void fetchCustomFeeds();
    setVisibleCount(LIST_PAGE_SIZE);
    setSteamApiArticles([]);
    setSteamTotal(null);
    setSteamNewsCount(0);
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
            const response = await fetch(url);
            xmlText = await response.text();
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
  const hasUnread = unreadLinks.size > 0;
  const failed =
    allMergedArticles.length === 0 && feedsError && (steamAppId === null || steamError);

  return (
    <GameTabShell
      eyebrow={t("game.news.eyebrow")}
      title={t("game.news.title")}
      description={
        allMergedArticles.length > 0
          ? t("game.news.subtitleCount", {
              count: allMergedArticles.length,
              game: gameDisplayName(game),
            })
          : t("game.news.subtitle", { game: gameDisplayName(game) })
      }
      icon={<Newspaper size={20} />}
      toolbar={
        <GameNewsToolbar
          view={state.view}
          onViewChange={(view) => setState({ view })}
          density={state.density}
          onDensityChange={(density) => setState({ density })}
          activeCategory={state.category}
          onSelectCategory={(category) => setState({ category })}
          counts={categoryCounts}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          sortOption={state.sort}
          onSortChange={(sort) => setState({ sort })}
          onMarkAllRead={handleMarkAllRead}
          onOpenCustomFeeds={() => setShowCustomFeedsModal(true)}
          onRefresh={handleRefresh}
          onOpenNewsHub={() => navigate("/news")}
          isRefreshing={loading}
          hasUnread={hasUnread}
          unreadCount={unreadLinks.size}
        />
      }
    >
      {loading && allMergedArticles.length === 0 ? (
        state.view === "feed" && state.density === "timeline" ? (
          <GameNewsTimelineSkeleton />
        ) : state.view === "feed" && state.density === "list" ? (
          <GameNewsListSkeleton />
        ) : (
          <GameTabSkeleton count={6} height={220} />
        )
      ) : totalDisplayed === 0 ? (
        <GameTabEmpty
          icon={<Newspaper size={26} />}
          title={
            searchQuery || state.category !== "all"
              ? t("game.news.noMatchTitle")
              : t("game.news.emptyTitle")
          }
          description={
            searchQuery || state.category !== "all"
              ? t("game.news.noMatchSubtitle")
              : failed
                ? t("game.news.emptyError")
                : t("game.news.emptySubtitle", { game: gameDisplayName(game) })
          }
          actions={
            searchQuery || state.category !== "all" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setState({ category: "all" });
                }}
              >
                {t("game.news.clearFilter")}
              </Button>
            ) : (
              <>
                <Button variant="primary" size="sm" onClick={handleRefresh}>
                  {t("common.retry")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCustomFeedsModal(true)}
                >
                  {t("game.news.customFeedsTitle")}
                </Button>
              </>
            )
          }
        />
      ) : state.view === "briefing" ? (
        <GameNewsBriefing
          hero={briefing.hero}
          unread={briefing.unread}
          patchNotes={briefing.patchNotes}
          unreadCount={briefing.unreadCount}
          readLinks={readLinks}
          savedLinks={savedLinks}
          onOpenArticle={handleOpenArticle}
          onToggleSave={handleToggleSave}
          onToggleRead={handleToggleRead}
          onShowFeed={() => setState({ view: "feed" })}
        />
      ) : (
        <div className="game-news-content-area">
          {heroArticle && (
            <GameNewsHero
              article={heroArticle}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              saved={savedLinks.has(heroArticle.link)}
              read={readLinks.has(heroArticle.link)}
            />
          )}

          {state.density === "timeline" ? (
            <GameNewsTimeline
              articles={paginatedArticles}
              readLinks={readLinks}
              savedArticles={savedArticles}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              onToggleRead={handleToggleRead}
            />
          ) : state.density === "list" ? (
            <GameNewsListView
              articles={paginatedArticles}
              readLinks={readLinks}
              savedArticles={savedArticles}
              onOpenArticle={handleOpenArticle}
              onToggleSave={handleToggleSave}
              onToggleRead={handleToggleRead}
            />
          ) : (
            <div className="game-news-grid">
              {gridArticles.map((article) => (
                <GameNewsCard
                  key={article.link}
                  article={article}
                  onOpen={handleOpenArticle}
                  onToggleSave={handleToggleSave}
                  onToggleRead={handleToggleRead}
                  read={readLinks.has(article.link)}
                  saved={savedLinks.has(article.link)}
                  alsoCount={alsoByLink.get(article.link)}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <div className="game-news-load-more">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? t("common.loading") : t("news.loadMore")}
              </Button>
            </div>
          )}

          <div className="game-news-footer">
            <span>
              {t("game.news.footer", {
                count: totalDisplayed,
                game: gameDisplayName(game),
              })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => navigate("/news")}>
              {t("game.news.openNewsHub")}
            </Button>
          </div>
        </div>
      )}

      <NewsArticlePreview
        article={selectedArticle}
        saved={selectedArticle ? savedLinks.has(selectedArticle.link) : false}
        onClose={handleClosePreview}
        onToggleSave={handleToggleSave}
        onPrevArticle={() => {
          if (selectedIndex > 0) handleOpenArticle(orderedLeads[selectedIndex - 1]);
        }}
        onNextArticle={() => {
          if (selectedIndex >= 0 && selectedIndex < orderedLeads.length - 1) {
            handleOpenArticle(orderedLeads[selectedIndex + 1]);
          }
        }}
        hasPrev={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < orderedLeads.length - 1}
      />

      <GameNewsCustomFeedsModal
        gameName={game.name}
        isOpen={showCustomFeedsModal}
        onClose={() => setShowCustomFeedsModal(false)}
        feeds={customFeeds}
        onSaveFeeds={handleSaveCustomFeeds}
      />
    </GameTabShell>
  );
}
