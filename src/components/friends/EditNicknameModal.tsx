import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend } from "./friendsTypes";
import { PencilIcon, XIcon } from "./friendsUtils";

interface EditNicknameModalProps {
  friend: Friend | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (friendId: string, nickname: string) => void;
}

export default function EditNicknameModal({
  friend,
  isOpen,
  onClose,
  onSave,
}: EditNicknameModalProps) {
  const { t } = useLanguage();
  const [nickname, setNickname] = useState(friend?.nickname || "");

  if (!isOpen || !friend) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(friend.id, nickname.trim());
    onClose();
  };

  const handleClear = () => {
    onSave(friend.id, "");
    onClose();
  };

  return (
    <div className="friends-modal-backdrop" onClick={onClose}>
      <div className="friends-modal-box friends-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2 className="friends-modal-title">
            <PencilIcon /> {t("friendsPage.setNickname")}
          </h2>
          <button type="button" className="friends-modal-close" onClick={onClose} title={t("common.close")}>
            <XIcon />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="friends-modal-body">
            <p className="friends-modal-desc">
              {t("friendsPage.setNicknameDesc", { name: friend.name })}
            </p>
            <div className="form-group">
              <input
                type="text"
                className="profile-input"
                placeholder={friend.name}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="friends-modal-footer">
            {friend.nickname && (
              <button type="button" className="btn btn-secondary btn--mini" onClick={handleClear}>
                {t("friendsPage.clearNickname")}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
