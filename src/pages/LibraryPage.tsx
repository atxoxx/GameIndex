import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import type { Game, PlayStatus } from "../types/game";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import LibraryFilterRail from "../components/library/LibraryFilterRail";
import LibraryHero from "../components/library/LibraryHero";
import LibraryToolbar, { type LibraryGroupBy } from "../components/library/LibraryToolbar";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import LibraryEmptyState from "../components/library/LibraryEmptyState";
import LibraryFilteredEmpty from "../components/library/LibraryFilteredEmpty";
import LibraryVirtualGrid from "../components/library/LibraryVirtualGrid";
import LibraryContextMenu from "../components/library/LibraryContextMenu";
import LibraryGameCard from "../components/library/LibraryGameCard";
import LibraryExportModal from "../components/library/LibraryExportModal";
import LibraryBulkBar from "../components/library/LibraryBulkBar";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, runningGameIds, launchGame, removeGame, updateGame } = useGames();
  const { showToast } = useToast();
  const { density, setDensity } = useDensityContext();
  const { t } = useLanguage();

  const {
    filters,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    setSource,
    setPlayStatus,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removePlayStatus,
    removeSearch,
    removeSource,
    reset,
    hasFilters,
  } = useLibraryFilters(games);

  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<LibraryGroupBy>("none");
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("contextmenu", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  const isLibraryEmpty = games.length === 0;

  const handleCardClick = useCallback(
    (game: Game) => {
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId]
  );

  const handleGameContextMenu = useCallback((e: React.MouseEvent, game: Game) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ game, x: e.clientX, y: e.clientY });
  }, []);

  const handleLaunch = useCallback(
    (game: Game) => {
      setContextMenu(null);
      launchGame(game);
    },
    [launchGame]
  );

  const handleViewDetails = useCallback(
    (game: Game) => {
      setContextMenu(null);
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId]
  );

  const handleRemove = useCallback(
    (game: Game) => {
      setContextMenu(null);
      removeGame(game.id);
      showToast(t("library.removedFromLibrary", { name: game.name }), "info");
    },
    [removeGame, showToast, t]
  );

  const handleUpdatePlayStatus = useCallback(
    (gameId: string, status: PlayStatus) => {
      updateGame(gameId, { playStatus: status });
      setContextMenu(null);
    },
    [updateGame]
  );

  // Bulk actions
  const toggleSelectGame = useCallback((game: Game) => {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(game.id)) {
        next.delete(game.id);
      } else {
        next.add(game.id);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedGameIds(new Set(filteredGames.map((g) => g.id)));
  }, [filteredGames]);

  const clearSelection = useCallback(() => {
    setSelectedGameIds(new Set());
  }, []);

  const handleBulkSetPlayStatus = useCallback(
    (status: PlayStatus) => {
      if (selectedGameIds.size === 0) return;
      selectedGameIds.forEach((id) => {
        updateGame(id, { playStatus: status });
      });
      showToast(t("library.bulk.updatedStatus", { count: selectedGameIds.size }), "success");
      clearSelection();
      setBulkMode(false);
    },
    [selectedGameIds, updateGame, showToast, t, clearSelection]
  );

  const handleBulkRemove = useCallback(() => {
    if (selectedGameIds.size === 0) return;
    const count = selectedGameIds.size;
    selectedGameIds.forEach((id) => {
      removeGame(id);
    });
    showToast(t("library.bulk.removedGames", { count }), "info");
    clearSelection();
    setBulkMode(false);
  }, [selectedGameIds, removeGame, showToast, t, clearSelection]);

  const editorial = density !== "list" && density !== "compact" && groupBy === "none";

  const renderCard = useCallback(
    (game: Game, index: number) => {
      const featured = editorial && index === 0 && !!game.coverArtUrl;
      return (
        <LibraryGameCard
          key={game.id}
          game={game}
          density={density}
          isRunning={runningGameIds.includes(game.id)}
          onClick={() => handleCardClick(game)}
          onContextMenu={(e) => handleGameContextMenu(e, game)}
          onLaunch={handleLaunch}
          selectable={bulkMode}
          selected={selectedGameIds.has(game.id)}
          onToggleSelect={toggleSelectGame}
          className={`animate-fade-in stagger-${Math.min(index + 1, 8)}${featured ? " lib-card--featured" : ""}`}
        />
      );
    },
    [
      density,
      editorial,
      runningGameIds,
      bulkMode,
      selectedGameIds,
      handleCardClick,
      handleGameContextMenu,
      handleLaunch,
      toggleSelectGame,
    ]
  );

  const toolbarTitle = isLibraryEmpty
    ? t("page.library.yourGames")
    : `${t("nav.library")} (${
        hasFilters
          ? t("bigscreen.library.countOf", { count: filteredGames.length, total: games.length })
          : games.length
      })`;

  const toolbarCount =
    !isLibraryEmpty && hasFilters
      ? t("libraryPage.resultCount", { count: filteredGames.length, plural: filteredGames.length !== 1 ? "s" : "" })
      : null;

  const sidebarProps = {
    search: filters.search,
    selectedGenres: filters.genres,
    selectedPlatforms: filters.platforms,
    yearMin: filters.yearMin,
    yearMax: filters.yearMax,
    ratingMin: filters.ratingMin,
    status: filters.status,
    playStatus: filters.playStatus,
    availableGenres,
    availablePlatforms,
    source: filters.source,
    sort: filters.sort,
    onSearchChange: setSearch,
    onGenresChange: setGenres,
    onPlatformsChange: setPlatforms,
    onYearRangeChange: setYearRange,
    onRatingMinChange: setRatingMin,
    onStatusChange: setStatus,
    onPlayStatusChange: setPlayStatus,
    onSourceChange: setSource,
    onSortChange: setSort,
    onReset: reset,
  };

  const runningSet = useMemo(() => new Set(runningGameIds), [runningGameIds]);

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
        filters.sort,
        groupBy,
      ]),
    [filters, groupBy]
  );

  return (
    <div className="lib-page">
      <LibraryHero
        games={games}
        activeStatus={filters.status}
        activePlayStatus={filters.playStatus}
        onFilterStatus={setStatus}
        onFilterPlayStatus={setPlayStatus}
        onCardClick={handleCardClick}
      />

      {!isLibraryEmpty && <ContinuePlayingRail games={games} onCardClick={handleCardClick} />}

      {!isLibraryEmpty && games.length >= 4 && (
        <RecentlyAddedRail games={games} onCardClick={handleCardClick} />
      )}

      {!isLibraryEmpty && (
        <LibraryToolbar
          title={toolbarTitle}
          count={toolbarCount}
          search={filters.search}
          onSearchChange={setSearch}
          sort={filters.sort}
          onSortChange={setSort}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          density={density}
          onDensityChange={setDensity}
          bulkMode={bulkMode}
          onToggleBulkMode={() => {
            setBulkMode(!bulkMode);
            clearSelection();
          }}
          onExport={() => setExportOpen(true)}
        />
      )}

      {!isLibraryEmpty && (
        <LibraryFilterChips
          filters={filters}
          resultCount={filteredGames.length}
          onRemoveSearch={removeSearch}
          onRemoveGenre={removeGenre}
          onRemovePlatform={removePlatform}
          onRemoveYear={removeYear}
          onRemoveRating={removeRating}
          onRemoveStatus={removeStatus}
          onRemovePlayStatus={removePlayStatus}
          onRemoveSource={removeSource}
          onResetAll={reset}
        />
      )}

      {isLibraryEmpty ? (
        <LibraryEmptyState />
      ) : (
        <div className="lib-layout">
          <LibraryFilterRail collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}>
            <LibraryFilterSidebar {...sidebarProps} />
          </LibraryFilterRail>

          <div className="lib-main">
            {filteredGames.length === 0 ? (
              <LibraryFilteredEmpty onReset={reset} />
            ) : (
              <LibraryVirtualGrid
                items={filteredGames}
                density={density}
                isBigScreen={false}
                editorial={editorial}
                groupBy={groupBy}
                resetKey={filterResetKey}
                renderItem={renderCard}
              />
            )}
          </div>
        </div>
      )}

      {/* Bulk Operations Floating Bar */}
      {bulkMode && (
        <LibraryBulkBar
          selectedCount={selectedGameIds.size}
          totalCount={filteredGames.length}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onSetPlayStatus={handleBulkSetPlayStatus}
          onRemoveSelected={handleBulkRemove}
          onExit={() => {
            setBulkMode(false);
            clearSelection();
          }}
        />
      )}

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          game={contextMenu.game}
          isRunning={runningSet.has(contextMenu.game.id)}
          onLaunch={() => handleLaunch(contextMenu.game)}
          onViewDetails={() => handleViewDetails(contextMenu.game)}
          onUpdatePlayStatus={handleUpdatePlayStatus}
          onRemove={() => handleRemove(contextMenu.game)}
        />
      )}

      {exportOpen && (
        <LibraryExportModal
          games={games}
          filteredGames={filteredGames}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
