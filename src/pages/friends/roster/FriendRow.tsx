import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  CalendarPlus,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Swords,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { Friend, FriendCircle } from "../friendsTypes";
import { displayName, formatLastSeen, presenceLabel, safeCurrentlyPlaying } from "../friendsUtils";
import { FriendAvatar } from "../shared/FriendAvatar";

interface FriendRowProps {
  friend: Friend;
  circles: FriendCircle[];
  density: "comfortable" | "compact";
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleChecked: () => void;
  onMessage: () => void;
  onInvite: () => void;
  onCompare: () => void;
  onTogglePin: () => void;
  onSetNickname: () => void;
  onToggleBlock: () => void;
  onDelete: () => void;
}

const MENU_WIDTH = 208;

export function FriendRow({
  friend,
  circles,
  density,
  selected,
  selectMode,
  checked,
  onSelect,
  onToggleChecked,
  onMessage,
  onInvite,
  onCompare,
  onTogglePin,
  onSetNickname,
  onToggleBlock,
  onDelete,
}: FriendRowProps) {
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const name = displayName(friend);
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  const presence = playing
    ? t("friendsPage.playingGame", { game: playing })
    : presenceLabel(friend, t) || formatLastSeen(friend.lastSeen, t);
  const memberCircles = (friend.groups || [])
    .map((id) => circles.find((circle) => circle.id === id))
    .filter((circle): circle is FriendCircle => !!circle);

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setMenuPos({ top: rect.bottom + 6, left });
    setMenuOpen(true);
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const height = menu.offsetHeight;
    const roomBelow = window.innerHeight - rect.bottom - 8;
    const top =
      roomBelow >= height || rect.top < height + 8
        ? Math.min(rect.bottom + 6, window.innerHeight - height - 8)
        : rect.top - height - 6;
    setMenuPos((prev) => ({ top: Math.max(8, top), left: prev?.left ?? 8 }));
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      className={[
        "friends-row",
        `friends-row--${density}`,
        selected ? "is-selected" : "",
        friend.pinned ? "is-pinned" : "",
        friend.blocked ? "is-blocked" : "",
        selectMode ? "is-selecting" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => (selectMode ? onToggleChecked() : onSelect())}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selectMode) onToggleChecked();
          else onSelect();
        }
      }}
    >
      {selectMode && (
        <span className="friends-row__check">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleChecked}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("friendsPage.selectFriendAria", { name })}
          />
        </span>
      )}

      <FriendAvatar friend={friend} size={density === "compact" ? "sm" : "md"} />

      <span className="friends-row__main">
        <span className="friends-row__name-line">
          <span className="friends-row__name">{name}</span>
          {friend.pinned && (
            <span className="friends-row__badge" title={t("friends.pinned")}>
              <Pin size={11} aria-hidden="true" />
            </span>
          )}
          {friend.blocked && (
            <span className="friends-row__badge is-muted" title={t("friendsPage.blocked")}>
              <Ban size={11} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className={["friends-row__presence", playing ? "is-playing" : ""].filter(Boolean).join(" ")}>
          {presence}
        </span>
        {density === "comfortable" && friend.nickname && friend.nickname.trim() !== friend.name && (
          <span className="friends-row__alias">@{friend.name}</span>
        )}
      </span>

      {density === "comfortable" && memberCircles.length > 0 && (
        <span className="friends-row__circles" aria-label={t("friendsPage.circles")}>
          {memberCircles.slice(0, 3).map((circle) => (
            <span
              key={circle.id}
              className="friends-row__circle-dot"
              style={circle.color ? { background: circle.color } : undefined}
              title={circle.name}
            />
          ))}
        </span>
      )}

      <span className="friends-row__actions">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onMessage();
          }}
          title={t("friends.message")}
          aria-label={t("friendsPage.messageFriendTitle", { name })}
        >
          <MessageCircle size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onInvite();
          }}
          title={t("friends.invite")}
          aria-label={t("friendsPage.inviteToSessionTitle", { name })}
        >
          <CalendarPlus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCompare();
          }}
          title={t("friends.compare")}
          aria-label={t("friendsPage.compareLibrariesWith", { name })}
        >
          <Swords size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          ref={triggerRef}
          className={`friends-row__menu-trigger${menuOpen ? " is-open" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            if (menuOpen) setMenuOpen(false);
            else openMenu();
          }}
          title={t("friendsPage.actions")}
          aria-label={t("friendsPage.actions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
      </span>

      {menuOpen &&
        menuPos &&
        createPortal(
          <div
            className="friends-menu"
            role="menu"
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: MENU_WIDTH,
              maxHeight: "calc(100vh - 16px)",
              overflowY: "auto",
              zIndex: 1200,
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => run(onCompare)}>
              <Swords size={14} aria-hidden="true" />
              {t("friends.compare")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onInvite)}>
              <CalendarPlus size={14} aria-hidden="true" />
              {t("friends.invite")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onMessage)}>
              <MessageCircle size={14} aria-hidden="true" />
              {t("friends.message")}
            </button>
            <span className="friends-menu__divider" aria-hidden="true" />
            <button type="button" role="menuitem" onClick={() => run(onTogglePin)}>
              {friend.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
              {friend.pinned ? t("friends.unpin") : t("friendsPage.pinToTop")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onSetNickname)}>
              <Pencil size={14} aria-hidden="true" />
              {t("friendsPage.setNickname")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onToggleBlock)}>
              <Ban size={14} aria-hidden="true" />
              {friend.blocked ? t("friendsPage.unblock") : t("friendsPage.blockIgnore")}
            </button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => run(onDelete)}>
              <Trash2 size={14} aria-hidden="true" />
              {t("friendsPage.removeFriendTitle", { name })}
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}

export default FriendRow;
