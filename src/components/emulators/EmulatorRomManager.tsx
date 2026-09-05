import { useMemo, useState, memo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import type { Emulator, DuplicateGroup } from "../../types/emulator";
import { formatBytesShort } from "../../types/download";
import { Button } from "../ui";
import EmulatorRomBulkBar from "./EmulatorRomBulkBar";
import EmulatorRomGridView from "./EmulatorRomGridView";
import EmulatorRomTableView from "./EmulatorRomTableView";

export type RomSortKey = "name" | "size" | "playtime" | "dateAdded";
export type RomViewMode = "grid" | "table";

interface RomManagerProps {
  emulator: Emulator;
  accentColor: string;
  games: Game[];
  runningGameIds: string[];
  recalcId: string | null;
  onAddRom: (emu: Emulator) => void;
  onRecalcSizes: (emu: Emulator) => void;
  onLaunch: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
  onInspect: (game: Game) => void;
  onBulkDelete: () => void;
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

function EmulatorRomManagerBase({
  emulator,
  accentColor,
  games,
  runningGameIds,
  recalcId,
  onAddRom,
  onRecalcSizes,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
  onInspect,
  onBulkDelete,
}: RomManagerProps) {
  const { t } = useLanguage();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<RomSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<RomViewMode>("grid");
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  // QoL filters: favorites only + region / language tags.
  const [favOnly, setFavOnly] = useState(false);
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [langFilter, setLangFilter] = useState<string>("");
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [findingDups, setFindingDups] = useState(false);

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

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = games.filter((g) => {
      if (q && !g.name.toLowerCase().includes(q)) return false;
      if (favOnly && !g.favorite) return false;
      if (regionFilter && g.romRegion !== regionFilter) return false;
      if (langFilter && g.romLanguage !== langFilter) return false;
      return true;
    });

    return [...list].sort((a, b) => {
      let res = 0;
      switch (sortKey) {
        case "size":
          res = (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0);
          break;
        case "playtime": {
          const parseH = (p?: string) => (p ? parseFloat(p) || 0 : 0);
          res = parseH(a.playTime) - parseH(b.playTime);
          break;
        }
        case "dateAdded":
          res = (a.addedAt ?? 0) - (b.addedAt ?? 0);
          break;
        case "name":
        default:
          res = a.name.localeCompare(b.name);
          break;
      }
      return sortDir === "desc" ? -res : res;
    });
  }, [games, search, sortKey, sortDir, favOnly, regionFilter, langFilter]);

  const totalBytes = useMemo(
    () => filteredGames.reduce((sum, g) => sum + (g.sizeBytes ?? 0), 0),
    [filteredGames]
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

  const sortOptions: Record<RomSortKey, string> = {
    name: t("emulators.sort.name"),
    size: t("emulators.games.size"),
    playtime: t("game.playTime"),
    dateAdded: t("emulators.sort.dateAdded"),
  };

  const findDuplicates = async () => {
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
  };

  const recentGames = useMemo(() => {
    return games
      .filter((g) => g.lastPlayed)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 6);
  }, [games]);

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

        {/* QoL filter bar: favorites, region, language */}
        {(favOnly || regionFilter || langFilter || regionOptions.length > 0 || langOptions.length > 0) && (
          <div className="emu-games-filters">
            <button
              type="button"
              className={`emu-filter-chip${favOnly ? " is-active" : ""}`}
              onClick={() => setFavOnly((v) => !v)}
              title={t("emulators.roms.favorite")}
            >
              ★ {t("emulators.roms.favorite")}
            </button>
            {regionOptions.length > 0 && (
              <select
                className="emulators-sort-select emu-filter-select"
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
              >
                <option value="">{t("emulators.roms.region")}: {t("common.all")}</option>
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
                value={langFilter}
                onChange={(e) => setLangFilter(e.target.value)}
              >
                <option value="">{t("emulators.roms.language")}: {t("common.all")}</option>
                {langOptions.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
            {(favOnly || regionFilter || langFilter) && (
              <button
                type="button"
                className="emu-filter-clear"
                onClick={() => {
                  setFavOnly(false);
                  setRegionFilter("");
                  setLangFilter("");
                }}
              >
                {t("common.clear")}
              </button>
            )}
          </div>
        )}

        <div className="emu-games-tools">
          {/* ROM Search */}
          <div className="emulators-search-wrap emu-games-search">
            <svg className="emulators-search-icon" {...ICON}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
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
                <svg {...ICON}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Sort selector */}
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

          {/* View Mode Toggle: Grid vs Table */}
          <div className="emu-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`emu-view-btn${viewMode === "grid" ? " is-active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid view"
              aria-label="Grid view"
            >
              <svg {...ICON}>
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              type="button"
              className={`emu-view-btn${viewMode === "table" ? " is-active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table view"
              aria-label="Table view"
            >
              <svg {...ICON}>
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>

          {/* Actions: Add ROM, Recalculate */}
          <div className="emu-games-actions">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              }
              onClick={() => onAddRom(emulator)}
            >
              {t("emulators.games.addRom")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
              }
              onClick={() => onRecalcSizes(emulator)}
              isLoading={recalcId === emulator.id}
            >
              {t("emulators.games.recalc")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              }
              onClick={findDuplicates}
              isLoading={findingDups}
            >
              {findingDups ? t("emulators.duplicates.finding") : t("emulators.duplicates.find")}
            </Button>
          </div>
        </div>
      </div>

      {/* Continue-playing rail */}
      {recentGames.length > 0 && (
        <div className="emu-recent-rail">
          <h4 className="emu-recent-title">
            {t("emulators.recent.title")} · {t("emulators.recent.continue")}
          </h4>
          <div className="emu-recent-row">
            {recentGames.map((g) => (
              <button
                key={g.id}
                type="button"
                className="emu-recent-chip"
                onClick={() => onInspect(g)}
                title={g.name}
              >
                <span className="emu-recent-chip-name">{g.name}</span>
                <span className="emu-recent-chip-time">
                  {new Date(g.lastPlayed ?? 0).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating Bulk Selection Bar */}
      <EmulatorRomBulkBar
        selectedCount={selectedGameIds.size}
        totalBytes={selectedBytes}
        onLaunch={handleBulkLaunch}
        onOpenLocations={handleBulkOpenLocations}
        onDelete={onBulkDelete}
        onClear={() => setSelectedGameIds(new Set())}
      />

      {/* Games content or empty state */}
      {filteredGames.length === 0 ? (
        <div className="emu-games-empty">
          <span className="emu-games-empty-glyph">🎮</span>
          {search ? (
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
                leftIcon={
                  <svg {...ICON}>
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                }
                onClick={() => onAddRom(emulator)}
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
        />
      )}

      {/* Duplicate ROMs modal */}
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
              <button className="modal-close" aria-label={t("common.close")} onClick={() => setDuplicates(null)}>
                ×
              </button>
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
                    {group.games.map((g) => (
                      <div key={g.id} className="emu-dup-game">
                        <span className="emu-dup-game-name">{g.name}</span>
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
        document.body
      )}
    </div>
  );
}

export default memo(EmulatorRomManagerBase);
