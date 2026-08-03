import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { Button, ConfirmModal, PageHeader } from "../components/ui";
import DensityToggle from "../components/DensityToggle";
import { DEFAULT_SORT, driveOf, sortGames, buildSections, gameTotalBytes, type GroupKey, type SortKey } from "./storage/utils";
import { formatSize } from "../types/game";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { BulkRecalcBar } from "./storage/BulkRecalcBar";
import { StorageHeader } from "./storage/StorageHeader";
import { StorageSortSelect } from "./storage/StorageSortSelect";
import { StorageRow } from "./storage/StorageRow";
import { StorageGroup } from "./storage/StorageGroup";
import { EmulatorStorageCard } from "./storage/EmulatorStorageCard";
import { MoveGameDialog } from "./storage/MoveGameDialog";
import { useStalePaths } from "./storage/useStalePaths";
import type { Game } from "../types/game";
import type { Emulator } from "../types/emulator";
import "./StoragePage.css";
import "../styles/page-storage.css";

/** Active list filter for the Storage tab. */
export type StorageFilter = "all" | "sized" | "missing" | "stale";

/** Top-level Storage view: a flat (groupable) game list, or a per-emulator
 *  breakdown of install + ROM footprints. */
type StorageView = "games" | "emulators";

/** Refactored Storage page — density-aware, searchable, themed, and now a
 *  real game *manager*: multi-select rows, batch move between drives, and
 *  uninstall with confirmation. Games can be reorganised into collapsible
 *  sections (by Platform / Emulator / Drive) and a dedicated Emulators view
 *  rolls every emulator's install folder + linked ROMs into one footprint. */
import { useBigScreen } from "../context/BigScreenContext";
import { useLanguage } from "../context/LanguageContext";
import BigScreenSystem from "../components/bigscreen/BigScreenSystem";

/** Best-effort parent directory of a file path (used to size an emulator's
 *  install folder from its executable). */
function parentDir(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? norm.slice(0, idx) : p;
}

/** refresh-cw icon used by the toolbar re-check action. */
const RefreshIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

