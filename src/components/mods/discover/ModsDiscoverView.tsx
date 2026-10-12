import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bookmark,
  Compass,
  History,
  LayoutGrid,
  List,
  Maximize2,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Table,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button } from "../../ui";
import MultiSelectDropdown from "../../ui/MultiSelectDropdown";
import SourceSelect from "./SourceSelect";
import SourceConfigModal from "./SourceConfigModal";
import DiscoverHero from "./DiscoverHero";
import DiscoverSpotlight from "./DiscoverSpotlight";
import RemoteModGrid, { type DiscoverView } from "./RemoteModGrid";
import RemoteModDetailModal from "./RemoteModDetailModal";
import DiscoverHistoryView from "./DiscoverHistoryView";
import DiscoverBookmarksView from "./DiscoverBookmarksView";
import DiscoverSourcesTab from "./DiscoverSourcesTab";
import { useModBookmarks } from "./useModBookmarks";
import {
  useModBrowse,
  useModSources,
  useRemoteInstall,
  useRemoteInstalls,
} from "../../../hooks/useModDiscover";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { gameDisplayName, type Game } from "../../../types/game";
import type { RemoteModSummary } from "../../../types/mods";
import {
  collectTagCounts,
  modHasSelectedTag,
} from "./format";
import "./mods-discover.css";

const SORTS = ["trending", "downloads", "updated", "latest"] as const;
const QUICK_SUGGESTIONS = [
  "Overhaul",
  "Textures",
  "UI",
  "Fix",
  "Audio",
  "Gameplay",
  "Graphics",
  "Weapons",
];

const sourcePrefKey = (gameId: string) => `gamelib.mods.discover.source.${gameId}`;
const DETECT_TTL_MS = 6 * 60 * 60 * 1000;
const detectedKey = (gameId: string) => `gamelib.mods.discover.detected.${gameId}`;

export type DiscoverSubtab = "browse" | "bookmarks" | "history" | "sources";
export type ModStatusFilter = "all" | "not_installed" | "installed" | "bookmarked";

interface ModsDiscoverViewProps {
  /** If fixed to a game (e.g. subtab in game detail page), pass it here. */
  game?: Game | null;
  /** Full game candidate list (for standalone page mode). */
  games?: Game[];
  /** Called when user changes the active game in standalone mode. */
  onSelectGame?: (gameId: string) => void;
  /** Layout mode: 'page' (standalone) or 'subtab' (embedded in game page) */
  variant?: "page" | "subtab";
  /** Optional initial subtab */
  initialSubtab?: DiscoverSubtab;
}

