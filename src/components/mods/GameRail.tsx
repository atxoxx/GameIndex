// GameRail — the left games column on the main Mods page. Deliberately quiet:
// search + three filter chips + a sort menu, then compact game rows. The
// per-game detail (engines, progress) lives in the workspace, not here.

import { useMemo, useRef, useState } from "react";
import {
  ArrowUpCircle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Layers,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import { gameDisplayName, type Game } from "../../types/game";
import type { ModsOverviewEntry } from "../../types/mods";

export type RailFilter = "all" | "modded" | "updates";
export type RailSort = "mods" | "name" | "size";

function formatStorage(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

interface GameRailProps {
  games: Game[];
  totalGames: number;
  overview: Map<string, ModsOverviewEntry>;
  selectedGameId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: RailFilter;
  onFilterChange: (filter: RailFilter) => void;
  sort: RailSort;
  onSortChange: (sort: RailSort) => void;
  moddedCount: number;
  updatesCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function GameRail({
  games,
  totalGames,
  overview,
  selectedGameId,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  moddedCount,
  updatesCount,
  refreshing,
  onRefresh,
  collapsed,
  onToggleCollapsed,
}: GameRailProps) {
  const { t } = useLanguage();
  const sortBtnRef = useRef<HTMLButtonElement | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);

  const sortItems: ContextMenuItem[] = useMemo(
    () => [
      {
        id: "mods",
        label: t("mods.rail.sortMods"),
        active: sort === "mods",
        onSelect: () => {
          onSortChange("mods");
          setSortMenu(null);
        },
      },
      {
        id: "name",
        label: t("mods.rail.sortName"),
        active: sort === "name",
        onSelect: () => {
          onSortChange("name");
          setSortMenu(null);
        },
      },
      {
        id: "size",
        label: t("mods.rail.sortSize"),
        active: sort === "size",
        onSelect: () => {
          onSortChange("size");
          setSortMenu(null);
        },
      },
    ],
    [t, sort, onSortChange],
  );

  const openSortMenu = () => {
    const rect = sortBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSortMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className={`mods-rail${collapsed ? " is-collapsed" : ""}`}>
      <div className="mods-rail__head">
        {!collapsed && (
          <span className="mods-rail__title">
            <Boxes size={14} />
            {t("mods.gamesLibrary")}
            <span className="mods-rail__count">{totalGames}</span>
          </span>
        )}
        <div className="mods-rail__head-actions">
          <button
            type="button"
            className={`mods-rail__icon-btn${refreshing ? " is-spinning" : ""}`}
            onClick={onRefresh}
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
          >
            <RefreshCw size={13} />
          </button>
          <button
            type="button"
            className="mods-rail__icon-btn"
            onClick={onToggleCollapsed}
            title={collapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
            aria-label={collapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="mods-rail__search">
            <Search size={14} className="mods-rail__search-icon" />
            <input
              type="text"
              placeholder={t("mods.searchPlaceholder")}
              aria-label={t("mods.searchPlaceholder")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="mods-rail__search-clear"
                onClick={() => onSearchChange("")}
                title={t("common.clearSearch")}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="mods-rail__filters">
            <div className="mods-rail__chips" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={filter === "all"}
                className={`mods-rail__chip${filter === "all" ? " is-active" : ""}`}
                onClick={() => onFilterChange("all")}
              >
                {t("mods.rail.all")}
                <span className="mods-rail__chip-count">{totalGames}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === "modded"}
                className={`mods-rail__chip${filter === "modded" ? " is-active" : ""}`}
                onClick={() => onFilterChange("modded")}
              >
                <Gamepad2 size={12} />
                {t("mods.rail.modded")}
                <span className="mods-rail__chip-count">{moddedCount}</span>
              </button>
              {updatesCount > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "updates"}
                  className={`mods-rail__chip mods-rail__chip--updates${
                    filter === "updates" ? " is-active" : ""
                  }`}
                  onClick={() => onFilterChange("updates")}
                >
                  <ArrowUpCircle size={12} />
                  {t("mods.rail.updates")}
                  <span className="mods-rail__chip-count">{updatesCount}</span>
                </button>
              )}
            </div>

            <button
              ref={sortBtnRef}
              type="button"
              className="mods-rail__sort"
              onClick={openSortMenu}
              title={t("mods.sortBy")}
              aria-label={t("mods.sortBy")}
            >
              <Layers size={13} />
            </button>
          </div>
        </>
      )}

      {games.length === 0 ? (
        <div className="mods-rail__empty">
          <p>{t("mods.noGamesMatch")}</p>
          {(search || filter !== "all") && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                onFilterChange("all");
              }}
            >
              {t("common.clearSearch")}
            </button>
          )}
        </div>
      ) : (
        <div className="mods-rail__list">
          {games.map((g) => {
            const entry = overview.get(g.id);
            const modCount = entry?.total ?? 0;
            const enabled = entry?.enabled ?? 0;
            const updates = entry?.updates ?? 0;
            const size = formatStorage(entry?.totalSizeBytes ?? g.modsSizeBytes ?? 0);
            const isSelected = g.id === selectedGameId;
            const name = gameDisplayName(g);

            return (
              <button
                key={g.id}
                type="button"
                className={`mods-rail__row${isSelected ? " is-selected" : ""}${
                  modCount > 0 ? " has-mods" : ""
                }`}
                onClick={() => onSelect(g.id)}
                title={name}
              >
                <span className="mods-rail__cover">
                  {g.coverArtUrl ? (
                    <img src={g.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <span>{name.slice(0, 2).toUpperCase()}</span>
                  )}
                </span>

                {!collapsed && (
                  <span className="mods-rail__row-main">
                    <span className="mods-rail__name">{name}</span>
                    <span className="mods-rail__row-sub">
                      {modCount > 0 ? (
                        <>
                          <span className="mods-rail__mods">
                            {enabled > 0
                              ? t("mods.enabledCount", {
                                  enabled: String(enabled),
                                  total: String(modCount),
                                })
                              : t("mods.modsCount", { count: String(modCount) })}
                          </span>
                          {size && <span className="mods-rail__size">{size}</span>}
                        </>
                      ) : (
                        <span className="mods-rail__nomods">{t("mods.noModsYet")}</span>
                      )}
                    </span>
                  </span>
                )}

                {!collapsed && updates > 0 && (
                  <span className="mods-rail__updates" title={t("mods.updatesAvailable", { count: String(updates) })}>
                    <ArrowUpCircle size={12} />
                    {updates}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {sortMenu && (
        <ContextMenu
          x={sortMenu.x}
          y={sortMenu.y}
          items={sortItems}
          onClose={() => setSortMenu(null)}
          ariaLabel={t("mods.sortBy")}
        />
      )}
    </div>
  );
}
