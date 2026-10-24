import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../../context/LanguageContext";
import type { Friend } from "../friendsTypes";
import { PencilIcon, XIcon } from "../friendsUtils";
import { Button } from "../../../components/ui";

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

  // The modal stays mounted between openings, so reseed the draft whenever it
  // is opened (or reopened for another friend) instead of showing stale text.
  useEffect(() => {
    if (isOpen) setNickname(friend?.nickname || "");
  }, [isOpen, friend?.id, friend?.nickname]);

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

  return createPortal(
    <div className="friends-modal-backdrop" onClick={onClose}>
      <form
        className="friends-modal-box friends-modal-sm"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="friends-modal-header">
          <h2 className="friends-modal-title">
            <PencilIcon /> {t("friendsPage.setNickname")}
          </h2>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<XIcon />} type="button"  onClick={onClose} title={t("common.close")}></Button>
        </div>

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
            <Button variant="secondary" size="sm" type="button"  onClick={handleClear}> {t("friendsPage.clearNickname")} </Button>
          )}
          <Button variant="secondary" size="md" type="button"  onClick={onClose}> {t("common.cancel")} </Button>
          <Button variant="primary" size="md" type="submit" > {t("common.save")} </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