export default function ModsDiscoverView({
  game: passedGame,
  games: passedGames,
  onSelectGame,
  variant = "page",
  initialSubtab = "browse",
}: ModsDiscoverViewProps) {
  const { games: allGames } = useGames();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // Active game resolution
  const candidates = useMemo(() => {
    if (passedGames) return passedGames;
    return allGames
      .filter((g) => g.installed !== false)
      .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b)));
  }, [passedGames, allGames]);

  const [selectedGameId, setSelectedGameId] = useState<string | null>(
    passedGame?.id ?? (candidates[0]?.id || null),
  );

  useEffect(() => {
    if (passedGame) {
      setSelectedGameId(passedGame.id);
    }
  }, [passedGame]);

  const activeGame = useMemo(() => {
    if (passedGame) return passedGame;
    return candidates.find((g) => g.id === selectedGameId) ?? candidates[0] ?? null;
  }, [passedGame, candidates, selectedGameId]);

  const gameId = activeGame?.id ?? null;

  // Subtabs & Views
  const [subtab, setSubtab] = useState<DiscoverSubtab>(initialSubtab);
  const [view, setView] = usePersistedState<DiscoverView>(
    "gamelib.mods.discover.view_v2",
    "grid",
    ["grid", "list", "compact"],
  );

  // Filters & Search
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ModStatusFilter>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [configOpen, setConfigOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [activeMod, setActiveMod] = useState<RemoteModSummary | null>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filtersRef.current?.contains(e.target as Node)) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  // Data Hooks
  const {
    sources,
    loading: sourcesLoading,
    resolving,
    resolveAll,
    setLink,
    clearLink,
  } = useModSources(gameId);

  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;

  const browse = useModBrowse(
    selectedSource?.available ? selectedSource.id : null,
    selectedSource?.externalId ?? null,
  );

  const installs = useRemoteInstalls(gameId);
  const { install: quickInstallRemote } = useRemoteInstall();
  const {
    bookmarks,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    clearBookmarks,
  } = useModBookmarks(gameId);

  const autoResolvedRef = useRef<string | null>(null);

  const availableCount = useMemo(
    () => sources.filter((s) => s.available).length,
    [sources],
  );

  const installedKeys = useMemo(
    () => new Set(installs.installs.map((i) => `${i.source}:${i.sourceModId}`)),
    [installs.installs],
  );

  // Auto-detect mod sources for active game
  useEffect(() => {
    if (!gameId || sourcesLoading || resolving || sources.length === 0) return;
    if (autoResolvedRef.current === gameId) return;
    if (!sources.some((s) => !s.externalId)) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(detectedKey(gameId)) || 0);
    } catch {
      /* ignore */
    }
    if (last && Date.now() - last < DETECT_TTL_MS) return;
    autoResolvedRef.current = gameId;
    try {
      localStorage.setItem(detectedKey(gameId), String(Date.now()));
    } catch {
      /* ignore */
    }
    void resolveAll();
  }, [gameId, sourcesLoading, resolving, sources, resolveAll]);

  // Synchronize source preference when game changes
  useEffect(() => {
    if (sources.length === 0) {
      setSourceId(null);
      return;
    }
    if (sourceId && sources.some((s) => s.id === sourceId && s.available)) return;

    let stored: string | null = null;
    try {
      stored = gameId ? localStorage.getItem(sourcePrefKey(gameId)) : null;
    } catch {
      /* ignore */
    }

    const remembered = stored
      ? (sources.find((s) => s.id === stored && s.available) ?? null)
      : null;
    const first = remembered ?? sources.find((s) => s.available);
    setSourceId(first?.id ?? sources[0]?.id ?? null);
  }, [sources, sourceId, gameId]);

  const handleSourceChange = (id: string) => {
    setSourceId(id);
    try {
      if (gameId) localStorage.setItem(sourcePrefKey(gameId), id);
    } catch {
      /* ignore */
    }
  };

  const handleResolve = () => {
    if (gameId) {
      try {
        localStorage.setItem(detectedKey(gameId), String(Date.now()));
      } catch {
        /* ignore */
      }
    }
    void resolveAll();
  };

  const handleGameSelect = (newGameId: string) => {
    setSelectedGameId(newGameId);
    onSelectGame?.(newGameId);
    setCategory("all");
    setSelectedTags([]);
  };

  // Derive categories and tags from results
  const categories = useMemo(() => {
    return Array.from(
      new Set(
        browse.results
          .map((r) => r.category)
          .filter((c): c is string => !!c && c.trim().length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [browse.results]);

  const tagCounts = useMemo(() => collectTagCounts(browse.results), [browse.results]);
  const tagOptions = useMemo(
    () =>
      Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([tag]) => tag),
    [tagCounts],
  );
  const tagCountMap = useMemo(
    () => Object.fromEntries(tagCounts.entries()),
    [tagCounts],
  );

  // Filtered browse results
  const visibleResults = useMemo(() => {
    let list = browse.results;

    // Filter by category
    if (category !== "all") {
      list = list.filter((r) => r.category === category);
    }

    // Filter by tags
    if (selectedTags.length > 0) {
      list = list.filter((r) => modHasSelectedTag(r, selectedTags));
    }

    // Filter by installation / bookmark status
    if (statusFilter === "installed") {
      list = list.filter((r) => installedKeys.has(`${r.source}:${r.id}`));
    } else if (statusFilter === "not_installed") {
      list = list.filter((r) => !installedKeys.has(`${r.source}:${r.id}`));
    } else if (statusFilter === "bookmarked") {
      list = list.filter((r) => isBookmarked(r.source, r.id));
    }

    return list;
  }, [browse.results, category, selectedTags, statusFilter, installedKeys, isBookmarked]);

  // Featured spotlight mod
  const spotlightMod = useMemo(() => {
    if (browse.results.length === 0) return null;
    return browse.results[0] ?? null;
  }, [browse.results]);

  const handleInstalled = async () => {
    if (activeGame) {
      try {
        await invoke("mods_scan_game", {
          gameId: activeGame.id,
          gamePath: activeGame.path ?? "",
          steamAppId: activeGame.steamAppId ?? null,
        });
      } catch {
        /* best-effort rescan */
      }
    }
    void installs.refresh();
    showToast(t("mods.discover.installedRescan"), "success");
  };

  const handleQuickInstall = async (mod: RemoteModSummary) => {
    if (!gameId || !selectedSource?.externalId) return;
    try {
      const res = await quickInstallRemote({
        gameId,
        source: mod.source,
        externalId: selectedSource.externalId,
        modId: mod.id,
        name: mod.name,
        author: mod.author,
        version: mod.version,
        remoteUrl: mod.url,
      });

      if (res.status === "installed") {
        showToast(
          t("mods.discover.installedBody", { count: String(res.installedFiles) }),
          "success",
        );
        void handleInstalled();
      } else if (res.status === "manual") {
        showToast(res.message ?? t("mods.discover.manualNeeded"), "info");
      } else if (res.status === "steam" || res.status === "external") {
        if (res.message) showToast(res.message, "info");
        if (res.url) void openUrl(res.url);
      }
    } catch (err) {
      showToast(String(err), "error");
    }
  };

  const handleToggleBookmark = (mod: RemoteModSummary) => {
    const added = toggleBookmark(
      mod,
      gameId || undefined,
      activeGame ? gameDisplayName(activeGame) : undefined,
    );
    if (added) {
      showToast(t("mods.discover.bookmarkAdded", { name: mod.name }), "success");
    } else {
      showToast(t("mods.discover.bookmarkRemoved", { name: mod.name }), "info");
    }
  };

  const handleOpenFolder = () => {
    if (!activeGame?.modsFolder) return;
    invoke("open_folder", { path: activeGame.modsFolder })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  return (
    <div className={`mods-discover-view-root mods-discover-view--${variant}`}>
      {/* Top Hero / Banner */}
      {variant === "page" ? (
        <DiscoverHero
          game={activeGame}
          detectedCount={availableCount}
          detecting={resolving || sourcesLoading}
          onResolve={handleResolve}
          onConfigure={() => setConfigOpen(true)}
          onOpenFolder={activeGame?.modsFolder ? handleOpenFolder : undefined}
        />
      ) : null}

      {/* Discover Subtabs Navigation */}
      <div className="mods-discover-nav-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subtab === "browse"}
          className={`mods-discover-nav-tab${subtab === "browse" ? " active" : ""}`}
          onClick={() => setSubtab("browse")}
        >
          <Compass size={15} />
          <span>{t("mods.discover.subtabBrowse")}</span>
          {browse.total != null && browse.total > 0 && (
            <span className="mods-discover-nav-badge">{browse.total}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={subtab === "bookmarks"}
          className={`mods-discover-nav-tab${subtab === "bookmarks" ? " active" : ""}`}
          onClick={() => setSubtab("bookmarks")}
        >
          <Bookmark size={15} />
          <span>{t("mods.discover.subtabBookmarks")}</span>
          {bookmarks.length > 0 && (
            <span className="mods-discover-nav-badge">{bookmarks.length}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={subtab === "history"}
          className={`mods-discover-nav-tab${subtab === "history" ? " active" : ""}`}
          onClick={() => setSubtab("history")}
        >
          <History size={15} />
          <span>{t("mods.discover.subtabHistory")}</span>
          {installs.installs.length > 0 && (
            <span className="mods-discover-nav-badge">{installs.installs.length}</span>
          )}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={subtab === "sources"}
          className={`mods-discover-nav-tab${subtab === "sources" ? " active" : ""}`}
          onClick={() => setSubtab("sources")}
        >
          <Settings2 size={15} />
          <span>{t("mods.discover.subtabSources")}</span>
          <span className="mods-discover-nav-badge">
            {availableCount}/{sources.length}
          </span>
        </button>

        {variant === "subtab" && activeGame && (
          <div className="mods-discover-nav-extra">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Maximize2 size={13} />}
              onClick={() => navigate(`/mods/discover?gameId=${activeGame.id}`)}
              title={t("mods.discover.openFullScreen")}
            >
              {t("mods.discover.fullScreenBtn")}
            </Button>
          </div>
        )}
      </div>

      {/* ── Subtab: BROWSE ────────────────────────────────────────────── */}
      {subtab === "browse" && (
        <div className="mods-discover-tab-pane">
          {/* Source Picker Chips */}
          <SourceSelect
            sources={sources}
            value={sourceId}
            onChange={handleSourceChange}
            onConfigure={() => setConfigOpen(true)}
            onResolve={handleResolve}
            resolving={resolving}
            loading={sourcesLoading}
            disabled={!gameId}
          />

          {/* Featured Spotlight (only when on page 1 of trending without custom query) */}
          {spotlightMod && !browse.query && browse.sort === "trending" && (
            <DiscoverSpotlight
              mod={spotlightMod}
              installed={installedKeys.has(`${spotlightMod.source}:${spotlightMod.id}`)}
              isBookmarked={isBookmarked(spotlightMod.source, spotlightMod.id)}
              onOpen={setActiveMod}
              onOpenExternal={(m) => void openUrl(m.url)}
              onToggleBookmark={handleToggleBookmark}
              onQuickInstall={handleQuickInstall}
            />
          )}

          {/* Search, Filter & View Mode Controls Toolbar */}
          <div className="mods-discover-toolbar">
            <div className="mods-discover-toolbar-row">
              {/* Standalone game picker */}
              {variant === "page" && candidates.length > 1 && (
                <div className="mods-discover-field mods-discover-field--game">
                  <label className="mods-discover-label" htmlFor="mods-discover-game">
                    {t("mods.discover.selectGame")}
                  </label>
                  <select
                    id="mods-discover-game"
                    className="mods-discover-select"
                    value={gameId ?? ""}
                    onChange={(e) => handleGameSelect(e.target.value)}
                  >
                    {candidates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {gameDisplayName(g)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Search Bar */}
              <div className="mods-discover-field mods-discover-field--search">
                <label className="mods-discover-label" htmlFor="mods-discover-search">
                  {t("mods.discover.search")}
                </label>
                <div className="mods-discover-search">
                  <Search size={15} className="mods-discover-search-icon" />
                  <input
                    id="mods-discover-search"
                    type="text"
                    className="mods-discover-search-input"
                    placeholder={t("mods.discover.searchPlaceholder")}
                    value={browse.query}
                    disabled={!selectedSource?.available}
                    onChange={(e) => browse.setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") browse.flush();
                    }}
                  />
                  {browse.query && (
                    <button
                      type="button"
                      className="mods-discover-search-clear"
                      onClick={() => browse.setQuery("")}
                      title={t("mods.source.clear")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Filters popover: sort, category, status, tags */}
              <div className="mods-discover-filters" ref={filtersRef}>
                <button
                  type="button"
                  className={`mods-discover-filters-btn${filtersOpen ? " is-open" : ""}`}
                  onClick={() => setFiltersOpen((v) => !v)}
                  aria-expanded={filtersOpen}
                >
                  <SlidersHorizontal size={14} />
                  <span>{t("mods.filters")}</span>
                  {(() => {
                    const active =
                      (browse.sort !== "trending" ? 1 : 0) +
                      (category !== "all" ? 1 : 0) +
                      (statusFilter !== "all" ? 1 : 0) +
                      (selectedTags.length > 0 ? 1 : 0);
                    return active > 0 ? (
                      <span className="mods-discover-filters-count">{active}</span>
                    ) : null;
                  })()}
                </button>

                {filtersOpen && (
                  <div className="mods-discover-filters-popover" role="dialog" aria-label={t("mods.filters")}>
                    <div className="mods-discover-field">
                      <label className="mods-discover-label" htmlFor="mods-discover-sort">
                        {t("mods.discover.sortBy")}
                      </label>
                      <select
                        id="mods-discover-sort"
                        className="mods-discover-select"
                        value={browse.sort}
                        disabled={!selectedSource?.available}
                        onChange={(e) => browse.setSort(e.target.value)}
                      >
                        {SORTS.map((s) => (
                          <option key={s} value={s}>
                            {t(`mods.discover.sort.${s}`)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mods-discover-field">
                      <label className="mods-discover-label" htmlFor="mods-discover-category">
                        {t("mods.discover.category")}
                      </label>
                      <select
                        id="mods-discover-category"
                        className="mods-discover-select"
                        value={category}
                        disabled={categories.length === 0}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="all">{t("mods.discover.allCategories")}</option>
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="mods-discover-field">
                      <label className="mods-discover-label" htmlFor="mods-discover-status">
                        {t("mods.discover.filterStatus")}
                      </label>
                      <select
                        id="mods-discover-status"
                        className="mods-discover-select"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as ModStatusFilter)}
                      >
                        <option value="all">{t("mods.discover.statusAll")}</option>
                        <option value="not_installed">{t("mods.discover.statusNotInstalled")}</option>
                        <option value="installed">{t("mods.discover.statusInstalled")}</option>
                        <option value="bookmarked">{t("mods.discover.statusBookmarked")}</option>
                      </select>
                    </div>

                    {tagOptions.length > 0 && (
                      <div className="mods-discover-field">
                        <label className="mods-discover-label">{t("mods.discover.tags")}</label>
                        <MultiSelectDropdown
                          label={t("mods.discover.tags")}
                          placeholder={t("mods.discover.allTags")}
                          options={tagOptions}
                          selected={selectedTags}
                          onChange={setSelectedTags}
                          counts={tagCountMap}
                          clearLabel={t("mods.source.clear")}
                          showSearch
                          searchPlaceholder={t("mods.discover.tags")}
                          noResultsLabel={t("mods.discover.empty")}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Suggestions Strip */}
            {!browse.query && (
              <div className="mods-discover-suggestions-row">
                <span className="mods-discover-suggestions-label">
                  <Sparkles size={12} /> {t("mods.discover.quickSuggestions")}:
                </span>
                <div className="mods-discover-suggestions-pills">
                  {QUICK_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      className="mods-discover-suggestion-pill"
                      onClick={() => browse.setQuery(sug)}
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toolbar Bottom Metadata & View Mode Toggle */}
            <div className="mods-discover-toolbar-row mods-discover-toolbar-row--meta">
              <span className="mods-discover-count">
                {selectedSource?.available && !browse.loading
                  ? browse.total != null
                    ? t("mods.discover.resultsCount", { count: String(browse.total) })
                    : t("mods.discover.resultsCount", { count: String(visibleResults.length) })
                  : selectedSource?.note ?? ""}
              </span>

              <div className="mods-discover-meta-right">
                {selectedSource?.available && (
                  <button
                    type="button"
                    className="mods-discover-icon-btn"
                    onClick={browse.refresh}
                    disabled={browse.loading}
                    title={t("mods.discover.refresh")}
                    aria-label={t("mods.discover.refresh")}
                  >
                    <RefreshCw size={14} className={browse.loading ? "spinning" : undefined} />
                  </button>
                )}

                {/* View Mode Toggle: Grid, List, Compact */}
                <div
                  className="mods-discover-viewtoggle"
                  role="group"
                  aria-label={t("mods.discover.viewAria")}
                >
                  <button
                    type="button"
                    className={`mods-discover-viewtoggle-btn${view === "grid" ? " active" : ""}`}
                    onClick={() => setView("grid")}
                    title={t("mods.discover.view.grid")}
                    aria-label={t("mods.discover.view.grid")}
                    aria-pressed={view === "grid"}
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    type="button"
                    className={`mods-discover-viewtoggle-btn${view === "list" ? " active" : ""}`}
                    onClick={() => setView("list")}
                    title={t("mods.discover.view.list")}
                    aria-label={t("mods.discover.view.list")}
                    aria-pressed={view === "list"}
                  >
                    <List size={15} />
                  </button>
                  <button
                    type="button"
                    className={`mods-discover-viewtoggle-btn${view === "compact" ? " active" : ""}`}
                    onClick={() => setView("compact")}
                    title={t("mods.discover.view.compact")}
                    aria-label={t("mods.discover.view.compact")}
                    aria-pressed={view === "compact"}
                  >
                    <Table size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Results Grid Container */}
          <RemoteModGrid
            results={visibleResults}
            loading={browse.loading}
            loadingMore={browse.loadingMore}
            error={browse.error}
            hasMore={browse.hasMore}
            hasSource={!!selectedSource?.available}
            view={view}
            total={browse.total}
            installedKeys={installedKeys}
            isBookmarked={isBookmarked}
            onOpen={setActiveMod}
            onOpenExternal={(mod) => void openUrl(mod.url)}
            onToggleBookmark={handleToggleBookmark}
            onQuickInstall={handleQuickInstall}
            onLoadMore={browse.loadMore}
            onRetry={browse.refresh}
            onConfigure={() => setConfigOpen(true)}
            onClearFilters={() => {
              browse.setQuery("");
              setCategory("all");
              setStatusFilter("all");
              setSelectedTags([]);
            }}
          />
        </div>
      )}

      {/* ── Subtab: SAVED & WISHLIST ──────────────────────────────────── */}
      {subtab === "bookmarks" && (
        <div className="mods-discover-tab-pane">
          <DiscoverBookmarksView
            bookmarks={bookmarks}
            installedKeys={installedKeys}
            onOpen={setActiveMod}
            onOpenExternal={(m) => void openUrl(m.url)}
            onRemoveBookmark={(s, id) => removeBookmark(s, id)}
            onQuickInstall={handleQuickInstall}
            onClearAll={() => clearBookmarks()}
            onNavigateBrowse={() => setSubtab("browse")}
          />
        </div>
      )}

      {/* ── Subtab: INSTALL HISTORY ───────────────────────────────────── */}
      {subtab === "history" && (
        <div className="mods-discover-tab-pane">
          <DiscoverHistoryView
            installs={installs.installs}
            onRemove={installs.remove}
            onNavigateBrowse={() => setSubtab("browse")}
          />
        </div>
      )}

      {/* ── Subtab: SOURCES & ACCOUNTS ────────────────────────────────── */}
      {subtab === "sources" && (
        <div className="mods-discover-tab-pane">
          <DiscoverSourcesTab
            gameId={gameId}
            gameName={activeGame ? gameDisplayName(activeGame) : undefined}
            sources={sources}
            resolving={resolving}
            onResolve={handleResolve}
            onSetLink={setLink}
            onClearLink={clearLink}
          />
        </div>
      )}

      {/* Source Config Modal */}
      <SourceConfigModal
        open={configOpen}
        gameId={gameId}
        gameName={activeGame ? gameDisplayName(activeGame) : undefined}
        sources={sources}
        onClose={() => setConfigOpen(false)}
        onSetLink={setLink}
        onClearLink={clearLink}
      />

      {/* Mod Detail Modal */}
      {activeMod && selectedSource && selectedSource.externalId && (
        <RemoteModDetailModal
          open
          gameId={activeGame?.id ?? ""}
          source={activeMod.source}
          externalId={selectedSource.externalId}
          summary={activeMod}
          isBookmarked={isBookmarked(activeMod.source, activeMod.id)}
          onClose={() => setActiveMod(null)}
          onInstalled={handleInstalled}
          onToggleBookmark={handleToggleBookmark}
        />
      )}
    </div>
  );
}
