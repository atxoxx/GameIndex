import { ArrowRight, GitCompare, Minus, Plus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { formatBackupDate } from "./backupUtils";
import type { BackupDiffReport } from "../../types/backup";

interface BackupDiffModalProps {
  diff: BackupDiffReport | null;
  onClose: () => void;
  onRestore?: () => void;
}

export default function BackupDiffModal({ diff, onClose, onRestore }: BackupDiffModalProps) {
  const { t } = useLanguage();
  if (!diff) return null;

  const fileName = diff.filePath.split(/[\\/]/).pop() ?? "backup.gibak";

  return createPortal(
    <div className="backup-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="backup-modal-card backup-modal-card--wide" onClick={(e) => e.stopPropagation()}>
        <header className="backup-modal-header">
          <div className="backup-modal-title-wrap">
            <span className="backup-modal-icon-badge backup-modal-icon-badge--info">
              <GitCompare size={20} />
            </span>
            <div>
              <h3 className="backup-modal-title">
                {t("settings.backup.diffTitle")}
              </h3>
              <span className="backup-modal-subtitle">
                {fileName} · {formatBackupDate(diff.archiveCreatedAt)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="backup-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </header>

        {/* Diff summary banner */}
        <div className="backup-diff-summary-bar">
          <div className="backup-diff-summary-side">
            <span className="backup-diff-summary-label">
              {t("settings.backup.archiveState")}
            </span>
            <span className="backup-diff-summary-val">
              {diff.archiveTotalRecords.toLocaleString()} {t("settings.backup.records")}
            </span>
          </div>

          <div className="backup-diff-summary-arrow">
            <ArrowRight size={20} />
            <span
              className={`backup-diff-delta-badge ${
                diff.recordDelta > 0
                  ? "backup-diff-delta-badge--pos"
                  : diff.recordDelta < 0
                  ? "backup-diff-delta-badge--neg"
                  : ""
              }`}
            >
              {diff.recordDelta > 0 ? `+${diff.recordDelta}` : diff.recordDelta}
            </span>
          </div>

          <div className="backup-diff-summary-side">
            <span className="backup-diff-summary-label">
              {t("settings.backup.liveState")}
            </span>
            <span className="backup-diff-summary-val">
              {diff.liveTotalRecords.toLocaleString()} {t("settings.backup.records")}
            </span>
          </div>
        </div>

        {/* Per-domain diff comparison table */}
        <div className="backup-diff-table-container">
          <table className="backup-diff-table">
            <thead>
              <tr>
                <th>{t("settings.backup.domainHeader")}</th>
                <th>{t("settings.backup.archiveCountHeader")}</th>
                <th>{t("settings.backup.liveCountHeader")}</th>
                <th>{t("settings.backup.deltaHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {diff.domains.map((row) => (
                <tr key={row.domain}>
                  <td className="backup-diff-domain-cell">
                    <span className="backup-diff-domain-name">{row.domain}</span>
                  </td>
                  <td>{row.archiveCount.toLocaleString()}</td>
                  <td>{row.liveCount.toLocaleString()}</td>
                  <td>
                    {row.delta > 0 ? (
                      <span className="backup-delta-pill backup-delta-pill--added">
                        <Plus size={11} />
                        {row.delta}
                      </span>
                    ) : row.delta < 0 ? (
                      <span className="backup-delta-pill backup-delta-pill--removed">
                        <Minus size={11} />
                        {Math.abs(row.delta)}
                      </span>
                    ) : (
                      <span className="backup-delta-pill backup-delta-pill--unchanged">
                        {t("settings.backup.noChange")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="backup-modal-footer">
          {onRestore && (
            <Button variant="secondary" onClick={onRestore}>
              {t("settings.backup.prepareRestore")}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
