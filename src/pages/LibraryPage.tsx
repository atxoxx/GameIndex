import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useLibraryFilters } from "../hooks/useLibraryFilters";
import type { Game } from "../types/game";
import LibraryFilterChips from "../components/library/LibraryFilterChips";
import LibraryFilterSidebar from "../components/library/LibraryFilterSidebar";
import LibraryFilterRail from "../components/library/LibraryFilterRail";
import LibraryHero from "../components/library/LibraryHero";
import LibraryToolbar from "../components/library/LibraryToolbar";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import LibraryEmptyState from "../components/library/LibraryEmptyState";
import LibraryFilteredEmpty from "../components/library/LibraryFilteredEmpty";
import LibraryVirtualGrid from "../components/library/LibraryVirtualGrid";
import LibraryContextMenu from "../components/library/LibraryContextMenu";
import LibraryGameCard from "../components/library/LibraryGameCard";
import BigScreenGameCard from "../components/library/BigScreenGameCard";
import BigScreenLibrary from "../components/library/BigScreenLibrary";

export default function LibraryPage() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, runningGameIds, launchGame, removeGame } = useGames();
  const { showToast } = useToast();
  const { isBigScreen } = useBigScreen();
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

  // Editorial mode: when the library is small enough to render without
  // virtualization (and not in a list/compact view), promote the first
  // card to a wide "feature" tile to create visual rhythm — a curated
  // feel instead of a uniform wall of equal cards.
  const editorial = !isBigScreen && density !== "list" && density !== "compact";

  const renderCard = useCallback(
    (game: Game, index: number) => {
      if (isBigScreen) {
        return <BigScreenGameCard key={game.id} game={game} onClick={() => handleCardClick(game)} />;
      }
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
          className={`animate-fade-in stagger-${Math.min(index + 1, 8)}${featured ? " lib-card--featured" : ""}`}
        />
      );
    },
    [isBigScreen, density, editorial, runningGameIds, handleCardClick, handleGameContextMenu, handleLaunch]
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

  // Stable key that only changes when the filter/sort facets change.
  // The virtualized grid resets its scroll offset on this — so a
  // filtered result starts at the top, but cover-enrichment updates
  // (which also rebuild `filteredGames`) don't yank the scroll.
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
      ]),
    [filters]
  );

  return (
    <div className={`lib-page${isBigScreen ? " lib-page--bigscreen" : ""}`}>
      {isBigScreen && !isLibraryEmpty ? (
        <BigScreenLibrary
          filteredGames={filteredGames}
          totalGames={games.length}
          onSelectGame={handleCardClick}
          filters={filters}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          setSearch={setSearch}
          setGenres={setGenres}
          setPlatforms={setPlatforms}
          setStatus={setStatus}
          setSource={setSource}
          setSort={setSort}
          reset={reset}
        />
      ) : (
        <>
          <LibraryHero games={games} />

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
              density={density}
              onDensityChange={setDensity}
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
                    isBigScreen={isBigScreen}
                    editorial={editorial}
                    resetKey={filterResetKey}
                    renderItem={renderCard}
                  />
                )}
              </div>
            </div>
          )}

          {contextMenu && (
            <LibraryContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              game={contextMenu.game}
              isRunning={runningSet.has(contextMenu.game.id)}
              onLaunch={() => handleLaunch(contextMenu.game)}
              onViewDetails={() => handleViewDetails(contextMenu.game)}
              onRemove={() => handleRemove(contextMenu.game)}
            />
          )}
        </>
      )}
    </div>
  );
}
