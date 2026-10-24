import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Database,
  Gamepad2,
  HardDrive,
  RefreshCw,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  Button,
  ConfirmModal,
  PageHeader,
  Panel,
  Skeleton,
  SubTabs,
} from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSaves } from "../../context/SavesContext";
import { useToast } from "../../context/ToastContext";
import type { SaveBackup, SaveLocation } from "../../types/saves";
import { formatRelative } from "../../utils/savesTime";
import BackupTab from "../settings/BackupTab";
import GamesTab from "./GamesTab";
import SavesBackupAllDialog from "./SavesBackupAllDialog";
import SavesSettingsTab from "./SavesSettingsTab";
import SavesSummaryBand from "./SavesSummaryBand";
import SnapshotsTab from "./SnapshotsTab";
import SnapshotDrawer from "./SnapshotDrawer";
import { buildSavesOverview, protectionRank, type TrackedSaveGame } from "./savesData";
import { useSavesLibrary } from "./useSavesLibrary";

type SavesTab = "games" | "snapshots" | "system" | "settings";

type SavesDialog =
  | { kind: "restore"; backup: SaveBackup }
  | { kind: "delete"; backups: SaveBackup[] }
  | { kind: "deleteGame"; entry: TrackedSaveGame }
  | { kind: "backupAll"; entries: TrackedSaveGame[] }
  | null;

const TAB_IDS: SavesTab[] = ["games", "snapshots", "system", "settings"];

function readTab(value: string | null): SavesTab {
  return value && (TAB_IDS as string[]).includes(value) ? (value as SavesTab) : "games";
}

/**
 * SavesPage — the library-wide protection hub.
 *
 * Games opens as a master–detail roster: the rail is for scanning every
 * tracked game, the pane manages the selected game's locations and snapshots
 * without leaving the page. Snapshots is the library-wide, day-grouped archive
 * with a manifest slide-over; Library & Database embeds the existing backup
 * suite; Settings shares its controls with Settings → Saves.
 */
