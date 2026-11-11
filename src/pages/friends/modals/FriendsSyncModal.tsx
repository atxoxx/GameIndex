import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { FriendsSyncStatus, RelayStatus } from "../../../sync/friends/engine";
import type { Friend } from "../friendsTypes";
import { asPeerPubkey } from "../friendsSyncHelpers";
import {
  isPeerOnline,
  peerCurrentlyPlaying,
  peerDeliveryState,
  syncTone,
} from "../friendsSyncPresentation";
import { displayName, formatLastSeen } from "../friendsUtils";
import { FriendAvatar } from "../shared/FriendAvatar";
import {
  getNostrShareScope,
  setNostrShareScope,
  type NostrShareScope,
} from "../../friendsStorage";
import { Button } from "../../../components/ui";

interface FriendsSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: FriendsSyncStatus;
  /** Accepted friends, so every row has a name even without presence. */
  friends: Friend[];
  lastSyncedTime: string;
  onTriggerSync: () => void;
}

const SCOPE_OPTIONS: { value: Exclude<NostrShareScope, "off">; labelKey: string; descKey: string }[] = [
  { value: "core", labelKey: "friendsPage.nostrScopeCore", descKey: "friendsPage.nostrScopeCoreDesc" },
  { value: "full", labelKey: "friendsPage.nostrScopeFull", descKey: "friendsPage.nostrScopeFullDesc" },
];

/** The engine always publishes; a stored legacy "off" means the reduced set. */
function normalizeScope(scope: NostrShareScope): Exclude<NostrShareScope, "off"> {
  return scope === "full" ? "full" : "core";
}

const PHASE_LABEL = {
  idle: "friendsPage.syncPhaseIdle",
  connecting: "friendsPage.syncPhaseConnecting",
  online: "friendsPage.syncPhaseOnline",
  degraded: "friendsPage.syncPhaseDegraded",
  offline: "friendsPage.syncPhaseOffline",
} as const;

const DELIVERY_LABEL = {
  seen: "friendsPage.syncSeen",
  delivered: "friendsPage.syncDelivered",
  none: "friendsPage.syncNotDelivered",
} as const;

const DELIVERY_HINT = {
  seen: "friendsPage.syncSeenHint",
  delivered: "friendsPage.syncDeliveredHint",
  none: "friendsPage.syncNotDeliveredHint",
} as const;

const RELAY_LABEL: Record<RelayStatus, string> = {
  idle: "friendsPage.syncRelayIdle",
  accepted: "friendsPage.nostrRelayReachable",
  failed: "friendsPage.nostrRelayFailed",
};

/** A last-6-characters tail is what tells two "Marty_" rows apart. */
function shortKey(value: string | null | undefined): string | null {
  const key = (value || "").trim();
  return key ? `#${key.slice(-6)}` : null;
}

/**
 * Diagnostics for the always-on engine.
 *
 * Everything shown comes from `FriendsSyncStatus`: the phase it reached, what
 * each relay answered, what is still queued, and what each friend's presence
 * says back. Nothing is inferred from a timer, so an idle page never claims to
 * be syncing.
 */
