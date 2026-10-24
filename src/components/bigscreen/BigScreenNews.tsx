import { useState, useMemo, useCallback, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useNewsDemand } from "../../context/NewsContext";
import { formatArticleDate } from "../../utils/news/feed";
import type { NewsArticle } from "../../types/news";
import { useFocusable } from "../../hooks/useFocusable";
import { openUrl } from "@tauri-apps/plugin-opener";
import BigScreenPill from "./BigScreenPill";
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

  // Left Sidebar Sources
  const allSources = useMemo(() => ["All Sources", ...sourceNames], [sourceNames]);
  const hasFatalError = error !== null && articles.length === 0;

  return (
    <div className="bigscreen-system-hub">
      {/* Left Menu Pane - Filter by Source */}
      <div className="bigscreen-system-left-pane">
        <h2 className="bigscreen-system-title">{t("bigscreen.news.feeds")}</h2>
        <div className="bigscreen-system-menu" role="tablist">
          {allSources.map((src) => {
            const isAll = src === "All Sources";
            const isActive = isAll ? activeSource === null : activeSource === src;
            return (
              <SourceRow
                key={src}
                src={src}
                isAll={isAll}
                isActive={isActive}
                onSelect={() => setSourceFilter(isAll ? null : src)}
              />
            );
          })}
        </div>
      </div>

      {/* Right Content Pane - Articles Grid */}
      <div className="bigscreen-system-right-pane" style={{ padding: "0" }}>
        <div className="bigscreen-system-section-view bigscreen-news-content">
          <div className="bigscreen-news-toolbar">
            <h3>{t("bigscreen.news.latestArticles")}</h3>
            <NewsRefreshButton onRefresh={() => void refresh(true)} />
          </div>

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

      {/* Fullscreen Article Reader Modal */}
      {selectedArticle && (
        <BigScreenNewsReader article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}
    </div>
  );
}

// ─── Refresh Button ───────────────────────────────────────────────
// Owns its useFocusable call unconditionally (rules-of-hooks) — the
// previous inline `{...useFocusable(refresh)}` in the toolbar JSX
// skipped the hook whenever the loading branch rendered.

function NewsRefreshButton({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useLanguage();
  const refreshProps = useFocusable(onRefresh);

  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...refreshProps}
    >
      {t("bigscreen.news.refresh")}
    </button>
  );
}

// ─── Source Row Component ─────────────────────────────────────────
// Owns its useFocusable call unconditionally (rules-of-hooks) — the
// previous inline `useFocusable(selectSource)` inside `allSources.map`
// was a hook-in-map violation. Mirrors the NewsArticleCard pattern.

function SourceRow({
  src,
  isAll,
  isActive,
  onSelect,
}: {
  src: string;
  isAll: boolean;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(onSelect);

  return (
    <button
      type="button"
      aria-selected={isActive}
      className={`bigscreen-system-menu-item ${isActive ? "active" : ""}`}
      {...focusProps}
    >
      <span className="menu-item-icon">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v4h4M8 11h8M8 15h8" />
        </svg>
      </span>
      <span className="menu-item-label">{isAll ? t("bigscreen.news.allSources") : src}</span>
    </button>
  );
}

// ─── News Card Component ─────────────────────────────────────────────

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
    >
      <div className="bigscreen-news-card-cover">
        {article.imageUrl ? (
          <img src={article.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="bigscreen-news-accent-dot" />
      </div>
      <div className="bigscreen-news-card-body">
        <h4 className="bigscreen-news-card-title">
          {article.title}
        </h4>
        <div className="bigscreen-news-card-meta">
          <span className="bigscreen-news-source">{article.sourceName}</span>
          {article.pubDate && (
            <span className="bigscreen-news-date">{formatArticleDate(article.pubDate, language)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── News Reader Modal Component ─────────────────────────────────────

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
    <div data-bigscreen-overlay="true" className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal" onClick={onClose}>
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal"
        style={{
          width: "80%",
          maxWidth: "800px",
          height: "80%",
          maxHeight: "650px",
          padding: "0",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner image or placeholder */}
        <div className="bigscreen-news-reader-banner">
          {article.imageUrl ? (
            <img src={article.imageUrl} alt="" />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center", alignItems: "center", opacity: 0.1 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="80" height="80">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
          )}
        </div>

        {/* Article Details */}
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

        {/* Footer Actions */}
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
