// ROM browser for the workbench: filter bar, grid/table switch and the
// multi-disc grouping that keeps one card per game instead of one per disc.
// Selection lives in the page (the inspector is a sibling column), so this
// component only reports which ROM the user pointed at.

import { useCallback, useMemo, useRef, useState } from "react";
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
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import type { DuplicateGroup, Emulator } from "../../types/emulator";
import { formatBytesShort } from "../../types/download";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Button, ConfirmModal } from "../ui";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import {
  filterAndSortRoms,
  groupMultiDiscRoms,
  type RomSortDir,
  type RomSortKey,
} from "./emulatorUi";
import EmulatorRomBulkBar from "./EmulatorRomBulkBar";
import EmulatorRomGridView from "./EmulatorRomGridView";
import EmulatorRomTableView from "./EmulatorRomTableView";

type RomViewMode = "grid" | "table";

interface RomBrowserProps {
  emulator: Emulator;
  accentColor: string;
  glyph: string;
  logo?: string;
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

export default function EmulatorRomBrowser({
  emulator,
  accentColor,
  glyph,
  logo,
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
}: RomBrowserProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<RomSortKey>("name");
  const [sortDir, setSortDir] = useState<RomSortDir>("asc");
  const [viewMode, setViewMode] = usePersistedState<RomViewMode>(
    "gamelib.emulators.rom_view_mode_v1",
    "grid",
    ["grid", "table"]
  );
  const [groupMode, setGroupMode] = usePersistedState<"grouped" | "all">(
    "gamelib.emulators.group_discs_v1",
    "grouped",
    ["grouped", "all"]
  );
  const groupDiscs = groupMode === "grouped";
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [region, setRegion] = useState("");
  const [language, setLanguage] = useState("");
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [findingDups, setFindingDups] = useState(false);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

  const regionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.romRegion) set.add(g.romRegion);
    return [...set].sort();
  }, [games]);

  const languageOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) if (g.romLanguage) set.add(g.romLanguage);
    return [...set].sort();
  }, [games]);

  const filtered = useMemo(
    () =>
      filterAndSortRoms(
        games,
        { search, favoritesOnly, region, language },
        sortKey,
        sortDir
      ),
    [games, search, favoritesOnly, region, language, sortKey, sortDir]
  );

  const grouped = useMemo(
    () => (groupDiscs ? groupMultiDiscRoms(filtered) : null),
    [filtered, groupDiscs]
  );

  const displayGames = grouped ? grouped.games : filtered;
  const totalBytes = useMemo(
    () => filtered.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [filtered]
  );

  const selectedBytes = useMemo(
    () =>
      games
        .filter((g) => selectedGameIds.has(g.id))
        .reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [games, selectedGameIds]
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
    if (selectedGameIds.size === displayGames.length && displayGames.length > 0) {
      setSelectedGameIds(new Set());
    } else {
      setSelectedGameIds(new Set(displayGames.map((g) => g.id)));
    }
  };

  const selectedGames = useMemo(
    () => games.filter((g) => selectedGameIds.has(g.id)),
    [games, selectedGameIds]
  );

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
        label: findingDups ? t("emulators.duplicates.finding") : t("emulators.duplicates.find"),
        icon: <Copy size={15} />,
        disabled: findingDups,
        onSelect: () => {
          setMoreMenu(null);
          void findDuplicates();
        },
      },
    ],
    [t, recalcId, emulator.id, findingDups, onRecalcSizes, findDuplicates]
  );

  const sortOptions: Record<RomSortKey, string> = {
    name: t("emulators.sort.name"),
    size: t("emulators.games.size"),
    playtime: t("game.playTime"),
    dateAdded: t("emulators.sort.dateAdded"),
  };

  const hasFilters = favoritesOnly || Boolean(region) || Boolean(language);

  return (
    <div className="emu-wb-browser">
      <div className="emu-wb-browser-head">
        <div className="emu-wb-browser-title">
          <h3>{t("emulators.detail.gamesTitle")}</h3>
          <span className="emu-wb-browser-count">{displayGames.length}</span>
          {totalBytes > 0 && <span className="emu-wb-browser-size">{formatBytesShort(totalBytes)}</span>}
        </div>

        <div className="emu-wb-browser-actions">
          <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={onAddRom}>
            {t("emulators.games.addRom")}
          </Button>
          <button
            ref={moreRef}
            type="button"
            className="emu-wb-icon-btn"
            title={t("emulators.actions.more")}
            aria-label={t("emulators.actions.more")}
            onClick={() => {
              const rect = moreRef.current?.getBoundingClientRect();
              if (rect) setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
            }}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div className="emu-wb-browser-controls">
        <div className="emu-wb-search emu-wb-search--grow">
          <Search size={14} className="emu-wb-search-icon" aria-hidden />
          <input
            type="search"
            value={search}
            placeholder={t("emulators.games.search")}
            aria-label={t("emulators.games.search")}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="emu-wb-search-clear"
              onClick={() => setSearch("")}
              aria-label={t("emulators.list.clearSearch")}
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`emu-wb-chip${favoritesOnly ? " is-active" : ""}`}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((v) => !v)}
          title={t("emulators.roms.favorite")}
        >
          ★ {t("emulators.roms.favorite")}
        </button>

        {regionOptions.length > 0 && (
          <select
            className="emu-wb-select"
            value={region}
            aria-label={t("emulators.roms.region")}
            onChange={(e) => setRegion(e.target.value)}
          >
            <option value="">{t("emulators.roms.region")}: {t("common.all")}</option>
            {regionOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}

        {languageOptions.length > 0 && (
          <select
            className="emu-wb-select"
            value={language}
            aria-label={t("emulators.roms.language")}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">{t("emulators.roms.language")}: {t("common.all")}</option>
            {languageOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button
            type="button"
            className="emu-wb-chip"
            onClick={() => {
              setFavoritesOnly(false);
              setRegion("");
              setLanguage("");
            }}
          >
            {t("common.clear")}
          </button>
        )}

        <div className="emu-wb-sort">
          <select
            className="emu-wb-select"
            value={sortKey}
            aria-label={t("mods.sortBy")}
            onChange={(e) => setSortKey(e.target.value as RomSortKey)}
          >
            {(Object.keys(sortOptions) as RomSortKey[]).map((key) => (
              <option key={key} value={key}>{sortOptions[key]}</option>
            ))}
          </select>
          <button
            type="button"
            className="emu-wb-icon-btn"
            title={sortDir === "asc" ? t("emulators.sort.ascending") : t("emulators.sort.descending")}
            aria-label={sortDir === "asc" ? t("emulators.sort.ascending") : t("emulators.sort.descending")}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          >
            {sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>

        <div className="emu-wb-view" role="group">
          <button
            type="button"
            className={`emu-wb-icon-btn${viewMode === "grid" ? " is-active" : ""}`}
            title={t("emulators.games.gridView")}
            aria-label={t("emulators.games.gridView")}
            aria-pressed={viewMode === "grid"}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            className={`emu-wb-icon-btn${viewMode === "table" ? " is-active" : ""}`}
            title={t("emulators.games.tableView")}
            aria-label={t("emulators.games.tableView")}
            aria-pressed={viewMode === "table"}
            onClick={() => setViewMode("table")}
          >
            <List size={14} />
          </button>
        </div>

        {viewMode === "grid" && (
          <button
            type="button"
            className={`emu-wb-chip${groupDiscs ? " is-active" : ""}`}
            aria-pressed={groupDiscs}
            onClick={() => setGroupMode(groupDiscs ? "all" : "grouped")}
            title={t("emulators.roms.groupDiscsHint")}
          >
            {t("emulators.roms.groupDiscs")}
          </button>
        )}
      </div>

      <EmulatorRomBulkBar
        selectedCount={selectedGameIds.size}
        totalBytes={selectedBytes}
        onLaunch={() => {
          for (const game of selectedGames) onLaunch(game);
        }}
        onOpenLocations={() => {
          for (const game of selectedGames) {
            if (game.romPath) onOpenLocation(game.romPath);
          }
        }}
        onDelete={() => setConfirmBulkDelete(true)}
        onClear={() => setSelectedGameIds(new Set())}
      />

      {filtered.length === 0 ? (
        <div className="emu-wb-empty">
          <span className="emu-wb-empty-glyph" aria-hidden>
            <Gamepad2 size={34} />
          </span>
          {search.trim() ? (
            <p>{t("emulators.games.none")}</p>
          ) : (
            <>
              <p>{t("emulators.detail.emptyGames")}</p>
              <p className="emu-wb-empty-hint">{t("emulators.detail.emptyGamesHint")}</p>
              <div className="emu-wb-empty-actions">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<RefreshCw size={14} />}
                  onClick={onScan}
                  isLoading={scanning}
                >
                  {scanning ? t("emulators.scanning") : t("emulators.scan")}
                </Button>
                <Button variant="secondary" size="sm" leftIcon={<Plus size={14} />} onClick={onAddRom}>
                  {t("emulators.games.addRom")}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : viewMode === "grid" ? (
        <EmulatorRomGridView
          games={displayGames}
          selectedGameIds={selectedGameIds}
          runningGameIds={runningGameIds}
          accentColor={accentColor}
          glyph={glyph}
          logo={logo}
          discCounts={grouped?.discCounts}
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
          games={filtered}
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

      {moreMenu && (
        <ContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={moreItems}
          onClose={() => setMoreMenu(null)}
          ariaLabel={t("emulators.actions.more")}
        />
      )}

      {duplicates &&
        createPortal(
          <div className="modal-overlay emulators-modal-overlay" onMouseDown={() => setDuplicates(null)}>
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
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={t("common.close")}
                  onClick={() => setDuplicates(null)}
                  className="modal-close"
                >
                  ×
                </Button>
              </div>
              <div className="modal-body emu-dup-body">
                {duplicates.length === 0 ? (
                  <p className="emu-panel-hint">{t("emulators.duplicates.none")}</p>
                ) : (
                  duplicates.map((group) => (
                    <div key={group.hash} className="emu-dup-group">
                      <div className="emu-dup-group-head">
                        <span className="emu-mono">{group.hash}</span>
                        <span className="emu-dup-group-size">{formatBytesShort(group.sizeBytes)}</span>
                      </div>
                      {group.games.map((game) => (
                        <div key={game.id} className="emu-dup-game">
                          <span className="emu-dup-game-name">{game.name}</span>
                          <span className="emu-mono emu-dup-game-path" title={game.romPath}>
                            {game.romPath}
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
          document.body
        )}

      <ConfirmModal
        open={confirmBulkDelete}
        title={`${t("emulators.games.deleteRom")}?`}
        message={t("emulators.games.bulkDeleteConfirm", { count: selectedGameIds.size })}
        confirmLabel="emulators.games.deleteRom"
        onConfirm={() => {
          onDeleteRoms(Array.from(selectedGameIds));
          setSelectedGameIds(new Set());
          setConfirmBulkDelete(false);
        }}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
