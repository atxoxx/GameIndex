import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Gamepad2,
  HardDrive,
  LayoutDashboard,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSizeUnit } from "../hooks/useSizeUnit";
import { usePersistedState } from "../hooks/usePersistedState";
import PageWidget from "../components/PageWidget";
import { ConfirmModal, PageHeader, SubTabs } from "../components/ui";
import type { Game } from "../types/game";
import { gameDisplayName } from "../types/game";

import {
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  STORAGE_TABS,
  driveBuckets,
  driveOf,
  exportStorageReportCsv,
  exportStorageReportJson,
  gameTotalBytes,
  matchesStorageFilter,
  nextSort,
  parseSort,
  serializeSort,
  sortGamesByColumn,
  totalBytesWithMods,
  SORT_OPTION_VALUES,
  type StorageFilter,
  type StorageSort,
  type StorageSortColumn,
  type StorageTab,
  type TableColumn,
} from "./storage/utils";
import {
  buildRecommendations,
  type Recommendation,
  type RecommendationId,
} from "./storage/recommendations";
import { useDriveUsage } from "./storage/useDriveUsage";
import { useMountVersion } from "./storage/mounts";
import { useStalePaths } from "./storage/useStalePaths";
import { useStorageHistory } from "./storage/useStorageHistory";
import { useLeftoverScan } from "./storage/useLeftoverScan";
import { StorageStatBand } from "./storage/StorageStatBand";
import { StorageOverview } from "./storage/StorageOverview";
import { DriveRail } from "./storage/DriveRail";
import { DriveSheet } from "./storage/DriveSheet";
import { StorageToolbar } from "./storage/StorageToolbar";
import { GamesTable } from "./storage/GamesTable";
import { RecommendationStrip } from "./storage/RecommendationStrip";
import { StorageEmulatorsTab } from "./storage/StorageEmulatorsTab";
import { StorageBatchBar } from "./storage/StorageBatchBar";
import { MoveGameDialog } from "./storage/MoveGameDialog";
import { LibraryHealthCenter } from "./storage/LibraryHealthCenter";
import "./StoragePage.css";

const DISMISS_KEY = "gamelib.storage.recs.dismissed_v1";

/** Sentinel that hides the whole recommendation strip. */
const STRIP_SENTINEL = "__strip__";

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(ids));
  } catch {
    /* localStorage may be unavailable; dismissal is a nicety, not state. */
  }
}

/**
 * Storage — one page, four views, one shared vocabulary.
 *
 * Overview answers "where did my disk go", Games is the working table,
 * Health is the maintenance centre and Emulators covers ROM libraries. The
 * drive rail filters the table without leaving the view, and the drive sheet
 * drills into a single volume.
 */
