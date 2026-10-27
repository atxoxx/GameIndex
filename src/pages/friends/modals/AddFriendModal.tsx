import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import type { Friend } from "../friendsTypes";
import {
  FriendCodeQR,
  CopyIcon,
  PlusIcon,
  XIcon,
  getInitials,
  getProceduralAvatarStyle,
  formatHours,
  UsersIcon,
  StarIcon,
} from "../friendsUtils";
import { Button } from "../../../components/ui";

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  myFriendCode: string;
  nostrPublicKey: string;
  friendCodeInput: string;
  onFriendCodeInputChange: (val: string) => void;
  decodedFriend: Friend | null;
  onAddFriend: () => void;
}

export default function AddFriendModal({
  isOpen,
  onClose,
  myFriendCode,
  nostrPublicKey,
  friendCodeInput,
  onFriendCodeInputChange,
  decodedFriend,
  onAddFriend,
}: AddFriendModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<"add" | "mycode">("add");

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
          <Button variant="ghost" size="sm" iconOnly leftIcon={<XIcon />} type="button"  onClick={onClose} title={t("common.close")}></Button>
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
              <p className="friends-modal-desc">{t("friends.pasteFriendCodeDesc")}</p>

              <div className="form-group">
                <input
                  type="text"
                  className="profile-input"
                  placeholder={t("friends.pasteCodePlaceholder")}
                  aria-label={t("friends.pasteCodePlaceholder")}
                  value={friendCodeInput}
                  onChange={(e) => onFriendCodeInputChange(e.target.value)}
                  autoFocus
                />
              </div>

              {decodedFriend && (
                <div className="friend-preview-card">
                  <div className="friend-preview-header">
                    <div className="preview-avatar-wrapper">
                      {decodedFriend.avatar && decodedFriend.avatar.startsWith("data:") ? (
                        <img src={decodedFriend.avatar} alt={decodedFriend.name} className="preview-avatar-img" />
                      ) : (
                        <div
                          className="preview-avatar-procedural"
                          style={getProceduralAvatarStyle(decodedFriend.name)}
                        >
                          {getInitials(decodedFriend.name)}
                        </div>
                      )}
                    </div>
                    <div className="friend-preview-info">
                      <span className="friend-preview-name">{decodedFriend.name}</span>
                      <span className="friend-preview-status">
                        {decodedFriend.status || t("friendsPage.formatOnline")}
                      </span>
                      {decodedFriend.favoriteGame && (
                        <span className="friend-preview-favorite">
                          <StarIcon /> {decodedFriend.favoriteGame}
                        </span>
                      )}
                    </div>
                  </div>

                  {decodedFriend.libStats && (
                    <div className="friend-preview-stats">
                      <div className="preview-stat-item">
                        <span className="preview-stat-val">
                          {decodedFriend.libStats.gamesCount || 0}
                        </span>
                        <span className="preview-stat-lbl">{t("friendsPage.games")}</span>
                      </div>
                      <div className="preview-stat-item">
                        <span className="preview-stat-val">
                          {formatHours(decodedFriend.libStats.playtimeMinutes || 0, t)}
                        </span>
                        <span className="preview-stat-lbl">{t("friendsPage.playtime")}</span>
                      </div>
                      <div className="preview-stat-item">
                        <span className="preview-stat-val">
                          {decodedFriend.libStats.achievementsCount || 0}
                        </span>
                        <span className="preview-stat-lbl">{t("friendsPage.achievements")}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="my-code-display">
              <p className="friends-modal-desc">{t("friendsPage.shareCodeDesc")}</p>

              <div className="my-code-box">
                <span className="my-code-text">{myFriendCode}</span>
                <Button variant="secondary" size="sm" leftIcon={<CopyIcon />}
                  type="button"
                  onClick={() => copyToClipboard(myFriendCode, t("friendsPage.friendCode"))}
                > {t("common.copy")} </Button>
              </div>

              {myFriendCode && (
                <div className="my-qr-container">
                  <FriendCodeQR code={myFriendCode} />
                  <span className="my-qr-label">{t("friends.scanQrWithMobile")}</span>
                </div>
              )}

              {nostrPublicKey && (
                <div className="nostr-key-box">
                  <span className="nostr-key-label">{t("friendsPage.nostrPublicKey")}</span>
                  <div className="nostr-key-row">
                    <span className="nostr-key-val">{nostrPublicKey}</span>
                    <Button variant="secondary" size="sm" iconOnly leftIcon={<CopyIcon />}
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
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="md"
              type="button"
              leftIcon={<PlusIcon />}
              onClick={onAddFriend}
              disabled={!decodedFriend}
            >
              {t("friends.addFriend")}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
