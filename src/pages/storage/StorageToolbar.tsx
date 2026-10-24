import { useEffect, useRef, useState } from "react";
import {
  Check,
  Columns3,
  Download,
  FileJson,
  FileSpreadsheet,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import {
  TABLE_COLUMNS,
  type StorageFilter,
  type TableColumn,
} from "./utils";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;

  filter: StorageFilter;
  onFilterChange: (filter: StorageFilter) => void;
  counts: Record<StorageFilter, number>;

  filteredCount: number;
  totalCount: number;

  columns: Set<TableColumn>;
  onToggleColumn: (column: TableColumn) => void;

  selectMode: boolean;
  onToggleSelectMode: () => void;

  isRefreshing: boolean;
  onRefreshPaths: () => void;

  onExportCsv: () => void;
  onExportJson: () => void;
}

/** The five chips that answer real questions. Size tiers stay available
 *  through the size column's sort rather than as three more chips. */
const CHIPS: { id: StorageFilter; label: (t: (key: string) => string) => string }[] = [
  { id: "all", label: (t) => t("storage.all") },
  { id: "sized", label: (t) => t("storage.sized") },
  { id: "missing", label: (t) => t("storage.missing") },
  { id: "stale", label: (t) => t("storage.stale") },
  { id: "hasMods", label: (t) => t("storage.filter.hasMods") },
];

/**
 * StorageToolbar — one row, one job each.
 *
 * Everything that used to compete for the same line (view switcher, group-by,
 * density, sort select, three export buttons) either moved to the rail, into a
 * table header, or behind the column/export popovers.
 */
export function StorageToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  counts,
  filteredCount,
  totalCount,
  columns,
  onToggleColumn,
  selectMode,
  onToggleSelectMode,
  isRefreshing,
  onRefreshPaths,
  onExportCsv,
  onExportJson,
}: Props) {
  const { t } = useLanguage();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!columnsOpen && !exportOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (columnsOpen && !columnsRef.current?.contains(target)) setColumnsOpen(false);
      if (exportOpen && !exportRef.current?.contains(target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [columnsOpen, exportOpen]);

  const narrowing = filteredCount !== totalCount;

  return (
    <div className="storage-toolbar">
      <div className="storage-toolbar__search">
        <Search className="storage-toolbar__search-icon" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          className="storage-toolbar__input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("storage.searchPlaceholder")}
          aria-label={t("storage.searchAria")}
        />
        {search ? (
          <button
            type="button"
            className="storage-toolbar__search-clear"
            onClick={() => onSearchChange("")}
            aria-label={t("storage.clearSearch")}
          >
            <X aria-hidden="true" />
          </button>
        ) : (
          <kbd className="storage-toolbar__kbd" aria-hidden="true">/</kbd>
        )}
      </div>

      <div className="storage-toolbar__chips" role="group" aria-label={t("storage.filterByStatus")}>
        {CHIPS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={`storage-chip${filter === id ? " is-active" : ""}`}
            aria-pressed={filter === id}
            onClick={() => onFilterChange(id)}
          >
            {label(t)}
            <span className="storage-chip__count">{counts[id] ?? 0}</span>
          </button>
        ))}
      </div>

      <span className="storage-toolbar__count">
        {narrowing
          ? t("storage.ofTotal", { used: filteredCount, total: totalCount })
          : t("storage.gamesCount", { count: filteredCount, plural: filteredCount === 1 ? "" : "s" })}
      </span>

      <div className="storage-toolbar__actions">
        <div className="storage-toolbar__popover-wrap" ref={columnsRef}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setColumnsOpen((open) => !open);
              setExportOpen(false);
            }}
            active={columnsOpen}
            leftIcon={<Columns3 />}
            title={t("storage.columns.button")}
          >
            {t("storage.columns.button")}
          </Button>
          {columnsOpen && (
            <div className="storage-popover" role="menu">
              <p className="storage-popover__label">{t("storage.columns.button")}</p>
              {TABLE_COLUMNS.map((column) => {
                const checked = columns.has(column);
                return (
                  <button
                    key={column}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    className={`storage-popover__item${checked ? " is-checked" : ""}`}
                    onClick={() => onToggleColumn(column)}
                  >
                    <span className="storage-popover__check">{checked && <Check aria-hidden="true" />}</span>
                    {t(`storage.columns.${column}`)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onRefreshPaths}
          isLoading={isRefreshing}
          leftIcon={<RefreshCw />}
          title={t("storage.recheckTitle")}
        >
          {t("common.refresh")}
        </Button>

        <Button
          variant={selectMode ? "secondary" : "ghost"}
          size="sm"
          onClick={onToggleSelectMode}
          active={selectMode}
          title={t("storage.batchMoveTitle")}
        >
          {t("storage.select")}
        </Button>

        <div className="storage-toolbar__popover-wrap" ref={exportRef}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setExportOpen((open) => !open);
              setColumnsOpen(false);
            }}
            active={exportOpen}
            leftIcon={<Download />}
            title={t("storage.batch.exportReport")}
          >
            {t("storage.export")}
          </Button>
          {exportOpen && (
            <div className="storage-popover storage-popover--end" role="menu">
              <button
                type="button"
                className="storage-popover__item"
                onClick={() => {
                  onExportCsv();
                  setExportOpen(false);
                }}
              >
                <FileSpreadsheet aria-hidden="true" />
                {t("storage.batch.exportCsv")}
              </button>
              <button
                type="button"
                className="storage-popover__item"
                onClick={() => {
                  onExportJson();
                  setExportOpen(false);
                }}
              >
                <FileJson aria-hidden="true" />
                {t("storage.batch.exportJson")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
