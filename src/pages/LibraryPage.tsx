import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import { useLibraryFacetCounts } from "../hooks/useLibraryFacetCounts";
import { useShelves } from "../context/ShelfContext";
import { usePersistedState } from "../hooks/usePersistedState";
import { rulesFromFilters } from "../hooks/shelfRules";
import {
  LIBRARY_DENSITIES,
  gameNameFromPath,
  type Game,
  type LibraryDensity,
  type PlayStatus,
} from "../types/game";
import type { ShelfRules } from "../types/shelf";
import { EXECUTABLE_DIALOG_FILTERS } from "../utils/executableTypes";
import PageWidget from "../components/PageWidget";
import LibraryHeader from "../components/library/LibraryHeader";
import LibraryStatBand from "../components/library/LibraryStatBand";
import LibraryResumeStrip from "../components/library/LibraryResumeStrip";
import LibraryCommandBar from "../components/library/LibraryCommandBar";
import LibraryScopeBar, { type LibraryScope } from "../components/library/LibraryScopeBar";
import LibraryFilterPopover from "../components/library/LibraryFilterPopover";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryVirtualGrid from "../components/library/LibraryVirtualGrid";
import LibraryGameCard from "../components/library/LibraryGameCard";
import LibraryEmptyState from "../components/library/LibraryEmptyState";
import LibraryFilteredEmpty from "../components/library/LibraryFilteredEmpty";
import LibraryBulkBar from "../components/library/LibraryBulkBar";
import LibraryExportModal from "../components/library/LibraryExportModal";
import GameContextMenu from "../components/game/GameContextMenu";
import { EditGameModal } from "../components/game/EditGameModal";
import { ShelfBuilderModal } from "../components/shelves/ShelfBuilderModal";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import type { LibraryGroupBy } from "../components/library/LibraryGroupMenu";
import "../library.css";
import "../styles/page-library.css";

const LIBRARY_DENSITY_KEY = "gamelib:library:density:v1";
const LIBRARY_GROUP_KEY = "gamelib:library:groupBy:v1";
const LIBRARY_GROUPS: readonly LibraryGroupBy[] = [
  "none",
  "platform",
  "playStatus",
  "genre",
  "releaseYear",
  "alphabetical",
];

/**
 * LibraryPage — the desktop library workspace.
 *
 * Order follows how people use a library: a quiet header, the numbers, the
 * sessions they were just playing, then a sticky command bar (scopes, search,
 * filters, sort, grouping, density) over the grid. Filters open in a drawer so
 * the artwork keeps the full width.
 */
