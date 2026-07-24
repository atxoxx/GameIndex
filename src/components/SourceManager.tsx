// SourceManager — the user-facing UI for managing download sources.
// Renders inside SettingsPage's Integrations section (or a new
// "Download Sources" sub-section). Three visible blocks:
//
//   1. Header — title + "Refresh all" button
//   2. Add-source form — URL + optional name + Add button
//   3. Source list — one row per configured source with
//      enabled toggle, refresh, delete, and metadata
//
// Persistence is handled by the Rust source_manager module; this
// component is just the React shell that calls the Tauri commands
// and renders state from useSources().

import { useState, useCallback } from "react";
import { useSources } from "../context/SourceContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { Button } from "./ui";
import type { SourceLink } from "../types/source";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

/** Format a unix-seconds timestamp as a short relative string. */
function formatRelative(unixSeconds: number | null, t: Translator): string {
  if (unixSeconds == null) return t("sourceManager.never");
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return t("sourceManager.justNow");
  if (diff < 3600) return t("sourceManager.minutesAgo", { count: Math.round(diff / 60) });
  if (diff < 86400) return t("sourceManager.hoursAgo", { count: Math.round(diff / 3600) });
  if (diff < 30 * 86400) return t("sourceManager.daysAgo", { count: Math.round(diff / 86400) });
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

export default function SourceManager() {
  const {
    sources,
    addSource,
    addSourceBulk,
    removeSource,
    toggleSource,
    refreshSource,
    refreshAllSources,
  } = useSources();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [showAddForm, setShowAddForm] = useState(false);
  // `addMode` switches between the single-URL form and the bulk
  // textarea ("one URL per line"). `bulk` is the raw textarea value.
  const [addMode, setAddMode] = useState<"single" | "bulk">("single");
  const [newUrl, setNewUrl] = useState("");
  const [newName, setNewName] = useState("");
  const [bulkText, setBulkText] = useState("");
  // `adding` is true while the Hydra API call is in flight.
  const [adding, setAdding] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  // Track which row is currently refreshing so we can show the
  // spinner only on that row (instead of on every row at once).
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Reset the form fields and hide the panel.
  const resetAddForm = useCallback(() => {
    setShowAddForm(false);
    setAddMode("single");
    setNewUrl("");
    setNewName("");
    setBulkText("");
  }, []);

  const handleAdd = useCallback(async () => {
    const url = newUrl.trim();
    if (!url) {
      showToast(t("sourceManager.urlRequired"), "error");
      return;
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      showToast(t("sourceManager.urlMustStartHttp"), "error");
      return;
    }
    // The Rust command POSTs the URL to the Hydra API
    // `/download-sources` endpoint, which fetches + parses the
    // source JSON and returns the full download data. We disable
    // the form while the API call is in flight.
    setAdding(true);
    try {
      await addSource(url, newName);
      resetAddForm();
    } catch (err) {
      const msg = String(err);
      showToast(t("sourceManager.addFailed", { error: msg }), "error");
    } finally {
      setAdding(false);
    }
  }, [newUrl, newName, addSource, showToast, resetAddForm, t]);

  // Parse the bulk textarea into a de-duplicated list of valid URLs.
  const parseBulkUrls = useCallback((text: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const url = raw.trim();
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }, []);

  const handleBulkAdd = useCallback(async () => {
    const urls = parseBulkUrls(bulkText);
    if (urls.length === 0) {
      showToast(t("sourceManager.pasteUrl"), "error");
      return;
    }
    const bad = urls.filter(
      (u) => !u.startsWith("http://") && !u.startsWith("https://"),
    );
    if (bad.length > 0) {
      showToast(
        t("sourceManager.bulkInvalidUrls", { count: bad.length }),
        "error",
      );
      return;
    }
    setAdding(true);
    try {
      const result = await addSourceBulk(urls);
      const { added, skipped, failed } = result;
      if (added.length > 0) {
        showToast(t("sourceManager.addedSources", { count: added.length, s: added.length === 1 ? "" : "s" }), "success");
      }
      if (skipped.length > 0) {
        showToast(t("sourceManager.skippedDuplicates", { count: skipped.length, s: skipped.length === 1 ? "" : "s" }), "info");
      }
      if (failed.length > 0) {
        showToast(
          t("sourceManager.failedToAdd", { count: failed.length, s: failed.length === 1 ? "" : "s" }),
          "error",
        );
      }
      if (added.length > 0 || skipped.length > 0) {
        resetAddForm();
      }
    } catch (err) {
      showToast(t("sourceManager.bulkAddFailed", { error: String(err) }), "error");
    } finally {
      setAdding(false);
    }
  }, [bulkText, parseBulkUrls, addSourceBulk, showToast, resetAddForm, t]);

  const handleRefreshOne = useCallback(
    async (id: string) => {
      setRefreshingIds((prev) => new Set(prev).add(id));
      try {
        await refreshSource(id);
      } catch {
        // toast already shown by context
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refreshSource],
  );

  const handleRefreshAll = useCallback(async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await refreshAllSources();
    } catch {
      // toast already shown
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, refreshAllSources]);

  const handleRemove = useCallback(
    async (source: SourceLink) => {
      const confirmed = window.confirm(
        t("sourceManager.removeConfirm", { name: source.name }),
      );
      if (!confirmed) return;
      try {
        await removeSource(source.id);
        showToast(t("sourceManager.removedSource", { name: source.name }), "info");
      } catch (err) {
        showToast(t("sourceManager.removeFailed", { error: String(err) }), "error");
        // Re-throw so the caller (e.g. an optimistic-UI layer) can
        // roll back if needed. The current caller ignores it but a
        // future caller may want to react.
        throw err;
      }
    },
    [removeSource, showToast, t],
  );

  const hasSources = sources.length > 0;
  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="src-manager">
      {/* ── Header row ───────────────────────────────────────────── */}
      <div className="src-manager-header">
        <div className="src-manager-header-text">
          <h3 className="src-manager-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {t("settings.section.downloadSources")}
          </h3>
          <p className="src-manager-desc">
            {t("sourceManager.desc1")} <code>{`{ name, downloads: [{ title, fileSize, uris }] }`}</code> {t("sourceManager.desc2")}
          </p>
        </div>
        <div className="src-manager-bulk">
          {hasSources && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefreshAll}
              disabled={refreshingAll || enabledCount === 0}
              title={t("sourceManager.refetchAll")}
              leftIcon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              }
            >
              {refreshingAll ? t("sourceManager.refreshing") : t("sourceManager.refreshAll")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowAddForm((s) => !s)}
            leftIcon={
              showAddForm ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              )
            }
          >
            {showAddForm ? t("common.close") : t("sourceManager.addSource")}
          </Button>
        </div>
      </div>

      {/* ── Add-source form ─────────────────────────────────────── */}
      {showAddForm && (
        <form
          className="src-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (addMode === "bulk") void handleBulkAdd();
            else void handleAdd();
          }}
        >
          {/* Mode toggle: single URL vs. bulk paste. */}
          <div className="src-form-modes" role="tablist" aria-label={t("sourceManager.addModeLabel")}>
            <button
              type="button"
              role="tab"
              aria-selected={addMode === "single"}
              className={`src-mode-btn${addMode === "single" ? " active" : ""}`}
              onClick={() => setAddMode("single")}
            >
              {t("sourceManager.singleLink")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addMode === "bulk"}
              className={`src-mode-btn${addMode === "bulk" ? " active" : ""}`}
              onClick={() => setAddMode("bulk")}
            >
              {t("sourceManager.bulkAdd")}
            </button>
          </div>

          {addMode === "single" ? (
            <div className="src-form-row">
              <input
                className="src-form-input"
                type="url"
                placeholder="https://example.com/sources/my-source.json"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                autoFocus
                required
                aria-label={t("sourceManager.sourceUrl")}
              />
              <input
                className="src-form-input"
                type="text"
                placeholder={t("sourceManager.displayNamePlaceholder")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ maxWidth: "200px" }}
                aria-label={t("sourceManager.sourceName")}
              />
            </div>
          ) : (
            <textarea
              className="src-form-textarea"
              rows={6}
              placeholder={"https://example.com/sources/source-1.json\nhttps://example.com/sources/source-2.json\nhttps://example.com/sources/source-3.json"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              autoFocus
              spellCheck={false}
              aria-label={t("sourceManager.bulkUrlsLabel")}
              style={{ width: "100%", resize: "vertical", minHeight: "120px", fontFamily: "SFMono-Regular, Consolas, monospace" }}
            />
          )}

          <p className="src-form-hint">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>
              {addMode === "bulk" ? (
                <>{t("sourceManager.bulkHint")}</>
              ) : (
                <>
                  {t("sourceManager.singleHint1")} <strong>{t("sourceManager.addSource")}</strong>{" "}
                  {t("sourceManager.singleHint2")}
                </>
              )}
            </span>
          </p>
          <div className="src-form-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetAddForm}
              disabled={adding}
            >
              {t("common.cancel")}
            </Button>
            {addMode === "bulk" ? (
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={!bulkText.trim() || adding}
                isLoading={adding}
              >
                {adding ? t("store.adding") : t("sourceManager.addAll")}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={!newUrl.trim() || adding}
                isLoading={adding}
              >
                {t("sourceManager.addSource")}
              </Button>
            )}
          </div>
        </form>
      )}

      {/* ── Source list ─────────────────────────────────────────── */}
      {hasSources ? (
        <div className="src-list">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              isRefreshing={refreshingIds.has(source.id)}
              onToggle={() => void toggleSource(source.id)}
              onRefresh={() => void handleRefreshOne(source.id)}
              onRemove={() => void handleRemove(source)}
            />
          ))}
        </div>
      ) : (
        <div className="src-empty">
          <svg
            className="src-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <p className="src-empty-title">{t("sourceManager.noSources")}</p>
          <p className="src-empty-hint">
            {t("sourceManager.emptyHintPre")}{" "}
            <code>{`{ name, downloads: [{ title, fileSize, uris }] }`}</code>
            {t("sourceManager.emptyHintPost")}
          </p>
        </div>
      )}

    </div>
  );
}

