import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, FriendCircle } from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isOnline,
  presenceLabel,
  safeCurrentlyPlaying,
  formatHours,
  formatLastSeen,
  formatFriendsSince,
  ThreeDotsIcon,
  CompareIcon,
  UsersIcon,
  MessageIcon,
  PinIcon,
  PencilIcon,
  BlockIcon,
  TrashIcon,
  GamepadIcon,
  StarIcon,
  ClockIcon,
} from "./friendsUtils";

interface FriendCardProps {
  friend: Friend;
  circles: FriendCircle[];
  myGameIds?: Set<string>;
  density?: "grid" | "list";
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onCompare: () => void;
  onInvite: () => void;
  onMessage: () => void;
  onTogglePin: () => void;
  onSetNickname: () => void;
  onToggleBlock: () => void;
  onDelete: () => void;
}

export default function FriendCard({
  friend,
  circles,
  density = "grid",
  selectMode = false,
  selected = false,
  onToggleSelect,
  onCompare,
  onInvite,
  onMessage,
  onTogglePin,
  onSetNickname,
  onToggleBlock,
  onDelete,
}: FriendCardProps) {
  const { t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_WIDTH = 210;

  function openMenu() {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setMenuPos({ top: rect.bottom + 6, left });
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      setMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const name = displayName(friend);
  const hasNickname = !!friend.nickname?.trim() && friend.nickname.trim() !== friend.name;
  const online = isOnline(friend);
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  const presence = presenceLabel(friend, t);

  const friendCircles = (friend.groups || [])
    .map((gid) => circles.find((c) => c.id === gid))
    .filter((c): c is FriendCircle => !!c);

  const stats = friend.libStats || { gamesCount: 0, playtimeMinutes: 0, achievementsCount: 0 };

  const menuItems = [
    {
      icon: <CompareIcon />,
      label: t("friends.compare"),
      title: t("friendsPage.compareLibrariesWith", { name }),
      onClick: onCompare,
    },
    {
      icon: <UsersIcon />,
      label: t("friends.invite"),
      title: t("friendsPage.inviteToSessionTitle", { name }),
      onClick: onInvite,
    },
    {
      icon: <MessageIcon />,
      label: t("friends.message"),
      title: t("friendsPage.messageFriendTitle", { name }),
      onClick: onMessage,
    },
    {
      icon: <PinIcon />,
      label: friend.pinned ? t("friends.unpin") : t("friendsPage.pinToTop"),
      title: friend.pinned ? t("friends.unpin") : t("friendsPage.pinToTop"),
      active: friend.pinned,
      onClick: onTogglePin,
    },
    {
      icon: <PencilIcon />,
      label: t("friendsPage.setNickname"),
      title: t("friendsPage.setNickname"),
      onClick: onSetNickname,
    },
    {
      icon: <BlockIcon />,
      label: friend.blocked ? t("friendsPage.unblock") : t("friendsPage.blockIgnore"),
      title: friend.blocked ? t("friendsPage.unblock") : t("friendsPage.blockIgnore"),
      active: friend.blocked,
      onClick: onToggleBlock,
    },
    {
      icon: <TrashIcon />,
      label: t("friendsPage.removeFriendTitle", { name }),
      title: t("friendsPage.removeFriendTitle", { name }),
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <div
      className={`friend-card-modern${density === "list" ? " friend-card--list" : ""}${
        friend.pinned ? " pinned" : ""
      }${friend.blocked ? " blocked" : ""}${selected ? " selected" : ""}`}
    >
      {selectMode && (
        <div className="friend-card-select-overlay" onClick={onToggleSelect}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {}}
            aria-label={t("friendsPage.selectFriendAria", { name })}
            className="friend-select-checkbox"
          />
        </div>
      )}

      <div className="friend-card-header">
        <div className="friend-avatar-wrapper">
          {friend.avatar && friend.avatar.startsWith("data:") ? (
            <img src={friend.avatar} alt={name} className="friend-avatar-img" />
          ) : (
            <div className="friend-avatar-procedural" style={getProceduralAvatarStyle(friend.name)}>
              {getInitials(name)}
            </div>
          )}
          <span
            className={`friend-presence-dot${online ? " online" : ""}${playing ? " in-game" : ""}`}
            title={online ? (playing ? t("friendsPage.playingNow") : t("friendsPage.onlineNow")) : t("friendsPage.offline")}
          />
        </div>

        <div className="friend-info-main">
          <div className="friend-name-row">
            <h3 className="friend-name" title={name}>
              {name}
            </h3>
            {friend.pinned && <span className="friend-pin-badge" title={t("friends.pinned")}><PinIcon /></span>}
            {friend.blocked && <span className="friend-blocked-badge" title={t("friendsPage.blocked")}><BlockIcon /></span>}
          </div>

          {hasNickname && (
            <div className="friend-realname" title={friend.name}>
              @{friend.name}
            </div>
          )}

          <div className="friend-status-text">
            {playing ? (
              <span className="presence-playing" title={playing}>
                <GamepadIcon /> {t("friendsPage.playingGame", { game: playing })}
              </span>
            ) : presence ? (
              <span className="presence-online">{presence}</span>
            ) : friend.status ? (
              <span className="presence-custom">{friend.status}</span>
            ) : (
              <span className="presence-offline">{formatLastSeen(friend.lastSeen, t)}</span>
            )}
          </div>
        </div>

        <div className="friend-card-actions-top">
          <button
            type="button"
            ref={triggerRef}
            className={`friend-menu-trigger${menuOpen ? " open" : ""}`}
            title={t("friendsPage.actions")}
            aria-label={t("friendsPage.actions")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              if (menuOpen) setMenuOpen(false);
              else openMenu();
            }}
          >
            <ThreeDotsIcon />
          </button>
        </div>
      </div>

      {friend.bio && <p className="friend-bio-line">{friend.bio}</p>}

      {friendCircles.length > 0 && (
        <div className="friend-circles-strip">
          {friendCircles.map((c) => (
            <span key={c.id} className="friend-circle-chip" style={c.color ? { borderColor: c.color, color: c.color } : undefined}>
              {c.name}
            </span>
          ))}
        </div>
      )}

      <div className="friend-card-stats">
        <div className="friend-stat-tile" title={t("friendsPage.gamesOwned")}>
          <span className="friend-stat-val">{stats.gamesCount}</span>
          <span className="friend-stat-lbl">{t("friendsPage.games")}</span>
        </div>
        <div className="friend-stat-tile" title={t("friendsPage.totalPlaytime")}>
          <span className="friend-stat-val">{formatHours(stats.playtimeMinutes, t)}</span>
          <span className="friend-stat-lbl">{t("friendsPage.playtime")}</span>
        </div>
        <div className="friend-stat-tile" title={t("friendsPage.totalAchievements")}>
          <span className="friend-stat-val">{stats.achievementsCount}</span>
          <span className="friend-stat-lbl">{t("friendsPage.achievements")}</span>
        </div>
      </div>

      <div className="friend-card-footer">
        {friend.favoriteGame ? (
          <div className="friend-favorite-game" title={t("friendsPage.favoriteGame", { game: friend.favoriteGame })}>
            <StarIcon /> <span>{friend.favoriteGame}</span>
          </div>
        ) : (
          <div className="friend-since" title={t("friendsPage.friendsSince")}>
            <ClockIcon /> <span>{formatFriendsSince(friend.addedAt, t)}</span>
          </div>
        )}

        <div className="friend-card-quick-actions">
          <button
            type="button"
            className="btn-friend-quick"
            title={t("friends.compare")}
            onClick={onCompare}
          >
            <CompareIcon />
          </button>
          <button
            type="button"
            className="btn-friend-quick"
            title={t("friends.message")}
            onClick={onMessage}
          >
            <MessageIcon />
          </button>
        </div>
      </div>

      {menuOpen && menuPos &&
        createPortal(
          <div
            className="friend-menu"
            role="menu"
            ref={menuRef}
            style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: MENU_WIDTH, zIndex: 1200 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {menuItems.map((item, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`friend-menu-item${item.danger ? " danger" : ""}${item.active ? " active" : ""}`}
                title={item.title}
                onClick={() => {
                  setMenuOpen(false);
                  item.onClick();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
