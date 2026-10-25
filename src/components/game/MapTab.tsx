import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LayoutGrid, MapPinned, RotateCcw, Search, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useWebviewContentFilterEnabled } from "../../context/SettingsContext";
import { dismissWebviewConsent, useEmbeddedWebviewNav } from "../../hooks/useEmbeddedWebviewNav";
import { useMapSuggestions } from "../../hooks/useMapSuggestions";
import {
  readPersistedLookup,
  writePersistedLookup,
  writePersistedLookupFound,
} from "./mapLookupStorage";
import { readMapMemory, rememberMapChoice, type MapMemory } from "./map/mapMemory";
import { useMapPreview } from "./map/useMapPreview";
import MapLaunchpad from "./map/MapLaunchpad";
import WebviewControls from "../webview/WebviewControls";
import { IconExternalLink, IconMap } from "./icons";
import { Button } from "../ui";
import { GameTabShell } from "./tabs";
import type { MapSourceResult } from "../../types/game";

interface MapTabProps {
  sources: MapSourceResult[];
  /** True while the automatic provider lookup is still running. */
  loading?: boolean;
  /** Name used for the automatic lookup; the search field starts here. */
  gameName?: string;
  /** Stable per-game key used to remember a manual lookup and map choices. */
  searchKey?: string;
  /** Notifies the parent whether any provider map is currently available. */
  onResultChange?: (hasResults: boolean) => void;
  /** Hide the native webview while a DOM modal sits above it. */
  visible?: boolean;
}

/**
 * Interactive Map — a provider launchpad backed by the native preview webview.
 *
 * The tab lands on a launchpad: every provider that matched the game exposes
 * its map list, with the last-used map highlighted. Opening a map switches to
 * the browser surface, which keeps the provider/map selectors, the browser
 * controls and a search for correcting the game match. "All maps" returns to
 * the launchpad; the chosen map is remembered per provider.
 */
