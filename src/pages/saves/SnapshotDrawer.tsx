import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, RotateCcw, Search, Trash2, X } from "lucide-react";
import { Button, Skeleton } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { BackupManifest, SaveBackup } from "../../types/saves";
import { formatClockTime, formatRelative } from "../../utils/savesTime";
import { SnapshotKindBadge, SnapshotStatusBadge } from "./SavesBadges";

/** File rows rendered at once; the rest are reachable through search. */
const MAX_FILES = 250;

interface SnapshotDrawerProps {
  backup: SaveBackup | null;
  onClose: () => void;
  onRestore: (backup: SaveBackup) => void;
  onDelete: (backup: SaveBackup) => void;
  onOpenFolder: (backup: SaveBackup) => void;
}

/**
 * Snapshot inspector modal.
 *
 * Reads the versioned manifest on demand rather than shipping every file list
 * with the page: a library-wide timeline can hold hundreds of snapshots, and
 * only the one the user opens needs its contents loaded.
 */
export default function SnapshotDrawer({
  backup,
  onClose,
  onRestore,
  onDelete,
  onOpenFolder,
}: SnapshotDrawerProps) {
  const { t, language } = useLanguage();
  const { formatBytes } = useSizeUnit();
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const backupId = backup?.id ?? null;

  // Return focus to the row that opened the drawer once it closes.
  useEffect(() => {
    if (backupId) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    trigger?.focus();
  }, [backupId]);

  useEffect(() => {
    if (!backupId) return;
    let cancelled = false;
    setManifest(null);
    setError(null);
    setQuery("");
    setLoaded(false);
    invoke<BackupManifest | null>("saves_get_backup_manifest", { backupId })
      .then((next) => {
        if (!cancelled) setManifest(next ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backupId]);

  useEffect(() => {
    if (!backupId) return;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [backupId]);

  useEffect(() => {
    if (!backupId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [backupId, onClose]);

  // Contain focus: the page behind the modal is not inert, so a Tab or a
  // stray controller move must not land on a snapshot row underneath.
  useEffect(() => {
    if (!backupId) return;
    const onFocusIn = (event: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      if (target && panel.contains(target)) return;
      closeRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [backupId]);

  useEffect(() => {
    if (!backupId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [backupId]);

  const files = manifest?.files ?? [];
  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files;
    return files.filter((file) => file.rel.toLowerCase().includes(needle));
  }, [files, query]);

  const groups = useMemo(() => {
    const locations = [...(manifest?.locations ?? [])].sort((a, b) => a.index - b.index);
    let remaining = MAX_FILES;
    return locations
      .map((location) => {
        const matching = filteredFiles.filter((file) => file.locationIndex === location.index);
        const visible = matching.slice(0, Math.max(0, remaining));
        remaining -= visible.length;
        return { location, files: visible, total: matching.length };
      })
      .filter((group) => group.total > 0 || query.trim() === "");
  }, [manifest, filteredFiles, query]);

  if (!backup) return null;

  const summary = manifest
    ? t("saves.drawer.summary", {
        locations: manifest.locations.length,
        files: manifest.files.length,
        size: formatBytes(backup.totalBytes),
      })
    : t("saves.backups.meta", {
        files: backup.fileCount,
        size: formatBytes(backup.totalBytes),
      });

  return createPortal(
    <div
      className="saves-drawer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="saves-drawer__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="saves-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="saves-drawer__head">
          <div className="saves-drawer__titles">
            <span className="saves-drawer__eyebrow">{t("saves.drawer.title")}</span>
            <h2 className="saves-drawer__title" id="saves-drawer-title">
              {backup.gameName}
            </h2>
            <div className="saves-drawer__badges">
              <SnapshotKindBadge kind={backup.kind} />
              <SnapshotStatusBadge status={backup.status} />
              <span className="saves-drawer__when">
                {formatRelative(backup.createdAt, language)} ·{" "}
                {formatClockTime(backup.createdAt, language)}
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="saves-icon-btn saves-drawer__close"
            onClick={onClose}
            title={t("saves.drawer.close")}
            aria-label={t("saves.drawer.close")}
          >
            <X size={17} />
          </button>
        </header>

        <div className="saves-drawer__body">
          <p className="saves-drawer__summary">{summary}</p>
          {backup.note && <p className="saves-drawer__note">“{backup.note}”</p>}

          {!loaded ? (
            <div className="saves-drawer__loading" aria-busy="true">
              <Skeleton width="100%" height="18px" />
              <Skeleton width="100%" height="18px" />
              <Skeleton width="70%" height="18px" />
            </div>
          ) : error ? (
            <p className="saves-drawer__error" role="status">
              {t("saves.drawer.error")}
            </p>
          ) : !manifest ? (
            <p className="saves-drawer__error" role="status">
              {t("saves.drawer.missingManifest")}
            </p>
          ) : (
            <>
              <div className="saves-drawer__search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("saves.drawer.search")}
                  aria-label={t("saves.drawer.search")}
                />
                {query && (
                  <button
                    type="button"
                    className="saves-drawer__search-clear"
                    onClick={() => setQuery("")}
                    aria-label={t("saves.drawer.clearSearch")}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {files.length === 0 ? (
                <p className="saves-drawer__empty">{t("saves.drawer.noFiles")}</p>
              ) : filteredFiles.length === 0 ? (
                <p className="saves-drawer__empty">{t("saves.snapshots.emptyFilter")}</p>
              ) : (
                <div className="saves-drawer__locations">
                  {groups.map(({ location, files: visible, total }) => (
                    <section className="saves-drawer__location" key={location.index}>
                      <header className="saves-drawer__location-head">
                        <div className="saves-drawer__location-title">
                          <strong>{location.label || t("saves.locations.untitled")}</strong>
                          <span>{t("saves.drawer.locationFiles", { count: total })}</span>
                        </div>
                        <code className="saves-drawer__location-path">{location.path}</code>
                      </header>
                      <ul className="saves-drawer__files">
                        {visible.map((file) => (
                          <li className="saves-file" key={`${file.locationIndex}-${file.rel}`}>
                            <span className="saves-file__name">{file.rel}</span>
                            <span className="saves-file__size">{formatBytes(file.size)}</span>
                          </li>
                        ))}
                      </ul>
                      {visible.length < total && (
                        <p className="saves-drawer__more">
                          {t("saves.drawer.showing", { shown: visible.length, total })}
                        </p>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="saves-drawer__footer">
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<FolderOpen size={15} />}
            onClick={() => onOpenFolder(backup)}
          >
            {t("saves.action.openBackup")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 size={15} />}
            onClick={() => onDelete(backup)}
            className="saves-drawer__danger"
          >
            {t("saves.action.deleteBackup")}
          </Button>
          <span className="saves-drawer__spacer" />
          <Button
            variant="primary"
            size="sm"
            leftIcon={<RotateCcw size={15} />}
            onClick={() => onRestore(backup)}
          >
            {t("saves.action.restore")}
          </Button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
