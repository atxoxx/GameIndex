import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game } from "../../types/game";
import { formatSize, gameDisplayName } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Button, ConfirmModal } from "../../components/ui";
import { useLibraryHealth } from "./useLibraryHealth";
import { HealthCategoryIcon, type HealthTabId } from "./HealthCategoryIcon";
import { HealthOverviewTab } from "./HealthOverviewTab";
import { HealthPathsTab } from "./HealthPathsTab";
import { HealthDuplicatesTab } from "./HealthDuplicatesTab";
import { HealthMetadataTab } from "./HealthMetadataTab";
import { HealthArtworkTab } from "./HealthArtworkTab";
import { HealthSizesTab } from "./HealthSizesTab";
import { HealthBacklogTab } from "./HealthBacklogTab";
import type { HealthCategory } from "./health";
import "./health.css";

function parentDir(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const index = norm.lastIndexOf("/");
  return index > 0 ? norm.slice(0, index) : path;
}

const TABS: { id: HealthTabId; category?: HealthCategory; tone: "danger" | "warning" | "info" }[] = [
  { id: "overview", tone: "info" },
  { id: "paths", category: "paths", tone: "danger" },
  { id: "duplicates", category: "duplicates", tone: "warning" },
  { id: "metadata", category: "metadata", tone: "info" },
  { id: "artwork", category: "artwork", tone: "warning" },
  { id: "sizes", category: "sizes", tone: "info" },
  { id: "backlog", category: "backlog", tone: "warning" },
];

