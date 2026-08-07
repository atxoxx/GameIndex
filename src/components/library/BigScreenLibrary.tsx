// BigScreenLibrary — self-contained controller-first library for Big
// Screen Mode.
//
// Consumes `useLibraryFilters()` (context-backed via
// LibraryFilterProvider) and `useGames()` directly — no props flow
// from the desktop LibraryPage anymore. The desktop page and this
// component mount exclusively per mode via ShellSwitch, so desktop
// mode is untouched.
//
// Layout: title + filter chips row on top, then the windowed GameGrid
// below (which owns the scroll + focus-restore behavior). Empty
// states are handled here: a truly empty library gets the "switch to
// desktop to import" message, a filter/search with no matches gets
// the no-match hint.
//
// The filter dropdown drawer carries `data-bigscreen-overlay="true"`
// so the gamepad engine treats it as an overlay: controller B closes
// the drawer (via the Escape dispatch) instead of exiting Big Screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Game, LibrarySource } from "../../types/game";
import type {
  LibraryFilters,
  LibraryStatus,
  LibrarySort,
} from "../../hooks/useLibraryFilters";
import { useLibraryFilters, SORT_LABELS } from "../../hooks/useLibraryFilters";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";
import GameGrid from "../bigscreen/GameGrid";

type DropdownType = "platform" | "genre" | "status" | "source" | "sort" | null;

export default function BigScreenLibrary() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { games, setSelectedGameId } = useGames();
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

  const [dropdown, setDropdown] = useState<DropdownType>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectGame = useCallback(
    (game: Game) => {
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [navigate, setSelectedGameId],
  );

  // Focusable filters bar
  const searchChip = useFocusable(() => {
    setSearchFocused(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  });
  const platformChip = useFocusable(() => setDropdown("platform"));
  const genreChip = useFocusable(() => setDropdown("genre"));
  const statusChip = useFocusable(() => setDropdown("status"));
  const sourceChip = useFocusable(() => setDropdown("source"));
  const sortChip = useFocusable(() => setDropdown("sort"));
  const resetChip = useFocusable(() => reset());

  // Close dropdown on Escape (controller B / X dispatch an Escape
  // keydown while the drawer is marked as an overlay).
  useEffect(() => {
    if (!dropdown && !searchFocused) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDropdown(null);
        setSearchFocused(false);
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dropdown, searchFocused]);

  // Clean label helper for platforms filter
  const platformLabel = useMemo(() => {
    if (filters.platforms.length === 0) return t("bigscreen.library.allPlatforms");
    if (filters.platforms.length === 1) return filters.platforms[0];
    return t("bigscreen.library.platformsCount", { count: filters.platforms.length });
  }, [filters.platforms, t]);

  // Clean label helper for genres filter
  const genreLabel = useMemo(() => {
    if (filters.genres.length === 0) return t("bigscreen.library.allGenres");
    if (filters.genres.length === 1) return filters.genres[0];
    return t("bigscreen.library.genresCount", { count: filters.genres.length });
  }, [filters.genres, t]);

  return (
    <div className="bigscreen-library-dashboard">
      <div className="bigscreen-library-header-section">
        <div className="bigscreen-library-title-row">
          <h2 className="bigscreen-library-title">{t("bigscreen.library.myCollection")}</h2>
          <span className="bigscreen-library-count">
            {t("bigscreen.library.countOf", { count: filteredGames.length, total: games.length })}
          </span>
        </div>

        {/* Filters Chips Row */}
        <div className="bigscreen-library-chips-row">
          {/* Search Box / Input */}
          <div
            className={`bigscreen-filter-chip bigscreen-filter-chip--search ${
              searchFocused ? "search-active" : ""
            }`}
            {...searchChip}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t("bigscreen.library.search")}
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>

          <button type="button" className="bigscreen-filter-chip" {...platformChip}>
            {t("bigscreen.library.chipPlatform")} <span>{platformLabel}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...genreChip}>
            {t("bigscreen.library.chipGenre")} <span>{genreLabel}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...statusChip}>
            {t("bigscreen.library.chipStatus")} <span>{filters.status === "all" ? t("common.all") : filters.status === "installed" ? t("filter.installed") : t("filter.notInstalled")}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...sourceChip}>
            {t("bigscreen.library.chipSource")} <span>{filters.source === "all" ? t("bigscreen.library.allSources") : filters.source.toUpperCase()}</span>
          </button>

          <button type="button" className="bigscreen-filter-chip" {...sortChip}>
            {t("bigscreen.library.chipSort")} <span>{SORT_LABELS[filters.sort]}</span>
          </button>

          {(filters.search ||
            filters.platforms.length > 0 ||
            filters.genres.length > 0 ||
            filters.status !== "all" ||
            filters.source !== "all" ||
            filters.sort !== "alphabetical") && (
            <button type="button" className="bigscreen-filter-chip bigscreen-filter-chip--reset" {...resetChip}>
              {t("bigscreen.library.resetFilters")}
            </button>
          )}
        </div>
      </div>

      {/* Library empty vs filtered grid */}
      {games.length === 0 ? (
        <div className="bigscreen-library-grid-container">
          <div className="bigscreen-library-empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" opacity="0.3">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <h3>{t("bigscreen.library.noGamesDesc")}</h3>
          </div>
        </div>
      ) : (
        <GameGrid
          games={filteredGames}
          onSelect={handleSelectGame}
          emptyState={
            <div className="bigscreen-library-empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="64" height="64" opacity="0.3">
                <polygon points="12 2 2 22 22 22" />
              </svg>
              <h3>{t("bigscreen.library.noMatch")}</h3>
              <p>{t("bigscreen.library.noMatchHint")}</p>
            </div>
          }
        />
      )}

      {/* Filter Options Dropdown Drawer */}
      {dropdown && (
        <FilterDropdownOverlay
          type={dropdown}
          filters={filters}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          setGenres={setGenres}
          setPlatforms={setPlatforms}
          setStatus={setStatus}
          setSource={setSource}
          setSort={setSort}
          onClose={() => setDropdown(null)}
        />
      )}
    </div>
  );
}

