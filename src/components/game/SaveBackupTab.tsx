import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
  Trash2,
  Zap,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { usePersistedState } from "../../hooks/usePersistedState";
import { Button, Badge, ConfirmModal, KpiTile, Skeleton } from "../ui";
import SettingsToggleCard from "../../pages/settings/SettingsToggleCard";
import {
  SAVE_KIND_LABEL_KEY,
  SAVE_SOURCE_LABEL_KEY,
  type SaveBackup,
  type SaveBackupKind,
  type SaveLocation,
} from "../../types/saves";

/**
 * Compact relative time, localized via `Intl.RelativeTimeFormat`.
 * `locale` must be the app language: passing `undefined` falls back to the OS
 * locale, which mixes languages (e.g. "il y a 5 minutes" under an English UI).
 */
export function formatRelative(ms: number, locale?: string): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return rtf.format(0, "second");
  if (abs < hour) return rtf.format(-Math.round(diff / minute), "minute");
  if (abs < day) return rtf.format(-Math.round(diff / hour), "hour");
  if (abs < 30 * day) return rtf.format(-Math.round(diff / day), "day");
  if (abs < 365 * day) return rtf.format(-Math.round(diff / (30 * day)), "month");
  return rtf.format(-Math.round(diff / (365 * day)), "year");
}

function sourceVariant(source: string): "info" | "success" | "accent" | "default" | "warning" {
  switch (source) {
    case "curated":
      return "accent";
    case "steam":
      return "info";
    case "pcgamingwiki":
      return "info";
    case "emulator":
      return "success";
    case "manual":
      return "default";
    default:
      return "default";
  }
}

function statusVariant(status: string): "success" | "warning" | "danger" {
  if (status === "failed") return "danger";
  if (status === "partial") return "warning";
  return "success";
}

type GameSubtab = "snapshots" | "locations" | "settings";
type SnapshotKindFilter = "all" | SaveBackupKind;

interface SaveBackupTabProps {
  gameId: string;
  gameName: string;
}