export function LibraryHealthCenter() {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const { games, updateGame, removeGame, launchGame, enrichGameMetadata, enqueueEnrichBatch } = useGames();
  const { showToast } = useToast();
  const health = useLibraryHealth(games, true);

  const [activeTab, setActiveTab] = usePersistedState<HealthTabId>(
    "gamelib.storage.health.tab_v1",
    "overview",
    ["overview", "paths", "duplicates", "metadata", "artwork", "sizes", "backlog"],
  );

  const [pendingDuplicates, setPendingDuplicates] = useState<string[] | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<Game | null>(null);
  const [pendingOrphans, setPendingOrphans] = useState<string[] | null>(null);

  const [uninstalling, setUninstalling] = useState(false);
  const [deletingArtwork, setDeletingArtwork] = useState(false);

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkTotal, setBulkTotal] = useState(0);

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  // ── Shared helpers ─────────────────────────────────────────────────────

  const handleOpenFolder = useCallback(
    async (game: Game) => {
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
    [showToast, t]
  );

  const handleOpenContaining = useCallback(
    async (game: Game) => {
      const raw = game.path || game.sizeRootPath;
      if (!raw) {
        showToast(t("storage.noFolderKnown", { name: gameDisplayName(game) }), "info");
        return;
      }
      try {
        await invoke("open_folder", { path: parentDir(raw) });
      } catch (err) {
        showToast(t("storage.couldNotOpenFolder", { error: String(err) }), "error");
      }
    },
    [showToast, t]
  );

  const handleRelink = useCallback(
    async (game: Game) => {
      try {
        const picked = await open({
          directory: true,
          multiple: false,
          title: t("storageRow.relinkFolder"),
        });
        if (!picked || typeof picked !== "string") return;
        const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
          exePath: game.path,
          gameName: game.name,
          rootOverride: picked,
          steamAppId: game.steamAppId ?? null,
        });
        updateGame(game.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        showToast(
          t("storageRow.detectedSize", {
            size: formatSize(result.sizeBytes, unit),
            name: gameDisplayName(game),
          }),
          "success"
        );
        health.scan();
      } catch (err) {
        showToast(t("storageRow.readError", { error: String(err) }), "error");
      }
    },
    [updateGame, showToast, t, unit, health]
  );

  // Broken-path "Clear" retires the dead install: the game is marked as no
  // longer installed and its stale measurement/reference is dropped.
  const handleClearPath = useCallback(
    (game: Game, field: "path" | "sizeRootPath") => {
      const updates: Partial<Game> = { installed: false };
      if (field === "sizeRootPath") {
        updates.sizeBytes = undefined;
        updates.sizeRootPath = undefined;
        updates.sizeDetectedAt = undefined;
      } else {
        updates.path = "";
      }
      updateGame(game.id, updates);
      showToast(t("storage.health.paths.cleared", { name: gameDisplayName(game) }), "info");
      health.scan();
    },
    [updateGame, showToast, t, health]
  );

  const handleLocateExecutable = useCallback(
    async (game: Game) => {
      try {
        const picked = await open({
          directory: false,
          multiple: false,
          title: t("storage.health.paths.locateTitle"),
        });
        if (!picked || typeof picked !== "string") return;
        try {
          const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
            exePath: picked,
            gameName: game.name,
            rootOverride: null,
            steamAppId: game.steamAppId ?? null,
          });
          updateGame(game.id, {
            path: picked,
            sizeBytes: result.sizeBytes,
            sizeRootPath: result.rootPath,
            sizeDetectedAt: new Date().toISOString(),
          });
        } catch {
          // The exe is valid even if we couldn't measure its folder.
          updateGame(game.id, { path: picked });
        }
        health.scan();
      } catch (err) {
        showToast(t("storageRow.readError", { error: String(err) }), "error");
      }
    },
    [updateGame, showToast, t, health]
  );

  const handleRemeasure = useCallback(
    async (game: Game) => {
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
        showToast(
          t("storageRow.detectedSize", {
            size: formatSize(result.sizeBytes, unit),
            name: gameDisplayName(game),
          }),
          "success"
        );
        health.scan();
      } catch (err) {
        showToast(t("storageRow.readError", { error: String(err) }), "error");
      }
    },
    [updateGame, showToast, t, unit, health]
  );

  const handleRemeasureAll = useCallback(
    async (ids: string[]) => {
      const targets = ids
        .map((id) => gameById.get(id))
        .filter((game): game is Game => !!game && (!!game.path?.trim() || game.steamAppId != null));
      if (targets.length === 0) {
        showToast(t("storageHeader.noMeasurements"), "info");
        return;
      }
      setBulkRunning(true);
      setBulkDone(0);
      setBulkTotal(targets.length);
      let done = 0;
      for (let index = 0; index < targets.length; index++) {
        const game = targets[index];
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
          done++;
        } catch {
          // Keep going; a single unreadable folder must not stop the sweep.
        }
        setBulkDone(index + 1);
      }
      setBulkRunning(false);
      showToast(
        t("storageBulk.recalculated", { count: done, plural: done === 1 ? "" : "s", stopped: "" }),
        "success"
      );
      health.scan();
    },
    [gameById, updateGame, showToast, t, health]
  );

  const handleEnrich = useCallback(
    async (game: Game) => {
      await enrichGameMetadata(game.id, game.name, game.steamAppId);
    },
    [enrichGameMetadata]
  );

  const handleEnrichAll = useCallback(
    (ids: string[]) => {
      const targets = ids
        .map((id) => gameById.get(id))
        .filter((game): game is Game => !!game)
        .map((game) => ({ id: game.id, name: game.name, steamAppId: game.steamAppId }));
      if (targets.length === 0) return;
      enqueueEnrichBatch(targets);
      showToast(
        t("storage.health.metadata.queued", {
          count: targets.length,
          plural: targets.length === 1 ? "" : "s",
        }),
        "success"
      );
    },
    [gameById, enqueueEnrichBatch, showToast, t]
  );

  // ── Confirmed destructive actions ──────────────────────────────────────

  const confirmRemoveDuplicates = useCallback(() => {
    if (!pendingDuplicates) return;
    for (const id of pendingDuplicates) removeGame(id);
    showToast(
      t("storage.health.duplicates.removed", {
        count: pendingDuplicates.length,
        plural: pendingDuplicates.length === 1 ? "" : "s",
      }),
      "success"
    );
    setPendingDuplicates(null);
    health.scan();
  }, [pendingDuplicates, removeGame, showToast, t, health]);

  const confirmUninstall = useCallback(async () => {
    if (!pendingUninstall) return;
    const game = pendingUninstall;
    const root = game.sizeRootPath || game.path;
    setUninstalling(true);
    try {
      if (root) await invoke("uninstall_game", { rootPath: root });
      removeGame(game.id);
      showToast(
        t("storage.uninstalled", { count: 1, plural: "" }),
        "success"
      );
      health.scan();
    } catch (err) {
      showToast(t("storage.uninstallFailed", { name: gameDisplayName(game), error: String(err) }), "error");
    } finally {
      setUninstalling(false);
      setPendingUninstall(null);
    }
  }, [pendingUninstall, removeGame, showToast, t, health]);

  const confirmDeleteOrphans = useCallback(async () => {
    if (!pendingOrphans) return;
    setDeletingArtwork(true);
    try {
      const freed = await invoke<number>("delete_orphaned_artwork", {
        relativePaths: pendingOrphans,
      });
      showToast(t("storage.health.artwork.reclaimed", { size: formatSize(freed, unit) }), "success");
      health.scan();
    } catch (err) {
      showToast(t("storage.health.error", { error: String(err) }), "error");
    } finally {
      setDeletingArtwork(false);
      setPendingOrphans(null);
    }
  }, [pendingOrphans, showToast, t, unit, health]);

  const scannedLabel = health.scannedAt
    ? t("storage.health.scannedAt", { time: new Date(health.scannedAt).toLocaleTimeString() })
    : t("storage.health.neverScanned");

  return (
    <div className="health-page">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="health-hero">
        <div className="health-hero-icon" aria-hidden="true">
          <HealthCategoryIcon category="overview" />
        </div>
        <div className="health-hero-text">
          <h2 className="health-hero-title">{t("storage.health.title")}</h2>
          <p className="health-hero-desc">{t("storage.health.subtitle")}</p>
          <p className="health-hero-scanned">{scannedLabel}</p>
        </div>
        <div className="health-hero-actions">
          <Button variant="primary" onClick={health.scan} isLoading={health.scanning}>
            {t("storage.health.runScan")}
          </Button>
        </div>
      </div>

      {/* ── Subtab rail ──────────────────────────────────────────────── */}
      <div className="health-subtabs" role="tablist" aria-label={t("storage.health.tabsAria")}>
        {TABS.map((tab) => {
          const count = tab.category ? health.counts[tab.category] : health.counts.total;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`health-subtab ${active ? "health-subtab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <HealthCategoryIcon category={tab.id} className="health-subtab-icon" />
              <span className="health-subtab-label">{t(`storage.health.tab.${tab.id}`)}</span>
              {count > 0 && (
                <span className={`health-subtab-count health-subtab-count--${tab.tone}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Active panel ─────────────────────────────────────────────── */}
      <div className="health-panel">
        {bulkRunning && (
          <div className="health-bulk-progress">
            <span>{t("storageBulk.progress", {
              done: bulkDone,
              total: bulkTotal,
              pct: Math.round((bulkDone / (bulkTotal || 1)) * 100),
            })}</span>
            <div className="health-bulk-track">
              <div
                className="health-bulk-fill"
                style={{ width: `${(bulkDone / (bulkTotal || 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {activeTab === "overview" && (
          <HealthOverviewTab
            score={health.score}
            counts={health.counts}
            onSelectCategory={(category) => setActiveTab(category)}
          />
        )}
        {activeTab === "paths" && (
          <HealthPathsTab
            games={games}
            issues={health.stalePaths}
            onRelink={handleRelink}
            onLocate={handleLocateExecutable}
            onClear={handleClearPath}
            onOpenFolder={handleOpenContaining}
          />
        )}
        {activeTab === "duplicates" && (
          <HealthDuplicatesTab groups={health.duplicateGroups} onRemove={setPendingDuplicates} />
        )}
        {activeTab === "metadata" && (
          <HealthMetadataTab
            games={games}
            issues={health.metadataIssues}
            onEnrich={handleEnrich}
            onEnrichAll={handleEnrichAll}
          />
        )}
        {activeTab === "artwork" && (
          <HealthArtworkTab orphans={health.orphanArtwork} onDelete={setPendingOrphans} />
        )}
        {activeTab === "sizes" && (
          <HealthSizesTab
            games={games}
            issues={health.sizeIssues}
            onRemeasure={handleRemeasure}
            onRemeasureAll={(ids) => void handleRemeasureAll(ids)}
          />
        )}
        {activeTab === "backlog" && (
          <HealthBacklogTab
            games={games}
            issues={health.backlogIssues}
            onLaunch={launchGame}
            onOpenFolder={handleOpenFolder}
            onUninstall={setPendingUninstall}
          />
        )}
      </div>

      {/* ── Confirmations ────────────────────────────────────────────── */}
      <ConfirmModal
        open={pendingDuplicates !== null}
        title={t("storage.health.duplicates.confirmTitle", {
          count: pendingDuplicates?.length ?? 0,
          plural: (pendingDuplicates?.length ?? 0) === 1 ? "" : "s",
        })}
        message={t("storage.health.duplicates.confirmBody")}
        confirmLabel={t("storage.health.duplicates.confirmLabel")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmRemoveDuplicates}
        onCancel={() => setPendingDuplicates(null)}
      />

      <ConfirmModal
        open={pendingUninstall !== null}
        title={t("storage.uninstallTitle", {
          name: pendingUninstall ? gameDisplayName(pendingUninstall) : "",
        })}
        message={t("storage.uninstallBody")}
        warning={t("storage.uninstallWarn")}
        confirmLabel={t("storage.uninstallLabel")}
        cancelLabel={t("common.cancel")}
        busy={uninstalling}
        onConfirm={() => void confirmUninstall()}
        onCancel={() => !uninstalling && setPendingUninstall(null)}
      />

      <ConfirmModal
        open={pendingOrphans !== null}
        title={t("storage.health.artwork.confirmTitle", {
          count: pendingOrphans?.length ?? 0,
          plural: (pendingOrphans?.length ?? 0) === 1 ? "" : "s",
        })}
        message={t("storage.health.artwork.confirmBody")}
        warning={t("storage.uninstallWarn")}
        confirmLabel={t("storage.health.artwork.confirmLabel")}
        cancelLabel={t("common.cancel")}
        busy={deletingArtwork}
        onConfirm={() => void confirmDeleteOrphans()}
        onCancel={() => !deletingArtwork && setPendingOrphans(null)}
      />
    </div>
  );
}
