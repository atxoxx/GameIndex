import { useCallback, useMemo, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Gamepad2,
  LayoutGrid,
  List,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import type { Emulator, DuplicateGroup } from "../../types/emulator";
import { formatBytesShort } from "../../types/download";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Button, ConfirmModal } from "../ui";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import {
  filterAndSortRoms,
  type RomSortDir,
  type RomSortKey,
} from "./emulatorUi";
import EmulatorRomBulkBar from "./EmulatorRomBulkBar";
import EmulatorRomGridView from "./EmulatorRomGridView";
import EmulatorRomTableView from "./EmulatorRomTableView";

type RomViewMode = "grid" | "table";

interface RomManagerProps {
  emulator: Emulator;
  accentColor: string;
  games: Game[];
  runningGameIds: string[];
  recalcId: string | null;
  scanning: boolean;
  onScan: () => void;
  onAddRom: () => void;
  onRecalcSizes: () => void;
  onLaunch: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
  onInspect: (game: Game) => void;
  onDeleteRoms: (ids: string[]) => void;
  onRomContextMenu: (e: React.MouseEvent, game: Game) => void;
}

function EmulatorRomManagerBase({
  emulator,
  accentColor,
  games,
  runningGameIds,
  recalcId,
  scanning,
  onScan,
  onAddRom,
  onRecalcSizes,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
  onInspect,
  onDeleteRoms,
  onRomContextMenu,
}: RomManagerProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<RomSortKey>("name");
  const [sortDir, setSortDir] = useState<RomSortDir>("asc");
  const [viewMode, setViewMode] = usePersistedState<RomViewMode>(
    "gamelib.emulators.rom_view_mode_v1",
    "grid",
    ["grid", "table"],
  );
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());

  // QoL filters: favorites only + region / language tags.
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [region, setRegion] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [findingDups, setFindingDups] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // "More" overflow menu, anchored to its trigger button.
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.romRegion) set.add(g.romRegion);
    return [...set].sort();
  }, [games]);

  const langOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.romLanguage) set.add(g.romLanguage);
    return [...set].sort();
  }, [games]);

  const filteredGames = useMemo(
    () =>
      filterAndSortRoms(
        games,
        {
          search,
          favoritesOnly,
          region,
          language,
        },
        sortKey,
        sortDir,
      ),
    [games, search, favoritesOnly, region, language, sortKey, sortDir],
  );

  const totalBytes = useMemo(
    () => filteredGames.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [filteredGames],
  );

  const selectedBytes = useMemo(
    () =>
      games
        .filter((g) => selectedGameIds.has(g.id))
        .reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [games, selectedGameIds],
  );

  const toggleSelectGame = (id: string) => {
    setSelectedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedGameIds.size === filteredGames.length && filteredGames.length > 0) {
      setSelectedGameIds(new Set());
    } else {
      setSelectedGameIds(new Set(filteredGames.map((g) => g.id)));
    }
  };

  const handleBulkLaunch = () => {
    for (const g of filteredGames) {
      if (selectedGameIds.has(g.id)) onLaunch(g);
    }
  };

  const handleBulkOpenLocations = () => {
    for (const g of filteredGames) {
      if (selectedGameIds.has(g.id) && g.romPath) onOpenLocation(g.romPath);
    }
  };

  const findDuplicates = useCallback(async () => {
    setFindingDups(true);
    try {
      const groups = await invoke<DuplicateGroup[]>("find_duplicate_roms", {
        emulatorId: emulator.id,
      });
      setDuplicates(groups);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setFindingDups(false);
    }
  }, [emulator.id, showToast]);

  const openMore = () => {
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
  };

  const moreItems: ContextMenuItem[] = useMemo(
    () => [
      {
        id: "recalc-sizes",
        label: t("emulators.games.recalc"),
        icon: <RefreshCw size={15} />,
        disabled: recalcId === emulator.id,
        onSelect: () => {
          setMoreMenu(null);
          onRecalcSizes();
        },
      },
      {
        id: "find-duplicates",
        label: findingDups
          ? t("emulators.duplicates.finding")
          : t("emulators.duplicates.find"),
        icon: <Copy size={15} />,
        disabled: findingDups,
        onSelect: () => {
          setMoreMenu(null);
          void findDuplicates();
        },
      },
    ],
    [t, recalcId, emulator.id, findingDups, onRecalcSizes, findDuplicates],
  );

  const sortOptions: Record<RomSortKey, string> = {
    name: t("emulators.sort.name"),
    size: t("emulators.games.size"),
    playtime: t("game.playTime"),
    dateAdded: t("emulators.sort.dateAdded"),
  };

  const recentGames = useMemo(() => {
    return games
      .filter((g) => g.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 6);
  }, [games]);

  const hasFilters = favoritesOnly || Boolean(region) || Boolean(language);

  return (
    <div className="emu-games">
      <div className="emu-games-head">
        <div className="emu-games-title-block">
          <h3 className="emu-games-title">
            {t("emulators.detail.gamesTitle")}
            <span className="emu-games-count">{filteredGames.length}</span>
            {totalBytes > 0 && (
              <span className="emu-games-total-pill">{formatBytesShort(totalBytes)}</span>
            )}
          </h3>
        </div>

        <div className="emu-games-toolbar">
          {/* ROM Search */}
          <div className="emulators-search-wrap emu-games-search">
            <Search className="emulators-search-icon" size={15} aria-hidden="true" />
            <input
              className="emulators-search"
              type="text"
              placeholder={t("emulators.games.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="emulators-search-clear"
                type="button"
                aria-label={t("emulators.list.clearSearch")}
                onClick={() => setSearch("")}
              >
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Sort selector + direction */}
          <div className="emu-games-sort-box">
            <select
              className="emulators-sort-select emu-games-sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as RomSortKey)}
            >
              {(Object.keys(sortOptions) as RomSortKey[]).map((k) => (
                <option key={k} value={k}>
                  {sortOptions[k]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="emulators-sort-dir"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
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
              {sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            </button>
          </div>

          {/* View mode toggle: grid vs table */}
          <div className="emu-view-toggle" role="group">
            <button
              type="button"
              className={`emu-view-btn${viewMode === "grid" ? " is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              title={t("emulators.games.gridView")}
              aria-label={t("emulators.games.gridView")}
            >
              <LayoutGrid size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`emu-view-btn${viewMode === "table" ? " is-active" : ""}`}
              onClick={() => setViewMode("table")}
              title={t("emulators.games.tableView")}
              aria-label={t("emulators.games.tableView")}
            >
              <List size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="emu-games-actions">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={onAddRom}
            >
              {t("emulators.games.addRom")}
            </Button>
            <button
              ref={moreBtnRef}
              type="button"
              className="emulators-sort-dir emu-games-more"
              onClick={openMore}
              title={t("emulators.actions.more")}
              aria-label={t("emulators.actions.more")}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* QoL filter bar: favorites, region, language */}
      <div className="emu-games-filters">
        <button
          type="button"
          className={`emu-filter-chip${favoritesOnly ? " is-active" : ""}`}
          onClick={() => setFavoritesOnly((v) => !v)}
          title={t("emulators.roms.favorite")}
          aria-pressed={favoritesOnly}
        >
          ★ {t("emulators.roms.favorite")}
        </button>
        {regionOptions.length > 0 && (
          <select
            className="emulators-sort-select emu-filter-select"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">
              {t("emulators.roms.region")}: {t("common.all")}
            </option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        {langOptions.length > 0 && (
          <select
            className="emulators-sort-select emu-filter-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">
              {t("emulators.roms.language")}: {t("common.all")}
            </option>
            {langOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button
            type="button"
            className="emu-filter-clear"
            onClick={() => {
              setFavoritesOnly(false);
              setRegion("");
              setLanguage("");
            }}
          >
            {t("common.clear")}
          </button>
        )}
      </div>

      {/* Continue-playing rail */}
      {recentGames.length > 0 && (
        <div className="emu-recent-rail">
          <h4 className="emu-recent-title">
            {t("emulators.recent.title")} · {t("emulators.recent.continue")}
          </h4>
          <div className="emu-recent-row">
            {recentGames.map((g) => (
              <div
                key={g.id}
                className="emu-recent-chip"
                role="button"
                tabIndex={0}
                onClick={() => onInspect(g)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onInspect(g);
                  }
                }}
                title={gameDisplayName(g)}
              >
                <span className="emu-recent-chip-name">{gameDisplayName(g)}</span>
                <span className="emu-recent-chip-time">
                  {new Date(g.lastPlayed ?? 0).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <button
                  type="button"
                  className="emu-recent-chip-launch emu-icon-btn"
                  title={t("emulators.games.launch")}
                  aria-label={t("emulators.games.launch")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLaunch(g);
                  }}
                >
                  <Play size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating bulk selection bar */}
      <EmulatorRomBulkBar
        selectedCount={selectedGameIds.size}
        totalBytes={selectedBytes}
        onLaunch={handleBulkLaunch}
        onOpenLocations={handleBulkOpenLocations}
        onDelete={() => setConfirmBulkDelete(true)}
        onClear={() => setSelectedGameIds(new Set())}
      />

      {/* Games content or empty state */}
      {filteredGames.length === 0 ? (
        <div className="emu-games-empty">
          <span className="emu-games-empty-glyph">
            <Gamepad2 size={40} aria-hidden="true" />
          </span>
          {search.trim() ? (
            <p>{t("emulators.games.none")}</p>
          ) : (
            <>
              <p>{t("emulators.detail.emptyGames")}</p>
              <p className="emu-games-empty-hint">
                {t("emulators.detail.emptyGamesHint")}
              </p>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<RefreshCw size={14} />}
                onClick={onScan}
                isLoading={scanning}
              >
                {scanning ? t("emulators.scanning") : t("emulators.scan")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={onAddRom}
              >
                {t("emulators.games.addRom")}
              </Button>
            </>
          )}
        </div>
      ) : viewMode === "grid" ? (
        <EmulatorRomGridView
          games={filteredGames}
          selectedGameIds={selectedGameIds}
          runningGameIds={runningGameIds}
          accentColor={accentColor}
          onToggleSelect={toggleSelectGame}
          onLaunch={onLaunch}
          onOpenLocation={onOpenLocation}
          onRename={onRename}
          onDelete={onDelete}
          onInspect={onInspect}
          onContextMenu={onRomContextMenu}
        />
      ) : (
        <EmulatorRomTableView
          games={filteredGames}
          selectedGameIds={selectedGameIds}
          runningGameIds={runningGameIds}
          totalSizeBytes={totalBytes}
          onToggleSelect={toggleSelectGame}
          onToggleSelectAll={toggleSelectAll}
          onLaunch={onLaunch}
          onOpenLocation={onOpenLocation}
          onRename={onRename}
          onDelete={onDelete}
          onInspect={onInspect}
          onContextMenu={onRomContextMenu}
        />
      )}

      {/* Duplicate ROMs modal */}
      {duplicates &&
        createPortal(
          <div
            className="modal-overlay emulators-modal-overlay"
            onMouseDown={() => setDuplicates(null)}
          >
            <div
              className="modal emulators-modal emu-dup-modal"
              role="dialog"
              aria-modal="true"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div className="modal-header-text">
                  <h2>{t("emulators.duplicates.title")}</h2>
                  <p className="modal-subtitle">
                    {duplicates.length === 0
                      ? t("emulators.duplicates.none")
                      : t("emulators.duplicates.groups", { count: duplicates.length })}
                  </p>
                </div>
                <Button variant="ghost" size="sm" iconOnly
                  
                  aria-label={t("common.close")}
                  onClick={() => setDuplicates(null)}
                 className="modal-close"> × </Button>
              </div>
              <div className="modal-body emu-dup-body">
                {duplicates.length === 0 ? (
                  <p className="emu-panel-hint">{t("emulators.duplicates.none")}</p>
                ) : (
                  duplicates.map((group) => (
                    <div key={group.hash} className="emu-dup-group">
                      <div className="emu-dup-group-head">
                        <span className="emu-mono">{group.hash}</span>
                        <span className="emu-dup-group-size">
                          {formatBytesShort(group.sizeBytes)}
                        </span>
                      </div>
                      {group.games.map((g) => (
                        <div key={g.id} className="emu-dup-game">
                          <span className="emu-dup-game-name">{gameDisplayName(g)}</span>
                          <span className="emu-mono emu-dup-game-path" title={g.romPath}>
                            {g.romPath}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className="modal-footer">
                <div className="modal-footer-actions">
                  <Button variant="ghost" onClick={() => setDuplicates(null)}>
                    {t("common.close")}
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Bulk delete confirmation */}
      <ConfirmModal
        open={confirmBulkDelete}
        title={`${t("emulators.games.deleteRom")}?`}
        message={t("emulators.games.bulkDeleteConfirm", {
          count: selectedGameIds.size,
        })}
        confirmLabel="emulators.games.deleteRom"
        onConfirm={() => {
          onDeleteRoms(Array.from(selectedGameIds));
          setSelectedGameIds(new Set());
          setConfirmBulkDelete(false);
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />

      {/* More menu (recalc sizes / find duplicates) */}
      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={moreItems}
          onClose={() => setMoreMenu(null)}
          ariaLabel={t("emulators.actions.more")}
        />
      )}
    </div>
  );
}

export default memo(EmulatorRomManagerBase);
