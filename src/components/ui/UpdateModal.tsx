import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useUpdate } from "../../context/UpdateContext";
import { useLanguage } from "../../context/LanguageContext";

export function UpdateModal() {
  const {
    showModal,
    setShowModal,
    status,
    updateInfo,
    error,
    progress,
    downloadAndInstall,
  } = useUpdate();
  const { t } = useLanguage();

  if (!showModal || status === "idle" || status === "up-to-date") {
    return null;
  }

  const isDownloading = status === "downloading";
  const isReady = status === "ready";
  const isError = status === "error";

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={isDownloading ? undefined : () => setShowModal(false)}
      role="presentation"
    >
      <div
        className="modal update-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        style={{ maxWidth: 520 }}
      >
        <div className="modal-header">
          <div
            className="modal-header-icon"
            style={{
              background: "rgba(99, 102, 241, 0.15)",
              color: "var(--accent-primary, #6366f1)",
              borderRadius: "12px",
              padding: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="update-modal-title">
              {t("updater.title")}
            </h2>
            {updateInfo?.version && (
              <span
                className="badge"
                style={{
                  background: "var(--accent-primary, #6366f1)",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "12px",
                  marginTop: "4px",
                  display: "inline-block",
                }}
              >
                v{updateInfo.version}
              </span>
            )}
          </div>
        </div>

        <div className="modal-body update-modal-body" style={{ padding: "16px 24px" }}>
          {isDownloading ? (
            <div className="update-progress-container" style={{ textAlign: "center" }}>
              <p style={{ marginBottom: "12px", color: "var(--text-secondary)" }}>
                {t("updater.downloading")}
              </p>
              <div
                className="progress-bar-bg"
                style={{
                  height: "8px",
                  width: "100%",
                  background: "var(--bg-tertiary, rgba(255,255,255,0.08))",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "8px",
                }}
              >
                <div
                  className="progress-bar-fill"
                  style={{
                    height: "100%",
                    width: `${progress.percent}%`,
                    background: "var(--accent-primary, #6366f1)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                {progress.percent}% {progress.total > 0 && `(${Math.round(progress.downloaded / 1024 / 1024)} MB / ${Math.round(progress.total / 1024 / 1024)} MB)`}
              </span>
            </div>
          ) : isReady ? (
            <p style={{ color: "var(--text-primary)" }}>
              {t("updater.readyToRestart")}
            </p>
          ) : isError ? (
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#f87171",
                fontSize: "14px",
              }}
            >
              {error || t("updater.errorGeneric")}
            </div>
          ) : (
            <div>
              <p style={{ marginBottom: "12px", color: "var(--text-secondary)" }}>
                {t("updater.newVersionAvailableDesc")}
              </p>
              {updateInfo?.body && (
                <div
                  style={{
                    background: "var(--bg-secondary, rgba(0,0,0,0.2))",
                    borderRadius: "8px",
                    padding: "12px",
                    maxHeight: "160px",
                    overflowY: "auto",
                    fontSize: "13px",
                    whiteSpace: "pre-wrap",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle, rgba(255,255,255,0.05))",
                  }}
                >
                  {updateInfo.body}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          <div className="modal-footer-actions">
            {!isDownloading && (
              <Button variant="ghost" onClick={() => setShowModal(false)}>
                {t("common.close")}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={downloadAndInstall}
              isLoading={isDownloading}
              disabled={isDownloading}
            >
              {isReady
                ? t("updater.relaunchNow")
                : isDownloading
                ? t("updater.downloading")
                : isError
                ? t("updater.retry")
                : t("updater.installUpdate")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
