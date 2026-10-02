import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RotateCcw, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useWebviewContentFilterEnabled } from "../../context/SettingsContext";
import { dismissWebviewConsent, useEmbeddedWebviewNav } from "../../hooks/useEmbeddedWebviewNav";
import { useMapSuggestions } from "../../hooks/useMapSuggestions";
import {
  readPersistedLookup,
  sameLookupName,
  writePersistedLookup,
  writePersistedLookupFound,
} from "./mapLookupStorage";
import WebviewControls from "../webview/WebviewControls";
import { IconExternalLink, IconMap } from "./icons";
import type { MapSourceResult } from "../../types/game";

const MAP_WEBVIEW_PREFIX = "mapgenie-preview-";

/** Tear down every map webview, tolerating ones already gone. */
async function closeMapWebviews() {
  try {
    const all = await Webview.getAll();
    for (const wv of all) {
      if (wv.label.startsWith(MAP_WEBVIEW_PREFIX)) {
        await invoke("close_preview_webview", { label: wv.label }).catch(() => {});
        await wv.close().catch(() => {});
      }
    }
  } catch {
    // Not running under Tauri (frontend-only dev) — nothing to close.
  }
}

interface MapTabProps {
  sources: MapSourceResult[];
  /** Name used for the automatic lookup; the search field starts here. */
  gameName?: string;
  /** Stable per-game key used to remember a manual lookup. */
  searchKey?: string;
  /** Notifies the parent whether any provider map is currently available. */
  onResultChange?: (hasResults: boolean) => void;
  /** Hide the native webview while a DOM modal sits above it. */
  visible?: boolean;
}

/**
 * Interactive map tab backed by one or more external providers
 * (MapGenie, GameMaps, GameMappers, Wand, Game-Maps).
 *
 * Pages are served through the same native child-webview pipeline the
 * WebLinks preview uses (`create_preview_webview`), so they are fully
 * interactive and sidestep iframe/framing restrictions. The DOM only
 * owns the toolbars and the frame placeholder the native view tracks.
 *
 * The heading doubles as a lookup search: the provider matcher is
 * deliberately conservative, so a wrong or missing auto-match can be
 * corrected by typing another name and re-running the providers. The
 * chosen name is remembered per game.
 */
