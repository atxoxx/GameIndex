import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { SyncLogEntry } from "./friendsTypes";
import {
  NOSTR_RELAYS,
  getLastRelayStatus,
  getNostrShareScope,
  getSyncFolder,
  onRelayStatusChange,
  setNostrShareScope,
  type NostrShareScope,
  type RelayStatus,
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

interface ScopeOption {
  value: NostrShareScope;
  labelKey: string;
  descKey: string;
  /** Marked as the sensible default so "Standard" reads as the recommended choice. */
  recommended?: boolean;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: "off", labelKey: "friendsPage.nostrScopeOff", descKey: "friendsPage.nostrScopeOffDesc" },
  {
    value: "core",
    labelKey: "friendsPage.nostrScopeCore",
    descKey: "friendsPage.nostrScopeCoreDesc",
    recommended: true,
  },
  { value: "full", labelKey: "friendsPage.nostrScopeFull", descKey: "friendsPage.nostrScopeFullDesc" },
];

/**
 * Maps a real relay result to its dot/status modifier and label. A relay
 * absent from `getLastRelayStatus()` is simply untouched (no modifier) and
 * shown as "not checked yet" — we never invent a probe, so the state here
 * reflects the last real publish attempt.
 */
const RELAY_STATUS_META: Record<RelayStatus, { modifier: string; labelKey: string }> = {
  accepted: { modifier: "online", labelKey: "friendsPage.nostrRelayReachable" },
  failed: { modifier: "failed", labelKey: "friendsPage.nostrRelayFailed" },
};

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
  const [scope, setScope] = useState<NostrShareScope>("core");
  const [relayStatus, setRelayStatus] = useState<Record<string, RelayStatus>>({});

  useEffect(() => {
    if (!isOpen) return;
    getSyncFolder().then((folder) => {
      if (folder) setSyncFolderPath(folder);
    });
    setScope(getNostrShareScope());
    setRelayStatus(getLastRelayStatus());
    // The relay listener only lives while the modal is open.
    const unsubscribe = onRelayStatusChange(() => setRelayStatus(getLastRelayStatus()));
    return unsubscribe;
  }, [isOpen]);

  if (!isOpen) return null;

  const activeOption = SCOPE_OPTIONS.find((opt) => opt.value === scope) ?? SCOPE_OPTIONS[1];

  const handleCopyFolder = () => {
    if (!syncFolderPath) return;
    navigator.clipboard.writeText(syncFolderPath);
    showToast(t("friendsPage.copiedToClipboard", { label: t("friendsPage.syncFolder") }), "success");
  };

  const handleScopeChange = (next: NostrShareScope) => {
    if (next === scope) return;
    setScope(next);
    setNostrShareScope(next);
    showToast(
      next === "off" ? t("friendsPage.nostrPublishOffToast") : t("friendsPage.nostrPublishOnToast"),
      "info"
    );
  };

  return createPortal(
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
            <div className="nostr-publish-row">
              <span className="nostr-publish-label">{t("friendsPage.nostrPublishToggle")}</span>
              <div
                className="nostr-scope-group"
                role="radiogroup"
                aria-label={t("friendsPage.nostrPublishToggle")}
              >
                {SCOPE_OPTIONS.map((opt) => {
                  const active = scope === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`nostr-scope-option${active ? " active" : ""}`}
                      onClick={() => handleScopeChange(opt.value)}
                    >
                      {t(opt.labelKey)}
                      {opt.recommended && (
                        <span className="nostr-scope-recommended">
                          {t("friendsPage.nostrScopeRecommended")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="friends-modal-desc">{t("friendsPage.nostrPublishDesc")}</p>
            <p className="friends-modal-desc nostr-scope-detail">{t(activeOption.descKey)}</p>
            <div className="nostr-relays-list">
              {NOSTR_RELAYS.map((relay) => {
                const status = relayStatus[relay];
                const meta = status ? RELAY_STATUS_META[status] : null;
                const modifier = meta ? ` ${meta.modifier}` : "";
                return (
                  <div key={relay} className="nostr-relay-item">
                    <span className={`nostr-relay-dot${modifier}`} />
                    <span className="nostr-relay-url">{relay}</span>
                    <span className={`nostr-relay-status${modifier}`}>
                      {meta ? t(meta.labelKey) : t("friendsPage.nostrRelayUnchecked")}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="friends-modal-desc nostr-relay-hint">{t("friendsPage.nostrRelayStatusHint")}</p>
            <div className="nostr-disclosure">
              <p>{t("friendsPage.nostrDisclosurePerm")}</p>
              <p>{t("friendsPage.nostrDisclosureHeartbeat")}</p>
              <p>{t("friendsPage.nostrDisclosureDms")}</p>
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
    </div>,
    document.body
  );
}
