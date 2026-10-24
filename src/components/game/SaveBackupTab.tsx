import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Clock,
  FileText,
  FolderOpen,
  HardDrive,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { usePersistedState } from "../../hooks/usePersistedState";
import {
  Button,
  Badge,
  ConfirmModal,
  Panel,
  Skeleton,
  StatBand,
  SubTabs,
  type StatBandItem,
  type SubTabItem,
} from "../ui";
import SettingsToggleCard from "../../pages/settings/SettingsToggleCard";
import AddLocationForm from "../../pages/saves/AddLocationForm";
import SaveLocationList from "../../pages/saves/SaveLocationList";
import SnapshotDrawer from "../../pages/saves/SnapshotDrawer";
import SnapshotRow from "../../pages/saves/SnapshotRow";
import {
  SAVE_KIND_LABEL_KEY,
  type SaveBackup,
  type SaveBackupKind,
  type SaveLocation,
  type SaveLocationHealth,
} from "../../types/saves";
import { formatRelative } from "../../utils/savesTime";

export { formatRelative } from "../../utils/savesTime";

type GameSubtab = "snapshots" | "locations" | "settings";
type SnapshotKindFilter = "all" | SaveBackupKind;

interface SaveBackupTabProps {
  gameId: string;
  gameName: string;
}

/**
 * SaveBackupTab — the per-game "Saves" tab.
 *
 * Reuses the hub's rows, badges, drawer and add-location form, so a snapshot
 * looks and behaves the same whether it is opened from the library-wide hub or
 * from a game page.
 */
