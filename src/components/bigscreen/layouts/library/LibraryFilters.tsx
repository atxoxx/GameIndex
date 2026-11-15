// Shared library filter surface.
//
// One implementation of the search field, facet chips and the
// controller-safe option drawer, used by every layout library. Each
// layout only decides where the bar sits (above the grid, in a column,
// inline) and whether it flows horizontally or vertically.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibrarySource } from "../../../../types/game";
import type { LibraryFilters, LibrarySort, LibraryStatus } from "../../../../hooks/useLibraryFilters";
import { SORT_LABEL_KEYS } from "../../../../hooks/useLibraryFilters";
import { useLanguage } from "../../../../context/LanguageContext";
import { useFocusable } from "../../../../hooks/useFocusable";

type DropdownType = "platform" | "genre" | "status" | "source" | "sort" | null;

export interface LibraryFilterBarProps {
  filters: LibraryFilters;
  availableGenres: string[];
  availablePlatforms: string[];
  setSearch: (value: string) => void;
  setGenres: (value: string[]) => void;
  setPlatforms: (value: string[]) => void;
  setStatus: (value: LibraryStatus) => void;
  setSource: (value: LibrarySource) => void;
  setSort: (value: LibrarySort) => void;
  reset: () => void;
  /** `column` is the Steam left-column rail. */
  orientation?: "row" | "column";
  className?: string;
}

