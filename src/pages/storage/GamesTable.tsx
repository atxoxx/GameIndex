import { ArrowDown, ArrowUp, ChevronsUpDown, HardDrive } from "lucide-react";
import type { Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { GameRow } from "./GameRow";
import { StorageEmpty } from "./StorageEmpty";
import type { StorageSort, StorageSortColumn, TableColumn } from "./utils";

interface Props {
  games: Game[];
  staleMap: Map<string, boolean>;
  maxBytes: number;
  columns: Set<TableColumn>;
  sort: StorageSort;
  onSortChange: (column: StorageSortColumn) => void;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onSizeUpdated: (id: string) => void;
  onOpenFolder: (game: Game) => void;
  onMove: (game: Game) => void;
  onUninstall: (game: Game) => void;
  onLaunch: (game: Game) => void;
  emptyTitle: string;
  emptyDescription: string;
}

interface ColumnDef {
  key: StorageSortColumn | null;
  id: string;
  label: string;
  numeric?: boolean;
}

/**
 * GamesTable — the library as a real table.
 *
 * A sticky header and click-to-sort columns replace the sort dropdown, so the
 * control lives on the thing it changes. Rows stay lightweight; detail opens
 * inline (see `GameRow`).
 */
export function GamesTable({
  games,
  staleMap,
  maxBytes,
  columns,
  sort,
  onSortChange,
  selectMode,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  onSizeUpdated,
  onOpenFolder,
  onMove,
  onUninstall,
  onLaunch,
  emptyTitle,
  emptyDescription,
}: Props) {
  const { t } = useLanguage();

  const columnDefs: ColumnDef[] = [
    { key: "name", id: "name", label: t("storage.table.name") },
    ...(columns.has("platform")
      ? [{ key: "platform" as const, id: "platform", label: t("storage.columns.platform") }]
      : []),
    ...(columns.has("drive")
      ? [{ key: "drive" as const, id: "drive", label: t("storage.columns.drive") }]
      : []),
    { key: "size", id: "size", label: t("storage.columns.size"), numeric: true },
    ...(columns.has("mods")
      ? [{ key: "mods" as const, id: "mods", label: t("storage.columns.mods"), numeric: true }]
      : []),
    ...(columns.has("lastPlayed")
      ? [{ key: "lastPlayed" as const, id: "lastPlayed", label: t("storage.columns.lastPlayed") }]
      : []),
    ...(columns.has("measuredAt")
      ? [{ key: "measuredAt" as const, id: "measuredAt", label: t("storage.columns.measuredAt") }]
      : []),
  ];

  const head = (
    <tr>
      {selectMode && (
        <th className="gt-head gt-head--check" scope="col">
          <label className="gt-check">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={onToggleSelectAll}
              aria-label={t("storage.selectAll")}
            />
          </label>
        </th>
      )}
      {columnDefs.map((column) => {
        const active = column.key != null && sort.column === column.key;
        const direction = active ? sort.direction : null;
        const ariaSort = active
          ? direction === "asc"
            ? "ascending"
            : "descending"
          : "none";
        return (
          <th
            key={column.id}
            scope="col"
            className={[
              "gt-head",
              column.numeric ? "gt-head--num" : "",
              active ? "is-sorted" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-sort={ariaSort}
          >
            {column.key ? (
              <button
                type="button"
                className="gt-sort"
                onClick={() => onSortChange(column.key as StorageSortColumn)}
              >
                {column.label}
                <span className="gt-sort__icon" aria-hidden="true">
                  {direction === "asc" ? (
                    <ArrowUp />
                  ) : direction === "desc" ? (
                    <ArrowDown />
                  ) : (
                    <ChevronsUpDown />
                  )}
                </span>
              </button>
            ) : (
              column.label
            )}
          </th>
        );
      })}
      <th className="gt-head gt-head--chev" scope="col" aria-label={t("storage.table.actions")} />
    </tr>
  );

  if (games.length === 0) {
    return (
      <StorageEmpty
        icon={<HardDrive />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="games-table">
      <table className="gt">
        <thead className="gt-head-row">{head}</thead>
        <tbody>
          {games.map((game) => (
            <GameRow
              key={game.id}
              game={game}
              stale={staleMap.get(game.id) === true}
              maxBytes={maxBytes}
              columns={columns}
              selectMode={selectMode}
              selected={selected.has(game.id)}
              onToggleSelect={() => onToggleSelect(game.id)}
              onSizeUpdated={() => onSizeUpdated(game.id)}
              onOpenFolder={onOpenFolder}
              onMove={onMove}
              onUninstall={onUninstall}
              onLaunch={onLaunch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
