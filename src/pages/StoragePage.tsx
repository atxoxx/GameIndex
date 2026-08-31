import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useDensityContext } from "../context/DensityContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { ConfirmModal, PageHeader } from "../components/ui";
import {
  DEFAULT_SORT,
  driveOf,
  sortGames,
  buildSections,
  gameTotalBytes,
  getSizeTier,
  exportStorageReportCsv,
  exportStorageReportJson,
  type GroupKey,
  type SortKey,
} from "./storage/utils";
import { StorageHeroDashboard } from "./storage/StorageHeroDashboard";
import { StorageControlsBar, type StorageFilter, type StorageViewMode } from "./storage/StorageControlsBar";
import { StorageRow } from "./storage/StorageRow";
import { StorageGridCard } from "./storage/StorageGridCard";
import { StorageGroup } from "./storage/StorageGroup";
import { StorageCleanupAssistant } from "./storage/StorageCleanupAssistant";
import { StorageBatchBar } from "./storage/StorageBatchBar";
import { EmulatorStorageCard } from "./storage/EmulatorStorageCard";
import { MoveGameDialog } from "./storage/MoveGameDialog";
import { useStalePaths } from "./storage/useStalePaths";
import type { Game } from "../types/game";
import type { Emulator } from "../types/emulator";
import { formatSize } from "../types/game";
import "./StoragePage.css";
import "../styles/page-storage.css";

function parentDir(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? norm.slice(0, idx) : p;
}