function SourceRow({
  source,
  isRefreshing,
  onToggle,
  onRefresh,
  onRemove,
}: {
  source: SourceLink;
  isRefreshing: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className={`src-item${source.enabled ? "" : " disabled"}${isRefreshing ? " refreshing" : ""}`}>
      <div className="src-item-info">
        <div className="src-item-header">
          <span className="src-item-name">{source.name}</span>
          <span className={`src-item-status ${source.enabled ? "enabled" : "disabled"}`}>
            {source.enabled ? t("sourceManager.enabled") : t("sourceManager.disabled")}
          </span>
        </div>
        <div className="src-item-url">
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.url}
          </a>
        </div>
        <div className="src-item-meta">
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {formatRelative(source.lastFetched, t)}
          </span>
          <span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            {t("storage.gamesCount", { count: source.gameCount.toLocaleString(), plural: source.gameCount === 1 ? "" : "s" })}
          </span>
        </div>
      </div>

      <div className="src-item-controls">
        <label className="src-toggle" title={source.enabled ? t("sourceManager.disableSource") : t("sourceManager.enableSource")}>
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={onToggle}
            aria-label={t("sourceManager.toggleSource", { source: source.name })}
          />
          <span className="src-toggle-slider" />
        </label>
        <button
          type="button"
          className={`src-action-btn${isRefreshing ? " spinning" : ""}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          title={t("sourceManager.refetchSource")}
          aria-label={t("sourceManager.refreshSource", { source: source.name })}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button
          type="button"
          className="src-action-btn danger"
          onClick={onRemove}
          disabled={isRefreshing}
          title={t("sourceManager.removeSource")}
          aria-label={t("sourceManager.removeSourceLabel", { source: source.name })}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
