import { useState, useCallback, useMemo, useEffect } from "react";
import { useNewsFeeds, buildOpml, parseOpml, estimateReadingTime } from "../hooks/useNewsFeeds";
import type { NewsArticle } from "../hooks/useNewsFeeds";
import { useToast } from "../context/ToastContext";
import { PageHeader, Button } from "../components/ui";
import { useLanguage } from "../context/LanguageContext";
import { useGames } from "../context/GameContext";
import { useWishlist } from "../hooks/useWishlist";
import NewsStatsHeader from "../components/news/NewsStatsHeader";
import NewsToolbar, {
  type NewsFeedView,
  type NewsTimeFilter,
  type NewsSortOption,
} from "../components/news/NewsToolbar";
import NewsSourcePills from "../components/news/NewsSourcePills";
import NewsArticleGrid from "../components/news/NewsArticleGrid";
import NewsArticlePreview from "../components/news/NewsArticlePreview";
import NewsFeedSettings from "../components/news/NewsFeedSettings";
import {
  loadSavedArticles,
  toggleSavedArticle,
  type SavedArticle,
} from "./communityStorage";
import "./news/NewsPage.css";

const ITEMS_PER_PAGE = 24;

export default function NewsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games } = useGames();
  const { wishlist } = useWishlist();

  const {
    articles,
    allArticles,
    loading,
    error,
    failedFeedsList,
    activeSource,
    sourceNames,
    customFeeds,
    allFeeds,
    enabledFeedUrls,
    readLinks,
    markRead,
    markAllRead,
    toggleReadStatus,
    setSourceFilter,
    toggleFeed,
    addCustomFeed,
    importFeedPack,
    removeCustomFeed,
    refresh,
  } = useNewsFeeds();

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(() => loadSavedArticles());
  const [view, setView] = useState<NewsFeedView>("feed");
  const [searchQuery, setSearchQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<NewsTimeFilter>("all");
  const [sortBy, setSortBy] = useState<NewsSortOption>("newest");
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Saved articles
  const savedAsArticles = useMemo<NewsArticle[]>(
    () => savedArticles.map((s) => ({ ...s, content: "" })),
    [savedArticles]
  );

  // Match articles with games in library or wishlist
  const userGameTitles = useMemo(() => {
    const list: string[] = [];
    for (const g of games) {
      if (g.name && g.name.length >= 3) list.push(g.name);
    }
    for (const w of wishlist) {
      if (w.name && w.name.length >= 3 && !list.includes(w.name)) list.push(w.name);
    }
    return list;
  }, [games, wishlist]);

  const relatedGameNames = useMemo(() => {
    const map = new Map<string, string>();
    if (userGameTitles.length === 0) return map;

    for (const a of allArticles) {
      const titleLower = a.title.toLowerCase();
      for (const name of userGameTitles) {
        const nameLower = name.toLowerCase();
        if (titleLower.includes(nameLower)) {
          map.set(a.link, name);
          break;
        }
      }
    }
    return map;
  }, [allArticles, userGameTitles]);

  // Composition: View + Source + Search + Time filter + Unread only + Sort
  const visibleArticles = useMemo(() => {
    let base =
      view === "saved"
        ? activeSource
          ? savedAsArticles.filter((a) => a.sourceName === activeSource)
          : savedAsArticles
        : articles;

    // Search
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.sourceName.toLowerCase().includes(q)
      );
    }

    // Time filter
    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoff =
        timeFilter === "today"
          ? now - 24 * 60 * 60 * 1000
          : timeFilter === "week"
            ? now - 7 * 24 * 60 * 60 * 1000
            : now - 30 * 24 * 60 * 60 * 1000;

      base = base.filter((a) => {
        if (!a.pubDate) return true;
        const time = new Date(a.pubDate).getTime();
        return isNaN(time) || time >= cutoff;
      });
    }

    // Unread only
    if (unreadOnly) {
      base = base.filter((a) => !readLinks.has(a.link));
    }

    // Sorting
    const sorted = [...base];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "newest": {
          const da = new Date(a.pubDate).getTime();
          const db = new Date(b.pubDate).getTime();
          if (isNaN(da) && isNaN(db)) return 0;
          if (isNaN(da)) return 1;
          if (isNaN(db)) return -1;
          return db - da;
        }
        case "oldest": {
          const da = new Date(a.pubDate).getTime();
          const db = new Date(b.pubDate).getTime();
          if (isNaN(da) && isNaN(db)) return 0;
          if (isNaN(da)) return 1;
          if (isNaN(db)) return -1;
          return da - db;
        }
        case "read_time": {
          const ta = estimateReadingTime((a.content || a.description || "") + a.title);
          const tb = estimateReadingTime((b.content || b.description || "") + b.title);
          return tb - ta;
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [view, activeSource, savedAsArticles, articles, searchQuery, timeFilter, unreadOnly, sortBy, readLinks]);

  const unreadTotal = useMemo(
    () => allArticles.filter((a) => !readLinks.has(a.link)).length,
    [allArticles, readLinks]
  );

  useEffect(() => {
    setPage(1);
  }, [view, searchQuery, activeSource, timeFilter, unreadOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(visibleArticles.length / ITEMS_PER_PAGE));
  const paginatedArticles = useMemo(
    () => visibleArticles.slice(0, page * ITEMS_PER_PAGE),
    [visibleArticles, page]
  );
  const hasMore = page < totalPages;

  const handleCardClick = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleToggleSave = useCallback((article: NewsArticle) => {
    setSavedArticles(toggleSavedArticle(article));
  }, []);

  const handleImportPack = useCallback(
    (packId: string) => {
      const count = importFeedPack(packId);
      if (count > 0) {
        showToast(
          t("newsPage.opmlImported", { count, plural: count === 1 ? "" : "s" }),
          "success"
        );
        refresh();
      }
    },
    [importFeedPack, refresh, showToast, t]
  );

  const handleExportOpml = useCallback(() => {
    const feeds = allFeeds.filter((f) => f.enabled);
    const blob = new Blob([buildOpml(feeds)], { type: "text/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gamelib-news-feeds.opml";
    a.click();
    URL.revokeObjectURL(url);
  }, [allFeeds]);

  const handleImportOpml = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const feeds = parseOpml(text);
        if (feeds.length === 0) {
          showToast(t("newsPage.opmlNoFeeds"), "warning");
          return;
        }
        let added = 0;
        for (const f of feeds) {
          addCustomFeed(f.name, f.url);
          added++;
        }
        showToast(
          t("newsPage.opmlImported", { count: added, plural: added === 1 ? "" : "s" }),
          "success"
        );
        refresh();
      } catch {
        showToast(t("newsPage.opmlReadFailed"), "error");
      }
    },
    [addCustomFeed, refresh, showToast, t]
  );

  const handleClosePreview = useCallback(() => {
    if (selectedArticle) markRead(selectedArticle.link);
    setSelectedArticle(null);
  }, [selectedArticle, markRead]);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const showMarkAllRead = unreadTotal > 0 && view === "feed";

  return (
    <div className="news-page page">
      {/* Header */}
      <PageHeader
        eyebrow={t("news.eyebrow")}
        title={t("news.title")}
        description={t("news.description")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" />
            <path d="M4 4a16 16 0 0 1 16 16" />
            <circle cx="5" cy="19" r="1" />
          </svg>
        }
        actions={
          <>
            {showMarkAllRead && (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllRead}
                title={t("newsPage.markAllRead")}
                aria-label={t("newsPage.markAllRead")}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              >
                {t("news.markRead")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              title={t("common.refresh")}
              aria-label={t("common.refresh")}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenSettings}
              title={t("newsPage.manageFeeds")}
              aria-label={t("newsPage.manageFeeds")}
              leftIcon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              }
            />
          </>
        }
      />

      {/* KPI strip */}
      <NewsStatsHeader
        total={allArticles.length}
        unread={unreadTotal}
        saved={savedArticles.length}
        feeds={enabledFeedUrls.size}
        loading={loading}
      />

      {/* View tabs + search + time filter + sort + unread */}
      <NewsToolbar
        view={view}
        onViewChange={setView}
        feedCount={articles.length}
        savedCount={savedArticles.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        unreadOnly={unreadOnly}
        onToggleUnreadOnly={() => setUnreadOnly((prev) => !prev)}
        unreadTotal={unreadTotal}
      />

      {/* Source filter pills */}
      <NewsSourcePills
        sourceNames={sourceNames}
        activeSource={activeSource}
        articles={view === "saved" ? savedAsArticles : allArticles}
        readLinks={readLinks}
        onSourceChange={setSourceFilter}
      />

      {/* Article panel */}
      <NewsArticleGrid
        articles={paginatedArticles}
        totalCount={visibleArticles.length}
        hasMore={hasMore}
        loading={loading}
        error={error}
        density="cinematic"
        readLinks={readLinks}
        savedLinks={new Set(savedArticles.map((s) => s.link))}
        sourceNames={sourceNames}
        activeSource={activeSource}
        view={view}
        searchQuery={searchQuery}
        relatedGameNames={relatedGameNames}
        onCardClick={handleCardClick}
        onToggleSave={handleToggleSave}
        onToggleRead={(art) => toggleReadStatus(art.link)}
        onLoadMore={() => setPage((p) => p + 1)}
        onRetry={refresh}
        onOpenSettings={handleOpenSettings}
        onClearSearch={() => setSearchQuery("")}
        onSwitchToFeed={() => setView("feed")}
      />

      {/* Article preview modal */}
      <NewsArticlePreview
        article={selectedArticle}
        saved={selectedArticle ? savedArticles.some((s) => s.link === selectedArticle.link) : false}
        onClose={handleClosePreview}
        onToggleSave={handleToggleSave}
      />

      {/* Feed settings modal */}
      {showSettings && (
        <NewsFeedSettings
          allFeeds={allFeeds}
          enabledFeedUrls={enabledFeedUrls}
          customFeeds={customFeeds}
          failedFeedsList={failedFeedsList}
          onToggleFeed={toggleFeed}
          onAddFeed={addCustomFeed}
          onImportPack={handleImportPack}
          onRemoveFeed={removeCustomFeed}
          onExportOpml={handleExportOpml}
          onImportOpml={handleImportOpml}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  );
}