export default function LibraryFilters({
  filters,
  availableGenres,
  availablePlatforms,
  setSearch,
  setGenres,
  setPlatforms,
  setStatus,
  setSource,
  setSort,
  reset,
  orientation = "row",
  className,
}: LibraryFilterBarProps) {
  const { t } = useLanguage();
  const [dropdown, setDropdown] = useState<DropdownType>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openDropdown = (type: DropdownType) => {
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDropdown(type);
  };

  const closeDropdown = useCallback(() => {
    setDropdown(null);
    window.requestAnimationFrame(() => {
      openerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const searchChip = useFocusable(() => {
    setSearchFocused(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 40);
  });
  const platformChip = useFocusable(() => openDropdown("platform"));
  const genreChip = useFocusable(() => openDropdown("genre"));
  const statusChip = useFocusable(() => openDropdown("status"));
  const sourceChip = useFocusable(() => openDropdown("source"));
  const sortChip = useFocusable(() => openDropdown("sort"));
  const resetChip = useFocusable(() => reset());

  useEffect(() => {
    if (!dropdown && !searchFocused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (dropdown) closeDropdown();
      setSearchFocused(false);
      searchInputRef.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDropdown, dropdown, searchFocused]);

  const platformLabel = useMemo(() => {
    if (filters.platforms.length === 0) return t("bigscreen.library.allPlatforms");
    if (filters.platforms.length === 1) return filters.platforms[0];
    return t("bigscreen.library.platformsCount", { count: filters.platforms.length });
  }, [filters.platforms, t]);

  const genreLabel = useMemo(() => {
    if (filters.genres.length === 0) return t("bigscreen.library.allGenres");
    if (filters.genres.length === 1) return filters.genres[0];
    return t("bigscreen.library.genresCount", { count: filters.genres.length });
  }, [filters.genres, t]);

  const hasFilters =
    !!filters.search ||
    filters.platforms.length > 0 ||
    filters.genres.length > 0 ||
    filters.status !== "all" ||
    filters.source !== "all" ||
    filters.sort !== "alphabetical";

  return (
    <>
      <div
        className={`bst-filters${orientation === "column" ? " bst-filters--column" : ""}${className ? ` ${className}` : ""}`}
      >
        <div className="bst-filter-search" data-active={searchFocused ? "true" : undefined} {...searchChip}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
          <input
            ref={searchInputRef}
            type="search"
            value={filters.search}
            placeholder={t("bigscreen.library.search")}
            aria-label={t("bigscreen.library.search")}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        <button type="button" className="bst-filter-chip" {...platformChip}>
          {t("bigscreen.library.chipPlatform", { value: platformLabel })}
        </button>
        <button type="button" className="bst-filter-chip" {...genreChip}>
          {t("bigscreen.library.chipGenre", { value: genreLabel })}
        </button>
        <button type="button" className="bst-filter-chip" {...statusChip}>
          {t("bigscreen.library.chipStatus", {
            value:
              filters.status === "all"
                ? t("common.all")
                : filters.status === "installed"
                  ? t("filter.installed")
                  : t("filter.notInstalled"),
          })}
        </button>
        <button type="button" className="bst-filter-chip" {...sourceChip}>
          {t("bigscreen.library.chipSource", {
            value:
              filters.source === "all"
                ? t("bigscreen.library.allSources")
                : filters.source.toUpperCase(),
          })}
        </button>
        <button type="button" className="bst-filter-chip" {...sortChip}>
          {t("bigscreen.library.chipSort", {
            value: t(SORT_LABEL_KEYS[filters.sort]),
          })}
        </button>
        {hasFilters ? (
          <button
            type="button"
            className="bst-filter-chip bst-filter-chip--reset"
            {...resetChip}
          >
            {t("bigscreen.library.resetFilters")}
          </button>
        ) : null}
      </div>

      {dropdown ? (
        <div
          className="bst-filter-drawer"
          data-bigscreen-overlay="true"
          onClick={closeDropdown}
        >
          <div
            className="bst-filter-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-label={dropdownTitle(dropdown, t)}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="bst-filter-drawer-head">
              <h3>{dropdownTitle(dropdown, t)}</h3>
              <button
                type="button"
                className="bst-filter-drawer-close"
                onClick={closeDropdown}
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </header>
            <div className="bst-filter-drawer-body">
              <FilterOptions
                type={dropdown}
                filters={filters}
                availableGenres={availableGenres}
                availablePlatforms={availablePlatforms}
                setGenres={setGenres}
                setPlatforms={setPlatforms}
                setStatus={setStatus}
                setSource={setSource}
                setSort={setSort}
                onClose={closeDropdown}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function dropdownTitle(
  type: Exclude<DropdownType, null>,
  t: (key: string) => string,
): string {
  switch (type) {
    case "platform":
      return t("bigscreen.library.selectPlatforms");
    case "genre":
      return t("bigscreen.library.selectGenres");
    case "status":
      return t("bigscreen.library.filterByStatus");
    case "source":
      return t("bigscreen.library.filterBySource");
    case "sort":
      return t("library.sortLibrary");
    default:
      return "";
  }
}

interface FilterOptionsProps {
  type: Exclude<DropdownType, null>;
  filters: LibraryFilters;
  availableGenres: string[];
  availablePlatforms: string[];
  setGenres: (value: string[]) => void;
  setPlatforms: (value: string[]) => void;
  setStatus: (value: LibraryStatus) => void;
  setSource: (value: LibrarySource) => void;
  setSort: (value: LibrarySort) => void;
  onClose: () => void;
}

function FilterOptions(props: FilterOptionsProps) {
  const { t } = useLanguage();
  const {
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
  } = props;

  if (type === "platform" || type === "genre") {
    const values = type === "platform" ? availablePlatforms : availableGenres;
    const active = type === "platform" ? filters.platforms : filters.genres;
    const commit = type === "platform" ? setPlatforms : setGenres;
    return (
      <div className="bst-filter-options bst-filter-options--grid">
        {values.map((value) => (
          <FilterOption
            key={value}
            label={value}
            active={active.includes(value)}
            onSelect={() =>
              commit(
                active.includes(value)
                  ? active.filter((entry) => entry !== value)
                  : [...active, value],
              )
            }
            onClose={onClose}
            keepOpen
          />
        ))}
      </div>
    );
  }

  if (type === "status") {
    const options: Array<{ value: LibraryStatus; label: string }> = [
      { value: "all", label: t("common.all") },
      { value: "installed", label: t("filter.installed") },
      { value: "not_installed", label: t("filter.notInstalled") },
    ];
    return (
      <div className="bst-filter-options">
        {options.map((option) => (
          <FilterOption
            key={option.value}
            label={option.label}
            active={filters.status === option.value}
            onSelect={() => setStatus(option.value)}
            onClose={onClose}
          />
        ))}
      </div>
    );
  }

  if (type === "source") {
    const options: LibrarySource[] = ["all", "steam", "local", "gog"];
    return (
      <div className="bst-filter-options">
        {options.map((source) => (
          <FilterOption
            key={source}
            label={
              source === "all"
                ? t("bigscreen.library.allSources")
                : source.toUpperCase()
            }
            active={filters.source === source}
            onSelect={() => setSource(source)}
            onClose={onClose}
          />
        ))}
      </div>
    );
  }

  const sorts: LibrarySort[] = [
    "alphabetical",
    "date_added",
    "most_played",
    "recently_played",
    "rating",
  ];
  return (
    <div className="bst-filter-options">
      {sorts.map((sort) => (
        <FilterOption
          key={sort}
          label={t(SORT_LABEL_KEYS[sort])}
          active={filters.sort === sort}
          onSelect={() => setSort(sort)}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

function FilterOption({
  label,
  active,
  onSelect,
  onClose,
  keepOpen = false,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  keepOpen?: boolean;
}) {
  const props = useFocusable(() => {
    onSelect();
    if (!keepOpen) onClose();
  });

  return (
    <button
      type="button"
      className="bst-filter-option"
      data-active={active ? "true" : undefined}
      aria-pressed={active}
      {...props}
    >
      <span className="bst-filter-check" aria-hidden="true">
        {active ? "✓" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
}
