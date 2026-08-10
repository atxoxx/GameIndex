import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useUpdate, formatBytes, formatEta } from "../../context/UpdateContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Renders a GitHub-style release body as plain text with clickable commit
 * links (`[text](url)`), preserving everything else verbatim via pre-wrap.
 */
function renderChangelog(body: string): ReactNode {
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(
      <a key={key++} href={m[2]} target="_blank" rel="noreferrer">
        {m[1]}
      </a>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

/**
 * UpdateModal — the Software Update dialog.
 *
 * Renders per update-state:
 *  - available   → release meta + changelog + install / snooze / skip actions
 *  - downloading → progress bar + live speed/ETA readout (portable builds can
 *                  background the download or cancel; NSIS downloads cannot)
 *  - ready       → "relaunch & apply"
 *  - restarting  → full-width pulsing state, no actions, not dismissible
 *  - error       → red alert + retry
 *
 * Accidental dismissal (backdrop mousedown / Escape) is disabled while a
 * download is in flight, during restart, and while an error is on screen —
 * the footer buttons remain the only explicit way out in those states.
 */
export function UpdateModal() {
  const {
    installMode,
    showModal,
    setShowModal,
    status,
    updateInfo,
    error,
    progress,
    checkForUpdates,
    installUpdate,
    applyUpdate,
    cancelDownload,
    skipVersion,
    snoozeUpdate,
  } = useUpdate();
  const { t } = useLanguage();

  const isDownloading = status === "downloading";
  const isReady = status === "ready";
  const isError = status === "error";
  const isRestarting = status === "restarting";
  const isChecking = status === "checking";
  const isPortable = installMode === "portable";

  const canDismiss = !isDownloading && !isRestarting && !isError;

  useEffect(() => {
    if (!showModal || !canDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowModal(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showModal, canDismiss, setShowModal]);

  if (!showModal || status === "idle" || status === "up-to-date") {
    return null;
  }

  const modeBadge =
    installMode === "portable"
      ? t("updater.modePortable")
      : installMode === "nsis"
        ? t("updater.modeInstalled")
        : t("updater.modeDev");

  const releasedOn = (() => {
    if (!updateInfo?.date) return null;
    const date = new Date(updateInfo.date);
    if (Number.isNaN(date.getTime())) return null;
    return t("updater.releasedOn", { date: date.toLocaleDateString() });
  })();

  const primaryLabel = isReady
    ? t("updater.relaunchNow")
    : isDownloading
      ? t("updater.downloading")
      : isError
        ? t("updater.retry")
        : isChecking
          ? t("updater.checking")
          : t("updater.installUpdate");

  const primaryAction = isReady
    ? () => void applyUpdate()
    : isDownloading || isChecking
      ? undefined
      : isError
        ? () => void checkForUpdates(true)
        : () => void installUpdate();

  let body: ReactNode;
  if (isDownloading) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {installMode === "nsis" && (
          <p
            style={{
              margin: 0,
              fontSize: "13px",
              color: "var(--text-secondary, var(--color-text-secondary))",
              textAlign: "center",
            }}
          >
            {t("updater.downloading")}
          </p>
        )}
        <div
          className="progress-bar-bg"
          style={{
            height: "8px",
            width: "100%",
            background: "var(--bg-tertiary, var(--color-bg-tertiary))",
            borderRadius: "4px",
            overflow: "hidden",
            marginBottom: "2px",
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "13px",
              color: "var(--text-primary, var(--color-text-primary))",
              fontWeight: 600,
            }}
          >
            {progress.percent}%
            {progress.total > 0 && (
              <span
                style={{
                  fontWeight: 400,
                  color: "var(--text-muted, var(--color-text-muted))",
                }}
              >
                {" "}({formatBytes(progress.downloaded)} /{" "}
                {formatBytes(progress.total)})
              </span>
            )}
          </span>
          {progress.speedBytesPerSec > 0 && (
            <span
              style={{
                fontSize: "13px",
                color: "var(--text-muted, var(--color-text-muted))",
              }}
            >
              {t("updater.speed", { speed: formatBytes(progress.speedBytesPerSec) })}
              {progress.etaSeconds != null && (
                <> · {t("updater.eta", { eta: formatEta(progress.etaSeconds) })}</>
              )}
            </span>
          )}
        </div>
      </div>
    );
  } else if (isReady) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <p style={{ margin: 0, color: "var(--text-primary, var(--color-text-primary))" }}>
          {t("updater.readyToRestart")}
        </p>
        {isPortable && (
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              color: "var(--text-muted, var(--color-text-muted))",
              lineHeight: 1.5,
            }}
          >
            {t("updater.portableHint")}
          </p>
        )}
      </div>
    );
  } else if (isRestarting) {
    body = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          padding: "20px 0 12px",
          textAlign: "center",
        }}
      >
        <span className="update-restarting-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--text-primary, var(--color-text-primary))",
          }}
        >
          {t("updater.restarting")}
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "12px",
            color: "var(--text-muted, var(--color-text-muted))",
          }}
        >
          {t("updater.restartingHint")}
        </p>
      </div>
    );
  } else if (isError) {
    body = (
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: "rgba(239, 68, 68, 0.12)",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          color: "#f87171",
          fontSize: "14px",
          lineHeight: 1.5,
        }}
      >
        {error || t("updater.errorGeneric")}
      </div>
    );
  } else if (isChecking) {
    body = (
      <p
        style={{
          margin: 0,
          textAlign: "center",
          color: "var(--text-muted, var(--color-text-muted))",
        }}
      >
        {t("updater.checking")}
      </p>
    );
  } else {
    // available
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {(updateInfo?.version || releasedOn) && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "8px",
              fontSize: "13px",
              color: "var(--text-muted, var(--color-text-muted))",
              flexWrap: "wrap",
            }}
          >
            {updateInfo?.version && (
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--text-secondary, var(--color-text-secondary))",
                }}
              >
                v{updateInfo.version}
              </span>
            )}
            {updateInfo?.version && releasedOn && (
              <span aria-hidden="true" style={{ opacity: 0.5 }}>
                ·
              </span>
            )}
            {releasedOn}
          </div>
        )}
        {updateInfo?.body && (
          <div
            style={{
              background: "var(--bg-secondary, var(--color-bg-secondary))",
              borderRadius: "8px",
              padding: "12px",
              maxHeight: "180px",
              overflowY: "auto",
              fontSize: "13px",
              whiteSpace: "pre-wrap",
              color: "var(--text-muted, var(--color-text-muted))",
              border: "1px solid var(--border-subtle, var(--color-border))",
              lineHeight: 1.6,
            }}
          >
            {updateInfo.body && renderChangelog(updateInfo.body)}
          </div>
        )}
        <p
          style={{
            margin: 0,
            fontSize: "14px",
            color: "var(--text-secondary, var(--color-text-secondary))",
          }}
        >
          {t("updater.newVersionAvailableDesc")}
        </p>
        {(isPortable || installMode === "nsis") && (
          <p
            style={{
              margin: 0,
              fontSize: "12px",
              color: "var(--text-muted, var(--color-text-muted))",
              lineHeight: 1.5,
            }}
          >
            {isPortable ? t("updater.portableHint") : t("updater.installedHint")}
          </p>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={canDismiss ? () => setShowModal(false) : undefined}
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
            {(updateInfo?.version || installMode) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "6px",
                  marginTop: "6px",
                }}
              >
                {updateInfo?.version && (
                  <span
                    style={{
                      background: "var(--accent-primary, #6366f1)",
                      color: "#fff",
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "12px",
                      display: "inline-block",
                      lineHeight: 1.4,
                    }}
                  >
                    v{updateInfo.version}
                  </span>
                )}
                <span
                  style={{
                    background: "var(--bg-tertiary, var(--color-bg-tertiary))",
                    border: "1px solid var(--border-subtle, var(--color-border))",
                    color: "var(--text-muted, var(--color-text-muted))",
                    fontSize: "11px",
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: "12px",
                    display: "inline-block",
                    lineHeight: 1.4,
                  }}
                >
                  {modeBadge}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-body">{body}</div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          <div
            className="modal-footer-actions"
            style={{ flexWrap: "wrap", justifyContent: "flex-end" }}
          >
            {isDownloading ? (
              isPortable && (
                <>
                  <Button variant="ghost" onClick={() => setShowModal(false)}>
                    {t("updater.downloadBackground")}
                  </Button>
                  <Button variant="ghost" onClick={() => void cancelDownload()}>
                    {t("updater.cancel")}
                  </Button>
                </>
              )
            ) : !isRestarting ? (
              <Button variant="ghost" onClick={() => setShowModal(false)}>
                {t("common.close")}
              </Button>
            ) : null}
            {status === "available" && (
              <>
                <Button variant="ghost" onClick={() => void snoozeUpdate(24)}>
                  {t("updater.remindLater")}
                </Button>
                <Button variant="ghost" onClick={() => void skipVersion()}>
                  {t("updater.skipVersion")}
                </Button>
              </>
            )}
            {!isRestarting && (
              <Button
                variant="primary"
                onClick={primaryAction}
                isLoading={isDownloading || isChecking}
                disabled={isDownloading || isChecking}
              >
                {primaryLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
