import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { npubEncode } from "nostr-tools/nip19";
import { Clock, Send, ShieldCheck, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { Friend, FriendInvitation } from "../friendsTypes";
import { asPeerPubkey } from "../friendsSyncHelpers";
import { extractNpub, pendingPeerLabel } from "../friendsSyncPresentation";
import {
  FriendCodeQR,
  CopyIcon,
  PlusIcon,
  XIcon,
  getInitials,
  getProceduralAvatarStyle,
  UsersIcon,
} from "../friendsUtils";
import { Button } from "../../../components/ui";

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Our own hex pubkey (the friend code the controller generates). */
  myFriendCode: string;
  nostrPublicKey: string;
  friendCodeInput: string;
  onFriendCodeInputChange: (val: string) => void;
  decodedFriend: Friend | null;
  /** Returns true when the request was actually queued. */
  onAddFriend: () => boolean;
  /** Outbound request already waiting on the pasted peer, if any. */
  pendingRequest?: FriendInvitation | null;
  /** Name of an accepted friend already using the pasted key. */
  existingFriendName?: string | null;
  onResendRequest?: () => void;
  onCancelRequest?: () => void;
}

/** Hex pubkeys are shared as `npub` so nobody has to copy 64 raw characters. */
function shareCode(pubkey: string): string {
  const hex = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return pubkey.trim();
  try {
    return npubEncode(hex);
  } catch {
    return hex;
  }
}

/**
 * The connect flow.
 *
 * Everything is decoded locally: the code carries a public key and nothing
 * else, so the peer's profile and stats stay hidden until they accept. The
 * modal therefore shows a neutral card instead of a fake preview, and keeps
 * the "request sent" state visible so a second press cannot silently queue a
 * duplicate request.
 */