interface DropdownOverlayProps {
  type: DropdownType;
  filters: LibraryFilters;
  availableGenres: string[];
  availablePlatforms: string[];
  setGenres: (val: string[]) => void;
  setPlatforms: (val: string[]) => void;
  setStatus: (val: LibraryStatus) => void;
  setSource: (val: LibrarySource) => void;
  setSort: (val: LibrarySort) => void;
  onClose: () => void;
}

function FilterDropdownOverlay({
  type,
  filters,
  availableGenres,
  availablePlatforms,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  onClose,
}: DropdownOverlayProps) {
  const { t } = useLanguage();
  const title = useMemo(() => {
    switch (type) {
      case "platform": return t("bigscreen.library.selectPlatforms");
      case "genre": return t("bigscreen.library.selectGenres");
      case "status": return t("bigscreen.library.filterByStatus");
      case "source": return t("bigscreen.library.filterBySource");
      case "sort": return t("library.sortOrder");
      default: return "";
    }
  }, [type, t]);

  return (
    // data-bigscreen-overlay="true": the gamepad engine treats this
    // drawer as an overlay, so controller B dispatches Escape (closing
    // the drawer) instead of invoking the shell exit / page back.
    <div className="bigscreen-overlay-drawer" data-bigscreen-overlay="true" onClick={onClose}>
      <div className="bigscreen-overlay-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bigscreen-overlay-drawer-header">
          <h3>{title}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="bigscreen-overlay-drawer-content">
          <DropdownOptionsList
            type={type}
            filters={filters}
            availableGenres={availableGenres}
            availablePlatforms={availablePlatforms}
            setGenres={setGenres}
            setPlatforms={setPlatforms}
            setStatus={setStatus}
            setSource={setSource}
            setSort={setSort}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}

function DropdownOptionsList({
  type,
  filters,
  availableGenres,
  availablePlatforms,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  onClose,
}: Omit<DropdownOverlayProps, "title">) {
  const { t } = useLanguage();

  if (type === "platform") {
    return (
      <div className="bigscreen-overlay-options-grid">
        {availablePlatforms.map((plat) => {
          const isActive = filters.platforms.includes(plat);
          const toggle = () => {
            const next = isActive
              ? filters.platforms.filter((p) => p !== plat)
              : [...filters.platforms, plat];
            setPlatforms(next);
          };
          return (
            <FilterOption
              key={plat}
              label={plat}
              active={isActive}
              type={type}
              onSelect={toggle}
              onClose={onClose}
            />
          );
        })}
      </div>
    );
  }

  if (type === "genre") {
    return (
      <div className="bigscreen-overlay-options-grid">
        {availableGenres.map((gen) => {
          const isActive = filters.genres.includes(gen);
          const toggle = () => {
            const next = isActive
              ? filters.genres.filter((g) => g !== gen)
              : [...filters.genres, gen];
            setGenres(next);
          };
          return (
            <FilterOption
              key={gen}
              label={gen}
              active={isActive}
              type={type}
              onSelect={toggle}
              onClose={onClose}
            />
          );
        })}
      </div>
    );
  }

  if (type === "status") {
    return (
      <div className="bigscreen-overlay-options-list">
        <FilterOption label={t("common.all")} active={filters.status === "all"} type={type} onSelect={() => setStatus("all")} onClose={onClose} />
        <FilterOption label={t("filter.installed")} active={filters.status === "installed"} type={type} onSelect={() => setStatus("installed")} onClose={onClose} />
        <FilterOption label={t("filter.notInstalled")} active={filters.status === "not_installed"} type={type} onSelect={() => setStatus("not_installed")} onClose={onClose} />
      </div>
    );
  }

  if (type === "source") {
    const sources: LibrarySource[] = ["all", "steam", "local", "gog"];
    return (
      <div className="bigscreen-overlay-options-list">
        {sources.map((src) => (
          <FilterOption
            key={src}
            label={src === "all" ? t("bigscreen.library.allSources") : src.toUpperCase()}
            active={filters.source === src}
            type={type}
            onSelect={() => setSource(src)}
            onClose={onClose}
          />
        ))}
      </div>
    );
  }

  if (type === "sort") {
    const sorts: LibrarySort[] = ["alphabetical", "date_added", "most_played", "recently_played", "rating"];
    return (
      <div className="bigscreen-overlay-options-list">
        {sorts.map((srt) => (
          <FilterOption
            key={srt}
            label={SORT_LABELS[srt]}
            active={filters.sort === srt}
            type={type}
            onSelect={() => setSort(srt)}
            onClose={onClose}
          />
        ))}
      </div>
    );
  }

  return null;
}

// ─── Filter Option row ─────────────────────────────────────────────
// Owns its useFocusable call unconditionally (rules-of-hooks). The
// old `renderOption` factory called useFocusable inside `.map()`
// callbacks — a rules-of-hooks violation that crashes the focus
// registry. Rows are always rendered as their own component.

function FilterOption({
  label,
  active,
  type,
  onSelect,
  onClose,
}: {
  label: string;
  active: boolean;
  type: DropdownType;
  onSelect: () => void;
  onClose: () => void;
}) {
  const optionProps = useFocusable(() => {
    onSelect();
    // Keep dropdown open for multi-select, close for single select
    if (type === "status" || type === "source" || type === "sort") {
      onClose();
    }
  });

  return (
    <button
      type="button"
      className={`bigscreen-overlay-drawer-option ${active ? "option-active" : ""}`}
      {...optionProps}
    >
      <span className="option-checkbox">{active ? "✓" : ""}</span>
      <span className="option-label">{label}</span>
    </button>
  );
}
