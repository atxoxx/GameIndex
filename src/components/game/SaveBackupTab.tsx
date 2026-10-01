import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Button, Badge, ConfirmModal, Skeleton } from "../ui";
import {
  SAVE_KIND_LABEL_KEY,
  SAVE_SOURCE_LABEL_KEY,
  type SaveBackup,
  type SaveLocation,
} from "../../types/saves";

/** Compact relative time, localized via `Intl.RelativeTimeFormat`. */
export function formatRelative(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
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

interface SaveBackupTabProps {
  gameId: string;
  gameName: string;
}

/**
 * SaveBackupTab — the per-game "Saves" subtab.
 *
 * Lists the game's detected/manual save locations and its snapshot
 * history, and exposes Back up / Restore / Add location. Auto-detection
 * runs once on first open so a new user sees real results without having
 * to understand paths first.
 */
export default function SaveBackupTab({ gameId, gameName }: SaveBackupTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { enabled, progress, restoreBackup, deleteBackup, openBackup, openPath } = useSaves();
  const { formatBytes } = useSizeUnit();

  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [busy, setBusy] = useState<null | "detect" | "backup">(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addPath, setAddPath] = useState("");
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

  const handleBackup = useCallback(async () => {
    setBusy("backup");
    try {
      const backup = await invoke<SaveBackup>("saves_backup_game", {
        gameId,
        note: null,
      });
      showToast(
        t("saves.toast.backupDone", {
          count: backup.fileCount,
          size: formatBytes(backup.totalBytes),
        }),
        "success"
      );
      await load(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }, [gameId, load, showToast, t, formatBytes]);

  const handleDetect = useCallback(async () => {
    setBusy("detect");
    try {
      const before = locations?.length ?? 0;
      const list = await invoke<SaveLocation[]>("saves_detect_locations", { gameId });
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
        label: null,
      });
      setAddPath("");
      setAddOpen(false);
      await load(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [addPath, gameId, load, showToast]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
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
        setBackups((prev) =>
          prev ? prev.filter((b) => b.id !== pending.backup.id) : prev
        );
        showToast(t("saves.toast.backupDeleted"), "info");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmBusy(false);
      setPending(null);
    }
  }, [pending, restoreBackup, deleteBackup, load, showToast, t]);

  const includedCount = useMemo(
    () => (locations ?? []).filter((l) => l.include).length,
    [locations]
  );

  if (!enabled) {
    return null;
  }

  return (
    <div className="saves-tab">
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
          >
            {t("saves.action.rescan")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAddOpen((o) => !o)}>
            {t("saves.action.addLocation")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleBackup}
            isLoading={busy === "backup"}
            disabled={busy !== null || includedCount === 0}
          >
            {t("saves.action.backupNow")}
          </Button>
        </div>
      </div>

      {inProgress && progress && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div className="saves-progress__bar">
            <div
              className="saves-progress__fill"
              style={{ width: `${Math.max(4, progress.percent)}%` }}
            />
          </div>
          <span className="saves-progress__label">{progress.message || t("saves.progress.working")}</span>
        </div>
      )}

      {addOpen && (
        <div className="saves-add-row">
          <input
            type="text"
            className="saves-input"
            placeholder={t("saves.add.placeholder")}
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
            aria-label={t("saves.add.placeholder")}
          />
          <Button variant="secondary" size="sm" onClick={handleBrowse}>
            {t("saves.action.browse")}
          </Button>
          <Button variant="primary" size="sm" onClick={handleAdd} disabled={!addPath.trim()}>
            {t("saves.action.add")}
          </Button>
        </div>
      )}

      <section className="saves-card">
        <header className="saves-card__header">
          <h3 className="saves-card__title">{t("saves.locations.title")}</h3>
          <span className="saves-card__count">
            {t("saves.locations.count", { count: includedCount })}
          </span>
        </header>

        {locations === null ? (
          <div className="saves-card__skeleton">
            <Skeleton width="100%" height="44px" />
            <Skeleton width="100%" height="44px" />
          </div>
        ) : locations.length === 0 ? (
          <div className="saves-empty">
            <p className="saves-empty__title">{t("saves.locations.emptyTitle")}</p>
            <p className="saves-empty__text">{t("saves.locations.emptyText")}</p>
            <Button variant="primary" size="sm" onClick={handleDetect} isLoading={busy === "detect"}>
              {t("saves.action.scanForSaves")}
            </Button>
          </div>
        ) : (
          <ul className="saves-location-list">
            {locations.map((loc) => (
              <li key={loc.id} className={`saves-location${loc.include ? "" : " is-excluded"}`}>
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
                    <span className="saves-location__label">{loc.label || t("saves.locations.untitled")}</span>
                    <Badge variant={sourceVariant(loc.source)} size="sm">
                      {t(SAVE_SOURCE_LABEL_KEY[loc.source] ?? "saves.source.manual")}
                    </Badge>
                    <Badge variant="default" size="sm">
                      {loc.kind === "file" ? t("saves.locations.kindFile") : t("saves.locations.kindFolder")}
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="saves-icon-btn saves-icon-btn--danger"
                    onClick={() => void removeLocation(loc)}
                    title={t("saves.action.removeLocation")}
                    aria-label={t("saves.action.removeLocation")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="saves-card">
        <header className="saves-card__header">
          <h3 className="saves-card__title">{t("saves.backups.title")}</h3>
          <span className="saves-card__count">
            {t("saves.backups.count", { count: backups?.length ?? 0 })}
          </span>
        </header>

        {backups === null ? (
          <div className="saves-card__skeleton">
            <Skeleton width="100%" height="44px" />
          </div>
        ) : backups.length === 0 ? (
          <div className="saves-empty">
            <p className="saves-empty__title">{t("saves.backups.emptyTitle")}</p>
            <p className="saves-empty__text">{t("saves.backups.emptyText")}</p>
          </div>
        ) : (
          <ul className="saves-backup-list">
            {backups.map((backup) => (
              <li key={backup.id} className="saves-backup">
                <div className="saves-backup__body">
                  <div className="saves-backup__top">
                    <Badge variant={backup.kind === "manual" ? "accent" : "info"} size="sm">
                      {t(SAVE_KIND_LABEL_KEY[backup.kind] ?? "saves.kind.manual")}
                    </Badge>
                    <span className="saves-backup__when">{formatRelative(backup.createdAt)}</span>
                    <Badge variant={statusVariant(backup.status)} size="sm">
                      {t(`saves.status.${backup.status}`)}
                    </Badge>
                  </div>
                  <span className="saves-backup__meta">
                    {t("saves.backups.meta", {
                      files: backup.fileCount,
                      size: formatBytes(backup.totalBytes),
                    })}
                  </span>
                  {backup.note && <span className="saves-backup__note">{backup.note}</span>}
                </div>
                <div className="saves-backup__actions">
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="saves-icon-btn saves-icon-btn--danger"
                    onClick={() => setPending({ kind: "delete", backup })}
                    title={t("saves.action.deleteBackup")}
                    aria-label={t("saves.action.deleteBackup")}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

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
            ? t("saves.confirm.restoreMessage", { when: formatRelative(pending?.backup.createdAt ?? 0) })
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
