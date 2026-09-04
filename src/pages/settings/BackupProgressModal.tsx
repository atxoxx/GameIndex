import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { formatBackupBytes } from "./backupUtils";

export interface BackupProgressModalProps {
  open: boolean;
  targetPath: string;
  domains: string[];
  onComplete: () => void;
  onClose: () => void;
}

interface BackupProgressPayload {
  phase: string;
  currentDomain: string | null;
  domainIndex: number;
  totalDomains: number;
  percent: number;
  bytesWritten: number;
  message: string;
}

interface BackupOutcome {
  filePath: string;
  sizeBytes: number;
  createdAt: number;
  domains: string[];
}

/** Domain stem -> translation key fallback map */
const DOMAIN_LABEL_KEYS: Record<string, string> = {
  games: "settings.backup.domain.games",
  sessions: "settings.backup.domain.sessions",
  sources: "settings.backup.domain.sources",
  download_history: "settings.backup.domain.downloadHistory",
  wishlist: "settings.backup.domain.wishlist",
  store_cache: "settings.backup.domain.storeCache",
  achievements: "settings.backup.domain.achievements",
  kv: "settings.backup.domain.settings",
  news: "settings.backup.domain.news",
  emulators: "settings.backup.domain.emulators",
  mods: "settings.backup.domain.mods",
  plugins: "settings.backup.domain.plugins",
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function parentDir(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export default function BackupProgressModal({
  open,
  targetPath,
  domains,
  onComplete,
  onClose,
}: BackupProgressModalProps) {
  const { t } = useLanguage();

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const domainsRef = useRef(domains);
  domainsRef.current = domains;
  const hasExecutedRef = useRef(false);

  const [phase, setPhase] = useState<string>("preparing");
  const [percent, setPercent] = useState<number>(0);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const [completedDomains, setCompletedDomains] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [finalOutcome, setFinalOutcome] = useState<BackupOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = phase !== "complete" && phase !== "error";

  // Escape closes only once finished or failed
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isBusy) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isBusy, onClose]);

  // Execute backup on mount
  useEffect(() => {
    if (!open) {
      hasExecutedRef.current = false;
      return;
    }
    if (!targetPath || domains.length === 0) return;
    if (hasExecutedRef.current) return;
    hasExecutedRef.current = true;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    const activeDomains = [...domainsRef.current];

    setPhase("preparing");
    setPercent(5);
    setCurrentDomain(null);
    setCompletedDomains([]);
    setStatusMessage(t("settings.backup.preparing"));
    setFinalOutcome(null);
    setError(null);

    async function runBackup() {
      try {
        const un = await listen<BackupProgressPayload>("backup-progress", (event) => {
          if (cancelled) return;
          const p = event.payload;
          setPhase(p.phase);
          setPercent(p.percent);
          setCurrentDomain(p.currentDomain);
          if (p.message) setStatusMessage(p.message);

          if (p.currentDomain && !completedDomains.includes(p.currentDomain)) {
            setCompletedDomains((prev) => {
              // Any domain preceding currentDomain is definitely complete
              const prevIdx = activeDomains.indexOf(p.currentDomain!);
              const newlyDone = activeDomains.slice(0, Math.max(0, prevIdx));
              const merged = new Set([...prev, ...newlyDone]);
              return Array.from(merged);
            });
          }

          if (p.phase === "compressing") {
            setCompletedDomains([...activeDomains]);
          }
        });

        if (cancelled) {
          un();
          return;
        }
        unlisten = un;

        const outcome = await invoke<BackupOutcome>("backup_create", {
          targetPath,
          domains: activeDomains,
        });

        if (cancelled) return;
        setCompletedDomains([...activeDomains]);
        setFinalOutcome(outcome);
        setPercent(100);
        setPhase("complete");
        onCompleteRef.current();
      } catch (err) {
        if (cancelled) return;
        console.error("Backup creation failed:", err);
        setError(String(err));
        setPhase("error");
      }
    }

    void runBackup();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      // If aborted before completion (e.g. fast StrictMode remount), allow retry
      if (phase !== "complete") {
        hasExecutedRef.current = false;
      }
    };
  }, [open, targetPath]);

  const handleOpenFolder = async () => {
    try {
      const folder = parentDir(targetPath);
      await invoke("open_folder", { path: folder });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  if (!open) return null;

  const targetFileName = fileName(targetPath);

  return createPortal(
    <div
      className="modal-backdrop"
      data-busy={isBusy ? "true" : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-modal-title"
      onMouseDown={(e) => {
        if (!isBusy && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal backup-progress-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-header-icon backup-progress-header-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 id="backup-modal-title" className="modal-title">
              {phase === "complete"
                ? t("settings.backup.completeTitle")
                : t("settings.backup.modalTitle")}
            </h2>
            <p className="modal-subtitle" title={targetPath}>
              {targetFileName}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body backup-progress-body">
          {/* Progress Bar & Status */}
          <div className="backup-progress-meter-card">
            <div className="backup-progress-meter-header">
              <span className="backup-progress-headline">
                {phase === "preparing" && t("settings.backup.preparing")}
                {phase === "snapshotting" &&
                  t("settings.backup.snapshotting", {
                    domain: currentDomain
                      ? t(DOMAIN_LABEL_KEYS[currentDomain] ?? currentDomain)
                      : "",
                  })}
                {phase === "compressing" && t("settings.backup.compressing")}
                {phase === "complete" && t("settings.backup.completeDesc")}
                {phase === "error" && error}
              </span>
              <span className="backup-progress-percent">{percent}%</span>
            </div>

            <div className="backup-progress-track">
              <div
                className="backup-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                data-complete={phase === "complete" ? "true" : undefined}
                data-error={phase === "error" ? "true" : undefined}
              />
            </div>
          </div>

          {/* If complete: show summary box */}
          {phase === "complete" && finalOutcome && (
            <div className="backup-progress-summary-card">
              <div className="backup-summary-row">
                <span className="backup-summary-label">{t("settings.backup.totalSize", { size: "" }).replace(/:\s*$/, "")}</span>
                <span className="backup-summary-value">{formatBackupBytes(finalOutcome.sizeBytes)}</span>
              </div>
              <div className="backup-summary-row">
                <span className="backup-summary-label">{t("settings.backup.domainCount", { count: 0 }).replace(/^[0-9]+\s*/, "")}</span>
                <span className="backup-summary-value">{finalOutcome.domains.length}</span>
              </div>
              <div className="backup-summary-row">
                <span className="backup-summary-label">{t("settings.backup.path")}</span>
                <span className="backup-summary-value backup-summary-path" title={finalOutcome.filePath}>
                  {finalOutcome.filePath}
                </span>
              </div>
            </div>
          )}

          {/* Domain checklist stepper */}
          <div className="backup-domain-steps-container">
            <span className="backup-domain-steps-title">
              {t("settings.backup.included")} ({domains.length})
            </span>
            <div className="backup-domain-steps-list">
              {domains.map((dom) => {
                const isCurrent = dom === currentDomain && phase === "snapshotting";
                const isDone = completedDomains.includes(dom) || phase === "complete";
                const labelKey = DOMAIN_LABEL_KEYS[dom];
                const label = labelKey ? t(labelKey) : dom;

                return (
                  <div
                    key={dom}
                    className="backup-domain-step-item"
                    data-status={isDone ? "done" : isCurrent ? "active" : "pending"}
                  >
                    <div className="backup-step-indicator">
                      {isDone ? (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="backup-check-icon"
                          aria-hidden="true"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : isCurrent ? (
                        <div className="backup-step-spinner" aria-hidden="true" />
                      ) : (
                        <span className="backup-step-dot" aria-hidden="true" />
                      )}
                    </div>
                    <span className="backup-step-name">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer backup-progress-footer">
          <div className="backup-progress-footer-status">
            {isBusy && (
              <div className="backup-footer-busy">
                <div className="backup-mini-spinner" aria-hidden="true" />
                <span>{statusMessage}</span>
              </div>
            )}
          </div>

          <div className="modal-footer-actions">
            {phase === "complete" ? (
              <>
                <Button variant="secondary" onClick={handleOpenFolder}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ width: 14, height: 14 }}
                    aria-hidden="true"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  {t("settings.backup.showInFolder")}
                </Button>
                <Button variant="primary" onClick={onClose}>
                  {t("settings.backup.done")}
                </Button>
              </>
            ) : phase === "error" ? (
              <Button variant="secondary" onClick={onClose}>
                {t("common.close")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