/** check-square icon used by the selection-mode toggle. */
const SelectIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export default function StoragePage() {
  const { isBigScreen } = useBigScreen();
  const { t } = useLanguage();
  if (isBigScreen) {
    return <BigScreenSystem />;
  }
  const { games, updateGame, removeGame } = useGames();
  const { density, setDensity } = useDensityContext();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [driveFilter, setDriveFilter] = useState<string | null>(null);
  const [view, setView] = useState<StorageView>("games");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");

  // Selection / batch-management state.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveGames, setMoveGames] = useState<Game[] | null>(null);
  const [uninstallGames, setUninstallGames] = useState<Game[] | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  // Emulators (Emulators view).
  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [installBytes, setInstallBytes] = useState<Record<string, number | null>>({});
  const [measuringEmu, setMeasuringEmu] = useState<Set<string>>(new Set());

  // Storage is only meaningful for games actually installed on disk.
  const installedGames = useMemo(
    () => games.filter((g) => g.installed),
    [games]
  );

  const { staleMap, refresh, refreshAll } = useStalePaths(installedGames);
  const staleCount = useMemo(
    () =>
      Array.from(staleMap.values()).reduce((n, stale) => (stale ? n + 1 : n), 0),
    [staleMap]
  );

  // Drive filter narrows the cohort to a single volume bucket.
  const driveFilteredGames = useMemo(() => {
    if (!driveFilter) return installedGames;
    return installedGames.filter(
      (g) => g.sizeRootPath && driveOf(g.sizeRootPath) === driveFilter
    );
  }, [installedGames, driveFilter]);

  // Status filter (All / Sized / Missing / Stale) applied before search.
  const statusFilteredGames = useMemo(() => {
    switch (filter) {
      case "sized":
        return driveFilteredGames.filter(
          (g) => g.sizeBytes != null && g.sizeBytes > 0
        );
      case "missing":
        return driveFilteredGames.filter(
          (g) => g.sizeBytes == null || g.sizeBytes <= 0
        );
      case "stale":
        return driveFilteredGames.filter((g) => staleMap.get(g.id) === true);
      case "all":
      default:
        return driveFilteredGames;
    }
  }, [driveFilteredGames, filter, staleMap]);

  // Client-side name search filter.
  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statusFilteredGames;
    return statusFilteredGames.filter((g) =>
      g.name.toLowerCase().includes(q)
    );
  }, [statusFilteredGames, search]);

  const sortedGames = useMemo(
    () => sortGames(filteredGames, sort),
    [filteredGames, sort]
  );

  const unsizedCount = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0)
        .length,
    [installedGames]
  );

  const missingGames = useMemo(
    () =>
      installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0),
    [installedGames]
  );

  // Map of emulatorId -> display name (for grouping + "Other" fallback).
  const emuNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of emulators) m[e.id] = e.name;
    return m;
  }, [emulators]);

  // Build collapsible sections when grouping is active.
  const sections = useMemo(() => {
    if (groupBy === "none") return null;
    return buildSections(sortedGames, groupBy, (g) => {
      if (groupBy === "platform") return g.platform || t("storage.section.unknown");
      if (groupBy === "emulator")
        return g.emulatorId
          ? emuNameById[g.emulatorId] ?? t("storage.section.other")
          : t("storage.section.other");
      // drive
      const d = driveOf(g.sizeRootPath);
      return d === "Unknown" ? t("storage.section.unknown") : d;
    });
  }, [sortedGames, groupBy, emuNameById, t]);

  const handleRowSizeUpdated = useCallback(
    (gameId: string) => {
      void refresh(gameId);
    },
    [refresh]
  );

  const showingFiltered = search.trim().length > 0;

  // Re-check every measured path's existence on disk. Exposed via the toolbar
  // refresh button so the stale count updates on demand.
  const [refreshingPaths, setRefreshingPaths] = useState(false);
  const handleRefreshPaths = useCallback(() => {
    setRefreshingPaths(true);
    refreshAll();
    setTimeout(() => setRefreshingPaths(false), 600);
  }, [refreshAll]);

  const handleOpenFolder = useCallback(
    async (game: { sizeRootPath?: string; path?: string; name: string }) => {
      const target = game.sizeRootPath || game.path;
      if (!target) {
        showToast(t("storage.noFolderKnown", { name: game.name }), "info");
        return;
      }
      try {
        await invoke("open_folder", { path: target });
      } catch (err) {
        showToast(t("storage.couldNotOpenFolder", { error: err }), "error");
      }
    },
    [showToast, t]
  );

  // ── Selection helpers ────────────────────────────────────────────────
  const selectedGames = useMemo(
    () => installedGames.filter((g) => selected.has(g.id)),
    [installedGames, selected]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(sortedGames.map((g) => g.id)));
  }, [sortedGames]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // ── Move (single + batch) ─────────────────────────────────────────────
  const openMove = useCallback(
    (targets: Game[]) => {
      const movable = targets.filter((g) => g.sizeRootPath || g.path);
      if (movable.length === 0) {
        showToast(t("storage.selectToMove"), "info");
        return;
      }
      setMoveGames(movable);
    },
    [showToast, t]
  );

  const handleMoved = useCallback(
    (game: Game, toPath: string, newExe: string) => {
      updateGame(game.id, {
        path: newExe,
        sizeRootPath: toPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      void refresh(game.id);
    },
    [updateGame, refresh]
  );

  // ── Re-measure selected ───────────────────────────────────────────────
  const remeasureSelected = useCallback(async () => {
    const list = selectedGames.filter(
      (g) => g.path && g.path.trim() !== ""
    );
    if (list.length === 0) return;
    let done = 0;
    for (const g of list) {
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>(
          "detect_game_size",
          { exePath: g.path, gameName: g.name, rootOverride: null }
        );
        updateGame(g.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        done += 1;
      } catch (err) {
        console.error("re-measure failed for", g.name, err);
      }
    }
    showToast(t("storage.remeasured", { count: done, plural: done === 1 ? "" : "s" }), "success");
    refreshAll();
  }, [selectedGames, updateGame, showToast, refreshAll, t]);

  // ── Uninstall (single + batch) ───────────────────────────────────────
  const openUninstall = useCallback(
    (targets: Game[]) => {
      const removable = targets.filter((g) => g.sizeRootPath || g.path);
      if (removable.length === 0) {
        showToast(t("storage.selectToUninstall"), "info");
        return;
      }
      setUninstallGames(removable);
    },
    [showToast, t]
  );

  const confirmUninstall = useCallback(async () => {
    if (!uninstallGames) return;
    setUninstalling(true);
    let removed = 0;
    for (const g of uninstallGames) {
      const root = g.sizeRootPath || g.path;
      if (!root) {
        removeGame(g.id);
        removed += 1;
        continue;
      }
      try {
        await invoke("uninstall_game", { rootPath: root });
        removeGame(g.id);
        removed += 1;
      } catch (err) {
        showToast(t("storage.uninstallFailed", { name: g.name, error: err }), "error");
      }
    }
    setUninstalling(false);
    setUninstallGames(null);
    setSelected(new Set());
    setSelectMode(false);
    refreshAll();
    showToast(
      t("storage.uninstalled", { count: removed, plural: removed === 1 ? "" : "s" }),
      "success"
    );
  }, [uninstallGames, removeGame, showToast, refreshAll, t]);

  // ── Emulators view data ───────────────────────────────────────────────
  useEffect(() => {
    if (view !== "emulators") return;
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<Emulator[]>("list_emulators");
        if (!cancelled) setEmulators(list);
      } catch (err) {
        console.error("list_emulators failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);

  const emuRoms = useCallback(
    (emuId: string) => games.filter((g) => g.emulatorId === emuId),
    [games]
  );

  // Emulator-view summary stats: configured emulators, linked ROMs, and the
  // combined install + ROM footprint.
  const emuRomsList = useMemo(
    () => installedGames.filter((g) => g.emulatorId),
    [installedGames]
  );
  const emuTotalBytes = useMemo(() => {
    let total = 0;
    for (const e of emulators) total += installBytes[e.id] ?? 0;
    for (const g of emuRomsList) total += gameTotalBytes(g);
    return total;
  }, [emulators, installBytes, emuRomsList]);

  const measureEmulator = useCallback(
    async (emu: Emulator) => {
      if (!emu.executablePath) {
        setInstallBytes((prev) => ({ ...prev, [emu.id]: null }));
        return;
      }
      setMeasuringEmu((prev) => new Set(prev).add(emu.id));
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>(
          "measure_path_size",
          { path: parentDir(emu.executablePath) }
        );
        setInstallBytes((prev) => ({ ...prev, [emu.id]: result.sizeBytes }));
      } catch (err) {
        console.error("measure_path_size failed", err);
        setInstallBytes((prev) => ({ ...prev, [emu.id]: null }));
        showToast(t("storage.measureFailed", { name: emu.name, error: err }), "error");
      } finally {
        setMeasuringEmu((prev) => {
          const next = new Set(prev);
          next.delete(emu.id);
          return next;
        });
      }
    },
    [showToast, t]
  );

  return (
    <div className="storage-page page">
      {/* ── Page header + view switcher ─────────────────────────── */}
      <PageHeader
        eyebrow={t("storage.eyebrow")}
        title={t("storage.title")}
        description={t("storage.description")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
            <line x1="12" y1="6" x2="18" y2="6" />
            <line x1="12" y1="10" x2="15" y2="10" />
          </svg>
        }
        actions={
          <div className="storage__views" role="tablist" aria-label={t("storage.viewsAria")}>
            <button
              type="button"
              role="tab"
              aria-selected={view === "games"}
              className={`storage__view-tab${view === "games" ? " storage__view-tab--active" : ""}`}
              onClick={() => setView("games")}
            >
              {t("storage.view.games")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "emulators"}
              className={`storage__view-tab${view === "emulators" ? " storage__view-tab--active" : ""}`}
              onClick={() => setView("emulators")}
            >
              {t("storage.view.emulators")}
            </button>
          </div>
        }
      />

      {view === "games" ? (
        <>
          {/* ── Dashboard (totals · by platform · by drive) ───────── */}
          <StorageHeader
            games={installedGames}
            staleCount={staleCount}
            activeDrive={driveFilter}
            onDriveClick={(label) => setDriveFilter((cur) => (cur === label ? null : label))}
          />

          {/* ── Filters + toolbar (one unified control panel) ────── */}
          <div className="storage__controls">
            {/* Status filter chips + active drive chip + result count */}
            <div className="storage__controls-row">
              <div className="storage__filters" role="group" aria-label={t("storage.filterByStatus")}>
                {(
                  [
                    { key: "all", label: t("storage.all"), count: installedGames.length },
                    {
                      key: "sized",
                      label: t("storage.sized"),
                      count: installedGames.filter(
                        (g) => g.sizeBytes != null && g.sizeBytes > 0
                      ).length,
                    },
                    {
                      key: "missing",
                      label: t("storage.missing"),
                      count: unsizedCount,
                    },
                    { key: "stale", label: t("storage.stale"), count: staleCount },
                  ] as { key: StorageFilter; label: string; count: number }[]
                ).map(({ key, label, count }) => (
                  <button
                    key={key}
                    type="button"
                    className={`storage__filter-chip${
                      filter === key ? " storage__filter-chip--active" : ""
                    }`}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                    <span className="storage__filter-chip-count">{count}</span>
                  </button>
                ))}
              </div>
              {driveFilter && (
                <button
                  type="button"
                  className="storage__drive-chip"
                  onClick={() => setDriveFilter(null)}
                  aria-label={t("storage.clearDriveFilter", { drive: driveFilter })}
                  title={t("storage.clearDriveFilter", { drive: driveFilter })}
                >
                  {t("storage.driveLabel", { drive: driveFilter })}
                  <span className="storage__drive-chip-clear" aria-hidden>
                    {"×"}
                  </span>
                </button>
              )}
              <span className="storage__controls-count">
                {t("storage.gamesCount", { count: sortedGames.length, plural: sortedGames.length === 1 ? "" : "s" })}
                {(showingFiltered || filter !== "all" || driveFilter) &&
                  installedGames.length !== sortedGames.length &&
                  ` ${t("storage.ofTotal", { total: installedGames.length })}`}
                {!showingFiltered && filter === "all" && !driveFilter && unsizedCount > 0 &&
                  ` ${"·"} ${t("storageHeader.missingCount", { count: unsizedCount, plural: "" })}`}
              </span>
            </div>

            {/* Search + sort + group-by + density + actions */}
            <div className="storage__controls-row storage__controls-row--tools">
              <div className="storage__search">
                <svg className="storage__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  className="storage__search-input"
                  type="text"
                  placeholder={t("storage.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("storage.searchAria")}
                />
                {search && (
                  <button
                    type="button"
                    className="storage__search-clear"
                    onClick={() => setSearch("")}
                    aria-label={t("storage.clearSearch")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              <StorageSortSelect value={sort} onChange={setSort} />

              {/* Group-by segmented control */}
              <div className="storage__groupby" role="group" aria-label={t("storage.groupBy")}>
                {(["none", "platform", "emulator", "drive"] as GroupKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`storage__groupby-opt${groupBy === k ? " storage__groupby-opt--active" : ""}`}
                    aria-pressed={groupBy === k}
                    onClick={() => setGroupBy(k)}
                  >
                    {t(`storage.group.${k}`)}
                  </button>
                ))}
              </div>

              {/* Density toggle */}
              <div className="storage__density-group">
                <DensityToggle density={density} onChange={setDensity} />
              </div>

              {/* Actions: bulk recalc · re-check paths · selection mode */}
              <div className="storage__controls-actions">
                <BulkRecalcBar unsizedGames={missingGames} onComplete={refreshAll} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshPaths}
                  isLoading={refreshingPaths}
                  leftIcon={RefreshIcon}
                  title={t("storage.recheckTitle")}
                >
                  {t("common.refresh")}
                </Button>
                <Button
                  variant={selectMode ? "secondary" : "ghost"}
                  size="sm"
                  active={selectMode}
                  leftIcon={SelectIcon}
                  onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  title={t("storage.batchMoveTitle")}
                >
                  {t("storage.select")}
                </Button>
              </div>
            </div>
          </div>

          {/* ── Selection / batch toolbar ────────────────────────── */}
          {selectMode && (
            <div className="storage__batch-bar" role="toolbar" aria-label={t("storage.batchActions")}>
              <span className="storage__batch-count">
                {SelectIcon}
                {t("storage.selected", { count: selected.size })}
              </span>
              <div className="storage__batch-actions">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => openMove(selectedGames)}
                  disabled={selected.size === 0}
                >
                  {t("storage.move")}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => openUninstall(selectedGames)}
                  disabled={selected.size === 0}
                >
                  {t("storage.uninstall")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={remeasureSelected}
                  disabled={selected.size === 0}
                >
                  {t("storage.remeasure")}
                </Button>
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {t("storage.selectAll")}
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  {t("common.clear")}
                </Button>
              </div>
            </div>
          )}

          {/* ── Game list (flat or grouped) ──────────────────────── */}
          {sortedGames.length === 0 ? (
            <div className="storage__empty-state">
              <div className="storage__empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
                  <line x1="12" y1="6" x2="18" y2="6" />
                  <line x1="12" y1="10" x2="15" y2="10" />
                </svg>
              </div>
              <p className="storage__empty-state-title">
                {showingFiltered
                  ? t("storage.emptySearch")
                  : filter === "stale"
                    ? t("storage.emptyStale")
                    : filter === "missing"
                      ? t("storage.emptyMissing")
                      : filter === "sized"
                        ? t("storage.emptySized")
                        : driveFilter
                          ? t("storage.emptyDrive", { drive: driveFilter })
                          : installedGames.length === 0
                            ? t("storage.emptyNone")
                            : t("storage.emptySizedYet")}
              </p>
              <p className="storage__empty-state-subtitle">
                {showingFiltered
                  ? t("storage.hintSearch")
                  : installedGames.length === 0
                    ? t("storage.hintImport")
                    : driveFilter
                      ? t("storage.hintDrive")
                      : t("storage.hintMeasure")}
              </p>
              {showingFiltered && (
                <Button variant="ghost" onClick={() => setSearch("")}>
                  {t("storage.clearSearch")}
                </Button>
              )}
            </div>
          ) : sections ? (
            <ul className="storage__groups">
              {sections.map((s) => (
                <StorageGroup
                  key={s.key}
                  label={s.label}
                  games={s.games}
                  bytes={s.bytes}
                  density={density}
                  selectMode={selectMode}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onSizeUpdated={handleRowSizeUpdated}
                  onOpenFolder={handleOpenFolder}
                  onMove={(g) => openMove([g])}
                  onUninstall={(g) => openUninstall([g])}
                  staleMap={staleMap}
                />
              ))}
            </ul>
          ) : (
            <ul className={`storage__list density-${density}`}>
              {sortedGames.map((g) => (
                <StorageRow
                  key={g.id}
                  game={g}
                  stale={staleMap.get(g.id) === true}
                  density={density}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onToggleSelect={() => toggleSelect(g.id)}
                  onSizeUpdated={() => handleRowSizeUpdated(g.id)}
                  onOpenFolder={() => handleOpenFolder(g)}
                  onMove={() => openMove([g])}
                  onUninstall={() => openUninstall([g])}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {/* ── Emulators view: summary strip + per-emulator cards ── */}
          <div className="storage__emu-summary">
            <div className="storage__emu-stat">
              <span className="storage__emu-stat-value">{emulators.length}</span>
              <span className="storage__emu-stat-label">{t("storage.emuTracked")}</span>
            </div>
            <div className="storage__emu-stat">
              <span className="storage__emu-stat-value">{emuRomsList.length}</span>
              <span className="storage__emu-stat-label">{t("storage.emuRoms")}</span>
            </div>
            <div className="storage__emu-stat">
              <span className="storage__emu-stat-value">{formatSize(emuTotalBytes, unit)}</span>
              <span className="storage__emu-stat-label">{t("storage.emuTotalSize")}</span>
            </div>
          </div>

          {emulators.length === 0 ? (
            <div className="storage__empty-state">
              <div className="storage__empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M20.4 14.7 16.1 19l-1.8-1.8" />
                  <line x1="12" y1="6" x2="18" y2="6" />
                  <line x1="12" y1="10" x2="15" y2="10" />
                </svg>
              </div>
              <p className="storage__empty-state-title">{t("emulators.empty.title")}</p>
              <p className="storage__empty-state-subtitle">{t("emulators.empty.desc")}</p>
            </div>
          ) : (
            <ul className="storage__emu-list">
              {emulators.map((emu) => (
                <EmulatorStorageCard
                  key={emu.id}
                  emulator={emu}
                  roms={emuRoms(emu.id)}
                  installBytes={installBytes[emu.id]}
                  measuring={measuringEmu.has(emu.id)}
                  onMeasure={() => measureEmulator(emu)}
                  onOpenRomFolder={handleOpenFolder}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── Move dialog ───────────────────────────────────────── */}
      {moveGames && (
        <MoveGameDialog
          games={moveGames}
          onMoved={handleMoved}
          onClose={() => {
            setMoveGames(null);
            refreshAll();
          }}
        />
      )}

      {/* ── Uninstall confirmation ────────────────────────────── */}
      <ConfirmModal
        open={uninstallGames !== null}
        title={
          uninstallGames && uninstallGames.length === 1
            ? t("storage.uninstallTitle", { name: uninstallGames[0].name })
            : t("storage.uninstallTitleMulti", { count: uninstallGames?.length ?? 0 })
        }
        message={
          uninstallGames && uninstallGames.length === 1
            ? t("storage.uninstallBody")
            : t("storage.uninstallBodyMulti")
        }
        warning={t("storage.uninstallWarn")}
        confirmLabel={t("storage.uninstallLabel")}
        cancelLabel={t("common.cancel")}
        busy={uninstalling}
        onConfirm={confirmUninstall}
        onCancel={() => !uninstalling && setUninstallGames(null)}
      />
    </div>
  );
}
