import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Download,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { NewsFeed } from "../../types/news";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useNews } from "../../context/NewsContext";
import {
  CURATED_FEED_PACKS,
  DEFAULT_FEEDS,
  getRegionalFeeds,
  ALL_MANAGED_FEEDS,
} from "../../utils/news/catalogues";
import {
  buildOpml,
  discoverFeedUrl,
  exportSavedArticlesMarkdown,
  parseOpml,
} from "../../utils/news/feed";

interface NewsSourcesDrawerProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = ["general", "pc", "console", "tech", "indie", "deals", "esports"];

/**
 * Sources drawer.
 *
 * Feed management used to live in a full-screen modal reached through a gear
 * icon — the most important setting on the page, hidden. This is the same
 * controls as a right-hand drawer, grouped by catalogue / regional / custom,
 * with health and backup in place.
 */
export default function NewsSourcesDrawer({ open, onClose }: NewsSourcesDrawerProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const news = useNews();

  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState("general");
  const [formError, setFormError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const opmlInputRef = useRef<HTMLInputElement>(null);

  const regionalFeeds = useMemo(() => getRegionalFeeds(language), [language]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const matches = useCallback(
    (feed: NewsFeed) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        feed.name.toLowerCase().includes(needle) || feed.url.toLowerCase().includes(needle)
      );
    },
    [query],
  );

  const enabledCount = news.feeds.filter((feed) => feed.enabled).length;

  if (!open) return null;

  const handleAdd = () => {
    setFormError(null);
    const trimmedName = name.trim();
    let trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      setFormError(t("news.feedErrorNameUrl"));
      return;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) trimmedUrl = `https://${trimmedUrl}`;
    try {
      new URL(trimmedUrl);
    } catch {
      setFormError(t("news.feedErrorInvalidUrl"));
      return;
    }
    const duplicate =
      news.feeds.some((feed) => feed.url.toLowerCase() === trimmedUrl.toLowerCase()) ||
      ALL_MANAGED_FEEDS.some((feed) => feed.url.toLowerCase() === trimmedUrl.toLowerCase());
    if (duplicate) {
      setFormError(t("news.feedErrorDuplicate"));
      return;
    }
    const added = news.addCustomFeed(trimmedName, trimmedUrl, category);
    if (!added) {
      setFormError(t("news.feedErrorDuplicate"));
      return;
    }
    setName("");
    setUrl("");
    showToast(t("news.feedAdded"), "success");
  };

  const handleDiscover = async () => {
    let homepage = url.trim();
    if (!homepage) {
      setFormError(t("news.feedErrorPasteUrl"));
      return;
    }
    if (!/^https?:\/\//i.test(homepage)) homepage = `https://${homepage}`;
    setDiscovering(true);
    setFormError(null);
    try {
      const discovered = await discoverFeedUrl(homepage);
      if (discovered) {
        setUrl(discovered);
        if (!name.trim()) {
          try {
            setName(new URL(homepage).hostname.replace(/^www\./, ""));
          } catch {
            /* keep the name empty */
          }
        }
      } else {
        setFormError(t("news.feedErrorNoFeed"));
      }
    } catch {
      setFormError(t("news.feedErrorUnreachable"));
    } finally {
      setDiscovering(false);
    }
  };

  const handleExportOpml = () => {
    const enabled = news.feeds.filter((feed) => feed.enabled);
    const blob = new Blob([buildOpml(enabled)], { type: "text/xml" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "gameindex-news-feeds.opml";
    anchor.click();
    URL.revokeObjectURL(href);
    showToast(t("news.opmlExportSuccess"), "success");
  };

  const handleImportOpml = async (file: File) => {
    try {
      const parsed = parseOpml(await file.text());
      if (parsed.length === 0) {
        showToast(t("newsPage.opmlNoFeeds"), "warning");
        return;
      }
      const added = news.addCustomFeeds(parsed.map((feed) => ({ name: feed.name, url: feed.url })));
      showToast(t("newsPage.opmlImported", { count: added, plural: added === 1 ? "" : "s" }), "success");
    } catch {
      showToast(t("newsPage.opmlReadFailed"), "error");
    }
  };

  const handleExportSaved = () => {
    if (news.saved.length === 0) {
      showToast(t("news.noSavedArticles"), "warning");
      return;
    }
    const blob = new Blob([exportSavedArticlesMarkdown(news.saved)], { type: "text/markdown" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "gameindex-saved-news.md";
    anchor.click();
    URL.revokeObjectURL(href);
    showToast(t("news.markdownExportSuccess"), "success");
  };

  const handleTestHealth = async () => {
    await news.testFeedHealth();
    showToast(t("news.healthChecked"), "info");
  };

  const renderFeedRow = (feed: NewsFeed, removable = false) => {
    const health = news.feedHealth.get(feed.url);
    return (
      <div key={feed.url} className="news-source-row">
        <span className="news-source-row__avatar" aria-hidden>
          {feed.name.charAt(0).toUpperCase()}
        </span>
        <div className="news-source-row__info">
          <div className="news-source-row__title">
            <span>{feed.name}</span>
            {health && (
              <span className={`news-health news-health--${health.status}`}>
                {health.latencyMs}ms
              </span>
            )}
          </div>
          <span className="news-source-row__url" title={feed.url}>
            {feed.url}
          </span>
        </div>
        {removable && (
          <button
            type="button"
            className="news-source-row__remove"
            onClick={() => news.removeCustomFeed(feed.url)}
            title={t("sourceManager.removeSourceLabel", { source: feed.name })}
            aria-label={t("sourceManager.removeSourceLabel", { source: feed.name })}
          >
            <Trash2 size={14} />
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={feed.enabled}
          className={`news-switch${feed.enabled ? " is-on" : ""}`}
          onClick={() => news.toggleFeed(feed.url)}
          title={feed.enabled ? t("news.disableFeed", { name: feed.name }) : t("news.enableFeed", { name: feed.name })}
          aria-label={feed.enabled ? t("news.disableFeed", { name: feed.name }) : t("news.enableFeed", { name: feed.name })}
        >
          <span />
        </button>
      </div>
    );
  };

  const international = news.feeds.filter(
    (feed) => feed.isDefault && !regionalFeeds.some((regional) => regional.url === feed.url),
  );
  const regional = news.feeds.filter((feed) =>
    regionalFeeds.some((entry) => entry.url === feed.url),
  );
  const custom = news.customFeeds;

  return createPortal(
    <div className="news-drawer-root" role="dialog" aria-modal="true" aria-label={t("news.sourcesDrawerTitle")}>
      <button
        type="button"
        className="news-drawer__scrim"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <aside className="news-drawer">
        <header className="news-drawer__head">
          <div>
            <h2>{t("news.sourcesDrawerTitle")}</h2>
            <p>{t("news.sourcesDrawerSubtitle")}</p>
          </div>
          <button type="button" className="news-drawer__close" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>

        <div className="news-drawer__status">
          <span>{t("news.feedsEnabled", { enabled: enabledCount, total: news.feeds.length })}</span>
          {news.failedFeeds.length > 0 && (
            <span className="news-drawer__failed">
              {t("news.failedFeedsWarningShort", { count: news.failedFeeds.length })}
            </span>
          )}
          <button type="button" onClick={handleTestHealth} disabled={news.testingHealth}>
            <Activity size={13} />
            {news.testingHealth ? t("news.testingFeeds") : t("news.testFeeds")}
          </button>
        </div>

        <label className="news-search news-search--drawer">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("news.searchFeedsPlaceholder")}
            aria-label={t("news.searchFeedsPlaceholder")}
          />
        </label>

        <div className="news-drawer__body">
          <section className="news-drawer__section">
            <h3>
              {t("news.internationalFeeds")}
              <span>{international.filter((feed) => feed.enabled).length}/{international.length}</span>
            </h3>
            {international.filter(matches).map((feed) => renderFeedRow(feed))}
          </section>

          {regional.length > 0 && (
            <section className="news-drawer__section">
              <h3>
                {t("news.regionalFeeds")}
                <span>{regional.filter((feed) => feed.enabled).length}/{regional.length}</span>
              </h3>
              <p className="news-drawer__hint">{t("news.regionalFeedsHint")}</p>
              {regional.filter(matches).map((feed) => renderFeedRow(feed))}
            </section>
          )}

          <section className="news-drawer__section">
            <h3>
              {t("news.customFeeds")}
              <span>{custom.length}</span>
            </h3>
            {custom.length === 0 ? (
              <p className="news-drawer__hint">{t("news.noCustomFeeds")}</p>
            ) : (
              custom.filter(matches).map((feed) => renderFeedRow(feed, true))
            )}
          </section>

          <section className="news-drawer__section">
            <h3>{t("news.curatedPacksTitle")}</h3>
            <div className="news-pack-grid">
              {CURATED_FEED_PACKS.map((pack) => {
                const added = pack.feeds.every((entry) =>
                  news.feeds.some((feed) => feed.url.toLowerCase() === entry.url.toLowerCase()),
                );
                return (
                  <button
                    key={pack.id}
                    type="button"
                    className={`news-pack${added ? " is-added" : ""}`}
                    onClick={() => news.importFeedPack(pack.id)}
                    disabled={added}
                  >
                    <span className="news-pack__icon" aria-hidden>{pack.icon}</span>
                    <span className="news-pack__text">
                      <strong>{t(pack.nameKey)}</strong>
                      <small>{t(pack.descKey)}</small>
                    </span>
                    <span className="news-pack__action">
                      {added ? t("news.packAdded") : t("news.packAdd")}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="news-drawer__section">
            <h3>{t("news.addCustomFeed")}</h3>
            <div className="news-add-feed">
              <div className="news-add-feed__row">
                <input
                  className="news-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("news.feedNamePlaceholder")}
                  aria-label={t("news.feedNamePlaceholder")}
                  maxLength={40}
                />
                <input
                  className="news-input"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder={t("news.feedUrlPlaceholder")}
                  aria-label={t("news.feedUrlPlaceholder")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAdd();
                  }}
                />
                <select
                  className="news-input news-input--select"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-label={t("news.topicsLabel")}
                >
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {value === "general" ? t("news.catGeneral") : t(`news.tab${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
                    </option>
                  ))}
                </select>
              </div>
              {formError && <p className="news-add-feed__error">{formError}</p>}
              <div className="news-add-feed__actions">
                <button type="button" className="news-button news-button--primary" onClick={handleAdd}>
                  <Plus size={14} />
                  {t("news.addFeed")}
                </button>
                <button
                  type="button"
                  className="news-button"
                  onClick={handleDiscover}
                  disabled={discovering}
                >
                  {discovering ? t("news.discovering") : t("news.discoverFromUrl")}
                </button>
              </div>
            </div>
          </section>

          <section className="news-drawer__section">
            <h3>{t("news.opmlTitle")}</h3>
            <p className="news-drawer__hint">{t("news.opmlHint")}</p>
            <div className="news-drawer__actions">
              <button type="button" className="news-button" onClick={handleExportOpml}>
                <Download size={14} />
                {t("newsPage.exportOpml")}
              </button>
              <button type="button" className="news-button" onClick={() => opmlInputRef.current?.click()}>
                <Upload size={14} />
                {t("newsPage.importOpml")}
              </button>
              <button type="button" className="news-button" onClick={handleExportSaved}>
                {t("news.exportBookmarksMd")}
              </button>
              <input
                ref={opmlInputRef}
                type="file"
                accept=".opml,application/xml,text/xml"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImportOpml(file);
                  event.target.value = "";
                }}
              />
            </div>
          </section>

          <section className="news-drawer__section">
            <h3>{t("news.maintenance")}</h3>
            <button
              type="button"
              className="news-button news-button--danger"
              onClick={() => {
                void news.clearCachedArticles();
                showToast(t("news.cacheCleared"), "success");
              }}
            >
              {t("news.clearCache")}
            </button>
          </section>
        </div>

        <footer className="news-drawer__foot">
          <span>
            {t("news.feedCounts", {
              international: DEFAULT_FEEDS.length,
              regional: regionalFeeds.length,
              custom: custom.length,
            })}
          </span>
          <button type="button" className="news-button news-button--primary" onClick={onClose}>
            {t("editImage.done")}
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