export default function AddFriendModal({
  isOpen,
  onClose,
  myFriendCode,
  nostrPublicKey,
  friendCodeInput,
  onFriendCodeInputChange,
  decodedFriend,
  onAddFriend,
  pendingRequest,
  existingFriendName,
  onResendRequest,
  onCancelRequest,
}: AddFriendModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<"add" | "mycode">("add");
  const [requested, setRequested] = useState<{ pubkey: string; name: string } | null>(null);

  const myNpub = useMemo(() => shareCode(myFriendCode), [myFriendCode]);

  // A new paste supersedes the "sent" state; clearing the box (which the
  // controller does right after a send) must not.
  useEffect(() => {
    if (!requested) return;
    if (!friendCodeInput.trim()) return;
    const current = asPeerPubkey(decodedFriend?.syncId);
    if (current !== requested.pubkey) setRequested(null);
  }, [decodedFriend, requested, friendCodeInput]);

  // Escape closes, matching the sync and nickname dialogs.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(t("friendsPage.copiedToClipboard", { label }), "success");
  };

  const decodedPubkey = asPeerPubkey(decodedFriend?.syncId);
  const pending = pendingRequest
    ? { pubkey: asPeerPubkey(pendingRequest.syncId) ?? pendingRequest.syncId, name: pendingRequest.name }
    : requested
      ? { pubkey: requested.pubkey, name: requested.name }
      : null;
  const pendingLabel = pending ? pendingPeerLabel(pending.name, pending.pubkey) : "";

  const handleInput = (raw: string) => {
    // A pasted sentence may carry the code in the middle; keep only the code.
    const npub = extractNpub(raw);
    onFriendCodeInputChange(npub ?? raw);
  };

  const handleSend = () => {
    if (!decodedFriend) return;
    const pubkey = decodedPubkey ?? decodedFriend.syncId;
    const queued = onAddFriend();
    if (queued) setRequested({ pubkey, name: decodedFriend.name });
  };

  return createPortal(
    <div className="friends-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="friends-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-add-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-modal-header">
          <h2 className="friends-modal-title" id="friends-add-modal-title">
            <UsersIcon /> {t("friendsPage.addFriendModalTitle")}
          </h2>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<XIcon />} type="button" onClick={onClose} title={t("common.close")}></Button>
        </div>

        <div className="friends-modal-subtabs">
          <button
            type="button"
            className={`friends-modal-subtab${activeSubTab === "add" ? " active" : ""}`}
            onClick={() => setActiveSubTab("add")}
          >
            {t("friendsPage.enterFriendCodeTab")}
          </button>
          <button
            type="button"
            className={`friends-modal-subtab${activeSubTab === "mycode" ? " active" : ""}`}
            onClick={() => setActiveSubTab("mycode")}
          >
            {t("friendsPage.myFriendCodeTab")}
          </button>
        </div>

        <div className="friends-modal-body">
          {activeSubTab === "add" ? (
            <div className="add-friend-form">
              <p className="friends-modal-desc">{t("friendsPage.pasteCodeHint")}</p>

              <div className="form-group">
                <input
                  type="text"
                  className="profile-input"
                  placeholder={t("friends.pasteCodePlaceholder")}
                  aria-label={t("friends.pasteCodePlaceholder")}
                  value={friendCodeInput}
                  onChange={(e) => handleInput(e.target.value)}
                  autoFocus
                />
              </div>

              {pending && (
                <div className="friend-request-pending" role="status">
                  <div className="friend-request-pending__head">
                    <Clock size={15} aria-hidden="true" />
                    <span>{t("friendsPage.requestSentTitle")}</span>
                  </div>
                  {pendingLabel && <p className="friend-request-pending__peer">{pendingLabel}</p>}
                  <p className="friend-request-pending__body">{t("friendsPage.requestSentBody")}</p>
                  <div className="friend-request-pending__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      leftIcon={<Send size={14} />}
                      onClick={() => onResendRequest?.()}
                    >
                      {t("friendsPage.sendAgain")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      leftIcon={<X size={14} />}
                      onClick={() => {
                        onCancelRequest?.();
                        setRequested(null);
                        onFriendCodeInputChange("");
                      }}
                    >
                      {t("friendsPage.cancelRequest")}
                    </Button>
                  </div>
                </div>
              )}

              {!pending && decodedFriend && existingFriendName && (
                <div className="friend-preview-card friend-preview-card--neutral">
                  <div className="friend-preview-header">
                    <div className="preview-avatar-wrapper">
                      <div className="preview-avatar-procedural" style={getProceduralAvatarStyle(existingFriendName)}>
                        {getInitials(existingFriendName)}
                      </div>
                    </div>
                    <div className="friend-preview-info">
                      <span className="friend-preview-name">{existingFriendName}</span>
                      <span className="friend-preview-status">
                        {t("friendsPage.alreadyFriends", { name: existingFriendName })}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {!pending && decodedFriend && !existingFriendName && (
                <div className="friend-preview-card friend-preview-card--neutral">
                  <div className="friend-preview-header">
                    <div className="preview-avatar-wrapper">
                      <div
                        className="preview-avatar-procedural"
                        style={getProceduralAvatarStyle(decodedFriend.name)}
                      >
                        {getInitials(decodedFriend.name)}
                      </div>
                    </div>
                    <div className="friend-preview-info">
                      <span className="friend-preview-name">{decodedFriend.name}</span>
                      <span className="friend-preview-status">
                        {t("friendsPage.profileAfterAccept")}
                      </span>
                    </div>
                  </div>
                  <p className="friend-preview-note">
                    <ShieldCheck size={13} aria-hidden="true" />
                    {t("friendsPage.syncStartsOnAccept")}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="my-code-display">
              <p className="friends-modal-desc">{t("friendsPage.shareCodeDesc")}</p>

              <div className="my-code-box">
                <span className="my-code-text">{myNpub}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<CopyIcon />}
                  type="button"
                  onClick={() => copyToClipboard(myNpub, t("friendsPage.friendCode"))}
                >
                  {t("common.copy")}
                </Button>
              </div>

              <p className="my-code-hint">
                <ShieldCheck size={13} aria-hidden="true" />
                {t("friendsPage.myCodeSafeHint")}
              </p>

              {myNpub && (
                <div className="my-qr-container">
                  <FriendCodeQR code={myNpub} />
                  <span className="my-qr-label">{t("friends.scanQrWithMobile")}</span>
                </div>
              )}

              {nostrPublicKey && (
                <div className="nostr-key-box">
                  <span className="nostr-key-label">{t("friendsPage.nostrPublicKey")}</span>
                  <div className="nostr-key-row">
                    <span className="nostr-key-val">{nostrPublicKey}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      iconOnly
                      leftIcon={<CopyIcon />}
                      type="button"
                      onClick={() => copyToClipboard(nostrPublicKey, t("friendsPage.nostrPublicKey"))}
                    ></Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {activeSubTab === "add" && (
          <div className="friends-modal-footer">
            <Button variant="secondary" size="md" type="button" onClick={onClose}>
              {pending ? t("common.close") : t("common.cancel")}
            </Button>
            {!pending && !existingFriendName && (
              <Button
                variant="primary"
                size="md"
                type="button"
                leftIcon={<PlusIcon />}
                onClick={handleSend}
                disabled={!decodedFriend}
              >
                {t("friendsPage.sendRequest")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