export default function MapTab({
  sources,
  loading = false,
  gameName = "",
  searchKey,
  onResultChange,
  visible = true,
}: MapTabProps) {
  const { t } = useLanguage();
  const contentFilterEnabled = useWebviewContentFilterEnabled();
  const containerRef = useRef<HTMLDivElement>(null);
  const expandedFrameRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [manualResults, setManualResults] = useState<MapSourceResult[] | null>(null);
  const [draft, setDraft] = useState(gameName);
  const [query, setQuery] = useState(gameName);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [expanded, setExpanded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [memory, setMemory] = useState<MapMemory>(() => readMapMemory(searchKey));

  const [mode, setMode] = useState<"launchpad" | "map">("launchpad");
  const [provider, setProvider] = useState("");
  const [mapSelection, setMapSelection] = useState("");

  const results = manualResults ?? sources;
  const autoLoading = loading && manualResults === null;
  const suggestions = useMapSuggestions(draft, searchOpen);
  const resultSignature = results.map((source) => source.id).join("|");

  const activeSource =
    mode === "map"
      ? results.find((source) => source.id === provider) ?? results[0] ?? null
      : null;

  const activeUrl = useMemo(() => {
    if (!activeSource) return null;
    if (
      mapSelection &&
      (activeSource.url === mapSelection ||
        activeSource.maps.some((map) => map.url === mapSelection))
    ) {
      return mapSelection;
    }
    return activeSource.url;
  }, [activeSource, mapSelection]);

  const { webview, status } = useMapPreview({
    url: activeUrl,
    containerRef,
    expandedFrameRef,
    expanded,
    visible: visible && !searchOpen,
    reloadNonce,
    contentFilterEnabled,
  });

  const { navState, goBack, goForward } = useEmbeddedWebviewNav(
    webview?.label ?? null,
    activeUrl ?? "",
    visible && !searchOpen && status === "ready",
  );

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);
  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);
  const dismissCookies = useCallback(() => {
    dismissWebviewConsent(webview?.label ?? null);
  }, [webview]);

  // A missing provider after a lookup change or game switch falls back to the
  // launchpad instead of showing an empty map frame.
  useEffect(() => {
    if (mode !== "map") return;
    if (!results.some((source) => source.id === provider)) {
      setMode("launchpad");
      setProvider("");
      setMapSelection("");
    }
  }, [resultSignature, results, mode, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Report availability so the parent's Map tab status dot stays in sync,
  // including after a manual search that found (or lost) a map.
  useEffect(() => {
    if (loading && manualResults === null) return;
    if (manualResults === null && readPersistedLookup(searchKey)) return;
    onResultChange?.(results.length > 0);
  }, [resultSignature, results, manualResults, onResultChange, searchKey, loading]);

  const openExternal = useCallback((url: string) => {
    if (!url) return;
    openUrl(url).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }, []);

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
    setMemory(readMapMemory(searchKey));
    if (stored) {
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

  const chooseSuggestion = useCallback(
    (title: string) => {
      setDraft(title);
      void runSearch(title);
      setSearchOpen(false);
    },
    [runSearch],
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
      searchInputRef.current?.blur();
    }
  };

  const openProvider = useCallback(
    (source: MapSourceResult, mapUrl: string) => {
      setMode("map");
      setProvider(source.id);
      setMapSelection(mapUrl);
      setSearchOpen(false);
      rememberMapChoice(searchKey, source.id, mapUrl);
      setMemory((prev) => ({
        maps: { ...prev.maps, [source.id]: mapUrl },
        provider: source.id,
      }));
      setReloadNonce((n) => n + 1);
    },
    [searchKey],
  );

  const openLaunchpad = useCallback(() => {
    setMode("launchpad");
    setProvider("");
    setMapSelection("");
    setExpanded(false);
  }, []);

  const selectProvider = useCallback(
    (providerId: string) => {
      const source = results.find((entry) => entry.id === providerId);
      if (!source) return;
      const rememberedUrl = memory.maps[providerId];
      const nextUrl =
        rememberedUrl &&
        (source.url === rememberedUrl ||
          source.maps.some((map) => map.url === rememberedUrl))
          ? rememberedUrl
          : source.url;
      openProvider(source, nextUrl);
    },
    [memory.maps, openProvider, results],
  );

  const selectMap = useCallback(
    (mapUrl: string) => {
      if (!activeSource) return;
      openProvider(activeSource, mapUrl);
    },
    [activeSource, openProvider],
  );

  const searchForm = (
    <div className="map-search">
      <form
        className="game-tab-search map-search__field"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(draft);
          setSearchOpen(false);
        }}
      >
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          className="game-tab-search__input"
          value={draft}
          placeholder={t("map.searchPlaceholder")}
          aria-label={t("map.searchPlaceholder")}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={suggestions.length > 0}
          aria-controls="map-tab-suggestions"
          onFocus={() => setSearchOpen(true)}
          onChange={(event) => {
            setDraft(event.target.value);
            setSearchOpen(true);
            setHighlight(-1);
          }}
          onKeyDown={handleSearchKeyDown}
        />
        {draft.trim() !== gameName.trim() && (
          <button
            type="button"
            className="game-tab-search__clear"
            onClick={resetSearch}
            title={t("map.searchReset")}
            aria-label={t("map.searchReset")}
          >
            <RotateCcw size={13} />
          </button>
        )}
        <button type="submit" className="map-search__go" disabled={searching || !draft.trim()}>
          {searching ? <span className="map-search__spinner" /> : t("map.searchAction")}
        </button>
      </form>

      {suggestions.length > 0 && searchOpen && (
        <ul className="map-search__suggestions" id="map-tab-suggestions" role="listbox">
          {suggestions.map((title, index) => (
            <li key={title}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`map-search__suggestion${index === highlight ? " is-active" : ""}`}
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
  );

  const mapSelectors = activeSource ? (
    <>
      <label className="map-browser__field">
        <span>{t("map.sourceLabel")}</span>
        <select
          className="map-browser__select"
          value={activeSource.id}
          aria-label={t("map.selectSource")}
          onChange={(event) => selectProvider(event.target.value)}
        >
          {results.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
      </label>

      {activeSource.maps.length > 1 && (
        <label className="map-browser__field">
          <span>{t("map.mapLabel")}</span>
          <select
            className="map-browser__select"
            value={activeUrl ?? activeSource.url}
            aria-label={t("map.selectMap")}
            onChange={(event) => selectMap(event.target.value)}
          >
            <option value={activeSource.url}>{t("map.mapList")}</option>
            {activeSource.maps.map((map) => (
              <option key={map.url} value={map.url}>
                {map.title}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  ) : null;

  if (mode === "launchpad" || !activeSource) {
    const totalMaps = results.reduce((sum, source) => sum + Math.max(1, source.maps.length), 0);
    return (
      <GameTabShell
        eyebrow={t("map.source")}
        title={t("map.launchpadTitle", { game: gameName })}
        description={
          results.length > 0
            ? t("map.launchpadSummary", { providers: results.length, maps: totalMaps })
            : autoLoading
              ? t("map.searching", { name: gameName })
              : t("map.noResults", { name: query })
        }
        icon={<IconMap size={20} />}
        actions={
          draft.trim() !== gameName.trim() ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw size={14} />}
              onClick={resetSearch}
            >
              {t("map.searchReset")}
            </Button>
          ) : undefined
        }
        toolbar={searchForm}
      >
        <MapLaunchpad
          sources={results}
          query={query}
          searching={searching || autoLoading}
          searchError={searchError}
          remembered={memory.maps}
          canReset={draft.trim() !== gameName.trim()}
          onOpenProvider={openProvider}
          onOpenExternal={openExternal}
          onSearchAnother={() => searchInputRef.current?.focus()}
          onResetLookup={resetSearch}
        />
      </GameTabShell>
    );
  }

  const displayTitle = activeSource.title || activeSource.label;

  return (
    <div className="map-browser">
      <div className="map-browser__bar">
        <button
          type="button"
          className="map-browser__all"
          onClick={openLaunchpad}
          title={t("map.allMaps")}
        >
          <LayoutGrid size={14} />
          <span>{t("map.allMaps")}</span>
        </button>

        <span className="map-browser__heading">
          <MapPinned size={15} aria-hidden="true" />
          <span title={displayTitle}>{displayTitle}</span>
        </span>

        {mapSelectors}

        <WebviewControls
          canGoBack={navState.back}
          canGoForward={navState.forward}
          onBack={goBack}
          onForward={goForward}
          onReload={reload}
          onHome={reload}
          onDismissCookies={dismissCookies}
          expanded={expanded}
          onToggleExpand={toggleExpand}
        />

        <button
          type="button"
          className="map-browser__external"
          onClick={() => openExternal(activeUrl ?? activeSource.url)}
          title={t("map.openOnProvider", { provider: activeSource.label })}
        >
          <IconExternalLink size={15} />
        </button>
      </div>

      <div className="map-browser__searchrow">{searchForm}</div>

      <div className="map-browser__frame" ref={containerRef}>
        {!activeUrl || status !== "ready" ? (
          <div className="map-browser__placeholder">
            {status === "loading" ? (
              <>
                <div className="map-browser__spinner" />
                <span>{t("map.loading")}</span>
              </>
            ) : (
              <>
                <span>{t("map.unavailable")}</span>
                <button
                  type="button"
                  className="map-browser__external map-browser__external--text"
                  onClick={() => openExternal(activeUrl ?? activeSource.url)}
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
        createPortal(
          <div
            className="map-tab__expand-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={displayTitle}
          >
            <div className="map-tab__expand-modal">
              <div className="map-browser__bar">
                <button
                  type="button"
                  className="map-browser__all"
                  onClick={openLaunchpad}
                  title={t("map.allMaps")}
                >
                  <LayoutGrid size={14} />
                  <span>{t("map.allMaps")}</span>
                </button>
                <span className="map-browser__heading">
                  <span title={displayTitle}>{displayTitle}</span>
                </span>
                {mapSelectors}
                <WebviewControls
                  canGoBack={navState.back}
                  canGoForward={navState.forward}
                  onBack={goBack}
                  onForward={goForward}
                  onReload={reload}
                  onHome={reload}
                  onDismissCookies={dismissCookies}
                  expanded
                  onToggleExpand={toggleExpand}
                />
                <button
                  type="button"
                  className="map-browser__external"
                  onClick={() => setExpanded(false)}
                  title={t("weblinks.closeExpand")}
                  aria-label={t("weblinks.closeExpand")}
                >
                  <X size={15} />
                </button>
              </div>
              <div ref={expandedFrameRef} className="map-tab__expand-frame">
                {status !== "ready" && (
                  <div className="map-browser__placeholder">
                    {status === "loading" ? (
                      <>
                        <div className="map-browser__spinner" />
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
          document.body,
        )}
    </div>
  );
}
