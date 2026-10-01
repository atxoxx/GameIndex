import { AlertTriangle, CheckCircle2, ShieldCheck, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import type { BackupVerifyReport } from "../../types/backup";

interface BackupVerifyModalProps {
  report: BackupVerifyReport | null;
  onClose: () => void;
}

export default function BackupVerifyModal({ report, onClose }: BackupVerifyModalProps) {
  const { t } = useLanguage();
  if (!report) return null;

  return createPortal(
    <div className="backup-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="backup-modal-card backup-modal-card--wide" onClick={(e) => e.stopPropagation()}>
        <header className="backup-modal-header">
          <div className="backup-modal-title-wrap">
            <span
              className={`backup-modal-icon-badge ${
                report.valid
                  ? "backup-modal-icon-badge--success"
                  : "backup-modal-icon-badge--warning"
              }`}
            >
              {report.valid ? <ShieldCheck size={20} /> : <AlertTriangle size={20} />}
            </span>
            <div>
              <h3 className="backup-modal-title">
                {t("settings.backup.verifyTitle")}
              </h3>
              <span className="backup-modal-subtitle">
                {report.filePath.split(/[\\/]/).pop()}
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

        {/* Verification status hero */}
        <div
          className={`backup-verify-hero ${
            report.valid ? "backup-verify-hero--valid" : "backup-verify-hero--invalid"
          }`}
        >
          <div className="backup-verify-hero-icon">
            {report.valid ? <CheckCircle2 size={28} /> : <AlertTriangle size={28} />}
          </div>
          <div className="backup-verify-hero-text">
            <strong>
              {report.valid
                ? t("settings.backup.verifyAllValid")
                : t("settings.backup.verifyHasIssues")}
            </strong>
            <p>
              {report.valid
                ? t("settings.backup.verifyMessageOk", { count: report.totalDomains })
                : t("settings.backup.verifyMessageIssues", {
                    healthy: report.healthyDomains,
                    total: report.totalDomains,
                    domains: report.corruptedDomains.join(", "),
                  })}
            </p>
          </div>
        </div>

        {/* Stats summary strip */}
        <div className="backup-verify-stats">
          <div className="backup-verify-stat-item">
            <span className="backup-verify-stat-label">
              {t("settings.backup.verifyHealthy")}
            </span>
            <span className="backup-verify-stat-value">
              {report.healthyDomains} / {report.totalDomains}
            </span>
          </div>
          <div className="backup-verify-stat-item">
            <span className="backup-verify-stat-label">
              {t("settings.backup.verifyRecords")}
            </span>
            <span className="backup-verify-stat-value">
              {report.totalRecords.toLocaleString()}
            </span>
          </div>
          <div className="backup-verify-stat-item">
            <span className="backup-verify-stat-label">
              {t("settings.backup.verifyFormat")}
            </span>
            <span className="backup-verify-stat-value">
              {report.isRaw ? t("settings.backup.rawFormat") : t("settings.backup.legacyFormat")}
            </span>
          </div>
        </div>

        {/* Domain checklist */}
        <div className="backup-verify-details-section">
          <h4 className="backup-verify-section-title">
            {t("settings.backup.verifyDomainBreakdown")}
          </h4>
          <div className="backup-verify-list">
            {report.details.map((detail) => (
              <div
                key={detail.domain}
                className={`backup-verify-row ${
                  detail.valid ? "backup-verify-row--ok" : "backup-verify-row--err"
                }`}
              >
                <div className="backup-verify-row-main">
                  <span className="backup-verify-row-dot" />
                  <span className="backup-verify-row-name">{detail.domain}</span>
                </div>
                <div className="backup-verify-row-meta">
                  {detail.valid ? (
                    <span className="backup-verify-row-count">
                      {detail.recordsFound.toLocaleString()}{" "}
                      {t("settings.backup.recordsFound", { count: detail.recordsFound })}
                    </span>
                  ) : (
                    <span className="backup-verify-row-error">
                      {detail.error || t("settings.backup.corruptedDomain")}
                    </span>
                  )}
                  <span
                    className={`backup-verify-badge ${
                      detail.valid
                        ? "backup-verify-badge--ok"
                        : "backup-verify-badge--err"
                    }`}
                  >
                    {detail.valid
                      ? t("settings.backup.verifiedPass")
                      : t("settings.backup.verifiedFail")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <footer className="backup-modal-footer">
          <Button variant="primary" onClick={onClose}>
            {t("common.done")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