export default function MapTab({
  sources,
  gameName = "",
  searchKey,
  onResultChange,
  visible = true,
}: MapTabProps) {
  const { t } = useLanguage();
  const contentFilterEnabled = useWebviewContentFilterEnabled();
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeMapUrl, setActiveMapUrl] = useState<string | null>(null);
  const [webviewInst, setWebviewInst] = useState<Webview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadNonce, setReloadNonce] = useState(0);

  // A manual search overrides the automatic lookup until the game changes.
  const [manualResults, setManualResults] = useState<MapSourceResult[] | null>(null);
  const [draft, setDraft] = useState(gameName);
  const [query, setQuery] = useState(gameName);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const expandedFrameRef = useRef<HTMLDivElement>(null);

  const results = manualResults ?? sources;
  const suggestions = useMapSuggestions(draft, searchOpen);
  // The native webview composites above the DOM, so hide it while the search
  // popover is open or the suggestions would render behind the map.
  const webviewVisible = visible && !searchOpen;

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
      setHighlight(-1);
    }
  }, [searchOpen]);

  const activeSource =
    results.find((s) => s.id === activeSourceId) ?? results[0] ?? null;

  // Prefer an explicitly chosen map, but fall back to the provider's
  // preferred URL when the source (and therefore map list) changes.
  const activeUrl =
    activeMapUrl && activeSource?.maps.some((m) => m.url === activeMapUrl)
      ? activeMapUrl
      : activeSource?.url ?? "";

  const { navState, goBack, goForward } = useEmbeddedWebviewNav(
    webviewInst?.label ?? null,
    activeUrl,
    webviewVisible && status === "ready"
  );

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  const goHome = useCallback(() => {
    setActiveMapUrl(null);
    setReloadNonce((n) => n + 1);
  }, []);

  const dismissCookies = useCallback(() => {
    dismissWebviewConsent(webviewInst?.label ?? null);
  }, [webviewInst]);

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  const resultSignature = results.map((s) => s.id).join("|");
  useEffect(() => {
    // Prefer Wand (it exposes per-map sub-maps) when available.
    setActiveSourceId(results.some((source) => source.id === "wand") ? "wand" : null);
    setActiveMapUrl(null);
  }, [resultSignature, results]);

  // Report availability so the parent's Map tab status dot stays in sync,
  // including after a manual search that found (or lost) a map.
  useEffect(() => {
    onResultChange?.(results.length > 0);
  }, [resultSignature, results, onResultChange]);

  const openExternal = useCallback(() => {
    if (!activeUrl) return;
    openUrl(activeUrl).catch(() => {
      window.open(activeUrl, "_blank", "noopener,noreferrer");
    });
  }, [activeUrl]);

  const runSearch = useCallback(async (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    setSearching(true);
    setSearchError(false);
    try {
      const found = await invoke<MapSourceResult[]>("fetch_game_maps", { gameName: name });
      const list = found ?? [];
      setManualResults(list);
      writePersistedLookup(searchKey, name);
      writePersistedLookupFound(searchKey, list.length > 0);
    } catch {
      setSearchError(true);
      setManualResults([]);
      writePersistedLookup(searchKey, name);
      writePersistedLookupFound(searchKey, false);
    } finally {
      setQuery(name);
      setSearching(false);
    }
  }, [searchKey]);

  // On mount, and whenever the game changes, restore a previously chosen
  // lookup for this game instead of the automatic match.
  useEffect(() => {
    const stored = readPersistedLookup(searchKey);
    setManualResults(null);
    setSearchError(false);
    if (stored && !sameLookupName(stored, gameName)) {
      setDraft(stored);
      setQuery(stored);
      void runSearch(stored);
    } else {
      setDraft(gameName);
      setQuery(gameName);
    }
  }, [searchKey, gameName, runSearch]);

  const resetSearch = useCallback(() => {
    setManualResults(null);
    setDraft(gameName);
    setQuery(gameName);
    setSearchError(false);
    writePersistedLookup(searchKey, null);
    writePersistedLookupFound(searchKey, null);
  }, [gameName, searchKey]);

  const isSearchDirty = manualResults !== null || draft.trim() !== gameName.trim();

  const chooseSuggestion = useCallback(
    (title: string) => {
      setDraft(title);
      runSearch(title);
      setSearchOpen(false);
    },
    [runSearch]
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setHighlight(-1);
  }, []);

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      if (highlight >= 0 && suggestions[highlight]) {
        event.preventDefault();
        chooseSuggestion(suggestions[highlight]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  };

  // Keep the native view glued to the DOM frame as the page scrolls/resizes.
  useEffect(() => {
    const frame =
      expanded && expandedFrameRef.current ? expandedFrameRef.current : containerRef.current;
    if (!frame || !webviewInst) return;

    const sync = () => {
      const rect = frame.getBoundingClientRect();
      webviewInst
        .setPosition(new LogicalPosition(rect.left, rect.top))
        .catch(() => {});
      webviewInst
        .setSize(new LogicalSize(rect.width, rect.height))
        .catch(() => {});
      invoke("reposition_preview_webview", {
        label: webviewInst.label,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => {});
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(frame);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [webviewInst, expanded]);

  // Leave the enlarged view when the tab is hidden or the user presses Escape.
  useEffect(() => {
    if (!visible) setExpanded(false);
  }, [visible]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Native webviews composite above the DOM, so hide it while a modal is open.
  useEffect(() => {
    if (!webviewInst) return;
    invoke("set_preview_webview_visible", {
      label: webviewInst.label,
      visible: webviewVisible,
    }).catch(() => {});
    (webviewVisible ? webviewInst.show() : webviewInst.hide()).catch(() => {});
  }, [webviewInst, webviewVisible]);

  // (Re)create the native webview whenever the selected URL changes.
  useEffect(() => {
    let active = true;
    let local: Webview | null = null;

    if (!activeUrl) {
      setStatus("loading");
      return;
    }

    setStatus("loading");

    async function init() {
      await closeMapWebviews();
      if (!active || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const label = MAP_WEBVIEW_PREFIX + Math.random().toString(36).slice(2, 9);

      try {
        await invoke("create_preview_webview", {
          label,
          url: activeUrl,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          contentFilter: contentFilterEnabled,
        });
        const webview = await Webview.getByLabel(label);
        if (!webview) throw new Error("map webview was not created");

        if (!active) {
          invoke("close_preview_webview", { label }).catch(() => {});
          webview.close().catch(() => {});
          return;
        }

        local = webview;
        setWebviewInst(webview);
        setStatus("ready");
      } catch (err) {
        console.error("Failed to create map webview:", err);
        if (active) setStatus("error");
      }
    }

    init();

    return () => {
      active = false;
      setWebviewInst(null);
      if (local) {
        invoke("close_preview_webview", { label: local.label }).catch(() => {});
        local.close().catch(() => {});
      } else {
        closeMapWebviews();
      }
    };
  }, [activeUrl, contentFilterEnabled, reloadNonce]);

  const displayTitle = activeSource
    ? activeSource.title
    : searching
      ? t("map.searching", { name: query })
      : searchError
        ? t("map.searchError")
        : t("map.noResults", { name: query });

  // Shared between the in-tab toolbar and the fullscreen toolbar.
  const mapSelectors = (
    <>
      {activeSource && results.length > 1 && (
        <label className="map-tab__field">
          <span className="map-tab__field-label">{t("map.sourceLabel")}</span>
          <select
            className="map-tab__select"
            value={activeSource.id}
            aria-label={t("map.selectSource")}
            onChange={(event) => {
              setActiveSourceId(event.target.value);
              setActiveMapUrl(null);
            }}
          >
            {results.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {activeSource && activeSource.maps.length > 1 && (
        <label className="map-tab__field">
          <span className="map-tab__field-label">{t("map.mapLabel")}</span>
          <select
            className="map-tab__select"
            value={activeUrl}
            aria-label={t("map.selectMap")}
            onChange={(event) => setActiveMapUrl(event.target.value)}
          >
            {activeSource.maps.map((map) => (
              <option key={map.url} value={map.url}>
                {map.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );

  return (
    <div className="map-tab">
      <div className="map-tab__toolbar">
        <div className="map-tab__heading">
          <span className="map-tab__icon" aria-hidden="true">
            <IconMap size={18} />
          </span>
          <div className="map-tab__heading-text">
            <span className="map-tab__eyebrow">{t("map.source")}</span>
            <span className="map-tab__game" title={displayTitle}>
              {displayTitle}
            </span>
          </div>
          {activeSource && (
            <span className="map-tab__provider-chip">{activeSource.label}</span>
          )}
        </div>

        <div className="map-tab__search-box">
          {!searchOpen ? (
            <div className="map-tab__search-triggers">
              {manualResults !== null && (
                <button
                  type="button"
                  className="map-tab__search-reset-standalone"
                  onClick={resetSearch}
                  title={t("map.searchReset")}
                  aria-label={t("map.searchReset")}
                >
                  <RotateCcw size={14} />
                </button>
              )}
              <button
                type="button"
                className={`map-tab__search-toggle${manualResults !== null ? " is-active" : ""}`}
                onClick={() => setSearchOpen(true)}
                title={t("map.searchOpen")}
                aria-label={t("map.searchOpen")}
              >
                <Search size={15} />
              </button>
            </div>
          ) : (
            <div className="map-tab__search-panel">
              <form
                className="map-tab__search"
                onSubmit={(event) => {
                  event.preventDefault();
                  runSearch(draft);
                }}
              >
                <span className="map-tab__search-icon" aria-hidden="true">
                  <Search size={14} />
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="map-tab__search-input"
                  value={draft}
                  placeholder={t("map.searchPlaceholder")}
                  aria-label={t("map.searchPlaceholder")}
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={suggestions.length > 0}
                  aria-controls="map-tab-suggestions"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setHighlight(-1);
                  }}
                  onKeyDown={handleSearchKeyDown}
                />
                {isSearchDirty && (
                  <button
                    type="button"
                    className="map-tab__search-reset"
                    onClick={() => {
                      resetSearch();
                      setSearchOpen(false);
                    }}
                    title={t("map.searchReset")}
                    aria-label={t("map.searchReset")}
                  >
                    <X size={13} />
                  </button>
                )}
                <button
                  type="submit"
                  className="map-tab__search-go"
                  disabled={searching || !draft.trim()}
                >
                  {searching ? <span className="map-tab__search-spinner" /> : t("map.searchAction")}
                </button>
                <button
                  type="button"
                  className="map-tab__search-close"
                  onClick={closeSearch}
                  title={t("map.searchClose")}
                  aria-label={t("map.searchClose")}
                >
                  <X size={13} />
                </button>
              </form>

              {suggestions.length > 0 && (
                <ul className="map-tab__suggestions" id="map-tab-suggestions" role="listbox">
                  {suggestions.map((title, index) => (
                    <li key={title}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        className={`map-tab__suggestion${index === highlight ? " is-active" : ""}`}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => chooseSuggestion(title)}
                      >
                        {title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="map-tab__controls">
          <WebviewControls
            canGoBack={navState.back}
            canGoForward={navState.forward}
            onBack={goBack}
            onForward={goForward}
            onReload={reload}
            onHome={goHome}
            onDismissCookies={dismissCookies}
            expanded={expanded}
            onToggleExpand={activeSource ? toggleExpand : undefined}
          />

          {mapSelectors}

          {activeSource && (
            <button
              type="button"
              className="map-tab__external"
              onClick={openExternal}
              title={t("map.openOnProvider", { provider: activeSource.label })}
            >
              <IconExternalLink size={15} />
              <span>{t("map.openOnProvider", { provider: activeSource.label })}</span>
            </button>
          )}
        </div>
      </div>

      <div className="map-tab__frame" ref={containerRef}>
        {!activeSource ? (
          <div className="map-tab__placeholder">
            {searching ? (
              <>
                <div className="map-tab__spinner" />
                <span>{t("map.searching", { name: query })}</span>
              </>
            ) : (
              <>
                <span className="map-tab__placeholder-icon">
                  <IconMap size={22} />
                </span>
                <span>{searchError ? t("map.searchError") : t("map.noResults", { name: query })}</span>
                <span className="map-tab__placeholder-hint">{t("map.noResultsHint")}</span>
                <div className="map-tab__placeholder-actions">
                  <button
                    type="button"
                    className="map-tab__search-go map-tab__search-go--wide"
                    onClick={() => setSearchOpen(true)}
                  >
                    <Search size={14} />
                    {t("map.searchOpen")}
                  </button>
                  {isSearchDirty && (
                    <button type="button" className="map-tab__external" onClick={resetSearch}>
                      {t("map.searchReset")}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : status !== "ready" ? (
          <div className="map-tab__placeholder">
            {status === "loading" ? (
              <>
                <div className="map-tab__spinner" />
                <span>{t("map.loading")}</span>
              </>
            ) : (
              <>
                <span>{t("map.unavailable")}</span>
                <button
                  type="button"
                  className="map-tab__external"
                  onClick={openExternal}
                >
                  <IconExternalLink size={15} />
                  <span>{t("map.openOnProvider", { provider: activeSource.label })}</span>
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      {expanded &&
        activeSource &&
        createPortal(
          <div
            className="map-tab__expand-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={activeSource.title}
          >
            <div className="map-tab__expand-modal">
              <div className="map-tab__expand-toolbar">
                <WebviewControls
                  canGoBack={navState.back}
                  canGoForward={navState.forward}
                  onBack={goBack}
                  onForward={goForward}
                  onReload={reload}
                  onHome={goHome}
                  onDismissCookies={dismissCookies}
                  expanded
                  onToggleExpand={toggleExpand}
                />
                {mapSelectors}
                <span className="map-tab__expand-title" title={activeSource.title}>
                  {activeSource.title}
                </span>
                <button
                  type="button"
                  className="map-tab__expand-close"
                  onClick={() => setExpanded(false)}
                  title={t("weblinks.closeExpand")}
                  aria-label={t("weblinks.closeExpand")}
                >
                  <X size={15} />
                </button>
              </div>
              <div ref={expandedFrameRef} className="map-tab__expand-frame">
                {status !== "ready" && (
                  <div className="map-tab__placeholder">
                    {status === "loading" ? (
                      <>
                        <div className="map-tab__spinner" />
                        <span>{t("map.loading")}</span>
                      </>
                    ) : (
                      <span>{t("map.unavailable")}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
