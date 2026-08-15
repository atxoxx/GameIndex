import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../../components/ui";
import type { PluginCandidate } from "../../types/plugins";

/** A file that failed validation during the bulk scan. */
export interface BulkSkippedFile {
  path: string;
  error: string;
}

export interface PluginsBulkImportModalProps {
  open: boolean;
  /** Successfully validated candidates the user can choose to install. */
  candidates: PluginCandidate[];
  /** Files that failed `plugins_import_file` during the scan. */
  skipped: BulkSkippedFile[];
  onClose: () => void;
  /** Called after the install loop finishes: (installed, failed). */
  onInstalled: (installed: number, failed: number) => void;
}

const hashLabel = (hash: string) =>
  hash.length > 24 ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : hash;

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * PluginsBulkImportModal — review gate for bulk plugin import.
 *
 * The tab scans every picked `.js` file via `plugins_import_file` and
 * hands this modal the surviving candidates plus the failures. The user
 * reviews each plugin (metadata, source, hash, security warning),
 * unchecks any they don't want, and confirms once. Installation runs
 * one plugin at a time so per-plugin errors can be surfaced inline
 * without aborting the rest of the batch.
 */
export default function PluginsBulkImportModal({
  open,
  candidates,
  skipped,
  onClose,
  onInstalled,
}: PluginsBulkImportModalProps) {
  const { t } = useLanguage();

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});

  // Reset selection + errors each time the modal opens with a fresh batch.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const c of candidates) next[c.id] = true;
    setSelected(next);
    setInstallErrors({});
    setInstalling(false);
    setProgress({ done: 0, total: 0 });
  }, [open, candidates]);

  // Escape / backdrop close — disabled while an install is in flight.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !installing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, installing, onClose]);

  const selectedIds = useMemo(
    () => candidates.filter((c) => selected[c.id]).map((c) => c.id),
    [candidates, selected],
  );
  const selectedCount = selectedIds.length;
  const allSelected = selectedCount === candidates.length && candidates.length > 0;

  const setAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const c of candidates) next[c.id] = value;
    setSelected(next);
  };

  const toggle = (id: string) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleInstall = async () => {
    if (selectedCount === 0 || installing) return;
    setInstalling(true);
    setInstallErrors({});
    setProgress({ done: 0, total: selectedCount });

    let done = 0;
    let failed = 0;
    for (const c of candidates) {
      if (!selected[c.id]) continue;
      try {
        await invoke("plugins_install", { candidate: c });
        done += 1;
      } catch (e) {
        failed += 1;
        setInstallErrors((prev) => ({ ...prev, [c.id]: String(e) }));
      }
      setProgress({ done: done + failed, total: selectedCount });
    }

    setInstalling(false);
    onInstalled(done, failed);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      data-busy={installing ? "true" : undefined}
      onMouseDown={installing ? undefined : onClose}
      role="presentation"
    >
      <div
        className="modal bulk-plugins-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-plugins-modal-title"
      >
        <div className="modal-header">
          <div className="modal-header-icon" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="bulk-plugins-modal-title">
              {t("settings.plugins.bulkReviewTitle")}
            </h2>
            <p className="modal-subtitle">
              {t("settings.plugins.bulkReviewSubtitle", {
                ready: candidates.length,
                skipped: skipped.length,
              })}
            </p>
          </div>
        </div>

        <div className="modal-body bulk-plugins-body">
          <div className="bulk-plugins-warning" role="note">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{t("settings.plugins.securityWarning")}</span>
          </div>

          {candidates.length > 0 ? (
            <>
              <div className="bulk-plugins-select-bar">
                <span className="bulk-plugins-select-count">
                  {t("settings.plugins.bulkSelectedCount", {
                    count: selectedCount,
                    total: candidates.length,
                  })}
                </span>
                <div className="bulk-plugins-select-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAll(!allSelected)}
                    disabled={installing}
                  >
                    {allSelected
                      ? t("settings.plugins.bulkSelectNone")
                      : t("settings.plugins.bulkSelectAll")}
                  </Button>
                </div>
              </div>

              <ul className="bulk-plugins-list">
                {candidates.map((c) => (
                  <li
                    className={`bulk-plugins-item${
                      installErrors[c.id] ? " has-error" : ""
                    }`}
                    key={c.id}
                  >
                    <label className="bulk-plugins-item-check">
                      <input
                        type="checkbox"
                        checked={!!selected[c.id]}
                        disabled={installing}
                        onChange={() => toggle(c.id)}
                      />
                      <span className="bulk-plugins-item-checkbox" aria-hidden />
                    </label>
                    <div className="bulk-plugins-item-info">
                      <div className="bulk-plugins-item-title">
                        <span className="bulk-plugins-item-name">{c.name}</span>
                        {c.version && (
                          <span className="bulk-plugins-item-version">
                            v{c.version}
                          </span>
                        )}
                      </div>
                      <div className="bulk-plugins-item-sub">
                        {c.author
                          ? `${t("settings.plugins.author")}: ${c.author}`
                          : ""}
                        {c.author && c.sourceUrl ? " · " : ""}
                        {c.sourceUrl && (
                          <span className="bulk-plugins-item-source">
                            {c.sourceUrl}
                          </span>
                        )}
                      </div>
                      <div className="bulk-plugins-item-hash">
                        {t("settings.plugins.hash")}: {hashLabel(c.fileHash)}
                      </div>
                      {installErrors[c.id] && (
                        <p className="bulk-plugins-item-error" role="alert">
                          {installErrors[c.id]}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="bulk-plugins-empty">{t("settings.plugins.bulkAllFailed")}</p>
          )}

          {skipped.length > 0 && (
            <div className="bulk-plugins-skipped">
              <h3 className="bulk-plugins-skipped-title">
                {t("settings.plugins.bulkSkippedTitle", { count: skipped.length })}
              </h3>
              <p className="bulk-plugins-skipped-hint">
                {t("settings.plugins.bulkSkippedHint")}
              </p>
              <ul className="bulk-plugins-skipped-list">
                {skipped.map((s) => (
                  <li key={s.path}>
                    <span className="bulk-plugins-skipped-file">
                      {baseName(s.path)}
                    </span>
                    <span className="bulk-plugins-skipped-error">{s.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">
            {installing
              ? t("settings.plugins.bulkInstalling", {
                  done: progress.done,
                  total: progress.total,
                })
              : "\u00a0"}
          </span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={installing}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleInstall}
              isLoading={installing}
              disabled={selectedCount === 0}
            >
              {t("settings.plugins.bulkInstall")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
