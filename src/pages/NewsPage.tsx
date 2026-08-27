import { useState, useCallback, useMemo, useEffect } from "react";
import {
  useNewsFeeds,
  buildOpml,
  parseOpml,
  estimateReadingTime,
  exportSavedArticlesMarkdown,
  type NewsCategory,
  type NewsArticle,
} from "../hooks/useNewsFeeds";
import { useToast } from "../context/ToastContext";
import { PageHeader, Button } from "../components/ui";
import { useLanguage } from "../context/LanguageContext";
import { useGames } from "../context/GameContext";
import { useWishlist } from "../hooks/useWishlist";
import type { ViewDensity } from "../types/game";
import NewsHeroSpotlight from "../components/news/NewsHeroSpotlight";
import NewsStatsHeader from "../components/news/NewsStatsHeader";
import NewsToolbar, {
  type NewsTimeFilter,
  type NewsReadTimeFilter,
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
const DENSITY_STORAGE_KEY = "gamelib.news.density";

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
    historyEntries,
    markRead,
    markAllRead,
    toggleReadStatus,
    setSourceFilter,
    toggleFeed,
    addCustomFeed,
    importFeedPack,
    removeCustomFeed,
    refresh,
    addToHistory,
    testFeedHealth,
    feedHealthMap,
    testingHealth,
  } = useNewsFeeds();

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState(1);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(() => loadSavedArticles());
  const [activeCategory, setActiveCategory] = useState<NewsCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<NewsTimeFilter>("all");
  const [readTimeFilter, setReadTimeFilter] = useState<NewsReadTimeFilter>("all");
  const [sortBy, setSortBy] = useState<NewsSortOption>("newest");
  const [hasImagesOnly, setHasImagesOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Density layout persistence
  const [density, setDensity] = useState<ViewDensity>(() => {
    try {
      const stored = localStorage.getItem(DENSITY_STORAGE_KEY);
      if (stored && ["cinematic", "cozy", "compact", "list"].includes(stored)) {
        return stored as ViewDensity;
      }
    } catch { /* ignore */ }
    return "cinematic";
  });

  const handleDensityChange = useCallback((newDensity: ViewDensity) => {
    setDensity(newDensity);
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, newDensity);
    } catch { /* ignore */ }
  }, []);

  // Saved articles as NewsArticle array
  const savedAsArticles = useMemo<NewsArticle[]>(
    () => savedArticles.map((s) => ({ ...s, content: "" })),
    [savedArticles]
  );

  // History entries as NewsArticle array
  const historyAsArticles = useMemo<NewsArticle[]>(
    () =>
      historyEntries.map((h) => ({
        title: h.title,
        link: h.link,
        description: "",
        content: "",
        pubDate: h.pubDate,
        sourceName: h.sourceName,
        sourceUrl: "",
        imageUrl: h.imageUrl,
      })),
    [historyEntries]
  );

  // User Game Titles (from Library and Wishlist)
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

  // Related games map (article.link -> gameName)
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

  // Feeds category map
  const feedCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of allFeeds) {
      if (f.category) map.set(f.name.toLowerCase(), f.category.toLowerCase());
    }
    return map;
  }, [allFeeds]);

  // Counts by category tab
  const countsByCategory = useMemo<Record<NewsCategory, number>>(() => {
    const counts: Record<NewsCategory, number> = {
      all: allArticles.length,
      for_you: allArticles.filter((a) => relatedGameNames.has(a.link)).length,
      pc: 0,
      console: 0,
      tech: 0,
      indie: 0,
      deals: 0,
      esports: 0,
      saved: savedArticles.length,
      history: historyEntries.length,
    };

    for (const a of allArticles) {
      const srcCat = feedCategoryMap.get(a.sourceName.toLowerCase()) || "general";
      const fullText = (a.title + " " + (a.description || "")).toLowerCase();

      if (srcCat === "pc" || /\b(pc|steam|windows)\b/i.test(fullText)) {
        counts.pc++;
      }
      if (srcCat === "console" || /\b(playstation|ps5|ps4|xbox|nintendo|switch)\b/i.test(fullText)) {
        counts.console++;
      }
      if (srcCat === "tech" || /\b(hardware|gpu|cpu|nvidia|amd|intel|rtx)\b/i.test(fullText)) {
        counts.tech++;
      }
      if (srcCat === "indie" || /\bindie\b/i.test(fullText)) {
        counts.indie++;
      }
      if (srcCat === "deals" || /\b(deal|discount|free|giveaway|sale)\b/i.test(fullText)) {
        counts.deals++;
      }
      if (srcCat === "esports" || /\b(esports|tournament|championship|major)\b/i.test(fullText)) {
        counts.esports++;
      }
    }

    return counts;
  }, [allArticles, feedCategoryMap, historyEntries.length, relatedGameNames, savedArticles.length]);

  // Visible Articles computation
  const visibleArticles = useMemo(() => {
    let base: NewsArticle[];

    if (activeCategory === "saved") {
      base = savedAsArticles;
    } else if (activeCategory === "history") {
      base = historyAsArticles;
    } else if (activeCategory === "for_you") {
      base = articles.filter((a) => relatedGameNames.has(a.link));
    } else if (activeCategory === "all") {
      base = articles;
    } else {
      // Filter by category keywords & feed category
      base = articles.filter((a) => {
        const srcCat = feedCategoryMap.get(a.sourceName.toLowerCase());
        if (srcCat === activeCategory) return true;
        const text = (a.title + " " + (a.description || "")).toLowerCase();
        if (activeCategory === "pc") return /\b(pc|steam|windows|rtx|geforce)\b/i.test(text);
        if (activeCategory === "console") return /\b(playstation|ps5|ps4|xbox|nintendo|switch)\b/i.test(text);
        if (activeCategory === "tech") return /\b(hardware|gpu|cpu|nvidia|amd|intel)\b/i.test(text);
        if (activeCategory === "indie") return /\bindie\b/i.test(text);
        if (activeCategory === "deals") return /\b(deal|discount|free|giveaway|sale)\b/i.test(text);
        if (activeCategory === "esports") return /\b(esports|tournament|championship)\b/i.test(text);
        return true;
      });
    }

    // Source filter
    if (activeSource && activeCategory !== "all") {
      base = base.filter((a) => a.sourceName === activeSource);
    }

    // Search query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      base = base.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.sourceName.toLowerCase().includes(q) ||
          (relatedGameNames.get(a.link)?.toLowerCase().includes(q) ?? false)
      );
    }

    // Tag filter
    if (activeTag) {
      const tagLower = activeTag.toLowerCase();
      base = base.filter((a) => {
        const text = (a.title + " " + (a.description || "")).toLowerCase();
        return text.includes(tagLower);
      });
    }

    // Has images only
    if (hasImagesOnly) {
      base = base.filter((a) => Boolean(a.imageUrl));
    }

    // Time filter
    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoff =
        timeFilter === "today"
          ? now - 24 * 60 * 60 * 1000
          : timeFilter === "3days"
            ? now - 3 * 24 * 60 * 60 * 1000
            : timeFilter === "week"
              ? now - 7 * 24 * 60 * 60 * 1000
              : now - 30 * 24 * 60 * 60 * 1000;

      base = base.filter((a) => {
        if (!a.pubDate) return true;
        const time = new Date(a.pubDate).getTime();
        return isNaN(time) || time >= cutoff;
      });
    }

    // Read time filter
    if (readTimeFilter !== "all") {
      base = base.filter((a) => {
        const minutes = estimateReadingTime((a.content || a.description || "") + a.title);
        if (readTimeFilter === "quick") return minutes <= 3;
        if (readTimeFilter === "medium") return minutes > 3 && minutes <= 6;
        if (readTimeFilter === "long") return minutes > 6;
        return true;
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
        case "source": {
          return a.sourceName.localeCompare(b.sourceName);
        }
        case "title": {
          return a.title.localeCompare(b.title);
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [
    activeCategory,
    savedAsArticles,
    historyAsArticles,
    articles,
    relatedGameNames,
    feedCategoryMap,
    activeSource,
    searchQuery,
    activeTag,
    hasImagesOnly,
    timeFilter,
    readTimeFilter,
    unreadOnly,
    sortBy,
    readLinks,
  ]);

  const unreadTotal = useMemo(
    () => allArticles.filter((a) => !readLinks.has(a.link)).length,
    [allArticles, readLinks]
  );

  const matchedGamesCount = useMemo(
    () => allArticles.filter((a) => relatedGameNames.has(a.link)).length,
    [allArticles, relatedGameNames]
  );

  useEffect(() => {
    setPage(1);
  }, [activeCategory, searchQuery, activeTag, activeSource, timeFilter, readTimeFilter, hasImagesOnly, unreadOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(visibleArticles.length / ITEMS_PER_PAGE));
  const paginatedArticles = useMemo(
    () => visibleArticles.slice(0, page * ITEMS_PER_PAGE),
    [visibleArticles, page]
  );
  const hasMore = page < totalPages;

  // Selected article index for cycling in preview modal
  const selectedIndex = useMemo(() => {
    if (!selectedArticle) return -1;
    return visibleArticles.findIndex((a) => a.link === selectedArticle.link);
  }, [selectedArticle, visibleArticles]);

  const hasPrevArticle = selectedIndex > 0;
  const hasNextArticle = selectedIndex >= 0 && selectedIndex < visibleArticles.length - 1;

  const handlePrevArticle = useCallback(() => {
    if (selectedIndex > 0) {
      const prev = visibleArticles[selectedIndex - 1];
      markRead(prev.link);
      addToHistory(prev);
      setSelectedArticle(prev);
    }
  }, [selectedIndex, visibleArticles, markRead, addToHistory]);

  const handleNextArticle = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < visibleArticles.length - 1) {
      const next = visibleArticles[selectedIndex + 1];
      markRead(next.link);
      addToHistory(next);
      setSelectedArticle(next);
    }
  }, [selectedIndex, visibleArticles, markRead, addToHistory]);

  const handleCardClick = useCallback(
    (article: NewsArticle) => {
      markRead(article.link);
      addToHistory(article);
      setSelectedArticle(article);
    },
    [markRead, addToHistory]
  );

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
    showToast(t("news.opmlExportSuccess"), "success");
  }, [allFeeds, showToast, t]);

  const handleExportSavedMarkdown = useCallback(() => {
    if (savedArticles.length === 0) {
      showToast(t("news.noSavedArticles"), "warning");
      return;
    }
    const md = exportSavedArticlesMarkdown(savedAsArticles);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gamelib-saved-news.md";
    a.click();
    URL.revokeObjectURL(url);
    showToast(t("news.markdownExportSuccess"), "success");
  }, [savedArticles.length, savedAsArticles, showToast, t]);

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

  const showMarkAllRead = unreadTotal > 0 && activeCategory !== "saved" && activeCategory !== "history";

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

      {/* Hero Spotlight Section */}
      <div className="ui-complete-only">
        {activeCategory === "all" && !searchQuery && !activeTag && (
          <NewsHeroSpotlight
            articles={allArticles}
            readLinks={readLinks}
            savedLinks={new Set(savedArticles.map((s) => s.link))}
            activeTag={activeTag}
            onSelectArticle={handleCardClick}
            onToggleSave={handleToggleSave}
            onSelectTag={setActiveTag}
          />
        )}

        {/* Interactive KPI strip */}
        <NewsStatsHeader
          total={allArticles.length}
          unread={unreadTotal}
          saved={savedArticles.length}
          feeds={enabledFeedUrls.size}
          matchedGamesCount={matchedGamesCount}
          loading={loading}
          onFilterAll={() => {
            setActiveCategory("all");
            setSearchQuery("");
            setActiveTag(null);
            setSourceFilter(null);
            setUnreadOnly(false);
          }}
          onToggleUnread={() => setUnreadOnly((prev) => !prev)}
          onFilterYourGames={() => {
            setActiveCategory("for_you");
            setSearchQuery("");
            setActiveTag(null);
          }}
          onOpenSaved={() => setActiveCategory("saved")}
          onOpenSettings={handleOpenSettings}
        />
      </div>

      {/* Categories + View Density + Search + Filters */}
      <NewsToolbar
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        countsByCategory={countsByCategory}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        timeFilter={timeFilter}
        onTimeFilterChange={setTimeFilter}
        readTimeFilter={readTimeFilter}
        onReadTimeFilterChange={setReadTimeFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        hasImagesOnly={hasImagesOnly}
        onToggleHasImagesOnly={() => setHasImagesOnly((prev) => !prev)}
        unreadOnly={unreadOnly}
        onToggleUnreadOnly={() => setUnreadOnly((prev) => !prev)}
        unreadTotal={unreadTotal}
        density={density}
        onDensityChange={handleDensityChange}
        onMarkAllRead={markAllRead}
        onOpenSettings={handleOpenSettings}
      />

      {/* Source filter pills */}
      <div className="ui-complete-only">
        <NewsSourcePills
          sourceNames={sourceNames}
          activeSource={activeSource}
          articles={
            activeCategory === "saved"
              ? savedAsArticles
              : activeCategory === "history"
                ? historyAsArticles
                : allArticles
          }
          readLinks={readLinks}
          onSourceChange={setSourceFilter}
        />
      </div>

      {/* Article Grid */}
      <NewsArticleGrid
        articles={paginatedArticles}
        totalCount={visibleArticles.length}
        hasMore={hasMore}
        loading={loading}
        error={error}
        density={density}
        readLinks={readLinks}
        savedLinks={new Set(savedArticles.map((s) => s.link))}
        sourceNames={sourceNames}
        activeSource={activeSource}
        activeCategory={activeCategory}
        searchQuery={searchQuery}
        activeTag={activeTag}
        relatedGameNames={relatedGameNames}
        onCardClick={handleCardClick}
        onToggleSave={handleToggleSave}
        onToggleRead={(art) => toggleReadStatus(art.link)}
        onLoadMore={() => setPage((p) => p + 1)}
        onRetry={refresh}
        onOpenSettings={handleOpenSettings}
        onClearSearch={() => setSearchQuery("")}
        onClearTag={() => setActiveTag(null)}
        onSwitchToAll={() => setActiveCategory("all")}
        onSelectTag={(tag) => setActiveTag(tag)}
      />

      {/* Article Preview & Reader Modal */}
      <NewsArticlePreview
        article={selectedArticle}
        saved={selectedArticle ? savedArticles.some((s) => s.link === selectedArticle.link) : false}
        onClose={handleClosePreview}
        onToggleSave={handleToggleSave}
        onPrevArticle={handlePrevArticle}
        onNextArticle={handleNextArticle}
        hasPrev={hasPrevArticle}
        hasNext={hasNextArticle}
      />

      {/* Feed Settings Modal */}
      {showSettings && (
        <NewsFeedSettings
          allFeeds={allFeeds}
          enabledFeedUrls={enabledFeedUrls}
          customFeeds={customFeeds}
          failedFeedsList={failedFeedsList}
          feedHealthMap={feedHealthMap}
          testingHealth={testingHealth}
          onToggleFeed={toggleFeed}
          onAddFeed={addCustomFeed}
          onImportPack={handleImportPack}
          onRemoveFeed={removeCustomFeed}
          onExportOpml={handleExportOpml}
          onImportOpml={handleImportOpml}
          onExportSavedMarkdown={handleExportSavedMarkdown}
          onTestFeedHealth={testFeedHealth}
          onClose={handleCloseSettings}
        />
      )}
    </div>
  );
}
