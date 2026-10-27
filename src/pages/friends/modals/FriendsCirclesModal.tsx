import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../../context/LanguageContext";
import type { Friend, FriendCircle } from "../friendsTypes";
import { displayName, PlusIcon, TrashIcon, XIcon, PencilIcon } from "../friendsUtils";
import { Button } from "../../../components/ui";

interface FriendsCirclesModalProps {
  isOpen: boolean;
  onClose: () => void;
  circles: FriendCircle[];
  friends: Friend[];
  onCreateCircle: (name: string, color?: string) => void;
  onRenameCircle: (circleId: string, name: string) => void;
  onDeleteCircle: (circleId: string) => void;
  onToggleFriendCircle: (friendId: string, circleId: string) => void;
}

const CIRCLE_COLORS = [
  "var(--circle-color-blue)",
  "var(--circle-color-emerald)",
  "var(--circle-color-purple)",
  "var(--circle-color-amber)",
  "var(--circle-color-pink)",
  "var(--circle-color-cyan)",
  "var(--circle-color-rose)",
];

export default function FriendsCirclesModal({
  isOpen,
  onClose,
  circles,
  friends,
  onCreateCircle,
  onRenameCircle,
  onDeleteCircle,
  onToggleFriendCircle,
}: FriendsCirclesModalProps) {
  const { t } = useLanguage();
  const [newCircleName, setNewCircleName] = useState("");
  const [newCircleColor, setNewCircleColor] = useState(CIRCLE_COLORS[0]);
  const [editingCircleId, setEditingCircleId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(
    circles.length > 0 ? circles[0].id : null
  );

  // Escape closes, matching the sync and add-friend dialogs.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCircleName.trim();
    if (!name) return;
    onCreateCircle(name, newCircleColor);
    setNewCircleName("");
  };

  const handleSaveRename = (circleId: string) => {
    const name = editName.trim();
    if (name) {
      onRenameCircle(circleId, name);
    }
    setEditingCircleId(null);
  };

  const activeCircle = circles.find((c) => c.id === selectedCircleId) || circles[0];

  return createPortal(
    <div className="friends-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="friends-modal-box friends-circles-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="friends-circles-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="friends-modal-header">
          <h2 className="friends-modal-title" id="friends-circles-modal-title">
            {t("friendsPage.manageCircles")}
          </h2>
          <Button variant="ghost" size="sm" iconOnly leftIcon={<XIcon />} type="button"  onClick={onClose} title={t("common.close")}></Button>
        </div>

        <div className="friends-modal-body">
          <form className="circles-create-row" onSubmit={handleCreate}>
            <input
              type="text"
              className="profile-input"
              placeholder={t("friendsPage.newCircleName")}
              aria-label={t("friendsPage.newCircleName")}
              value={newCircleName}
              onChange={(e) => setNewCircleName(e.target.value)}
            />
            <div className="circles-color-picker">
              {CIRCLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot${newCircleColor === c ? " active" : ""}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setNewCircleColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
            <Button variant="primary" size="sm" leftIcon={<PlusIcon />} type="submit"  disabled={!newCircleName.trim()}> {t("common.add")} </Button>
          </form>

          <div className="circles-layout">
            <div className="circles-list-sidebar">
              <span className="circles-sidebar-title">{t("friendsPage.yourCircles")}</span>
              {circles.length === 0 ? (
                <div className="circles-empty-note">{t("friendsPage.noCirclesYet")}</div>
              ) : (
                circles.map((c) => (
                  <div
                    key={c.id}
                    className={`circle-item-row${activeCircle?.id === c.id ? " active" : ""}`}
                    onClick={() => setSelectedCircleId(c.id)}
                  >
                    <span className="circle-item-dot" style={{ backgroundColor: c.color || "var(--color-accent)" }} />
                    {editingCircleId === c.id ? (
                      <input
                        className="profile-input circle-edit-input"
                        aria-label={t("friendsPage.circleName")}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleSaveRename(c.id)}
                        onKeyDown={(e) => e.key === "Enter" && handleSaveRename(c.id)}
                        autoFocus
                      />
                    ) : (
                      <span className="circle-item-name">{c.name}</span>
                    )}

                    <div className="circle-item-actions">
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCircleId(c.id);
                          setEditName(c.name);
                        }}
                        title={t("common.edit")}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        className="btn-icon danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCircle(c.id);
                        }}
                        title={t("common.delete")}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="circles-members-panel">
              {activeCircle ? (
                <>
                  <span className="circles-members-title">
                    {t("friendsPage.assignFriendsTo", { name: activeCircle.name })}
                  </span>
                  <div className="circles-friends-checklist">
                    {friends.length === 0 ? (
                      <div className="circles-empty-note">{t("friendsPage.noFriendsToAssign")}</div>
                    ) : (
                      friends.map((f) => {
                        const inCircle = (f.groups || []).includes(activeCircle.id);
                        return (
                          <label key={f.id} className="circle-friend-check-row">
                            <input
                              type="checkbox"
                              checked={inCircle}
                              onChange={() => onToggleFriendCircle(f.id, activeCircle.id)}
                            />
                            <span>{displayName(f)}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </>
              ) : (
                <div className="circles-empty-note">{t("friendsPage.selectCircleToManage")}</div>
              )}
            </div>
          </div>
        </div>

        <div className="friends-modal-footer">
          <Button variant="secondary" size="md" type="button"  onClick={onClose}> {t("common.done")} </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
