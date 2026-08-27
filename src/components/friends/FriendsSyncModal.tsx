import { useState, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { SyncLogEntry } from "./friendsTypes";
import {
  getSyncFolder,
  isNostrPublicPublishEnabled,
  setNostrPublicPublishEnabled,
} from "../../pages/friendsStorage";
import { P2pSyncIcon, RefreshIcon, XIcon, CopyIcon } from "./friendsUtils";

interface FriendsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSyncing: boolean;
  lastSyncedTime: string;
  syncLog: SyncLogEntry[];
  onTriggerSync: () => void;
}

const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.snort.social",
  "wss://relay.primal.net",
];

export default function FriendsSyncModal({
  isOpen,
  onClose,
  isSyncing,
  lastSyncedTime,
  syncLog,
  onTriggerSync,
}: FriendsSyncModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [syncFolderPath, setSyncFolderPath] = useState<string>("");
  const [nostrPublish, setNostrPublish] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      getSyncFolder().then((folder) => {
        if (folder) setSyncFolderPath(folder);
      });
      setNostrPublish(isNostrPublicPublishEnabled());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyFolder = () => {
    if (!syncFolderPath) return;
    navigator.clipboard.writeText(syncFolderPath);
    showToast(t("friendsPage.copiedToClipboard", { label: t("friendsPage.syncFolder") }), "success");
  };

  return (
    <div className="friends-modal-backdrop" onClick={onClose}>
      <div className="friends-modal-box friends-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2 className="friends-modal-title">
            <P2pSyncIcon /> {t("friendsPage.p2pSyncDiagnostics")}
          </h2>
          <button type="button" className="friends-modal-close" onClick={onClose} title={t("common.close")}>
            <XIcon />
          </button>
        </div>

        <div className="friends-modal-body">
          <div className="sync-section-block">
            <h4 className="sync-section-heading">{t("friendsPage.syncFolderHeading")}</h4>
            <p className="friends-modal-desc">{t("friendsPage.syncFolderDesc")}</p>
            <div className="sync-folder-picker-row">
              <input
                type="text"
                className="profile-input sync-folder-input"
                readOnly
                value={syncFolderPath || t("friendsPage.noFolderSelected")}
              />
              <button
                type="button"
                className="btn btn-secondary btn--mini"
                onClick={handleCopyFolder}
                title={t("common.copy")}
              >
                <CopyIcon /> {t("common.copy")}
              </button>
            </div>
          </div>

          <div className="sync-section-block">
            <h4 className="sync-section-heading">{t("friendsPage.nostrRelaysHeading")}</h4>
            <p className="friends-modal-desc">{t("friendsPage.nostrRelaysDesc")}</p>
            <label className="nostr-publish-row">
              <input
                type="checkbox"
                checked={nostrPublish}
                onChange={(e) => {
                  const on = e.target.checked;
                  setNostrPublish(on);
                  setNostrPublicPublishEnabled(on);
                  showToast(
                    on ? t("friendsPage.nostrPublishOnToast") : t("friendsPage.nostrPublishOffToast"),
                    "info"
                  );
                }}
              />
              <span className="nostr-publish-label">{t("friendsPage.nostrPublishToggle")}</span>
            </label>
            <p className="friends-modal-desc">{t("friendsPage.nostrPublishDesc")}</p>
            <div className="nostr-relays-list">
              {NOSTR_RELAYS.map((relay) => (
                <div key={relay} className="nostr-relay-item">
                  <span className="nostr-relay-dot online" />
                  <span className="nostr-relay-url">{relay}</span>
                  <span className="nostr-relay-status">{t("friendsPage.connected")}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="sync-section-block">
            <div className="sync-activity-header">
              <div>
                <h4 className="sync-section-heading">{t("friendsPage.recentSyncActivity")}</h4>
                {lastSyncedTime && (
                  <span className="sync-last-time-label">
                    {t("friendsPage.lastSynced")}: {lastSyncedTime}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary btn--mini"
                onClick={onTriggerSync}
                disabled={isSyncing}
              >
                <RefreshIcon className={isSyncing ? "sync-spinner" : ""} /> {t("friends.syncNow")}
              </button>
            </div>

            <div className="sync-log-container">
              {syncLog.length === 0 ? (
                <p className="sync-log-empty">{t("friendsPage.noSyncActivityRecorded")}</p>
              ) : (
                syncLog.map((entry, idx) => (
                  <div key={idx} className="sync-log-item">
                    <div className="sync-log-meta">
                      <span className="sync-log-time">{entry.time}</span>
                      <span className="sync-log-summary">{entry.message}</span>
                    </div>
                    {entry.details && entry.details.length > 0 && (
                      <div className="sync-log-details-list">
                        {entry.details.map((d, dIdx) => (
                          <div key={dIdx} className="sync-log-detail-line">
                            {d}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="friends-modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