export default function FriendsSyncModal({
  isOpen,
  onClose,
  syncStatus,
  friends,
  lastSyncedTime,
  onTriggerSync,
}: FriendsSyncModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [scope, setScope] = useState<Exclude<NostrShareScope, "off">>(() =>
    normalizeScope(getNostrShareScope())
  );

  useEffect(() => {
    if (!isOpen) return;
    setScope(normalizeScope(getNostrShareScope()));
  }, [isOpen]);

  // Escape to close + body scroll lock, matching the rest of the app's modals.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  const peerRows = useMemo(() => {
    const rows = friends
      .filter((friend) => !friend.blocked && friend.consent !== "pending")
      .map((friend) => {
        const pubkey = asPeerPubkey(friend.syncId);
        return { friend, pubkey, state: pubkey ? syncStatus.peers[pubkey] : undefined };
      });

    // Two friends may genuinely share a display name; the key tail keeps the
    // rows distinguishable instead of showing the same label twice.
    const nameCounts = new Map<string, number>();
    rows.forEach(({ friend }) => {
      const name = displayName(friend);
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    });

    return rows.map((row) => ({
      ...row,
      suffix:
        (nameCounts.get(displayName(row.friend)) ?? 0) > 1
          ? shortKey(row.pubkey ?? row.friend.syncId)
          : null,
    }));
  }, [friends, syncStatus.peers]);

  const relays = useMemo(() => Object.entries(syncStatus.relayStatus), [syncStatus.relayStatus]);
  const relayCounts = useMemo(() => {
    const accepted = relays.filter(([, state]) => state === "accepted").length;
    return { accepted, total: relays.length };
  }, [relays]);

  if (!isOpen) return null;

  const running = syncStatus.manualSync === "running";
  const tone = running ? "connecting" : syncTone(syncStatus.phase, syncStatus.pendingPublish);
  const activeScope = scope;
  const activeOption = SCOPE_OPTIONS.find((opt) => opt.value === activeScope) ?? SCOPE_OPTIONS[0];

  const handleScopeChange = (next: Exclude<NostrShareScope, "off">) => {
    if (next === scope) return;
    setScope(next);
    setNostrShareScope(next);
    showToast(t("friendsPage.nostrPublishOnToast"), "info");
  };

  return createPortal(
    <div className="friends-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="friends-modal-box friends-sync-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-sync-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-modal-header">
          <h2 className="friends-modal-title" id="friends-sync-modal-title">
            <ShieldCheck size={16} aria-hidden="true" /> {t("friendsPage.syncModalTitle")}
          </h2>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<X />} type="button" onClick={onClose} title={t("common.close")}></Button>
        </div>

        <div className="friends-modal-body">
          <div className="sync-section-block">
            <div className="sync-phase-row">
              <span className={`sync-phase-dot is-${tone}`} aria-hidden="true" />
              <div className="sync-phase-text">
                <strong>{t(PHASE_LABEL[tone])}</strong>
                <span>{t("friendsPage.syncAlwaysOn")}</span>
              </div>
              <Button
                variant="primary"
                size="sm"
                isLoading={running}
                leftIcon={<RefreshCw size={14} />}
                type="button"
                onClick={onTriggerSync}
              >
                {t("friends.syncNow")}
              </Button>
            </div>

            <div className="sync-facts">
              <span className="sync-fact">
                <Clock size={13} aria-hidden="true" />
                {t("friendsPage.lastSynced")}: {lastSyncedTime || t("friendsPage.lastSyncedNever")}
              </span>
              <span className="sync-fact">
                {t("friendsPage.syncPendingPublish", { count: syncStatus.pendingPublish })}
              </span>
            </div>

            {syncStatus.lastError && (
              <p className="sync-error-line">{t("friendsPage.syncFailed", { reason: syncStatus.lastError })}</p>
            )}
          </div>

          <div className="sync-section-block">
            <h4 className="sync-section-heading">{t("friendsPage.syncRelaysHeading")}</h4>
            <p className="friends-modal-desc">{t("friendsPage.nostrRelaysDesc")}</p>
            {relays.length > 0 && (
              <p
                className={`sync-relay-summary${relayCounts.accepted === 0 ? " is-none" : ""}`}
                aria-live="polite"
              >
                {relayCounts.accepted === 0
                  ? t("friendsPage.syncRelaysSummaryNone")
                  : t("friendsPage.syncRelaysSummary", {
                      ok: relayCounts.accepted,
                      total: relayCounts.total,
                    })}
              </p>
            )}
            <div className="nostr-relays-list">
              {relays.length === 0 ? (
                <p className="sync-log-empty">{t("friendsPage.nostrRelayUnchecked")}</p>
              ) : (
                relays.map(([relay, health]) => (
                  <div key={relay} className="nostr-relay-item">
                    <span className={`nostr-relay-dot is-${health}`} />
                    <span className="nostr-relay-url">{relay}</span>
                    <span className={`nostr-relay-status is-${health}`}>{t(RELAY_LABEL[health])}</span>
                  </div>
                ))
              )}
            </div>
            <p className="friends-modal-desc nostr-relay-hint">{t("friendsPage.nostrRelayStatusHint")}</p>
          </div>

          <div className="sync-section-block">
            <h4 className="sync-section-heading">{t("friendsPage.syncPeersHeading")}</h4>
            {peerRows.length === 0 ? (
              <p className="sync-log-empty">{t("friendsPage.syncNoFriends")}</p>
            ) : (
              <div className="sync-peer-list">
                {peerRows.map(({ friend, state, suffix }) => {
                  const online = isPeerOnline(state);
                  const playing = peerCurrentlyPlaying(state);
                  const delivery = peerDeliveryState(state);
                  const lastSeenAt = state?.lastSeenAt ?? null;
                  const lastExchange =
                    lastSeenAt === null
                      ? t("friendsPage.syncPeerNeverHeard")
                      : Date.now() - lastSeenAt > 24 * 60 * 60 * 1000
                        ? t("friendsPage.syncPeerNoRecentExchange")
                        : t("friendsPage.syncPeerLastExchange", {
                            time: formatLastSeen(Math.floor(lastSeenAt / 1000), t),
                          });
                  return (
                    <div key={friend.id} className="sync-peer-row">
                      <FriendAvatar friend={friend} size="sm" />
                      <span className="sync-peer-main">
                        <span className="sync-peer-name-line">
                          <span className="sync-peer-name">{displayName(friend)}</span>
                          {suffix && <span className="sync-peer-suffix">{suffix}</span>}
                          <span className={`sync-peer-state is-${online ? "online" : "offline"}`}>
                            {online ? t("friendsPage.syncPeerOnline") : t("friendsPage.syncPeerOffline")}
                          </span>
                        </span>
                        <span className="sync-peer-meta">
                          {playing && (
                            <>
                              <span className="sync-peer-playing">
                                {t("friendsPage.playingGame", { game: playing })}
                              </span>
                              <span className="sync-peer-sep" aria-hidden="true" />
                            </>
                          )}
                          {lastExchange}
                        </span>
                      </span>
                      <span
                        className={`sync-peer-delivery is-${delivery}`}
                        title={t(DELIVERY_HINT[delivery])}
                      >
                        {t(DELIVERY_LABEL[delivery])}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="sync-section-block">
            <h4 className="sync-section-heading">{t("friendsPage.nostrPublishToggle")}</h4>
            <div className="nostr-scope-group" role="radiogroup" aria-label={t("friendsPage.nostrPublishToggle")}>
              {SCOPE_OPTIONS.map((opt) => {
                const active = activeScope === opt.value;
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
                  </button>
                );
              })}
            </div>
            <p className="friends-modal-desc nostr-scope-detail">{t(activeOption.descKey)}</p>

            <div className="nostr-disclosure">
              <p>{t("friendsPage.nostrDisclosurePerm")}</p>
              <p>{t("friendsPage.nostrDisclosureEncrypted")}</p>
              <p>{t("friendsPage.nostrDisclosureNoSetup")}</p>
              <p>{t("friendsPage.messagesPrivate")}</p>
            </div>
          </div>
        </div>

        <div className="friends-modal-footer">
          <Button variant="secondary" size="md" type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