export default function StoragePage() {
  const { t } = useLanguage();
  const { games, updateGame, removeGame, launchGame } = useGames();
  const { showToast } = useToast();
  const { unit } = useSizeUnit();

  // ── View state ────────────────────────────────────────────────────────
  const [tab, setTab] = usePersistedState<StorageTab>(
    "gamelib.storage.tab_v3",
    "games",
    STORAGE_TABS,
  );
  const [sortRaw, setSortRaw] = usePersistedState(
    "gamelib.storage.sort_v2",
    serializeSort(DEFAULT_SORT),
    SORT_OPTION_VALUES,
  );
  const sort = useMemo<StorageSort>(() => parseSort(sortRaw), [sortRaw]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StorageFilter>("all");
  const [driveFilter, setDriveFilter] = useState<string | null>(null);
  const [columns, setColumns] = useState<Set<TableColumn>>(() => new Set(DEFAULT_COLUMNS));
  const [sheetDrive, setSheetDrive] = useState<string | null>(null);

  // ── Selection & batch actions ─────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveGames, setMoveGames] = useState<Game[] | null>(null);
  const [uninstallGames, setUninstallGames] = useState<Game[] | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [batchRemeasuring, setBatchRemeasuring] = useState(false);

  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  // ── Data ──────────────────────────────────────────────────────────────
  const installedGames = useMemo(() => games.filter((game) => game.installed), [games]);
  const { staleMap, refresh, refreshAll, checking: checkingPaths } = useStalePaths(installedGames);
  const mountVersion = useMountVersion();
  const driveUsage = useDriveUsage(installedGames);

  const staleCount = useMemo(() => {
    let count = 0;
    for (const stale of staleMap.values()) if (stale) count += 1;
    return count;
  }, [staleMap]);

  const drives = useMemo(() => driveBuckets(installedGames), [installedGames, mountVersion]);
  const totalBytes = useMemo(() => totalBytesWithMods(installedGames), [installedGames]);

  const history = useStorageHistory({ totalBytes, gameCount: installedGames.length });
  const leftover = useLeftoverScan(installedGames);

  // ── Filtering pipeline ────────────────────────────────────────────────
  const counts = useMemo<Record<StorageFilter, number>>(() => {
    const base: Record<StorageFilter, number> = {
      all: installedGames.length,
      sized: 0,
      missing: 0,
      stale: 0,
      hasMods: 0,
      massive: 0,
      large: 0,
      small: 0,
    };
    for (const game of installedGames) {
      for (const key of Object.keys(base) as StorageFilter[]) {
        if (key === "all") continue;
        if (matchesStorageFilter(game, key, staleMap.get(game.id) === true)) base[key] += 1;
      }
    }
    return base;
  }, [installedGames, staleMap]);

  const filteredGames = useMemo(() => {
    const query = search.trim().toLowerCase();
    return installedGames.filter((game) => {
      if (driveFilter && driveOf(game.sizeRootPath) !== driveFilter) return false;
      if (!matchesStorageFilter(game, filter, staleMap.get(game.id) === true)) return false;
      if (query) {
        const name = (game.displayName || game.name).toLowerCase();
        if (!name.includes(query)) return false;
      }
      return true;
    });
  }, [installedGames, driveFilter, filter, search, staleMap]);

  const sortedGames = useMemo(() => sortGamesByColumn(filteredGames, sort), [filteredGames, sort]);

  const maxBytes = useMemo(
    () => sortedGames.reduce((max, game) => Math.max(max, gameTotalBytes(game)), 0),
    [sortedGames],
  );

  // ── Recommendations ───────────────────────────────────────────────────
  const recommendations = useMemo(
    () =>
      buildRecommendations({
        games: installedGames,
        staleMap,
        driveUsage,
        leftover: leftover.folders ? leftover.totals : null,
      }),
    [installedGames, staleMap, driveUsage, leftover.folders, leftover.totals],
  );

  const visibleRecommendations = useMemo(() => {
    if (dismissed.includes(STRIP_SENTINEL)) return [];
    return recommendations.filter((rec) => !dismissed.includes(rec.id));
  }, [recommendations, dismissed]);

  // Forget dismissals for problems that no longer exist, so the strip comes
  // back if the same issue reappears later.
  useEffect(() => {
    const live = new Set(recommendations.map((rec) => rec.id as string));
    setDismissed((prev) => {
      const next = prev.filter((id) => id === STRIP_SENTINEL || live.has(id));
      if (next.length === prev.length) return prev;
      writeDismissed(next);
      return next;
    });
  }, [recommendations]);

  const dismissRecommendation = useCallback((id: RecommendationId) => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, id])];
      writeDismissed(next);
      return next;
    });
  }, []);

  const dismissStrip = useCallback(() => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, STRIP_SENTINEL])];
      writeDismissed(next);
      return next;
    });
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────
  const openFolder = useCallback(
    async (game: { sizeRootPath?: string; path?: string; name: string; displayName?: string }) => {
      const target = game.sizeRootPath || game.path;
      if (!target) {
        showToast(t("storage.noFolderKnown", { name: gameDisplayName(game) }), "info");
        return;
      }
      try {
        await invoke("open_folder", { path: target });
      } catch (err) {
        showToast(t("storage.couldNotOpenFolder", { error: String(err) }), "error");
      }
    },
    [showToast, t],
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        await invoke("open_folder", { path });
      } catch (err) {
        showToast(t("storage.couldNotOpenFolder", { error: String(err) }), "error");
      }
    },
    [showToast, t],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(
    () => setSelected(new Set(sortedGames.map((game) => game.id))),
    [sortedGames],
  );

  const invertSelection = useCallback(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      for (const game of sortedGames) if (!prev.has(game.id)) next.add(game.id);
      return next;
    });
  }, [sortedGames]);

  const selectStale = useCallback(() => {
    setSelected(new Set(sortedGames.filter((g) => staleMap.get(g.id) === true).map((g) => g.id)));
  }, [sortedGames, staleMap]);

  const selectMissing = useCallback(() => {
    setSelected(
      new Set(
        sortedGames.filter((g) => (g.sizeBytes ?? 0) <= 0).map((g) => g.id),
      ),
    );
  }, [sortedGames]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!selectMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitSelectMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectMode, exitSelectMode]);

  const openMove = useCallback(
    (targets: Game[]) => {
      const movable = targets.filter((game) => game.sizeRootPath || game.path);
      if (movable.length === 0) {
        showToast(t("storage.selectToMove"), "info");
        return;
      }
      setMoveGames(movable);
    },
    [showToast, t],
  );

  const openUninstall = useCallback(
    (targets: Game[]) => {
      const removable = targets.filter((game) => game.sizeRootPath || game.path);
      if (removable.length === 0) {
        showToast(t("storage.selectToUninstall"), "info");
        return;
      }
      setUninstallGames(removable);
    },
    [showToast, t],
  );

  const confirmUninstall = useCallback(async () => {
    if (!uninstallGames) return;
    setUninstalling(true);
    const freedBytes = uninstallGames.reduce((sum, game) => sum + gameTotalBytes(game), 0);
    let removed = 0;
    for (const game of uninstallGames) {
      const root = game.sizeRootPath || game.path;
      if (!root) {
        removeGame(game.id);
        removed += 1;
        continue;
      }
      try {
        await invoke("uninstall_game", { rootPath: root });
        removeGame(game.id);
        removed += 1;
      } catch (err) {
        showToast(t("storage.uninstallFailed", { name: gameDisplayName(game), error: String(err) }), "error");
      }
    }
    if (removed > 0) {
      await history.record({
        kind: "uninstall",
        bytes: freedBytes,
        count: removed,
        label: removed === 1 ? gameDisplayName(uninstallGames[0]) : null,
      });
    }
    setUninstalling(false);
    setUninstallGames(null);
    setSelected(new Set());
    setSelectMode(false);
    refreshAll();
    leftover.reset();
    showToast(
      t("storage.uninstalled", { count: removed, plural: removed === 1 ? "" : "s" }),
      "success",
    );
  }, [uninstallGames, removeGame, showToast, t, refreshAll, history, leftover]);

  const handleMoved = useCallback(
    (game: Game, toPath: string, newExe: string) => {
      updateGame(game.id, {
        path: newExe,
        sizeRootPath: toPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      void refresh(game.id);
    },
    [updateGame, refresh],
  );

  const handleBatchRemeasure = useCallback(async () => {
    const list = selectedGamesForRemeasure(installedGames, selected);
    if (list.length === 0) return;
    setBatchRemeasuring(true);
    let done = 0;
    for (const game of list) {
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: null,
          steamAppId: game.steamAppId ?? null,
        });
        updateGame(game.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        done += 1;
      } catch (err) {
        console.error("re-measure failed for", game.name, err);
      }
    }
    setBatchRemeasuring(false);
    showToast(
      t("storage.remeasured", { count: done, plural: done === 1 ? "" : "s" }),
      "success",
    );
    refreshAll();
  }, [installedGames, selected, updateGame, showToast, t, refreshAll]);

  const handleDriveRemeasure = useCallback(
    async (drive: string) => {
      const list = installedGames.filter(
        (game) => game.sizeRootPath && driveOf(game.sizeRootPath) === drive,
      );
      if (list.length === 0) return;
      setBatchRemeasuring(true);
      for (const game of list) {
        try {
          const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
            exePath: game.path,
            gameName: game.name,
            rootOverride: null,
            steamAppId: game.steamAppId ?? null,
          });
          updateGame(game.id, {
            sizeBytes: result.sizeBytes,
            sizeRootPath: result.rootPath,
            sizeDetectedAt: new Date().toISOString(),
          });
        } catch (err) {
          console.error("drive re-measure failed for", game.name, err);
        }
      }
      setBatchRemeasuring(false);
      refreshAll();
    },
    [installedGames, updateGame, refreshAll],
  );

  const openGameInTable = useCallback((game: Game) => {
    setTab("games");
    setFilter("all");
    setDriveFilter(null);
    setSearch(game.displayName || game.name);
  }, [setTab]);

  const handleRecommendation = useCallback(
    (rec: Recommendation) => {
      switch (rec.id) {
        case "stale":
          setTab("health");
          break;
        case "unmeasured":
          setTab("games");
          setFilter("missing");
          break;
        case "bigUnplayed":
          setTab("games");
          setFilter("all");
          setSelected(new Set(rec.gameIds));
          setSelectMode(true);
          break;
        case "modsBloat":
          setTab("games");
          setFilter("hasMods");
          break;
        case "lowSpace": {
          const tightest = Array.from(driveUsage.entries())
            .filter(([, usage]) => usage.total > 0)
            .sort((a, b) => a[1].available / a[1].total - b[1].available / b[1].total)[0];
          if (tightest) setSheetDrive(tightest[0]);
          break;
        }
        case "leftovers":
          setTab("overview");
          if (!leftover.folders) void leftover.scan();
          break;
      }
    },
    [setTab, driveUsage, leftover],
  );

  const handleExportCsv = useCallback(async () => {
    const csv = exportStorageReportCsv(sortedGames, unit);
    try {
      await navigator.clipboard.writeText(csv);
      showToast(t("storage.batch.copiedReport"), "success");
    } catch {
      showToast(t("storage.exportFailedCsv"), "error");
    }
  }, [sortedGames, unit, showToast, t]);

  const handleExportJson = useCallback(async () => {
    const json = exportStorageReportJson(sortedGames);
    try {
      await navigator.clipboard.writeText(json);
      showToast(t("storage.batch.copiedReport"), "success");
    } catch {
      showToast(t("storage.exportFailedJson"), "error");
    }
  }, [sortedGames, showToast, t]);

  const toggleColumn = useCallback((column: TableColumn) => {
    setColumns((prev) => {
      const next = new Set(prev);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }, []);

  const selectedGames = useMemo(
    () => installedGames.filter((game) => selected.has(game.id)),
    [installedGames, selected],
  );

  const sheetGames = useMemo(() => {
    if (!sheetDrive) return [];
    return installedGames.filter(
      (game) => game.sizeRootPath && driveOf(game.sizeRootPath) === sheetDrive,
    );
  }, [installedGames, sheetDrive]);

  const sheetRoot = useMemo(() => {
    const first = sheetGames.find((game) => game.sizeRootPath);
    if (!first?.sizeRootPath) return undefined;
    const normalized = first.sizeRootPath.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    return index > 0 ? first.sizeRootPath.slice(0, index) : first.sizeRootPath;
  }, [sheetGames]);

  const allSelected = sortedGames.length > 0 && selected.size === sortedGames.length;

  const emptyTitle = search.trim()
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
              : t("storage.emptySizedYet");

  const emptyDescription = search.trim()
    ? t("storage.hintSearch")
    : installedGames.length === 0
      ? t("storage.hintImport")
      : driveFilter
        ? t("storage.hintDrive")
        : t("storage.hintMeasure");

  const tabs = useMemo(
    () => [
      { id: "overview" as const, label: t("storage.tab.overview"), icon: LayoutDashboard },
      {
        id: "games" as const,
        label: t("storage.tab.games"),
        icon: Table2,
        count: sortedGames.length,
      },
      {
        id: "health" as const,
        label: t("storage.tab.health"),
        icon: ShieldCheck,
        badge:
          staleCount > 0 ? (
            <span className="storage-tab-badge" aria-hidden="true">
              {staleCount}
            </span>
          ) : null,
      },
      { id: "emulators" as const, label: t("storage.tab.emulators"), icon: Gamepad2 },
    ],
    [t, sortedGames.length, staleCount],
  );

  return (
    <div
      className={`storage-page page${selectMode && tab === "games" ? " storage-page--batch-open" : ""}`}
    >
      <PageWidget page="storage" widget="storageHeader">
        <div className="ui-item-storageHeader">
          <PageHeader
            eyebrow={t("storage.eyebrow")}
            title={t("storage.title")}
            description={t("storage.description")}
            icon={<HardDrive />}
          />
        </div>
      </PageWidget>

      <PageWidget page="storage" widget="storageHero">
        <div className="ui-item-storageHero">
          <StorageStatBand
            games={installedGames}
            staleCount={staleCount}
            driveUsage={driveUsage}
            onFilter={(next) => {
              setTab("games");
              setFilter(next);
            }}
            onOpenTab={setTab}
          />
        </div>
      </PageWidget>

      <PageWidget page="storage" widget="storageControls">
        <div className="ui-item-storageControls">
          <SubTabs
            items={tabs}
            value={tab}
            onChange={setTab}
            ariaLabel={t("storage.tabsAria")}
            className="storage-tabs"
          />
        </div>
      </PageWidget>

      <PageWidget page="storage" widget="storageList">
        <div className="ui-item-storageList">
          {tab === "overview" && (
            <StorageOverview
              games={installedGames}
              drives={drives}
              driveUsage={driveUsage}
              recommendations={recommendations}
              history={history.history}
              leftover={leftover.folders ? leftover.totals : null}
              leftoverFolders={leftover.folders}
              scanningLeftovers={leftover.scanning}
              onScanLeftovers={() => void leftover.scan()}
              onOpenDrive={setSheetDrive}
              onActOnRecommendation={handleRecommendation}
              onSelectGame={openGameInTable}
              onOpenTab={setTab}
              onOpenLeftover={openPath}
            />
          )}

          {tab === "games" && (
            <div className="storage-deck">
              <DriveRail
                drives={drives}
                usage={driveUsage}
                activeDrive={driveFilter}
                totalBytes={totalBytes}
                gameCount={installedGames.length}
                onSelect={setDriveFilter}
                onOpenDrive={setSheetDrive}
                onRefresh={refreshAll}
                refreshing={checkingPaths}
              />
              <div className="storage-deck__main">
                <RecommendationStrip
                  recommendations={visibleRecommendations}
                  onAct={handleRecommendation}
                  onDismiss={dismissRecommendation}
                  onDismissStrip={dismissStrip}
                  onOpenHealth={() => setTab("health")}
                />

                <StorageToolbar
                  search={search}
                  onSearchChange={setSearch}
                  filter={filter}
                  onFilterChange={setFilter}
                  counts={counts}
                  filteredCount={sortedGames.length}
                  totalCount={installedGames.length}
                  columns={columns}
                  onToggleColumn={toggleColumn}
                  selectMode={selectMode}
                  onToggleSelectMode={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                  isRefreshing={checkingPaths}
                  onRefreshPaths={refreshAll}
                  onExportCsv={handleExportCsv}
                  onExportJson={handleExportJson}
                />

                <GamesTable
                  games={sortedGames}
                  staleMap={staleMap}
                  maxBytes={maxBytes}
                  columns={columns}
                  sort={sort}
                  onSortChange={(column: StorageSortColumn) =>
                    setSortRaw(serializeSort(nextSort(sort, column)))
                  }
                  selectMode={selectMode}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={() => (allSelected ? clearSelection() : selectAll())}
                  allSelected={allSelected}
                  onSizeUpdated={(id) => void refresh(id)}
                  onOpenFolder={openFolder}
                  onMove={(game) => openMove([game])}
                  onUninstall={(game) => openUninstall([game])}
                  onLaunch={(game) => launchGame(game)}
                  emptyTitle={emptyTitle}
                  emptyDescription={emptyDescription}
                />
              </div>
            </div>
          )}

          {tab === "health" && <LibraryHealthCenter />}
          {tab === "emulators" && <StorageEmulatorsTab />}
        </div>
      </PageWidget>

      {selectMode && tab === "games" && (
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
          onRemeasure={() => void handleBatchRemeasure()}
          isRemeasuring={batchRemeasuring}
        />
      )}

      {sheetDrive && (
        <DriveSheet
          drive={sheetDrive}
          games={sheetGames}
          usage={driveUsage.get(sheetDrive)}
          rootPath={sheetRoot}
          onClose={() => setSheetDrive(null)}
          onOpenFolder={openPath}
          onSelectGame={openGameInTable}
          onMove={openMove}
          onRemeasure={() => void handleDriveRemeasure(sheetDrive)}
          remeasuring={batchRemeasuring}
        />
      )}

      {moveGames && (
        <MoveGameDialog
          games={moveGames}
          onMoved={handleMoved}
          onClose={() => {
            setMoveGames(null);
            refreshAll();
            leftover.reset();
          }}
        />
      )}

      <ConfirmModal
        open={uninstallGames !== null}
        title={
          uninstallGames && uninstallGames.length === 1
            ? t("storage.uninstallTitle", { name: gameDisplayName(uninstallGames[0]) })
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

function selectedGamesForRemeasure(games: Game[], selected: Set<string>): Game[] {
  return games.filter(
    (game) => selected.has(game.id) && ((game.path && game.path.trim() !== "") || game.steamAppId != null),
  );
}
