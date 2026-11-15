// BigScreenLibrary - data/filter host for the five layout libraries.
//
// Filtering, selection and game launching are shared business logic;
// each interface layout renders its own collection composition from
// the props below. The selected game is resolved against the filtered
// list on every render, so a filter change or a launch can never leave
// a removed game in an inspector panel.

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useLibraryFilters } from "../../hooks/useLibraryFilters";
import { useGames } from "../../context/GameContext";
import { useActivePreset } from "../../context/BigScreenPrefsContext";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusedGame } from "../bigscreen/selection/useFocusedGame";
import LibraryFilters from "../bigscreen/layouts/library/LibraryFilters";
import GameIndexLibrary from "../bigscreen/layouts/library/GameIndexLibrary";
import XboxLibrary from "../bigscreen/layouts/library/XboxLibrary";
import SteamLibrary from "../bigscreen/layouts/library/SteamLibrary";
import PlayStationLibrary from "../bigscreen/layouts/library/PlayStationLibrary";
import SwitchLibrary from "../bigscreen/layouts/library/SwitchLibrary";

function LibraryEmpty() {
  const { t } = useLanguage();
  return (
    <div className="bst-grid-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
      <h3>{t("bigscreen.library.noMatch")}</h3>
      <p>{t("bigscreen.library.noMatchHint")}</p>
    </div>
  );
}

function LibraryMissing() {
  const { t } = useLanguage();
  return (
    <div className="bst-grid-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M8 21h8M12 18v3" />
      </svg>
      <h3>{t("bigscreen.library.noGamesDesc")}</h3>
    </div>
  );
}

export default function BigScreenLibrary() {
  const navigate = useNavigate();
  const { games, setSelectedGameId, launchGame, runningGameIds } = useGames();
  const { id: layout, library: paradigm } = useActivePreset();
  const {
    filters,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setStatus,
    setSource,
    setSort,
    reset,
  } = useLibraryFilters(games);

  const { item: focusedGame, focusedId } = useFocusedGame({
    items: filteredGames,
    getId: (game) => game.id,
  });

  const isRunning = focusedId ? runningGameIds.includes(focusedId) : false;

  const handleSelect = useCallback(
    (game: Game) => {
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId],
  );

  const handlePlay = useCallback(
    (game: Game) => {
      launchGame(game);
    },
    [launchGame],
  );

  const recent = useMemo(
    () =>
      [...games]
        .filter((game) => (game.lastPlayed ?? 0) > 0)
        .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
    [games],
  );

  const filtersNode = (
    <LibraryFilters
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
      orientation={paradigm === "docs" ? "column" : "row"}
    />
  );

  const empty = games.length === 0 ? <LibraryMissing /> : <LibraryEmpty />;

  const props = {
    games: filteredGames,
    total: games.length,
    focused: focusedGame,
    isRunning,
    recent,
    filters: filtersNode,
    empty,
    onSelect: handleSelect,
    onPlay: focusedGame ? () => handlePlay(focusedGame) : () => {},
    autoFocusFirst: true,
  } as const;

  switch (layout) {
    case "xbox":
      return <XboxLibrary {...props} />;
    case "steam":
      return <SteamLibrary {...props} />;
    case "playstation":
      return <PlayStationLibrary {...props} />;
    case "switch":
      return <SwitchLibrary {...props} />;
    case "gameindex":
    default:
      return <GameIndexLibrary {...props} />;
  }
}