export default function StoragePage() {
  const { t } = useLanguage();
  const { games, updateGame, removeGame, launchGame } = useGames();
  const { density } = useDensityContext();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  // Controls state
  const [viewMode, setViewMode] = useState<StorageViewMode>("list");
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [driveFilter, setDriveFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupKey>("none");

  // Selection & batch actions
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveGames, setMoveGames] = useState<Game[] | null>(null);
  const [uninstallGames, setUninstallGames] = useState<Game[] | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [isRemeasuringBatch, setIsRemeasuringBatch] = useState(false);

  // Emulators view state
  const [emulators, setEmulators] = useState<Emulator[]>([]);
  const [installBytes, setInstallBytes] = useState<Record<string, number | null>>({});
  const [measuringEmu, setMeasuringEmu] = useState<Set<string>>(new Set());

  // Installed games cohort
  const installedGames = useMemo(
    () => games.filter((g) => g.installed),
    [games]
  );

  // Staleness checking
  const { staleMap, refresh, refreshAll } = useStalePaths(installedGames);
  const staleCount = useMemo(
    () => Array.from(staleMap.values()).reduce((n, stale) => (stale ? n + 1 : n), 0),
    [staleMap]
  );

  // Drive filter
  const driveFilteredGames = useMemo(() => {
    if (!driveFilter) return installedGames;
    return installedGames.filter(
      (g) => g.sizeRootPath && driveOf(g.sizeRootPath) === driveFilter
    );
  }, [installedGames, driveFilter]);

  // Counts for filter chips
  const counts = useMemo(() => {
    let sized = 0;
    let missing = 0;
    let stale = 0;
    let hasMods = 0;
    let massive = 0;
    let large = 0;
    let small = 0;

    for (const g of driveFilteredGames) {
      const isSized = g.sizeBytes != null && g.sizeBytes > 0;
      const isStale = staleMap.get(g.id) === true;
      const tier = getSizeTier(g);

      if (isSized) sized++;
      else missing++;
      if (isStale) stale++;
      if ((g.modsSizeBytes ?? 0) > 0) hasMods++;
      if (tier === "massive") massive++;
      else if (tier === "large") large++;
      else if (tier === "small" || tier === "medium") small++;
    }

    return {
      all: driveFilteredGames.length,
      sized,
      missing,
      stale,
      hasMods,
      massive,
      large,
      small,
    };
  }, [driveFilteredGames, staleMap]);

  // Filter application
  const statusFilteredGames = useMemo(() => {
    switch (filter) {
      case "sized":
        return driveFilteredGames.filter((g) => g.sizeBytes != null && g.sizeBytes > 0);
      case "missing":
        return driveFilteredGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0);
      case "stale":
        return driveFilteredGames.filter((g) => staleMap.get(g.id) === true);
      case "hasMods":
        return driveFilteredGames.filter((g) => (g.modsSizeBytes ?? 0) > 0);
      case "massive":
        return driveFilteredGames.filter((g) => getSizeTier(g) === "massive");
      case "large":
        return driveFilteredGames.filter((g) => getSizeTier(g) === "large");
      case "small":
        return driveFilteredGames.filter((g) => {
          const t = getSizeTier(g);
          return t === "small" || t === "medium";
        });
      case "all":
      default:
        return driveFilteredGames;
    }
  }, [driveFilteredGames, filter, staleMap]);

  // Search filter
  const searchFilteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return statusFilteredGames;
    return statusFilteredGames.filter((g) => g.name.toLowerCase().includes(q));
  }, [statusFilteredGames, search]);

  // Sort
  const sortedGames = useMemo(
    () => sortGames(searchFilteredGames, sort),
    [searchFilteredGames, sort]
  );

  // Maximum size for relative bar comparison
  const maxBytes = useMemo(() => {
    let max = 0;
    for (const g of sortedGames) {
      const b = gameTotalBytes(g);
      if (b > max) max = b;
    }
    return max;
  }, [sortedGames]);

  // Missing games list for bulk wizard
  const missingGames = useMemo(
    () => installedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0),
    [installedGames]
  );

  // Map of emulatorId -> display name
  const emuNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of emulators) m[e.id] = e.name;
    return m;
  }, [emulators]);

  // Grouped sections
  const sections = useMemo(() => {
    if (groupBy === "none") return null;
    return buildSections(sortedGames, groupBy, (g) => {
      if (groupBy === "platform") return g.platform || t("storage.section.unknown");
      if (groupBy === "emulator")
        return g.emulatorId ? emuNameById[g.emulatorId] ?? t("storage.section.other") : t("storage.section.other");
      if (groupBy === "sizeTier") {
        const tier = getSizeTier(g);
        if (tier === "massive") return "> 50 GB";
        if (tier === "large") return "15 - 50 GB";
        if (tier === "medium") return "5 - 15 GB";
        if (tier === "small") return "< 5 GB";
        return t("storage.missing");
      }
      if (groupBy === "status") {
        if (staleMap.get(g.id) === true) return t("storage.stale");
        if (g.sizeBytes == null || g.sizeBytes <= 0) return t("storage.missing");
        return t("storage.sized");
      }
      // default: drive
      const d = driveOf(g.sizeRootPath);
      return d === "Unknown" ? t("storage.section.unknown") : d;
    });
  }, [sortedGames, groupBy, emuNameById, staleMap, t]);

  const handleRowSizeUpdated = useCallback(
    (gameId: string) => {
      void refresh(gameId);
    },
    [refresh]
  );

  // Refresh all paths on disk
  const [refreshingPaths, setRefreshingPaths] = useState(false);
  const handleRefreshPaths = useCallback(() => {
    setRefreshingPaths(true);
    refreshAll();
    setTimeout(() => setRefreshingPaths(false), 600);
  }, [refreshAll]);

  // Open file explorer
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

  // Selection actions
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

  const invertSelection = useCallback(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const g of sortedGames) {
        if (!prev.has(g.id)) next.add(g.id);
      }
      return next;
    });
  }, [sortedGames]);

  const selectStale = useCallback(() => {
    const staleIds = sortedGames.filter((g) => staleMap.get(g.id) === true).map((g) => g.id);
    setSelected(new Set(staleIds));
  }, [sortedGames, staleMap]);

  const selectMissing = useCallback(() => {
    const missingIds = sortedGames.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0).map((g) => g.id);
    setSelected(new Set(missingIds));
  }, [sortedGames]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  // Escape key exits select mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectMode) {
        exitSelectMode();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectMode, exitSelectMode]);

  // Move operations
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

  // Batch remeasure
  const handleBatchRemeasure = useCallback(async () => {
    const list = selectedGames.filter((g) => g.path && g.path.trim() !== "");
    if (list.length === 0) return;
    setIsRemeasuringBatch(true);
    let done = 0;
    for (const g of list) {
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: g.path,
          gameName: g.name,
          rootOverride: null,
        });
        updateGame(g.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        done++;
      } catch (err) {
        console.error("re-measure failed for", g.name, err);
      }
    }
    setIsRemeasuringBatch(false);
    showToast(t("storage.remeasured", { count: done, plural: done === 1 ? "" : "s" }), "success");
    refreshAll();
  }, [selectedGames, updateGame, showToast, refreshAll, t]);

  // Uninstall operations
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
        removed++;
        continue;
      }
      try {
        await invoke("uninstall_game", { rootPath: root });
        removeGame(g.id);
        removed++;
      } catch (err) {
        showToast(t("storage.uninstallFailed", { name: g.name, error: err }), "error");
      }
    }
    setUninstalling(false);
    setUninstallGames(null);
    setSelected(new Set());
    setSelectMode(false);
    refreshAll();
    showToast(t("storage.uninstalled", { count: removed, plural: removed === 1 ? "" : "s" }), "success");
  }, [uninstallGames, removeGame, showToast, refreshAll, t]);

  // Export report helpers
  const handleExportCsv = useCallback(async () => {
    const csv = exportStorageReportCsv(sortedGames, unit);
    try {
      await navigator.clipboard.writeText(csv);
      showToast(t("storage.batch.copiedReport"), "success");
    } catch {
      showToast("Could not copy CSV report", "error");
    }
  }, [sortedGames, unit, showToast, t]);

  const handleExportJson = useCallback(async () => {
    const json = exportStorageReportJson(sortedGames);
    try {
      await navigator.clipboard.writeText(json);
      showToast(t("storage.batch.copiedReport"), "success");
    } catch {
      showToast("Could not copy JSON report", "error");
    }
  }, [sortedGames, showToast, t]);

  // Emulators view data fetch
  useEffect(() => {
    if (viewMode !== "emulators") return;
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
  }, [viewMode]);

  const emuRoms = useCallback(
    (emuId: string) => games.filter((g) => g.emulatorId === emuId),
    [games]
  );

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
      {/* ── Page Header ────────────────────────────────────────────── */}
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
      />

      {/* ── Hero Analytics Dashboard ───────────────────────────────── */}
      <StorageHeroDashboard
        games={installedGames}
        staleCount={staleCount}
        activeDrive={driveFilter}
        onDriveClick={(label) => setDriveFilter((cur) => (cur === label ? null : label))}
        onNavigateToCleanup={() => setViewMode("cleanup")}
        onSelectGame={(g) => {
          setSearch(g.name);
          setViewMode("list");
        }}
      />

      {/* ── Unified Controls Bar ───────────────────────────────────── */}
      <StorageControlsBar
        allCount={counts.all}
        sizedCount={counts.sized}
        missingCount={counts.missing}
        staleCount={counts.stale}
        hasModsCount={counts.hasMods}
        massiveCount={counts.massive}
        largeCount={counts.large}
        smallCount={counts.small}
        filteredCount={sortedGames.length}
        activeFilter={filter}
        onFilterChange={setFilter}
        activeDrive={driveFilter}
        onClearDriveFilter={() => setDriveFilter(null)}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        unsizedGames={missingGames}
        onRecalcComplete={refreshAll}
        isRefreshingPaths={refreshingPaths}
        onRefreshPaths={handleRefreshPaths}
        selectMode={selectMode}
        onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
      />

      {/* ── Floating Batch Selection Dock ──────────────────────────── */}
      {selectMode && (viewMode === "list" || viewMode === "grid") && (
        <StorageBatchBar
          selectedGames={selectedGames}
          onSelectAll={selectAll}
          onInvertSelection={invertSelection}
          onSelectStale={selectStale}
          onSelectMissing={selectMissing}
          onClearSelection={clearSelection}
          onExitSelectMode={exitSelectMode}
          onMove={openMove}
          onUninstall={openUninstall}
          onRemeasure={handleBatchRemeasure}
          isRemeasuring={isRemeasuringBatch}
        />
      )}

      {/* ── View Mode: List or Grid ────────────────────────────────── */}
      {(viewMode === "list" || viewMode === "grid") && (
        <>
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
                {search.trim()
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
                {search.trim()
                  ? t("storage.hintSearch")
                  : installedGames.length === 0
                    ? t("storage.hintImport")
                    : driveFilter
                      ? t("storage.hintDrive")
                      : t("storage.hintMeasure")}
              </p>
            </div>
          ) : sections ? (
            <ul className="storage__groups">
              {sections.map((s) => (
                <StorageGroup
                  key={s.key}
                  label={s.label}
                  games={s.games}
                  bytes={s.bytes}
                  maxBytes={maxBytes}
                  density={density}
                  viewMode={viewMode}
                  selectMode={selectMode}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onSizeUpdated={handleRowSizeUpdated}
                  onOpenFolder={handleOpenFolder}
                  onMove={(g) => openMove([g])}
                  onUninstall={(g) => openUninstall([g])}
                  onLaunch={(g) => launchGame(g)}
                  staleMap={staleMap}
                />
              ))}
            </ul>
          ) : viewMode === "grid" ? (
            <div className={`storage__grid density-${density}`}>
              {sortedGames.map((g) => (
                <StorageGridCard
                  key={g.id}
                  game={g}
                  maxBytes={maxBytes}
                  stale={staleMap.get(g.id) === true}
                  density={density}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onToggleSelect={() => toggleSelect(g.id)}
                  onSizeUpdated={() => handleRowSizeUpdated(g.id)}
                  onOpenFolder={() => handleOpenFolder(g)}
                  onMove={() => openMove([g])}
                  onUninstall={() => openUninstall([g])}
                  onLaunch={() => launchGame(g)}
                />
              ))}
            </div>
          ) : (
            <ul className={`storage__list density-${density}`}>
              {sortedGames.map((g) => (
                <StorageRow
                  key={g.id}
                  game={g}
                  maxBytes={maxBytes}
                  stale={staleMap.get(g.id) === true}
                  density={density}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onToggleSelect={() => toggleSelect(g.id)}
                  onSizeUpdated={() => handleRowSizeUpdated(g.id)}
                  onOpenFolder={() => handleOpenFolder(g)}
                  onMove={() => openMove([g])}
                  onUninstall={() => openUninstall([g])}
                  onLaunch={() => launchGame(g)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* ── View Mode: Storage Cleanup Assistant ───────────────────── */}
      {viewMode === "cleanup" && (
        <StorageCleanupAssistant
          games={installedGames}
          staleMap={staleMap}
          onRefreshStale={refreshAll}
          onOpenFolder={handleOpenFolder}
          onMoveGame={(g) => openMove([g])}
          onUninstallGame={(g) => openUninstall([g])}
        />
      )}

      {/* ── View Mode: Emulators ───────────────────────────────────── */}
      {viewMode === "emulators" && (
        <div className="storage-emulators-view">
          <div className="storage__emu-summary">
            <div className="storage__emu-stat">
              <div className="storage__emu-stat-icon storage__emu-stat-icon--emu">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <line x1="6" y1="12" x2="10" y2="12" />
                  <line x1="8" y1="10" x2="8" y2="14" />
                  <circle cx="15" cy="13" r="1" />
                  <circle cx="18" cy="11" r="1" />
                </svg>
              </div>
              <div className="storage__emu-stat-content">
                <span className="storage__emu-stat-value">{emulators.length}</span>
                <span className="storage__emu-stat-label">{t("storage.emuTracked")}</span>
              </div>
            </div>

            <div className="storage__emu-stat">
              <div className="storage__emu-stat-icon storage__emu-stat-icon--roms">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                </svg>
              </div>
              <div className="storage__emu-stat-content">
                <span className="storage__emu-stat-value">{emuRomsList.length}</span>
                <span className="storage__emu-stat-label">{t("storage.emuRoms")}</span>
              </div>
            </div>

            <div className="storage__emu-stat storage__emu-stat--primary">
              <div className="storage__emu-stat-icon storage__emu-stat-icon--size">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                  <path d="M3 12a9 9 0 0 0 18 0" />
                </svg>
              </div>
              <div className="storage__emu-stat-content">
                <span className="storage__emu-stat-value">{formatSize(emuTotalBytes, unit)}</span>
                <span className="storage__emu-stat-label">{t("storage.emuTotalSize")}</span>
              </div>
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
        </div>
      )}

      {/* ── Relocate Game Modal ────────────────────────────────────── */}
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

      {/* ── Uninstall Game Modal ──────────────────────────────────── */}
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
