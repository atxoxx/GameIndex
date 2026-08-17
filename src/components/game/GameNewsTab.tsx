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

/** Steam publishes a per-app RSS feed (patch notes, announcements, …). */
function steamFeedUrl(appId: number): string {
  return `https://store.steampowered.com/feeds/news/app/${appId}/?cc=us&l=en&format=rss`;
}

/**
 * Derive search keys for a game name so we match real-world headlines:
 * full name first, then the name with edition suffixes / parentheticals
 * stripped, then the base name before a colon or dash.
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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const steamAppId = game.steamAppId ?? null;

  const {
    allArticles,
    loading: feedsLoading,
    error: feedsError,
    refresh,
    markRead,
    addToHistory,
    readLinks,
  } = useNewsFeeds();

  // ── Official Steam news for this app id ────────────────────────────
  const [steamArticles, setSteamArticles] = useState<NewsArticle[]>([]);
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamError, setSteamError] = useState(false);

  useEffect(() => {
    if (!steamAppId) return;
    let active = true;
    setSteamLoading(true);
    setSteamError(false);

    const url = steamFeedUrl(steamAppId);
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
  }, [steamAppId, game.name, t]);

  // ── Merged, de-duplicated, newest-first article list ───────────────
  const matchKeys = useMemo(() => buildMatchKeys(game.name), [game.name]);

  const articles = useMemo(() => {
    const byLink = new Map<string, NewsArticle>();
    const add = (a: NewsArticle) => {
      const key = a.link.trim().toLowerCase();
      if (!byLink.has(key)) byLink.set(key, a);
    };
    // Official Steam posts first (they are authoritative), then matched
    // articles from the general gaming feeds.
    for (const a of steamArticles) add(a);
    for (const a of allArticles) {
      if (articleMatchesGame(a, matchKeys)) add(a);
    }
    return Array.from(byLink.values()).sort(
      (a, b) => articleDateMs(b) - articleDateMs(a)
    );
  }, [steamArticles, allArticles, matchKeys]);

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(() =>
    loadSavedArticles()
  );

  const selectedIndex = useMemo(() => {
    if (!selectedArticle) return -1;
    return articles.findIndex((a) => a.link === selectedArticle.link);
  }, [selectedArticle, articles]);

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

  const loading = feedsLoading || steamLoading;
  // Only call it a failure when every source we could have used errored.
  const failed =
    articles.length === 0 &&
    feedsError &&
    (steamAppId === null || steamError);

  return (
    <div className="game-news-tab">
      {/* Header with count + actions */}
      <div className="game-news-header">
        <div className="game-news-header-text">
          <h2>{t("game.news.title")}</h2>
          <p>
            {articles.length > 0
              ? t("game.news.subtitleCount", { count: articles.length, game: game.name })
              : t("game.news.subtitle", { game: game.name })}
          </p>
        </div>
        <div className="game-news-header-actions">
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
          >
            {t("common.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/news")}
            title={t("game.news.openNewsHub")}
            aria-label={t("game.news.openNewsHub")}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            }
          >
            {t("game.news.openNewsHub")}
          </Button>
        </div>
      </div>

      {/* Loading skeletons */}
      {loading && articles.length === 0 ? (
        <div className="game-news-grid" aria-hidden="true">
          <NewsArticleCardSkeleton density="cinematic" />
          <NewsArticleCardSkeleton density="cozy" />
          <NewsArticleCardSkeleton density="cozy" />
          <NewsArticleCardSkeleton density="cozy" />
          <NewsArticleCardSkeleton density="cozy" />
        </div>
      ) : articles.length === 0 ? (
        <div className="game-news-empty">
          <div className="game-news-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
              <path d="M18 14h-8" />
              <path d="M15 18h-5" />
              <path d="M10 6h8v4h-8V6Z" />
            </svg>
          </div>
          <h3>{t("game.news.emptyTitle")}</h3>
          <p>{failed ? t("game.news.emptyError") : t("game.news.emptySubtitle", { game: game.name })}</p>
          <div className="game-news-empty-actions">
            <Button variant="ghost" size="sm" onClick={refresh} leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            }>
              {t("common.retry")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/news")}>
              {t("game.news.openNewsHub")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="game-news-grid">
            {articles.map((article, index) => (
              <NewsArticleCard
                key={article.link}
                article={article}
                onClick={handleOpenArticle}
                onToggleSave={handleToggleSave}
                density={index === 0 ? "cinematic" : "cozy"}
                read={readLinks.has(article.link)}
                saved={savedArticles.some((s) => s.link === article.link)}
              />
            ))}
          </div>
          <div className="game-news-footer">
            <span>
              {t("game.news.footer", { count: articles.length, game: game.name })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => navigate("/news")}>
              {t("game.news.openNewsHub")}
            </Button>
          </div>
        </>
      )}

      {/* Reader modal with prev/next cycling across the merged list */}
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
            const prev = articles[selectedIndex - 1];
            markRead(prev.link);
            addToHistory(prev);
            setSelectedArticle(prev);
          }
        }}
        onNextArticle={() => {
          if (selectedIndex >= 0 && selectedIndex < articles.length - 1) {
            const next = articles[selectedIndex + 1];
            markRead(next.link);
            addToHistory(next);
            setSelectedArticle(next);
          }
        }}
        hasPrev={selectedIndex > 0}
        hasNext={selectedIndex >= 0 && selectedIndex < articles.length - 1}
      />
    </div>
  );
}