export default function LibraryPage() {
  const navigate = useNavigate();
  const {
    games,
    setSelectedGameId,
    runningGameIds,
    launchGame,
    forceCloseGame,
    removeGame,
    updateGame,
    importLocalGames,
  } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const {
    activeShelfId,
    getShelf,
    shelfGames,
    shelfCount,
    shelves,
    setActiveShelf,
    completedAtOf,
  } = useShelves();

  const {
    filters,
    filteredGames: baseFilteredGames,
    availableGenres,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    setSource,
    setPlayStatus,
    setVrOnly,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removePlayStatus,
    removeSearch,
    removeSource,
    removeVrOnly,
    reset,
  } = useLibraryFilters(games, { completedAtOf });

  const activeShelf = activeShelfId ? (getShelf(activeShelfId) ?? null) : null;
  const orderedShelves = useMemo(
    () => [...shelves].sort((a, b) => a.position - b.position),
    [shelves]
  );
  const activeShelfIds = useMemo(
    () => (activeShelf ? new Set(shelfGames(activeShelf.id).map((game) => game.id)) : null),
    [activeShelf, shelfGames]
  );
  const filteredGames = useMemo(
    () =>
      activeShelfIds
        ? baseFilteredGames.filter((game) => activeShelfIds.has(game.id))
        : baseFilteredGames,
    [baseFilteredGames, activeShelfIds]
  );

  const counts = useLibraryFacetCounts(games);

  const [density, setDensity] = usePersistedState<LibraryDensity>(
    LIBRARY_DENSITY_KEY,
    "cozy",
    LIBRARY_DENSITIES
  );
  const [groupBy, setGroupBy] = usePersistedState<LibraryGroupBy>(
    LIBRARY_GROUP_KEY,
    "none",
    LIBRARY_GROUPS
  );

  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [removeConfirmGame, setRemoveConfirmGame] = useState<Game | null>(null);
  const [bulkRemoveConfirmOpen, setBulkRemoveConfirmOpen] = useState(false);
  const [shelfBuilderOpen, setShelfBuilderOpen] = useState(false);
  const [shelfRules, setShelfRules] = useState<ShelfRules | undefined>(undefined);

  const isLibraryEmpty = games.length === 0;

  const activeFilterCount =
    (filters.genres.length > 0 ? 1 : 0) +
    (filters.platforms.length > 0 || filters.source !== "all" ? 1 : 0) +
    (filters.yearMin != null || filters.yearMax != null ? 1 : 0) +
    (filters.ratingMin != null ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.playStatus !== "all" ? 1 : 0) +
    (filters.vrOnly ? 1 : 0);

  // ── Navigation ───────────────────────────────────────────────────────────
  const handleCardClick = useCallback(
    (game: Game) => {
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId]
  );

  const handleGameContextMenu = useCallback((event: React.MouseEvent, game: Game) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ game, x: event.clientX, y: event.clientY });
  }, []);

  const handleLaunch = useCallback(
    (game: Game) => {
      setContextMenu(null);
      launchGame(game);
    },
    [launchGame]
  );

  const handleLaunchAdmin = useCallback(
    (game: Game) => {
      setContextMenu(null);
      launchGame({ ...game, runAsAdmin: true });
    },
    [launchGame]
  );

  const handleForceClose = useCallback(
    (game: Game) => {
      setContextMenu(null);
      forceCloseGame(game);
    },
    [forceCloseGame]
  );

  const handleEditGame = useCallback((game: Game) => {
    setContextMenu(null);
    setEditGame(game);
  }, []);

  const handleViewDetails = useCallback(
    (game: Game) => {
      setContextMenu(null);
      handleCardClick(game);
    },
    [handleCardClick]
  );

  const handleRemove = useCallback((game: Game) => {
    setContextMenu(null);
    setRemoveConfirmGame(game);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!removeConfirmGame) return;
    removeGame(removeConfirmGame.id);
    showToast(t("library.removedFromLibrary", { name: removeConfirmGame.name }), "info");
    setRemoveConfirmGame(null);
  }, [removeConfirmGame, removeGame, showToast, t]);

  // ── Page actions ─────────────────────────────────────────────────────────
  const handleQuickImport = useCallback(async () => {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("library.importDialogTitle"),
        filters: EXECUTABLE_DIALOG_FILTERS,
      });
      if (filePath && typeof filePath === "string") {
        await importLocalGames([{ path: filePath, metadata: null }]);
        showToast(t("library.importedName", { name: gameNameFromPath(filePath) }), "success");
      }
    } catch (error) {
      console.error("Quick import failed:", error);
      showToast(t("library.importFailed", { error: String(error) }), "error");
    }
  }, [importLocalGames, showToast, t]);

  const handleBrowseStore = useCallback(() => navigate("/store"), [navigate]);

  // ── Scopes / shelves ─────────────────────────────────────────────────────
  const applyScope = useCallback(
    (scope: LibraryScope) => {
      if (activeShelfId) setActiveShelf(null);
      if (scope === "all") {
        setStatus("all");
        setPlayStatus("all");
        return;
      }
      if (scope === "installed") {
        setPlayStatus("all");
        setStatus(filters.status === "installed" ? "all" : "installed");
        return;
      }
      setStatus("all");
      setPlayStatus(filters.playStatus === scope ? "all" : scope);
    },
    [activeShelfId, filters.playStatus, filters.status, setActiveShelf, setPlayStatus, setStatus]
  );

  const handleSelectShelf = useCallback(
    (id: string) => {
      if (activeShelfId === id) {
        setActiveShelf(null);
        return;
      }
      const shelf = getShelf(id);
      reset();
      if (shelf) setSort(shelf.sort);
      setActiveShelf(id);
    },
    [activeShelfId, getShelf, reset, setActiveShelf, setSort]
  );

  const openShelfBuilder = useCallback(() => {
    setShelfRules(rulesFromFilters(filters));
    setShelfBuilderOpen(true);
  }, [filters]);

  /** Clear every narrowing input, including the applied shelf. */
  const resetAll = useCallback(() => {
    reset();
    setActiveShelf(null);
  }, [reset, setActiveShelf]);

  // ── Bulk selection ───────────────────────────────────────────────────────
  const toggleSelectGame = useCallback((game: Game) => {
    setSelectedGameIds((previous) => {
      const next = new Set(previous);
      if (next.has(game.id)) next.delete(game.id);
      else next.add(game.id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedGameIds(new Set(filteredGames.map((game) => game.id)));
  }, [filteredGames]);

  const clearSelection = useCallback(() => setSelectedGameIds(new Set()), []);

  const handleBulkSetPlayStatus = useCallback(
    (status: PlayStatus) => {
      if (selectedGameIds.size === 0) return;
      selectedGameIds.forEach((id) => updateGame(id, { playStatus: status }));
      showToast(t("library.bulk.updatedStatus", { count: selectedGameIds.size }), "success");
      clearSelection();
      setBulkMode(false);
    },
    [selectedGameIds, updateGame, showToast, t, clearSelection]
  );

  const handleConfirmBulkRemove = useCallback(() => {
    setBulkRemoveConfirmOpen(false);
    if (selectedGameIds.size === 0) return;
    const count = selectedGameIds.size;
    selectedGameIds.forEach((id) => removeGame(id));
    showToast(t("library.bulk.removedGames", { count }), "info");
    clearSelection();
    setBulkMode(false);
  }, [selectedGameIds, removeGame, showToast, t, clearSelection]);

  // ── Grid ─────────────────────────────────────────────────────────────────
  const runningSet = useMemo(() => new Set(runningGameIds), [runningGameIds]);

  const renderCard = useCallback(
    (game: Game) => (
      <LibraryGameCard
        key={game.id}
        game={game}
        density={density}
        isRunning={runningSet.has(game.id)}
        onClick={() => handleCardClick(game)}
        onContextMenu={(event) => handleGameContextMenu(event, game)}
        onLaunch={handleLaunch}
        selectable={bulkMode}
        selected={selectedGameIds.has(game.id)}
        onToggleSelect={toggleSelectGame}
      />
    ),
    [
      density,
      runningSet,
      bulkMode,
      selectedGameIds,
      handleCardClick,
      handleGameContextMenu,
      handleLaunch,
      toggleSelectGame,
    ]
  );

  const filterResetKey = useMemo(
    () =>
      JSON.stringify([
        filters.search,
        filters.genres,
        filters.platforms,
        filters.yearMin,
        filters.yearMax,
        filters.ratingMin,
        filters.status,
        filters.source,
        filters.playStatus,
        filters.vrOnly,
        filters.sort,
        groupBy,
        activeShelfId,
      ]),
    [filters, groupBy, activeShelfId]
  );

  return (
    <div className={`lib-page library-page${bulkMode ? " is-bulk-mode" : ""}`}>
      <PageWidget page="library" widget="libHeader">
        <div className="ui-item-libHeader">
          <LibraryHeader
            total={games.length}
            bulkMode={bulkMode}
            onToggleBulkMode={() => {
              setBulkMode(!bulkMode);
              clearSelection();
            }}
            onImport={handleQuickImport}
            onBrowseStore={handleBrowseStore}
            onExport={() => setExportOpen(true)}
          />
        </div>
      </PageWidget>

      {!isLibraryEmpty && (
        <PageWidget page="library" widget="libKpis">
          <div className="ui-complete-only ui-item-libKpis">
            <LibraryStatBand
              games={games}
              installedCount={counts.installed}
              onToggleInstalled={() => applyScope("installed")}
            />
          </div>
        </PageWidget>
      )}

      {!isLibraryEmpty && (
        <PageWidget page="library" widget="libResume">
          <div className="ui-complete-only ui-item-libResume">
            <LibraryResumeStrip
              games={games}
              runningIds={runningGameIds}
              onOpen={handleCardClick}
              onLaunch={handleLaunch}
            />
          </div>
        </PageWidget>
      )}

      {isLibraryEmpty ? (
        <LibraryEmptyState />
      ) : (
        <>
          <PageWidget page="library" widget="libToolbar">
            <div className="ui-item-libToolbar">
              <LibraryCommandBar
                scopeBar={
                  <LibraryScopeBar
                    total={counts.total}
                    installed={counts.installed}
                    playStatusCounts={counts.playStatus}
                    status={filters.status}
                    playStatus={filters.playStatus}
                    shelves={orderedShelves}
                    activeShelf={activeShelf}
                    shelfCount={shelfCount}
                    onSelectScope={applyScope}
                    onSelectShelf={handleSelectShelf}
                    onCreateShelf={() => {
                      setShelfRules(undefined);
                      setShelfBuilderOpen(true);
                    }}
                  />
                }
                search={filters.search}
                onSearchChange={setSearch}
                activeFilterCount={activeFilterCount}
                filtersOpen={filtersOpen}
                onToggleFilters={() => setFiltersOpen((open) => !open)}
                filtersButtonRef={filtersButtonRef}
                sort={filters.sort}
                onSortChange={setSort}
                groupBy={groupBy}
                onGroupByChange={setGroupBy}
                density={density}
                onDensityChange={setDensity}
              />
            </div>
          </PageWidget>

          <PageWidget page="library" widget="libFilterChips">
            <div className="ui-item-libFilterChips">
              <LibraryFilterChips
                filters={filters}
                resultCount={filteredGames.length}
                activeShelf={activeShelf}
                onRemoveSearch={removeSearch}
                onRemoveGenre={removeGenre}
                onRemovePlatform={removePlatform}
                onRemoveYear={removeYear}
                onRemoveRating={removeRating}
                onRemoveStatus={removeStatus}
                onRemovePlayStatus={removePlayStatus}
                onRemoveSource={removeSource}
                onRemoveVrOnly={removeVrOnly}
                onClearShelf={() => setActiveShelf(null)}
                onSaveAsShelf={openShelfBuilder}
                onResetAll={resetAll}
              />
            </div>
          </PageWidget>

          <PageWidget page="library" widget="libGrid">
            <div className="lib-main ui-item-libGrid">
              {filteredGames.length === 0 ? (
                <LibraryFilteredEmpty onReset={resetAll} />
              ) : (
                <LibraryVirtualGrid
                  items={filteredGames}
                  density={density}
                  isBigScreen={false}
                  groupBy={groupBy}
                  resetKey={filterResetKey}
                  renderItem={renderCard}
                />
              )}
            </div>
          </PageWidget>
        </>
      )}

      <LibraryFilterPopover
        open={filtersOpen}
        onClose={closeFilters}
        anchorRef={filtersButtonRef}
        filters={filters}
        availableGenres={availableGenres}
        counts={counts}
        resultCount={filteredGames.length}
        onGenresChange={setGenres}
        onPlatformsChange={setPlatforms}
        onYearRangeChange={setYearRange}
        onRatingMinChange={setRatingMin}
        onStatusChange={setStatus}
        onPlayStatusChange={setPlayStatus}
        onSourceChange={setSource}
        onVrOnlyChange={setVrOnly}
        onReset={resetAll}
        onSaveAsShelf={openShelfBuilder}
      />

      {bulkMode && (
        <LibraryBulkBar
          selectedCount={selectedGameIds.size}
          totalCount={filteredGames.length}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onSetPlayStatus={handleBulkSetPlayStatus}
          onRemoveSelected={() => setBulkRemoveConfirmOpen(true)}
          onExit={() => {
            setBulkMode(false);
            clearSelection();
          }}
        />
      )}

      {contextMenu && (
        <GameContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          game={contextMenu.game}
          isRunning={runningSet.has(contextMenu.game.id)}
          onClose={() => setContextMenu(null)}
          onLaunch={() => handleLaunch(contextMenu.game)}
          onLaunchAdmin={() => handleLaunchAdmin(contextMenu.game)}
          onLaunchExe={(executable) => {
            setContextMenu(null);
            launchGame(contextMenu.game, executable);
          }}
          onForceClose={() => handleForceClose(contextMenu.game)}
          onViewDetails={() => handleViewDetails(contextMenu.game)}
          onEdit={() => handleEditGame(contextMenu.game)}
          onRemove={() => handleRemove(contextMenu.game)}
        />
      )}

      {editGame && <EditGameModal game={editGame} onClose={() => setEditGame(null)} />}

      {exportOpen && (
        <LibraryExportModal
          games={games}
          filteredGames={filteredGames}
          onClose={() => setExportOpen(false)}
        />
      )}

      <ShelfBuilderModal
        open={shelfBuilderOpen}
        shelf={null}
        initialRules={shelfRules}
        onClose={() => {
          setShelfBuilderOpen(false);
          setShelfRules(undefined);
        }}
      />

      <ConfirmModal
        open={removeConfirmGame !== null}
        title={t("game.removeConfirmTitle", { name: removeConfirmGame?.name ?? "" })}
        message={t("gamePage.removeConfirmBody")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleConfirmRemove}
        onCancel={() => setRemoveConfirmGame(null)}
      />

      <ConfirmModal
        open={bulkRemoveConfirmOpen}
        title={t("library.bulkRemoveConfirmTitle", { count: selectedGameIds.size })}
        message={t("library.bulkRemoveConfirmBody", { count: selectedGameIds.size })}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleConfirmBulkRemove}
        onCancel={() => setBulkRemoveConfirmOpen(false)}
      />
    </div>
  );
}
