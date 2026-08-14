import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, FriendCircle } from "./friendsTypes";
import { displayName, PlusIcon, TrashIcon, XIcon, PencilIcon } from "./friendsUtils";

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
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#8b5cf6", // Purple
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f43f5e", // Rose
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

  return (
    <div className="friends-modal-backdrop" onClick={onClose}>
      <div className="friends-modal-box friends-circles-modal" onClick={(e) => e.stopPropagation()}>
        <div className="friends-modal-header">
          <h2 className="friends-modal-title">{t("friendsPage.manageCircles")}</h2>
          <button type="button" className="friends-modal-close" onClick={onClose} title={t("common.close")}>
            <XIcon />
          </button>
        </div>

        <div className="friends-modal-body">
          <form className="circles-create-row" onSubmit={handleCreate}>
            <input
              type="text"
              className="profile-input"
              placeholder={t("friendsPage.newCircleName")}
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
            <button type="submit" className="btn btn-primary btn--mini" disabled={!newCircleName.trim()}>
              <PlusIcon /> {t("common.add")}
            </button>
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
                    {t("friendsPage.assignFriendsTo", { circle: activeCircle.name })}
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
