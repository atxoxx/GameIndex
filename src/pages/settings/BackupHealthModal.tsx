import { CheckCircle2, AlertCircle, ShieldAlert, ShieldCheck, Zap, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import type { BackupHealthSummary } from "./backupUtils";

interface BackupHealthModalProps {
  health: BackupHealthSummary;
  onClose: () => void;
  onQuickBackup: () => void;
  quickBusy?: boolean;
}

export default function BackupHealthModal({
  health,
  onClose,
  onQuickBackup,
  quickBusy,
}: BackupHealthModalProps) {
  const { t } = useLanguage();

  return createPortal(
    <div className="backup-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="backup-modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="backup-modal-header">
          <div className="backup-modal-title-wrap">
            <span
              className={`backup-modal-icon-badge ${
                health.score >= 75
                  ? "backup-modal-icon-badge--success"
                  : health.score >= 50
                  ? "backup-modal-icon-badge--warning"
                  : "backup-modal-icon-badge--danger"
              }`}
            >
              {health.score >= 75 ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
            </span>
            <div>
              <h3 className="backup-modal-title">
                {t("settings.backup.healthReportTitle")}
              </h3>
              <span className="backup-modal-subtitle">
                {t("settings.backup.healthReportSubtitle")}
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

        {/* Big Score Card */}
        <div className="backup-health-hero">
          <div className="backup-health-hero-left">
            <span className="backup-health-grade">{health.grade}</span>
            <span className="backup-health-score-val">{health.score} / 100</span>
          </div>
          <div className="backup-health-hero-right">
            <span className="backup-health-status-name">
              {t(health.labelKey)}
            </span>
            <p className="backup-health-status-tip">
              {health.score >= 75
                ? t("settings.backup.healthOptimalTip")
                : t("settings.backup.healthActionTip")}
            </p>
          </div>
        </div>

        {/* 4 Checklist Criteria */}
        <div className="backup-health-checks-list">
          {health.checks.map((check) => (
            <div
              key={check.id}
              className={`backup-health-check-row ${
                check.passed ? "backup-health-check-row--pass" : "backup-health-check-row--fail"
              }`}
            >
              <div className="backup-health-check-status">
                {check.passed ? (
                  <CheckCircle2 size={18} className="backup-check-icon--ok" />
                ) : (
                  <AlertCircle size={18} className="backup-check-icon--warn" />
                )}
              </div>
              <div className="backup-health-check-content">
                <div className="backup-health-check-title-row">
                  <span className="backup-health-check-name">{t(check.nameKey)}</span>
                  <span className="backup-health-check-score">
                    {t("settings.backup.health.points", {
                      score: check.score,
                      weight: check.weight,
                    })}
                  </span>
                </div>
                <p className="backup-health-check-desc">
                  {t(check.descKey, check.descParams)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <footer className="backup-modal-footer">
          {health.score < 80 && (
            <Button
              variant="primary"
              onClick={() => {
                onQuickBackup();
              }}
              isLoading={quickBusy}
            >
              <Zap size={14} />
              {t("settings.backup.quickBackup")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