export default function SaveBackupTab({ gameId, gameName }: SaveBackupTabProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const {
    enabled,
    settings,
    progress,
    restoreBackup,
    deleteBackup,
    openBackup,
    openLocation,
    updateSettings,
  } = useSaves();
  const { formatBytes } = useSizeUnit();

  const [subtab, setSubtab] = usePersistedState<GameSubtab>(
    "gamelib.game.save_backup.subtab_v1",
    "snapshots",
    ["snapshots", "locations", "settings"],
  );
  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [health, setHealth] = useState<SaveLocationHealth[]>([]);
  const [busy, setBusy] = useState<null | "detect" | "backup">(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<SnapshotKindFilter>("all");

  const [pending, setPending] = useState<null | {
    kind: "restore" | "delete";
    backup: SaveBackup;
  }>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [drawer, setDrawer] = useState<SaveBackup | null>(null);

  const load = useCallback(
    async (detectIfEmpty: boolean) => {
      try {
        let list = await invoke<SaveLocation[]>("saves_list_locations", { gameId });
        if (detectIfEmpty && list.length === 0) {
          list = await invoke<SaveLocation[]>("saves_detect_locations", { gameId });
        }
        const [history, healthList] = await Promise.all([
          invoke<SaveBackup[]>("saves_list_backups", { gameId }),
          invoke<SaveLocationHealth[]>("saves_location_health", { gameId }).catch(
            () => [] as SaveLocationHealth[],
          ),
        ]);
        setLocations(list);
        setBackups(history);
        setHealth(healthList);
      } catch {
        setLocations([]);
        setBackups([]);
        setHealth([]);
      }
    },
    [gameId],
  );

  useEffect(() => {
    if (!enabled) return;
    setLocations(null);
    setBackups(null);
    void load(true);
  }, [enabled, load]);

  const healthById = useMemo(
    () => new Map(health.map((entry) => [entry.id, entry.exists])),
    [health],
  );

  const inProgress = progress?.gameId === gameId || progress?.phase === "scan";
  const totalSnapshots = backups?.length ?? 0;
  const totalBytes = useMemo(
    () => (backups ?? []).reduce((sum, backup) => sum + backup.totalBytes, 0),
    [backups],
  );
  const includedCount = useMemo(
    () => (locations ?? []).filter((location) => location.include).length,
    [locations],
  );
  const missingCount = useMemo(
    () =>
      (locations ?? []).filter(
        (location) => location.include && healthById.get(location.id) === false,
      ).length,
    [locations, healthById],
  );
  const latestBackup = backups?.[0] ?? null;

  const filteredBackups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (backups ?? []).filter((backup) => {
      if (kindFilter !== "all" && backup.kind !== kindFilter) return false;
      if (!query) return true;
      return (
        (backup.note ?? "").toLowerCase().includes(query) ||
        backup.kind.toLowerCase().includes(query) ||
        backup.status.toLowerCase().includes(query)
      );
    });
  }, [backups, kindFilter, search]);

  const handleBackup = useCallback(
    async (customNote?: string | null) => {
      setBusy("backup");
      try {
        const backup = await invoke<SaveBackup>("saves_backup_game", {
          gameId,
          note: customNote && customNote.trim() ? customNote.trim() : null,
        });
        showToast(
          t("saves.toast.backupDone", {
            count: backup.fileCount,
            size: formatBytes(backup.totalBytes),
          }),
          "success",
        );
        setNoteOpen(false);
        setNote("");
        await load(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusy(null);
      }
    },
    [gameId, load, showToast, t, formatBytes],
  );

  const handleDetect = useCallback(async () => {
    setBusy("detect");
    try {
      const before = locations?.length ?? 0;
      const list = await invoke<SaveLocation[]>("saves_detect_locations", {
        gameId,
        includePcgw: true,
      });
      setLocations(list);
      const added = Math.max(0, list.length - before);
      showToast(t("saves.toast.scanGame", { count: added }), added > 0 ? "success" : "info");
      await load(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }, [gameId, locations, load, showToast, t]);

  const toggleInclude = useCallback(
    async (location: SaveLocation) => {
      try {
        await invoke("saves_update_location", {
          location: { ...location, include: !location.include },
        });
        setLocations((prev) =>
          prev
            ? prev.map((item) =>
                item.id === location.id ? { ...item, include: !item.include } : item,
              )
            : prev,
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [showToast],
  );

  const removeLocation = useCallback(
    async (location: SaveLocation) => {
      try {
        await invoke("saves_remove_location", { id: location.id });
        setLocations((prev) => (prev ? prev.filter((item) => item.id !== location.id) : prev));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [showToast],
  );

  const openBackupFolder = useCallback(
    (backup: SaveBackup) => {
      void openBackup(backup.id).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : String(err), "error");
      });
    },
    [openBackup, showToast],
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setConfirmBusy(true);
    try {
      if (pending.kind === "restore") {
        const result = await restoreBackup(pending.backup.id);
        showToast(
          t("saves.toast.restoreDone", { count: result.restoredFiles }),
          result.warnings.length > 0 ? "info" : "success",
        );
      } else {
        await deleteBackup(pending.backup.id);
        setBackups((prev) =>
          prev ? prev.filter((backup) => backup.id !== pending.backup.id) : prev,
        );
        showToast(t("saves.toast.backupDeleted"), "info");
      }
      await load(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmBusy(false);
      setPending(null);
    }
  }, [pending, restoreBackup, deleteBackup, load, showToast, t]);

  if (!enabled) return null;

  const subtabs: SubTabItem<GameSubtab>[] = [
    { id: "snapshots", label: t("saves.gameTab.snapshots"), icon: Archive, count: totalSnapshots },
    { id: "locations", label: t("saves.gameTab.locations"), icon: FolderOpen, count: locations?.length ?? 0 },
    { id: "settings", label: t("saves.gameTab.settings"), icon: SlidersHorizontal },
  ];

  const stats: StatBandItem[] = [
    {
      id: "snapshots",
      label: t("saves.kpi.backups"),
      value: totalSnapshots,
      detail: formatBytes(totalBytes),
      tone: "accent",
      icon: <Archive size={14} />,
    },
    {
      id: "storage",
      label: t("saves.kpi.storageUsed"),
      value: formatBytes(totalBytes),
      tone: "info",
      icon: <HardDrive size={14} />,
    },
    {
      id: "locations",
      label: t("saves.kpi.locations"),
      value: includedCount,
      detail: t("saves.pane.locationsDetail", { total: locations?.length ?? 0 }),
      tone: missingCount > 0 ? "danger" : "default",
      icon: <FolderOpen size={14} />,
    },
    {
      id: "last",
      label: t("saves.kpi.lastBackup"),
      value: latestBackup
        ? formatRelative(latestBackup.createdAt, language)
        : t("saves.kpi.never"),
      icon: <Clock size={14} />,
    },
  ];

  return (
    <div className="saves-tab">
      <div className="saves-tab__head">
        <div className="saves-tab__intro">
          <h2 className="saves-tab__title">{t("saves.tab.title")}</h2>
          <p className="saves-tab__subtitle">{t("saves.tab.subtitle")}</p>
        </div>
        <div className="saves-tab__actions">
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => void handleDetect()}
            isLoading={busy === "detect"}
            disabled={busy !== null}
            title={t("saves.action.rescan")}
          >
            {t("saves.action.rescan")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => {
              setSubtab("locations");
              setAddOpen(true);
            }}
          >
            {t("saves.action.addLocation")}
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<FileText size={14} />}
            onClick={() => setNoteOpen((open) => !open)}
            disabled={busy !== null || includedCount === 0}
            aria-expanded={noteOpen}
          >
            {t("saves.snapshot.takeWithNote")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Zap size={14} />}
            onClick={() => void handleBackup(null)}
            isLoading={busy === "backup"}
            disabled={busy !== null || includedCount === 0}
          >
            {t("saves.action.backupNow")}
          </Button>
        </div>
      </div>

      {noteOpen && (
        <div className="saves-note">
          <input
            type="text"
            className="saves-input"
            placeholder={t("saves.snapshot.notePlaceholder")}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleBackup(note);
              if (event.key === "Escape") setNoteOpen(false);
            }}
            aria-label={t("saves.snapshot.notePlaceholder")}
            autoFocus
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleBackup(note)}
            isLoading={busy === "backup"}
          >
            {t("saves.action.backupNow")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {inProgress && progress && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div
            className="saves-progress__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
          >
            <div
              className="saves-progress__fill"
              style={{ width: `${Math.max(4, progress.percent)}%` }}
            />
          </div>
          <span className="saves-progress__label">
            {progress.message || t("saves.progress.working")}
          </span>
        </div>
      )}

      <StatBand items={stats} ariaLabel={t("saves.pane.statsLabel")} />

      <SubTabs
        items={subtabs}
        value={subtab}
        onChange={setSubtab}
        ariaLabel={t("saves.viewsLabel")}
        className="saves-game-subtabs"
      />

      {subtab === "snapshots" && (
        <Panel
          heading={t("saves.backups.title")}
          actions={
            <span className="saves-section__count">
              {t("saves.backups.count", { count: filteredBackups.length })}
            </span>
          }
        >
          <div className="saves-timeline__bar">
            <div className="saves-timeline__search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("saves.snapshots.searchPlaceholder")}
                aria-label={t("saves.snapshots.searchPlaceholder")}
              />
            </div>
          </div>
          <div className="saves-timeline__chips" role="group" aria-label={t("saves.filterByType")}>
            {(["all", "manual", "auto-exit", "pre-restore"] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={`saves-chip${kindFilter === item ? " is-active" : ""}`}
                aria-pressed={kindFilter === item}
                onClick={() => setKindFilter(item)}
              >
                {item === "all"
                  ? t("saves.snapshots.allKinds")
                  : t(SAVE_KIND_LABEL_KEY[item])}
              </button>
            ))}
          </div>

          {backups === null ? (
            <div className="saves-timeline__skeleton" aria-busy="true">
              <Skeleton width="100%" height="56px" />
              <Skeleton width="100%" height="56px" />
            </div>
          ) : filteredBackups.length === 0 ? (
            <div className="saves-empty saves-empty--compact">
              <p className="saves-empty__title">
                {backups.length === 0
                  ? t("saves.snapshots.noneTitle")
                  : t("saves.snapshots.emptyFilter")}
              </p>
              <p className="saves-empty__text">{t("saves.snapshots.noneText")}</p>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Zap size={14} />}
                onClick={() => void handleBackup(null)}
                isLoading={busy === "backup"}
                disabled={includedCount === 0}
              >
                {t("saves.action.backupNow")}
              </Button>
            </div>
          ) : (
            <ul className="saves-snaps">
              {filteredBackups.map((backup) => (
                <SnapshotRow
                  key={backup.id}
                  backup={backup}
                  onOpenDetails={() => setDrawer(backup)}
                  onRestore={() => setPending({ kind: "restore", backup })}
                  onOpenFolder={() => openBackupFolder(backup)}
                  onDelete={() => setPending({ kind: "delete", backup })}
                />
              ))}
            </ul>
          )}
        </Panel>
      )}

      {subtab === "locations" && (
        <Panel
          heading={t("saves.locations.title")}
          actions={
            <div className="saves-section__actions">
              <span className="saves-section__count">
                {t("saves.locations.count", { count: includedCount })}
              </span>
              <Button
                variant="tertiary"
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => setAddOpen((open) => !open)}
                aria-expanded={addOpen}
              >
                {t("saves.action.addLocation")}
              </Button>
            </div>
          }
        >
          {addOpen && (
            <AddLocationForm
              gameId={gameId}
              onAdded={() => {
                setAddOpen(false);
                void load(false);
              }}
              onCancel={() => setAddOpen(false)}
            />
          )}

          {locations === null ? (
            <div className="saves-timeline__skeleton" aria-busy="true">
              <Skeleton width="100%" height="44px" />
              <Skeleton width="100%" height="44px" />
            </div>
          ) : locations.length === 0 ? (
            <div className="saves-empty saves-empty--compact">
              <p className="saves-empty__title">{t("saves.locations.emptyTitle")}</p>
              <p className="saves-empty__text">{t("saves.locations.emptyText")}</p>
              <div className="saves-empty__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw size={14} />}
                  onClick={() => void handleDetect()}
                  isLoading={busy === "detect"}
                >
                  {t("saves.action.scanForSaves")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => setAddOpen(true)}
                >
                  {t("saves.action.addLocation")}
                </Button>
              </div>
            </div>
          ) : (
            <SaveLocationList
              locations={locations}
              health={healthById}
              onToggle={(location) => void toggleInclude(location)}
              onOpen={(location) => {
                void openLocation(location.id).catch((err: unknown) =>
                  showToast(err instanceof Error ? err.message : String(err), "error"),
                );
              }}
              onRemove={(location) => void removeLocation(location)}
            />
          )}
        </Panel>
      )}

      {subtab === "settings" && settings && (
        <div className="saves-settings">
          <Panel heading={t("saves.settings.title")}>
            <div className="saves-settings-grid">
              <SettingsToggleCard
                title={t("saves.settings.autoExitTitle")}
                desc={t("saves.settings.autoExitDesc")}
                checked={settings.autoBackupOnExit}
                onChange={(checked) => void updateSettings({ autoBackupOnExit: checked })}
              />
              <SettingsToggleCard
                title={t("saves.settings.safetyTitle")}
                desc={t("saves.settings.safetyDesc")}
                checked={settings.restoreSafetySnapshot}
                onChange={(checked) => void updateSettings({ restoreSafetySnapshot: checked })}
              />
            </div>
          </Panel>

          <Panel heading={t("saves.settings.storageTitle")}>
            <div className="saves-setting-row">
              <div className="saves-setting-row__text">
                <span className="saves-setting-row__label">{t("saves.settings.backupDir")}</span>
                <span className="saves-setting-row__path" title={settings.backupDir}>
                  {settings.backupDir || "—"}
                </span>
              </div>
              <div className="saves-setting-row__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<FolderOpen size={14} />}
                  onClick={() => void invoke("saves_open_path", { path: settings.backupDir })}
                >
                  {t("saves.action.openFolder")}
                </Button>
              </div>
            </div>

            <div className="saves-setting-row">
              <div className="saves-setting-row__text">
                <span className="saves-setting-row__label">{t("saves.settings.retention")}</span>
                <span className="saves-setting-row__hint">{t("saves.settings.retentionHint")}</span>
              </div>
              <div className="saves-setting-row__actions">
                <Badge variant="default">
                  {settings.retention === 0
                    ? t("saves.settings.retentionUnlimited")
                    : t("saves.settings.retentionPerGame", { count: settings.retention })}
                </Badge>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <SnapshotDrawer
        backup={drawer}
        onClose={() => setDrawer(null)}
        onRestore={(backup) => {
          setDrawer(null);
          setPending({ kind: "restore", backup });
        }}
        onDelete={(backup) => {
          setDrawer(null);
          setPending({ kind: "delete", backup });
        }}
        onOpenFolder={(backup) => openBackupFolder(backup)}
      />

      <ConfirmModal
        open={pending !== null}
        busy={confirmBusy}
        title={
          pending?.kind === "restore"
            ? t("saves.confirm.restoreTitle", { name: gameName })
            : t("saves.confirm.deleteTitle")
        }
        message={
          pending?.kind === "restore"
            ? t("saves.confirm.restoreMessage", {
                when: formatRelative(pending?.backup.createdAt ?? 0, language),
              })
            : t("saves.confirm.deleteMessage")
        }
        warning={pending?.kind === "restore" ? t("saves.confirm.restoreWarning") : undefined}
        confirmLabel={pending?.kind === "restore" ? "saves.action.restore" : "common.delete"}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