export default function SavesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { games } = useGames();
  const {
    enabled,
    ready,
    summary,
    progress,
    refresh,
    scanAll,
    restoreBackup,
    deleteBackup,
    openBackup,
    openLocation,
    updateSettings,
  } = useSaves();
  const { locations, backups, health, loading, error, reload } = useSavesLibrary(enabled);

  const [busy, setBusy] = useState<null | "scan">(null);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [dialog, setDialog] = useState<SavesDialog>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [drawer, setDrawer] = useState<SaveBackup | null>(null);
  const [backupAllBusy, setBackupAllBusy] = useState(false);

  const tab = readTab(searchParams.get("tab"));
  const gameParam = searchParams.get("game");

  const overview = useMemo(
    () =>
      buildSavesOverview({
        games,
        locations: locations ?? [],
        backups: backups ?? [],
        health,
      }),
    [games, locations, backups, health],
  );

  const healthById = useMemo(
    () => new Map(health.map((entry) => [entry.id, entry.exists])),
    [health],
  );

  const selectedEntry = gameParam ? (overview.byId.get(gameParam) ?? null) : null;
  const defaultEntry = useMemo(
    () =>
      [...overview.tracked].sort(
        (a, b) => protectionRank(a.state) - protectionRank(b.state) || a.name.localeCompare(b.name),
      )[0] ?? null,
    [overview.tracked],
  );

  const eligibleEntries = useMemo(
    () => overview.tracked.filter((entry) => entry.includedLocations.length > 0),
    [overview.tracked],
  );

  // Keep the games tab pointing at a real, visible game so the pane is never
  // an empty frame after a game is removed or the library changes.
  useEffect(() => {
    if (tab !== "games" || loading || !ready || !enabled) return;
    if (gameParam && overview.byId.has(gameParam)) return;
    if (!defaultEntry) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "games");
        next.set("game", defaultEntry.gameId);
        return next;
      },
      { replace: true },
    );
  }, [
    tab,
    loading,
    ready,
    enabled,
    gameParam,
    overview,
    defaultEntry,
    setSearchParams,
  ]);

  const updateParams = useCallback(
    (nextTab: SavesTab, gameId?: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", nextTab);
          if (gameId) next.set("game", gameId);
          else next.delete("game");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleScan = useCallback(async () => {
    setBusy("scan");
    try {
      await scanAll();
      await reload();
    } finally {
      setBusy(null);
    }
  }, [scanAll, reload]);

  const openBackupAll = useCallback(() => {
    if (eligibleEntries.length === 0) return;
    setDialog({ kind: "backupAll", entries: eligibleEntries });
  }, [eligibleEntries]);

  const handleBackup = useCallback(
    async (entry: TrackedSaveGame, note?: string) => {
      setBusyGameId(entry.gameId);
      try {
        await invoke<SaveBackup>("saves_backup_game", {
          gameId: entry.gameId,
          note: note?.trim() ? note.trim() : null,
        });
        await Promise.all([refresh(), reload()]);
        showToast(t("saves.toast.gameBackedUp", { name: entry.name }), "success");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusyGameId(null);
      }
    },
    [refresh, reload, showToast, t],
  );

  const handleBackupGames = useCallback(
    async (entries: TrackedSaveGame[]) => {
      if (entries.length === 0) return;
      setBulk({ done: 0, total: entries.length });
      let done = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          await invoke<SaveBackup>("saves_backup_game", {
            gameId: entry.gameId,
            note: null,
          });
          done += 1;
        } catch {
          failed += 1;
        }
        setBulk({ done: done + failed, total: entries.length });
      }
      await Promise.all([refresh(), reload()]);
      setBulk(null);
      if (failed > 0) {
        showToast(t("saves.toast.bulkBackupPartial", { done, failed }), "info");
      } else {
        showToast(t("saves.toast.backupAll", { count: done }), "success");
      }
    },
    [refresh, reload, showToast, t],
  );

  const handleRescan = useCallback(
    async (entry: TrackedSaveGame) => {
      setBusyGameId(entry.gameId);
      try {
        const list = await invoke<SaveLocation[]>("saves_detect_locations", {
          gameId: entry.gameId,
          includePcgw: true,
        });
        const added = Math.max(0, list.length - entry.locations.length);
        await reload();
        showToast(t("saves.toast.scanGame", { count: added }), added > 0 ? "success" : "info");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusyGameId(null);
      }
    },
    [reload, showToast, t],
  );

  const handleToggleLocation = useCallback(
    async (_entry: TrackedSaveGame, location: SaveLocation) => {
      try {
        await invoke("saves_update_location", {
          location: { ...location, include: !location.include },
        });
        await reload();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [reload, showToast],
  );

  const handleRemoveLocation = useCallback(
    async (location: SaveLocation) => {
      try {
        await invoke("saves_remove_location", { id: location.id });
        await Promise.all([reload(), refresh()]);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [reload, refresh, showToast],
  );

  const handleLocationAdded = useCallback(() => {
    void Promise.all([reload(), refresh()]);
  }, [reload, refresh]);

  const handleOpenLocation = useCallback(
    (location: SaveLocation) => {
      void openLocation(location.id).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : String(err), "error");
      });
    },
    [openLocation, showToast],
  );

  const handleOpenBackupFolder = useCallback(
    (backup: SaveBackup) => {
      void openBackup(backup.id).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : String(err), "error");
      });
    },
    [openBackup, showToast],
  );

  const confirmDialog = useCallback(async () => {
    if (!dialog) return;
    setDialogBusy(true);
    try {
      if (dialog.kind === "restore") {
        const result = await restoreBackup(dialog.backup.id);
        await Promise.all([refresh(), reload()]);
        showToast(t("saves.toast.restoreDone", { count: result.restoredFiles }), "success");
        if (result.warnings.length > 0) {
          showToast(t("saves.toast.restoreWarnings", { count: result.warnings.length }), "info");
        }
      } else if (dialog.kind === "delete") {
        for (const backup of dialog.backups) {
          await deleteBackup(backup.id);
        }
        await Promise.all([refresh(), reload()]);
        showToast(t("saves.toast.backupsDeleted", { count: dialog.backups.length }), "info");
      } else if (dialog.kind === "deleteGame") {
        await invoke("saves_delete_game_backups", { gameId: dialog.entry.gameId });
        await Promise.all([refresh(), reload()]);
        showToast(t("saves.toast.historyCleared", { name: dialog.entry.name }), "info");
      } else if (dialog.kind === "backupAll") {
        const done = await invoke<SaveBackup[]>("saves_backup_all");
        await Promise.all([refresh(), reload()]);
        showToast(t("saves.toast.backupAll", { count: done.length }), "success");
      }
      setDialog(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDialogBusy(false);
      setBackupAllBusy(false);
    }
  }, [dialog, restoreBackup, deleteBackup, refresh, reload, showToast, t]);

  const confirmBackupAll = useCallback(async () => {
    if (!dialog || dialog.kind !== "backupAll") return;
    setBackupAllBusy(true);
    await confirmDialog();
  }, [dialog, confirmDialog]);

  if (!ready) {
    return (
      <div className="saves-page page">
        <div className="saves-page__skeleton">
          <Skeleton width="280px" height="2.4em" />
          <Skeleton width="100%" height="120px" />
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="saves-page page">
        <PageHeader
          eyebrow={t("nav.saves")}
          title={t("saves.page.title")}
          description={t("saves.page.disabledDesc")}
          icon={<Archive size={22} />}
        />
        <Panel className="saves-disabled">
          <Archive size={26} className="saves-disabled__icon" aria-hidden="true" />
          <strong>{t("saves.page.disabledTitle")}</strong>
          <p>{t("saves.page.disabledText")}</p>
          <Button
            variant="primary"
            onClick={async () => {
              await updateSettings({ enabled: true });
              await refresh();
            }}
          >
            {t("saves.settings.enableTitle")}
          </Button>
        </Panel>
      </div>
    );
  }

  const restoreTarget = dialog?.kind === "restore" ? dialog.backup : null;
  const deleteTargets = dialog?.kind === "delete" ? dialog.backups : [];
  const deleteGameTarget = dialog?.kind === "deleteGame" ? dialog.entry : null;
  const backupAllEntries = dialog?.kind === "backupAll" ? dialog.entries : [];

  const missingLocations =
    health.length > 0
      ? health.filter((entry) => !entry.exists).length
      : (summary?.missingLocations ?? 0);

  const globalProgress =
    progress &&
    progress.percent < 100 &&
    !(progress.phase !== "scan" && progress.gameId === selectedEntry?.gameId)
      ? progress
      : null;

  return (
    <div className="saves-page page">
      <PageWidget page="saves" widget="savesHeader">
        <PageHeader
          className="ui-item-savesHeader"
          eyebrow={t("nav.saves")}
          title={t("saves.page.title")}
          description={t("saves.page.desc")}
          icon={<Archive size={22} />}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw size={14} />}
                onClick={() => void handleScan()}
                isLoading={busy === "scan"}
                disabled={busy !== null || backupAllBusy}
              >
                {t("saves.action.scanLibrary")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Zap size={14} />}
                onClick={openBackupAll}
                disabled={busy !== null || backupAllBusy || eligibleEntries.length === 0}
              >
                {t("saves.action.backupAll")}
              </Button>
            </>
          }
        />
      </PageWidget>

      <PageWidget page="saves" widget="savesHero">
        <div className="ui-item-savesHero">
          <SavesSummaryBand
            summary={summary}
            overview={overview}
            missingLocations={missingLocations}
          />
        </div>
      </PageWidget>

      <PageWidget page="saves" widget="savesControls">
        <div className="ui-item-savesControls saves-controls">
          <SubTabs
            ariaLabel={t("saves.viewsLabel")}
            value={tab}
            onChange={(next) => updateParams(next, next === "games" ? gameParam : null)}
            items={[
              {
                id: "games",
                label: t("saves.subtab.games"),
                icon: Gamepad2,
                count: overview.counts.all,
              },
              {
                id: "snapshots",
                label: t("saves.subtab.snapshots"),
                icon: Archive,
                count: summary?.totalBackups ?? backups?.length ?? 0,
              },
              { id: "system", label: t("saves.subtab.system"), icon: Database },
              { id: "settings", label: t("saves.subtab.settings"), icon: SlidersHorizontal },
            ]}
            trailing={
              summary?.backupDir ? (
                <button
                  type="button"
                  className="saves-dir"
                  onClick={() => {
                    void invoke("saves_open_path", { path: summary.backupDir }).catch(
                      (err: unknown) =>
                        showToast(err instanceof Error ? err.message : String(err), "error"),
                    );
                  }}
                  title={summary.backupDir}
                >
                  <HardDrive size={14} aria-hidden="true" />
                  <span>{t("saves.settings.backupDir")}</span>
                </button>
              ) : null
            }
          />

          {globalProgress && (
            <div className="saves-progress" role="status" aria-live="polite">
              <div
                className="saves-progress__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={globalProgress.percent}
              >
                <div
                  className="saves-progress__fill"
                  style={{ width: `${Math.max(4, globalProgress.percent)}%` }}
                />
              </div>
              <span className="saves-progress__label">
                {globalProgress.message || t("saves.progress.working")}
              </span>
            </div>
          )}
        </div>
      </PageWidget>

      {error && (
        <div className="saves-alert" role="status">
          <span>{t("saves.page.loadError")}</span>
          <Button variant="tertiary" size="sm" onClick={() => void reload()}>
            {t("common.retry")}
          </Button>
        </div>
      )}

      <PageWidget page="saves" widget="savesGrid">
        <div className="ui-item-savesGrid saves-content">
          {tab === "games" && (
            <GamesTab
              overview={overview}
              loading={loading}
              selectedId={selectedEntry?.gameId ?? null}
              onSelect={(gameId) => updateParams("games", gameId)}
              health={healthById}
              progress={progress}
              busyGameId={busyGameId}
              bulk={bulk}
              scanning={busy === "scan"}
              onScan={() => void handleScan()}
              onBackupGames={(entries) => void handleBackupGames(entries)}
              onBackup={(entry, note) => void handleBackup(entry, note)}
              onRescan={(entry) => void handleRescan(entry)}
              onOpenGamePage={(gameId) => navigate(`/library/${gameId}?tab=saves`)}
              onViewHistory={(gameId) => updateParams("snapshots", gameId)}
              onToggleLocation={(entry, location) => void handleToggleLocation(entry, location)}
              onOpenLocation={handleOpenLocation}
              onRemoveLocation={(location) => void handleRemoveLocation(location)}
              onLocationAdded={handleLocationAdded}
              onOpenSnapshot={setDrawer}
              onRestore={(backup) => {
                setDrawer(null);
                setDialog({ kind: "restore", backup });
              }}
              onOpenBackupFolder={handleOpenBackupFolder}
              onDeleteSnapshot={(backup) => {
                setDrawer(null);
                setDialog({ kind: "delete", backups: [backup] });
              }}
              onDeleteGameSnapshots={(entry) => setDialog({ kind: "deleteGame", entry })}
            />
          )}

          {tab === "snapshots" && (
            <SnapshotsTab
              backups={backups ?? []}
              games={games}
              loading={loading}
              initialGameId={gameParam ?? "all"}
              onOpenSnapshot={setDrawer}
              onRestore={(backup) => {
                setDrawer(null);
                setDialog({ kind: "restore", backup });
              }}
              onOpenBackupFolder={handleOpenBackupFolder}
              onDeleteSnapshot={(backup) => {
                setDrawer(null);
                setDialog({ kind: "delete", backups: [backup] });
              }}
              onDeleteMany={(list) => setDialog({ kind: "delete", backups: list })}
              onBackupAll={openBackupAll}
            />
          )}

          {tab === "system" && (
            <div className="saves-system">
              <BackupTab />
            </div>
          )}

          {tab === "settings" && (
            <SavesSettingsTab
              scanning={busy === "scan"}
              backupAllDisabled={busy !== null || eligibleEntries.length === 0}
              onScan={() => void handleScan()}
              onBackupAll={openBackupAll}
            />
          )}
        </div>
      </PageWidget>

      <SnapshotDrawer
        backup={drawer}
        onClose={() => setDrawer(null)}
        onRestore={(backup) => {
          setDrawer(null);
          setDialog({ kind: "restore", backup });
        }}
        onDelete={(backup) => {
          setDrawer(null);
          setDialog({ kind: "delete", backups: [backup] });
        }}
        onOpenFolder={handleOpenBackupFolder}
      />

      <SavesBackupAllDialog
        open={backupAllEntries.length > 0}
        entries={backupAllEntries}
        busy={backupAllBusy}
        onConfirm={() => void confirmBackupAll()}
        onCancel={() => {
          if (!backupAllBusy) setDialog(null);
        }}
      />

      <ConfirmModal
        open={restoreTarget !== null}
        busy={dialogBusy}
        title={
          restoreTarget
            ? t("saves.confirm.restoreTitle", { name: restoreTarget.gameName })
            : ""
        }
        message={
          restoreTarget
            ? t("saves.confirm.restoreMessage", {
                when: formatRelative(restoreTarget.createdAt, language),
              })
            : ""
        }
        warning={t("saves.confirm.restoreWarning")}
        confirmLabel="saves.action.restore"
        onConfirm={() => void confirmDialog()}
        onCancel={() => !dialogBusy && setDialog(null)}
      />

      <ConfirmModal
        open={deleteTargets.length > 0}
        busy={dialogBusy}
        title={
          deleteTargets.length > 1
            ? t("saves.confirm.bulkDeleteTitle", { count: deleteTargets.length })
            : t("saves.confirm.deleteTitle")
        }
        message={
          deleteTargets.length > 1
            ? t("saves.confirm.bulkDeleteMessage", { count: deleteTargets.length })
            : t("saves.confirm.deleteMessage")
        }
        confirmLabel="common.delete"
        onConfirm={() => void confirmDialog()}
        onCancel={() => !dialogBusy && setDialog(null)}
      />

      <ConfirmModal
        open={deleteGameTarget !== null}
        busy={dialogBusy}
        title={
          deleteGameTarget
            ? t("saves.snapshots.deleteAllConfirmTitle", { name: deleteGameTarget.name })
            : ""
        }
        message={
          deleteGameTarget
            ? t("saves.snapshots.deleteAllConfirmBody", {
                count: deleteGameTarget.snapshots.length,
              })
            : ""
        }
        confirmLabel="common.delete"
        onConfirm={() => void confirmDialog()}
        onCancel={() => !dialogBusy && setDialog(null)}
      />
    </div>
  );
}
