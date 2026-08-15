import { createPortal } from "react-dom";
import { useUpdate } from "../../context/UpdateContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * UpdateNotification — a non-intrusive, dismissible banner shown when an
 * automatic check finds a new version. It floats in the bottom-right
 * corner (mirroring the toast anchor) and never blocks the UI: the user
 * can open the full Software Update dialog, or dismiss the hint and keep
 * working. Manual checks open the modal directly and never show this.
 */
export function UpdateNotification() {
  const {
    status,
    updateInfo,
    showUpdateNotification,
    openUpdateModal,
    dismissUpdateNotification,
  } = useUpdate();
  const { t } = useLanguage();

  if (!showUpdateNotification || status !== "available") {
    return null;
  }

  return createPortal(
    <div className="update-notification" role="status">
      <span className="update-notification-icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </span>
      <div className="update-notification-text">
        <span className="update-notification-title">
          {t("updater.newVersionAvailable", { version: updateInfo?.version ?? "" })}
        </span>
        <span className="update-notification-desc">
          {t("updater.newVersionAvailableDesc")}
        </span>
      </div>
      <button
        type="button"
        className="update-notification-action"
        onClick={openUpdateModal}
      >
        {t("common.details")}
      </button>
      <button
        type="button"
        className="update-notification-close"
        onClick={dismissUpdateNotification}
        aria-label={t("toast.dismiss")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body
  );
}
