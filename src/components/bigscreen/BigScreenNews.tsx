// News — one of the three Discover areas.
//
// DiscoverTabs owns the top strip; the body below is a single scroll
// region: a page header (feeds + refresh), a source filter row, then the
// article grid. Articles open in a reader panel that pins its banner and
// footer while only the copy scrolls.

import { useState, useMemo, useCallback, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useNewsDemand } from "../../context/NewsContext";
import { formatArticleDate } from "../../utils/news/feed";
import type { NewsArticle } from "../../types/news";
import { useFocusable } from "../../hooks/useFocusable";
import { openUrl } from "@tauri-apps/plugin-opener";
import BigScreenPill from "./BigScreenPill";
import DiscoverTabs from "./DiscoverTabs";
import {
  BigScreenEmptyState,
  BigScreenErrorState,
  BigScreenLoadingState,
} from "./BigScreenState";

export default function BigScreenNews() {
  const { t } = useLanguage();
  const {
    articles: allArticles,
    loading,
    error,
    refresh,
    loadArticle,
  } = useNewsDemand();

  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [activeSource, setSourceFilter] = useState<string | null>(null);

  const sourceNames = useMemo(
    () => [...new Set(allArticles.map((article) => article.sourceName))].sort(),
    [allArticles],
  );

  const articles = useMemo(
    () =>
      activeSource
        ? allArticles.filter((article) => article.sourceName === activeSource)
        : allArticles,
    [allArticles, activeSource],
  );

  const allSources = useMemo(() => ["All Sources", ...sourceNames], [sourceNames]);
  const hasFatalError = error !== null && articles.length === 0;

  return (
    <div className="bs-discover-page">
      <DiscoverTabs />

      <div className="bs-discover-page-body">
        <div className="bigscreen-news-page">
          <header className="bigscreen-news-header">
            <div className="bigscreen-news-heading">
              <h2 className="bigscreen-news-title">{t("bigscreen.news.feeds")}</h2>
              <span className="bigscreen-news-total">{articles.length}</span>
            </div>
            <NewsRefreshButton onRefresh={() => void refresh(true)} />
          </header>

          <div
            className="bigscreen-news-sources"
            role="tablist"
            aria-label={t("bigscreen.news.feeds")}
          >
            {allSources.map((src) => {
              const isAll = src === "All Sources";
              const isActive = isAll ? activeSource === null : activeSource === src;
              return (
                <SourceChip
                  key={src}
                  label={isAll ? t("bigscreen.news.allSources") : src}
                  isActive={isActive}
                  onSelect={() => setSourceFilter(isAll ? null : src)}
                />
              );
            })}
          </div>

          <h3 className="bigscreen-news-section-title">{t("bigscreen.news.latestArticles")}</h3>

          {loading ? (
            <BigScreenLoadingState message={t("bigscreen.news.loading")} />
          ) : hasFatalError ? (
            <BigScreenErrorState
              message={t("bigscreen.news.loadError", { error })}
              onRetry={() => void refresh(true)}
            />
          ) : articles.length === 0 ? (
            <BigScreenEmptyState message={t("bigscreen.news.noArticles")} />
          ) : (
            <div className="bigscreen-news-grid">
              {articles.map((article, index) => (
                <NewsArticleCard
                  key={`${article.link}-${index}`}
                  article={article}
                  onSelect={() => {
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
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen article reader modal */}
      {selectedArticle && (
        <BigScreenNewsReader article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}
    </div>
  );
}

// ─── Refresh button ───────────────────────────────────────────────
// Owns its useFocusable call unconditionally (rules-of-hooks) — an
// inline `{...useFocusable(refresh)}` in the header JSX would skip the
// hook whenever the loading branch rendered.

function NewsRefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useLanguage();
  const refreshProps = useFocusable(onRefresh);

  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-news-refresh"
      data-focus-key="news:refresh"
      {...refreshProps}
    >
      {t("bigscreen.news.refresh")}
    </button>
  );
}

// ─── Source chip ──────────────────────────────────────────────────
// Same reason as the refresh button: one hook instance per chip rather
// than a hook inside `allSources.map`.

function SourceChip({
  label,
  isActive,
  onSelect,
}: {
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const focusProps = useFocusable(onSelect);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={`bigscreen-filter-chip${isActive ? " active" : ""}`}
      data-focus-key={`news:source:${label}`}
      {...focusProps}
    >
      {label}
    </button>
  );
}

// ─── News card ────────────────────────────────────────────────────

function NewsArticleCard({
  article,
  onSelect,
}: {
  article: NewsArticle;
  onSelect: () => void;
}) {
  const { language } = useLanguage();
  const focusProps = useFocusable(onSelect);

  return (
    <div
      className="bigscreen-game-card bigscreen-news-card"
      {...focusProps}
      role="button"
      data-focus-key={`news:article:${article.link}`}
    >
      <div className="bigscreen-news-card-cover">
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40" aria-hidden="true">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="bigscreen-news-accent-dot" />
      </div>
      <div className="bigscreen-news-card-body">
        <h4 className="bigscreen-news-card-title">{article.title}</h4>
        <div className="bigscreen-news-card-meta">
          <span className="bigscreen-news-source">{article.sourceName}</span>
          {article.pubDate && (
            <span className="bigscreen-news-date">
              {formatArticleDate(article.pubDate, language)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── News reader modal ────────────────────────────────────────────

function BigScreenNewsReader({
  article,
  onClose,
}: {
  article: NewsArticle;
  onClose: () => void;
}) {
  const { t, language } = useLanguage();
  const handleOpenBrowser = useCallback(async () => {
    try {
      await openUrl(article.link);
    } catch {
      window.open(article.link, "_blank", "noopener,noreferrer");
    }
  }, [article.link]);

  const closeProps = useFocusable(onClose);
  const browserProps = useFocusable(handleOpenBrowser);

  // Controller B / X (and keyboard Escape) close the reader modal.
  // Capture-phase so it runs before the shell's global Escape handler,
  // and the data-bigscreen-overlay attribute tells the shell this
  // surface owns Back while mounted.
  useEffect(() => {
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [onClose]);

  return (
    <div
      data-bigscreen-overlay="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onClick={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-news-reader-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner image or placeholder */}
        <div className="bigscreen-news-reader-banner">
          {article.imageUrl ? (
            <img src={article.imageUrl} alt="" />
          ) : (
            <div className="bigscreen-news-reader-banner-empty" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
          )}
        </div>

        {/* Article details */}
        <div className="bigscreen-news-reader-body">
          <div className="bigscreen-news-reader-meta">
            <BigScreenPill tone="accent" size="sm">{article.sourceName}</BigScreenPill>
            {article.pubDate && (
              <span className="bigscreen-news-reader-date">
                {formatArticleDate(article.pubDate, language)}
              </span>
            )}
          </div>
          <h2 className="bigscreen-news-reader-title">{article.title}</h2>
          <p className="bigscreen-news-reader-copy">
            {article.description || t("bigscreen.news.noPreview")}
          </p>
        </div>

        {/* Footer actions */}
        <div className="bigscreen-news-reader-footer">
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary"
            {...browserProps}
          >
            {t("bigscreen.news.openBrowser")}
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary"
            {...closeProps}
          >
            {t("bigscreen.news.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
