import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Friend } from "./friendsTypes";
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
} from "./friendsUtils";

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

  if (!isOpen) return null;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(t("friendsPage.copiedToClipboard", { label }), "success");
  };

  return (
    <div className="friends-modal-backdrop" onClick={onClose}>
      <div className="friends-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2 className="friends-modal-title">
            <UsersIcon /> {t("friendsPage.addFriendModalTitle")}
          </h2>
          <button type="button" className="friends-modal-close" onClick={onClose} title={t("common.close")}>
            <XIcon />
          </button>
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
                  value={friendCodeInput}
                  onChange={(e) => onFriendCodeInputChange(e.target.value)}
                  autoFocus
                />
              </div>

              {decodedFriend && (
                <div className="friend-preview-card">
                  <div className="friend-preview-header">
                    {decodedFriend.avatar && decodedFriend.avatar.startsWith("data:") ? (
                      <img src={decodedFriend.avatar} alt={decodedFriend.name} className="friend-avatar-img" />
                    ) : (
                      <div
                        className="friend-avatar-procedural"
                        style={getProceduralAvatarStyle(decodedFriend.name)}
                      >
                        {getInitials(decodedFriend.name)}
                      </div>
                    )}
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
                      <span>
                        {t("friendsPage.gamesCount", { count: decodedFriend.libStats.gamesCount || 0 })}
                      </span>
                      <span> · </span>
                      <span>{formatHours(decodedFriend.libStats.playtimeMinutes || 0, t)}</span>
                      <span> · </span>
                      <span>
                        {decodedFriend.libStats.achievementsCount || 0} {t("friendsPage.achievements")}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="friends-modal-footer">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onAddFriend}
                  disabled={!decodedFriend}
                >
                  <PlusIcon /> {t("friends.addFriend")}
                </button>
              </div>
            </div>
          ) : (
            <div className="my-code-display">
              <p className="friends-modal-desc">{t("friendsPage.shareCodeDesc")}</p>

              <div className="my-code-box">
                <span className="my-code-text">{myFriendCode}</span>
                <button
                  type="button"
                  className="btn btn-secondary btn--mini"
                  onClick={() => copyToClipboard(myFriendCode, t("friendsPage.friendCode"))}
                >
                  <CopyIcon /> {t("common.copy")}
                </button>
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
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => copyToClipboard(nostrPublicKey, t("friendsPage.nostrPublicKey"))}
                    >
                      <CopyIcon />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
