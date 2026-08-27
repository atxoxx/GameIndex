import { useCallback, useMemo, type KeyboardEvent } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  type EmuRow,
  type PlatformCategory,
  getPlatformCategory,
} from "../../types/emulator";
import type { EmuFilter } from "./EmulatorStatsHeader";

export type SortKey = "name" | "games" | "platform" | "dateAdded";
export type SortDir = "asc" | "desc";

interface SidebarListProps {
  rows: EmuRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  filter: EmuFilter;
  onFilterChange: (filter: EmuFilter) => void;
  category: PlatformCategory;
  onCategoryChange: (cat: PlatformCategory) => void;
  sortKey: SortKey;
  onSortKeyChange: (key: SortKey) => void;
  sortDir: SortDir;
  onToggleSortDir: () => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function EmulatorGlyph({
  logo,
  glyph,
  className,
}: {
  logo?: string;
  glyph: string;
  className: string;
}) {
  if (logo) {
    return <img className={`${className}-img`} src={logo} alt="" draggable={false} />;
  }
  return <span className={className}>{glyph}</span>;
}

export default function EmulatorSidebarList({
  rows,
  selectedId,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  category,
  onCategoryChange,
  sortKey,
  onSortKeyChange,
  sortDir,
  onToggleSortDir,
}: SidebarListProps) {
  const { t } = useLanguage();

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.platform.toLowerCase().includes(q))
        return false;
      if (category !== "all" && getPlatformCategory(r.platform) !== category) {
        return false;
      }
      switch (filter) {
        case "added":
          return r.added;
        case "notAdded":
          return !r.added;
        case "configured":
          return r.configured;
        case "notConfigured":
          return r.added && !r.configured;
        default:
          return true;
      }
    });

    return [...base].sort((a, b) => {
      let res = 0;
      switch (sortKey) {
        case "games":
          res = a.gameCount - b.gameCount;
          break;
        case "platform":
          res = a.platform.localeCompare(b.platform);
          break;
        case "dateAdded":
          res = (a.createdAt ?? 0) - (b.createdAt ?? 0);
          break;
        case "name":
        default:
          res = a.name.localeCompare(b.name);
          break;
      }
      return sortDir === "desc" ? -res : res;
    });
  }, [rows, search, category, filter, sortKey, sortDir]);

  const groups = useMemo(() => {
    const added = filteredRows.filter((r) => r.added);
    const catalog = filteredRows.filter((r) => !r.added);
    return { added, catalog };
  }, [filteredRows]);

  const addedCount = useMemo(() => rows.filter((r) => r.added).length, [rows]);

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "Home" &&
        e.key !== "End"
      )
        return;
      const ids = filteredRows.map((r) => r.id);
      if (ids.length === 0) return;
      const current = selectedId ?? ids[0];
      const idx = ids.indexOf(current);
      let next = idx;
      if (e.key === "ArrowDown") next = Math.min(ids.length - 1, idx + 1);
      else if (e.key === "ArrowUp") next = Math.max(0, idx - 1);
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
      if (next !== idx) {
        e.preventDefault();
        onSelect(ids[next]);
      }
    },
    [filteredRows, selectedId, onSelect]
  );

  const categories: { key: PlatformCategory; label: string }[] = [
    { key: "all", label: t("emulators.filter.all") },
    { key: "nintendo", label: "Nintendo" },
    { key: "playstation", label: "PlayStation" },
    { key: "sega", label: "Sega" },
    { key: "xbox", label: "Xbox" },
    { key: "arcade", label: "Arcade" },
    { key: "other", label: t("emulators.custom") },
  ];

  const statusFilters: { key: EmuFilter; label: string }[] = [
    { key: "all", label: t("emulators.filter.all") },
    { key: "added", label: t("emulators.filter.added") },
    { key: "notAdded", label: t("emulators.filter.notAdded") },
    { key: "configured", label: t("emulators.filter.configured") },
    { key: "notConfigured", label: t("emulators.filter.notConfigured") },
  ];

  const sortLabel: Record<SortKey, string> = {
    name: t("emulators.sort.name"),
    games: t("emulators.sort.games"),
    platform: t("emulators.sort.platform"),
    dateAdded: t("emulators.sort.dateAdded"),
  };

  return (
    <aside className="emulators-list-pane">
      <div className="emulators-list-pane-header">
        <span className="emulators-list-pane-title">
          {t("emulators.list.title")}
        </span>
        <span className="emulators-list-pane-count">
          {filteredRows.length} / {rows.length}
        </span>
      </div>

      <div className="emulators-search-wrap">
        <svg className="emulators-search-icon" {...ICON}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="emulators-search"
          type="text"
          placeholder={t("emulators.list.search")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            className="emulators-search-clear"
            type="button"
            aria-label={t("emulators.list.clearSearch")}
            onClick={() => onSearchChange("")}
          >
            <svg {...ICON}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Generation / Manufacturer Category Bar */}
      <div className="emulators-category-bar ui-complete-only" role="tablist" aria-label="Console category">
        {categories.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={category === c.key}
            className={`emu-cat-pill${category === c.key ? " is-active" : ""}`}
            onClick={() => onCategoryChange(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Status Filter Chips */}
      <div className="emulators-filters ui-complete-only">
        {statusFilters.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`emu-filter-chip${filter === s.key ? " is-active" : ""}`}
            onClick={() => onFilterChange(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="emulators-sort">
        <label className="emulators-sort-label" htmlFor="emu-sort-select">
          {t("emulators.sortBy")}
        </label>
        <select
          id="emu-sort-select"
          className="emulators-sort-select"
          value={sortKey}
          onChange={(e) => onSortKeyChange(e.target.value as SortKey)}
        >
          {(Object.keys(sortLabel) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {sortLabel[k]}
            </option>
          ))}
        </select>
        <button
          className="emulators-sort-dir"
          onClick={onToggleSortDir}
          title={
            sortDir === "asc"
              ? t("emulators.sort.ascending")
              : t("emulators.sort.descending")
          }
          aria-label={
            sortDir === "asc"
              ? t("emulators.sort.ascending")
              : t("emulators.sort.descending")
          }
        >
          {sortDir === "asc" ? (
            <svg {...ICON}>
              <polyline points="18 15 12 9 6 15" />
            </svg>
          ) : (
            <svg {...ICON}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </button>
      </div>

      <div className="emulators-list-count">
        {t("emulators.list.count", { added: addedCount, total: rows.length })}
      </div>

      <div
        className="emulators-list"
        role="listbox"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
      >
        {filteredRows.length === 0 ? (
          <div className="emulators-list-empty">
            <span className="emulators-list-empty-glyph">🕹️</span>
            <span>{t("emulators.list.empty")}</span>
          </div>
        ) : (
          <>
            {groups.added.length > 0 && (
              <div className="emu-group">
                <div className="emu-group-header">
                  <span>{t("emulators.group.added")}</span>
                  <span className="emu-group-count">{groups.added.length}</span>
                </div>
                {groups.added.map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <button
                      key={r.id}
                      role="option"
                      aria-selected={active}
                      className={`emu-row${active ? " is-active" : ""}`}
                      style={{ ["--emu-accent" as string]: r.accent }}
                      onClick={() => onSelect(r.id)}
                    >
                      <EmulatorGlyph logo={r.logo} glyph={r.glyph} className="emu-row-glyph" />
                      <span className="emu-row-main">
                        <span className="emu-row-name">{r.name}</span>
                        <span className="emu-row-platform">{r.platform}</span>
                      </span>
                      <span className="emu-row-meta">
                        <span className="emu-row-count">
                          {r.gameCount === 1
                            ? t("emulators.romCountSingle", { count: r.gameCount })
                            : t("emulators.romCount", { count: r.gameCount })}
                        </span>
                        <span
                          className={`emu-status-pill ${
                            r.configured ? "is-configured" : "is-unconfigured"
                          }`}
                        >
                          {r.configured
                            ? t("emulators.status.configured")
                            : t("emulators.status.notConfigured")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {groups.catalog.length > 0 && (
              <div className="emu-group">
                <div className="emu-group-header">
                  <span>{t("emulators.group.catalog")}</span>
                  <span className="emu-group-count">{groups.catalog.length}</span>
                </div>
                {groups.catalog.map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <button
                      key={r.id}
                      role="option"
                      aria-selected={active}
                      className={`emu-row is-catalog${active ? " is-active" : ""}`}
                      style={{ ["--emu-accent" as string]: r.accent }}
                      onClick={() => onSelect(r.id)}
                    >
                      <EmulatorGlyph logo={r.logo} glyph={r.glyph} className="emu-row-glyph" />
                      <span className="emu-row-main">
                        <span className="emu-row-name">{r.name}</span>
                        <span className="emu-row-platform">{r.platform}</span>
                      </span>
                      <span className="emu-row-meta">
                        <span className="emu-status-pill is-catalog">
                          {t("emulators.status.notAdded")}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
