import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Archive, Clock, Upload, Zap } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSaves } from "../../context/SavesContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Badge, Button, ConfirmModal } from "../ui";
import type { SaveBackup } from "../../types/saves";
import { formatRelative } from "./SaveBackupTab";

interface GameSaveBackupCardProps {
  gameId: string;
  gameName: string;
  /** Jump to the game's Saves tab for the full history and location editor. */
  onManage?: () => void;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger"> = {
  complete: "success",
  partial: "warning",
  failed: "danger",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  complete: "saves.status.complete",
  partial: "saves.status.partial",
  failed: "saves.status.failed",
};

/**
 * GameSaveBackupCard — the Overview-tab save snapshots summary. Backs up and
 * restores the latest *usable* snapshot inline; the Saves tab stays the place
 * for the full history, per-location editor, and snapshot notes.
 */
export default function GameSaveBackupCard({
  gameId,
  gameName,
  onManage,
}: GameSaveBackupCardProps) {
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const { enabled, restoreBackup } = useSaves();
  const { formatBytes } = useSizeUnit();

  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [busy, setBusy] = useState<null | "backup">(null);
  const [pendingRestore, setPendingRestore] = useState<SaveBackup | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackups(await invoke<SaveBackup[]>("saves_list_backups", { gameId }));
    } catch {
      setBackups([]);
    }
  }, [gameId]);

  useEffect(() => {
    if (!enabled) return;
    setBackups(null);
    void load();
  }, [enabled, load]);

  const handleBackup = useCallback(async () => {
    setBusy("backup");
    try {
      const backup = await invoke<SaveBackup>("saves_backup_game", { gameId, note: null });
      showToast(
        t("saves.toast.backupDone", {
          count: backup.fileCount,
          size: formatBytes(backup.totalBytes),
        }),
        "success"
      );
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }, [gameId, load, showToast, t, formatBytes]);

  const handleRestore = useCallback(async () => {
    if (!pendingRestore) return;
    setConfirmBusy(true);
    try {
      const result = await restoreBackup(pendingRestore.id);
      showToast(
        t("saves.toast.restoreDone", { count: result.restoredFiles }),
        result.warnings.length > 0 ? "info" : "success"
      );
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmBusy(false);
      setPendingRestore(null);
    }
  }, [pendingRestore, restoreBackup, load, showToast, t]);

  if (!enabled) {
    return null;
  }

  // The newest snapshot may be an empty pre-restore safety capture; restore
  // should target the newest one that actually holds files.
  const latest = backups?.find((b) => b.fileCount > 0) ?? null;

  return (
    <section className="game-section game-save-backup-card" aria-label={t("saves.tab.title")}>
      <div className="game-save-backup-card__header">
        <div className="game-save-backup-card__title-row">
          <span className="game-save-backup-card__title-icon" aria-hidden>
            <Archive size={16} />
          </span>
          <span>{t("saves.tab.title")}</span>
        </div>
        {onManage && (
          <button type="button" className="game-save-backup-card__link" onClick={onManage}>
            {t("saves.action.manage")} →
          </button>
        )}
      </div>

      {backups === null ? (
        <div className="game-save-backup-card__skeleton" aria-hidden>
          <span />
          <span />
        </div>
      ) : latest ? (
        <div className="game-save-backup-card__body">
          <div className="game-save-backup-card__chips">
            <Badge variant={STATUS_VARIANT[latest.status] ?? "default"} size="sm">
              {t(STATUS_LABEL_KEY[latest.status] ?? "saves.status.complete")}
            </Badge>
            <span className="game-save-backup-card__count">
              {t("saves.backups.count", { count: backups.length })}
            </span>
          </div>
          <div className="game-save-backup-card__meta">
            <Clock size={12} />
            <span>{t("saves.game.lastBackup", { when: formatRelative(latest.createdAt, language) })}</span>
            <span>·</span>
            <span>
              {t("saves.backups.meta", {
                files: latest.fileCount,
                size: formatBytes(latest.totalBytes),
              })}
            </span>
          </div>
          <div className="game-save-backup-card__actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBackup()}
              isLoading={busy === "backup"}
            >
              <Zap size={13} />
              {t("saves.action.backupNow")}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPendingRestore(latest)}>
              <Upload size={13} />
              {t("saves.action.restore")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="game-save-backup-card__body">
          <p className="game-save-backup-card__empty">{t("saves.backups.emptyText")}</p>
          <div className="game-save-backup-card__actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleBackup()}
              isLoading={busy === "backup"}
            >
              <Zap size={13} />
              {t("saves.action.backupNow")}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingRestore !== null}
        busy={confirmBusy}
        title={t("saves.confirm.restoreTitle", { name: gameName })}
        message={t("saves.confirm.restoreMessage", {
          when: formatRelative(pendingRestore?.createdAt ?? 0, language),
        })}
        warning={t("saves.confirm.restoreWarning")}
        confirmLabel="saves.action.restore"
        onConfirm={() => void handleRestore()}
        onCancel={() => setPendingRestore(null)}
      />
    </section>
  );
}