/**
 * SaveBackupTab — the per-game "Sauvegardes / Saves" subtab.
 *
 * Provides a modular, 3-subtab experience:
 *   1. Snapshots & Timeline: KPI dashboard, 1-click snapshot, note annotation, timeline feed & restoration.
 *   2. Save Locations: Multi-path management, curated/cloud badges, custom folder/file selector.
 *   3. Game Settings: Per-game automation rules, safety snapshots, and retention configuration.
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
    openPath,
    updateSettings,
  } = useSaves();
  const { formatBytes } = useSizeUnit();

  const [subtab, setSubtab] = usePersistedState<GameSubtab>("gamelib.game.save_backup.subtab_v1", "snapshots", ["snapshots", "locations", "settings"]);
  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [busy, setBusy] = useState<null | "detect" | "backup">(null);

  // Snapshot note drawer
  const [noteOpen, setNoteOpen] = useState(false);
  const [customNote, setCustomNote] = useState("");

  // Add location drawer
  const [addOpen, setAddOpen] = useState(false);
  const [addPath, setAddPath] = useState("");
  const [addLabel, setAddLabel] = useState("");

  // Timeline search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<SnapshotKindFilter>("all");

  const [pending, setPending] = useState<null | { kind: "restore" | "delete"; backup: SaveBackup }>(
    null
  );
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(
    async (detectIfEmpty: boolean) => {
      try {
        let list = await invoke<SaveLocation[]>("saves_list_locations", { gameId });
        if (detectIfEmpty && list.length === 0) {
          list = await invoke<SaveLocation[]>("saves_detect_locations", { gameId });
        }
        const history = await invoke<SaveBackup[]>("saves_list_backups", { gameId });
        setLocations(list);
        setBackups(history);
      } catch {
        setLocations([]);
        setBackups([]);
      }
    },
    [gameId]
  );

  useEffect(() => {
    if (!enabled) return;
    setLocations(null);
    setBackups(null);
    void load(true);
  }, [enabled, load]);

  const inProgress = progress?.gameId === gameId || progress?.phase === "scan";

  // KPIs
  const totalSnapshots = backups?.length ?? 0;
  const totalBytes = useMemo(
    () => (backups ?? []).reduce((acc, b) => acc + b.totalBytes, 0),
    [backups]
  );
  const includedCount = useMemo(
    () => (locations ?? []).filter((l) => l.include).length,
    [locations]
  );
  const latestBackup = backups?.[0] ?? null;

  // Filtered timeline
  const filteredBackups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (backups ?? []).filter((b) => {
      if (kindFilter !== "all" && b.kind !== kindFilter) return false;
      if (q) {
        const noteMatches = b.note ? b.note.toLowerCase().includes(q) : false;
        const statusMatches = b.status.toLowerCase().includes(q);
        if (!noteMatches && !statusMatches) return false;
      }
      return true;
    });
  }, [backups, kindFilter, searchQuery]);

  const handleBackup = useCallback(
    async (note?: string | null) => {
      setBusy("backup");
      try {
        const backup = await invoke<SaveBackup>("saves_backup_game", {
          gameId,
          note: note && note.trim() ? note.trim() : null,
        });
        showToast(
          t("saves.toast.backupDone", {
            count: backup.fileCount,
            size: formatBytes(backup.totalBytes),
          }),
          "success"
        );
        setNoteOpen(false);
        setCustomNote("");
        await load(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusy(null);
      }
    },
    [gameId, load, showToast, t, formatBytes]
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }, [gameId, locations, showToast, t]);

  const handleAdd = useCallback(async () => {
    if (!addPath.trim()) return;
    try {
      await invoke<SaveLocation>("saves_add_location", {
        gameId,
        path: addPath.trim(),
        label: addLabel.trim() || null,
      });
      setAddPath("");
      setAddLabel("");
      setAddOpen(false);
      await load(false);
      showToast(t("saves.toast.gameBackedUp", { name: gameName }), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [addPath, addLabel, gameId, gameName, load, showToast, t]);

  const handleBrowseDir = useCallback(async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) setAddPath(picked);
    } catch {
      /* cancelled */
    }
  }, []);

  const handleBrowseFile = useCallback(async () => {
    try {
      const picked = await open({ directory: false, multiple: false });
      if (typeof picked === "string" && picked) setAddPath(picked);
    } catch {
      /* cancelled */
    }
  }, []);

  const toggleInclude = useCallback(
    async (loc: SaveLocation) => {
      try {
        await invoke<SaveLocation>("saves_update_location", {
          location: { ...loc, include: !loc.include },
        });
        setLocations((prev) =>
          prev ? prev.map((l) => (l.id === loc.id ? { ...l, include: !l.include } : l)) : prev
        );
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [showToast]
  );

  const removeLocation = useCallback(
    async (loc: SaveLocation) => {
      try {
        await invoke<number>("saves_remove_location", { id: loc.id });
        setLocations((prev) => (prev ? prev.filter((l) => l.id !== loc.id) : prev));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [showToast]
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setConfirmBusy(true);
    try {
      if (pending.kind === "restore") {
        const result = await restoreBackup(pending.backup.id);
        showToast(
          t("saves.toast.restoreDone", { count: result.restoredFiles }),
          result.warnings.length > 0 ? "info" : "success"
        );
        await load(false);
      } else {
        await deleteBackup(pending.backup.id);
        setBackups((prev) => (prev ? prev.filter((b) => b.id !== pending.backup.id) : prev));
        showToast(t("saves.toast.backupDeleted"), "info");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmBusy(false);
      setPending(null);
    }
  }, [pending, restoreBackup, deleteBackup, load, showToast, t]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="saves-tab">
      {/* ─── Top Header & Primary Action Bar ────────────────────────────── */}
      <div className="saves-tab__toolbar">
        <div className="saves-tab__toolbar-text">
          <h2 className="saves-tab__title">{t("saves.tab.title")}</h2>
          <p className="saves-tab__subtitle">{t("saves.tab.subtitle")}</p>
        </div>

        <div className="saves-tab__actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDetect}
            isLoading={busy === "detect"}
            disabled={busy !== null}
            title={t("saves.action.rescan")}
          >
            <RefreshCw size={14} />
            {t("saves.action.rescan")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAddOpen((o) => !o);
              if (!addOpen) setSubtab("locations");
            }}
          >
            <Plus size={14} />
            {t("saves.action.addLocation")}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNoteOpen((o) => !o)}
            disabled={busy !== null || includedCount === 0}
          >
            <FileText size={14} />
            {t("saves.snapshot.takeWithNote")}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleBackup(null)}
            isLoading={busy === "backup"}
            disabled={busy !== null || includedCount === 0}
          >
            <Zap size={14} />
            {t("saves.action.backupNow")}
          </Button>
        </div>
      </div>

      {/* ─── Optional Snapshot Note Drawer ──────────────────────────────── */}
      {noteOpen && (
        <div className="saves-note-drawer">
          <span className="saves-card__title" style={{ fontSize: "0.86rem" }}>
            {t("saves.snapshot.createTitle")}
          </span>
          <div className="saves-note-drawer__inputs">
            <input
              type="text"
              className="saves-input saves-note-drawer__input"
              placeholder={t("saves.snapshot.notePlaceholder")}
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleBackup(customNote);
              }}
              autoFocus
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBackup(customNote)}
              isLoading={busy === "backup"}
            >
              <Zap size={13} />
              {t("saves.action.backupNow")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Shared Progress Bar ────────────────────────────────────────── */}
      {inProgress && progress && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div className="saves-progress__bar">
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

      {/* ─── 4 KPI Tiles Summary ────────────────────────────────────────── */}
      <div className="saves-game-kpis">
        <KpiTile
          label={t("saves.kpi.backups")}
          value={totalSnapshots}
          icon={<Archive size={15} />}
          intent="accent"
          size="sm"
        />
        <KpiTile
          label={t("saves.kpi.storageUsed")}
          value={formatBytes(totalBytes)}
          icon={<HardDrive size={15} />}
          intent="info"
          size="sm"
        />
        <KpiTile
          label={t("saves.kpi.locations")}
          value={includedCount}
          icon={<FolderOpen size={15} />}
          subtext={
            locations?.length !== includedCount
              ? `${includedCount}/${locations?.length ?? 0}`
              : undefined
          }
          intent={includedCount === 0 ? "warning" : "default"}
          size="sm"
        />
        <KpiTile
          label={t("saves.kpi.lastBackup")}
          value={
            latestBackup ? formatRelative(latestBackup.createdAt, language) : t("saves.kpi.never")
          }
          icon={<Clock size={15} />}
          size="sm"
        />
      </div>

      {/* ─── Per-Game Subtabs Bar ───────────────────────────────────────── */}
      <nav className="saves-game-subtabs-bar" aria-label="Game save views">
        <button
          type="button"
          className={`saves-game-subtab-pill ${subtab === "snapshots" ? "active" : ""}`}
          onClick={() => setSubtab("snapshots")}
        >
          <Archive size={14} />
          <span>{t("saves.gameTab.snapshots")}</span>
          {totalSnapshots > 0 && (
            <span className="saves-subtab-badge">{totalSnapshots}</span>
          )}
        </button>

        <button
          type="button"
          className={`saves-game-subtab-pill ${subtab === "locations" ? "active" : ""}`}
          onClick={() => setSubtab("locations")}
        >
          <FolderOpen size={14} />
          <span>{t("saves.gameTab.locations")}</span>
          {(locations?.length ?? 0) > 0 && (
            <span className="saves-subtab-badge">{locations?.length}</span>
          )}
        </button>

        <button
          type="button"
          className={`saves-game-subtab-pill ${subtab === "settings" ? "active" : ""}`}
          onClick={() => setSubtab("settings")}
        >
          <SlidersHorizontal size={14} />
          <span>{t("saves.gameTab.settings")}</span>
        </button>
      </nav>

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 1: SNAPSHOTS & TIMELINE
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "snapshots" && (
        <section className="saves-card">
          <header className="saves-card__header">
            <h3 className="saves-card__title">{t("saves.backups.title")}</h3>
            <span className="saves-card__count">
              {t("saves.backups.count", { count: filteredBackups.length })}
            </span>
          </header>

          {/* Timeline Filter Toolbar */}
          <div className="saves-toolbar" style={{ marginTop: 0 }}>
            <div
              className="saves-input-wrapper"
              style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}
            >
              <input
                type="search"
                className="saves-input"
                style={{ width: "100%", paddingLeft: 34 }}
                placeholder={t("saves.snapshots.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 11,
                  top: 10,
                  color: "var(--color-text-muted)",
                  pointerEvents: "none",
                }}
              />
            </div>

            <div className="saves-filter-pills">
              <button
                type="button"
                className={`saves-filter-pill ${kindFilter === "all" ? "active" : ""}`}
                onClick={() => setKindFilter("all")}
              >
                <span>{t("saves.snapshots.allKinds")}</span>
              </button>
              <button
                type="button"
                className={`saves-filter-pill ${kindFilter === "manual" ? "active" : ""}`}
                onClick={() => setKindFilter("manual")}
              >
                <span>{t("saves.kind.manual")}</span>
              </button>
              <button
                type="button"
                className={`saves-filter-pill ${kindFilter === "auto-exit" ? "active" : ""}`}
                onClick={() => setKindFilter("auto-exit")}
              >
                <span>{t("saves.kind.autoExit")}</span>
              </button>
              <button
                type="button"
                className={`saves-filter-pill ${kindFilter === "pre-restore" ? "active" : ""}`}
                onClick={() => setKindFilter("pre-restore")}
              >
                <span>{t("saves.kind.preRestore")}</span>
              </button>
            </div>
          </div>

          {backups === null ? (
            <div className="saves-card__skeleton">
              <Skeleton width="100%" height="56px" />
              <Skeleton width="100%" height="56px" />
            </div>
          ) : filteredBackups.length === 0 ? (
            <div className="saves-empty">
              <p className="saves-empty__title">{t("saves.backups.emptyTitle")}</p>
              <p className="saves-empty__text">{t("saves.backups.emptyText")}</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleBackup(null)}
                isLoading={busy === "backup"}
                disabled={includedCount === 0}
              >
                <Zap size={14} />
                {t("saves.action.backupNow")}
              </Button>
            </div>
          ) : (
            <ul className="saves-backup-list">
              {filteredBackups.map((backup) => (
                <li key={backup.id} className="saves-snapshot-card-rich">
                  <div className="saves-snapshot-card-main">
                    <div className="saves-snapshot-card-details">
                      <div className="saves-snapshot-card-headline">
                        <Badge
                          variant={
                            backup.kind === "manual"
                              ? "accent"
                              : backup.kind === "pre-restore"
                                ? "warning"
                                : "info"
                          }
                          size="sm"
                        >
                          {t(SAVE_KIND_LABEL_KEY[backup.kind] ?? "saves.kind.manual")}
                        </Badge>
                        <span className="saves-backup__when">
                          {formatRelative(backup.createdAt, language)}
                        </span>
                        <Badge variant={statusVariant(backup.status)} size="sm">
                          {t(`saves.status.${backup.status}`)}
                        </Badge>
                      </div>

                      <div className="saves-snapshot-card-meta">
                        <span>
                          {t("saves.backups.meta", {
                            files: backup.fileCount,
                            size: formatBytes(backup.totalBytes),
                          })}
                        </span>
                        {backup.note && (
                          <>
                            <span>·</span>
                            <span className="saves-snapshot-card-note">“{backup.note}”</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="saves-snapshot-card-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPending({ kind: "restore", backup })}
                    >
                      {t("saves.action.restore")}
                    </Button>
                    <button
                      type="button"
                      className="saves-icon-btn"
                      onClick={() => void openBackup(backup.id)}
                      title={t("saves.action.openBackup")}
                      aria-label={t("saves.action.openBackup")}
                    >
                      <FolderOpen size={15} />
                    </button>
                    <button
                      type="button"
                      className="saves-icon-btn saves-icon-btn--danger"
                      onClick={() => setPending({ kind: "delete", backup })}
                      title={t("saves.action.deleteBackup")}
                      aria-label={t("saves.action.deleteBackup")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 2: SAVE LOCATIONS
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "locations" && (
        <section className="saves-card">
          <header className="saves-card__header">
            <h3 className="saves-card__title">{t("saves.locations.title")}</h3>
            <span className="saves-card__count">
              {t("saves.locations.count", { count: includedCount })}
            </span>
          </header>

          {/* Add Location Drawer */}
          {addOpen && (
            <div className="saves-add-row" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <input
                type="text"
                className="saves-input"
                style={{ flex: 1, minWidth: 200 }}
                placeholder={t("saves.add.placeholder")}
                value={addPath}
                onChange={(e) => setAddPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAdd();
                }}
              />
              <Button variant="secondary" size="sm" onClick={handleBrowseDir}>
                <FolderOpen size={14} />
                {t("saves.locations.kindFolder")}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleBrowseFile}>
                <FileText size={14} />
                {t("saves.locations.kindFile")}
              </Button>
              <Button variant="primary" size="sm" onClick={handleAdd} disabled={!addPath.trim()}>
                {t("saves.action.add")}
              </Button>
            </div>
          )}

          {locations === null ? (
            <div className="saves-card__skeleton">
              <Skeleton width="100%" height="44px" />
              <Skeleton width="100%" height="44px" />
            </div>
          ) : locations.length === 0 ? (
            <div className="saves-empty">
              <p className="saves-empty__title">{t("saves.locations.emptyTitle")}</p>
              <p className="saves-empty__text">{t("saves.locations.emptyText")}</p>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleDetect}
                  isLoading={busy === "detect"}
                >
                  <RefreshCw size={14} />
                  {t("saves.action.scanForSaves")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus size={14} />
                  {t("saves.action.addLocation")}
                </Button>
              </div>
            </div>
          ) : (
            <ul className="saves-location-list">
              {locations.map((loc) => (
                <li
                  key={loc.id}
                  className={`saves-location${loc.include ? "" : " is-excluded"}`}
                >
                  <label className="saves-location__check" title={t("saves.locations.include")}>
                    <input
                      type="checkbox"
                      checked={loc.include}
                      onChange={() => void toggleInclude(loc)}
                      aria-label={t("saves.locations.include")}
                    />
                  </label>
                  <div className="saves-location__body">
                    <div className="saves-location__top">
                      <span className="saves-location__label">
                        {loc.label || t("saves.locations.untitled")}
                      </span>
                      <Badge variant={sourceVariant(loc.source)} size="sm">
                        {t(SAVE_SOURCE_LABEL_KEY[loc.source] ?? "saves.source.manual")}
                      </Badge>
                      <Badge variant="default" size="sm">
                        {loc.kind === "file"
                          ? t("saves.locations.kindFile")
                          : t("saves.locations.kindFolder")}
                      </Badge>
                    </div>
                    <button
                      type="button"
                      className="saves-location__path"
                      onClick={() => void openPath(loc.path)}
                      title={t("saves.action.openFolder")}
                    >
                      {loc.path}
                    </button>
                  </div>
                  <div className="saves-location__actions">
                    <button
                      type="button"
                      className="saves-icon-btn"
                      onClick={() => void openPath(loc.path)}
                      title={t("saves.action.openFolder")}
                      aria-label={t("saves.action.openFolder")}
                    >
                      <FolderOpen size={15} />
                    </button>
                    <button
                      type="button"
                      className="saves-icon-btn saves-icon-btn--danger"
                      onClick={() => void removeLocation(loc)}
                      title={t("saves.action.removeLocation")}
                      aria-label={t("saves.action.removeLocation")}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 3: GAME SETTINGS & AUTOMATION
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "settings" && settings && (
        <div className="saves-settings-panel">
          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.gameTab.settings")}</h3>
            </header>

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
          </section>

          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.settings.storageTitle")}</h3>
            </header>

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
                  onClick={() => void invoke("saves_open_path", { path: settings.backupDir })}
                >
                  <FolderOpen size={14} />
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
                  {settings.retention === 0 ? "Unlimited" : `${settings.retention} per game`}
                </Badge>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ─── Confirmation Modal ─────────────────────────────────────────── */}
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
