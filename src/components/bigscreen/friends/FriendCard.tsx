// FriendCard — console friend tile for the Big Screen Friends hub.
//
// A-press opens a full action menu (modal): Compare, Message, Invite
// to Lobby, Pin/Unpin, Nickname, Circle assignment, Block, Delete —
// the desktop FriendCardMenu equivalents, gamepad-reachable.

import { useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import {
  type Friend,
  type FriendCircle,
  displayName,
  safeCurrentlyPlaying,
} from "../../../pages/friendsStorage";
import { FriendAvatar, Icons, formatFriendsSince, formatHours, isOnline, presenceLabel, sharedGamesCount, useOverlayEscape } from "./friendsUtils";

export interface FriendCardProps {
  friend: Friend;
  circles: FriendCircle[];
  myGameIds: Set<string>;
  onPin: () => void;
  onBlock: () => void;
  onDelete: () => void;
  onSetNickname: () => void;
  onCompare: () => void;
  onMessage: () => void;
  onInviteToLobby: () => void;
  onToggleCircle: (circleId: string) => void;
}

export default function FriendCard(props: FriendCardProps) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);
  const focusCard = useFocusable(() => setShowMenu(true));
  useOverlayEscape(() => setShowMenu(false), showMenu);
  const { friend } = props;
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  const online = isOnline(friend);
  const shared = sharedGamesCount(friend, props.myGameIds);

  return (
    <>
      <div
        className={`bigscreen-game-card bigscreen-friend-card${
          playing ? " bigscreen-friend-card--playing" : ""
        }${friend.blocked ? " bigscreen-friend-card--blocked" : ""}`}
        {...focusCard}
      >
        <div className="bigscreen-friend-card-top">
          <FriendAvatar avatar={friend.avatar} name={friend.name} className="bigscreen-friend-avatar" />
          <div className="bigscreen-friend-id">
            <h4 className="bigscreen-friend-name">
              {displayName(friend)}
              {friend.nickname && <span className="bigscreen-friend-realname">({friend.name})</span>}
            </h4>
            <p className={`bigscreen-friend-status${playing ? " bigscreen-friend-status--playing" : ""}`}>
              {playing && <span className="bigscreen-friend-status-dot" aria-hidden />}
              {friend.blocked
                ? t("friendsPage.blocked")
                : playing
                  ? t("bigscreen.friends.playing", { game: playing })
                  : presenceLabel(friend, t) || friend.status || t("bigscreen.friends.offline")}
            </p>
          </div>
          {friend.pinned && (
            <span className="bigscreen-friend-pin">{Icons.pin(true)}</span>
          )}
        </div>

        {friend.libStats && (
          <div className="bigscreen-friend-stats">
            {t("bigscreen.friends.friendStats", {
              games: friend.libStats.gamesCount,
              trophies: friend.libStats.achievementsCount,
            })}
            <span className="bigscreen-friend-stats-dot" aria-hidden />
            <span className="bigscreen-friend-stats-time">{formatHours(friend.libStats.playtimeMinutes, t)}</span>
          </div>
        )}

        <div className="bigscreen-friend-card-foot">
          {friend.favoriteGame && !isBlacklistedName(friend.favoriteGame) && (
            <span className="bigscreen-friend-fav">
              {Icons.star(true)}
              <span className="bigscreen-friend-fav-name">{friend.favoriteGame}</span>
            </span>
          )}
          {shared > 0 && (
            <span className="bigscreen-friend-common">
              {Icons.gamepad()}
              {t("friendsPage.inCommon", { count: shared })}
            </span>
          )}
          {friend.region && (
            <span className="bigscreen-friend-region">
              {Icons.mapPin()}
              {friend.region}
            </span>
          )}
          <span className="bigscreen-friend-since">
            {Icons.clock()}
            {formatFriendsSince(friend.addedAt, t)}
          </span>
        </div>

        {online && <span className="bigscreen-friend-online-dot" aria-hidden />}
      </div>

      {showMenu && <FriendMenu {...props} onClose={() => setShowMenu(false)} />}
    </>
  );
}

// ─── Action menu (modal) ──────────────────────────────────────────
// Owns its useFocusable calls unconditionally: the menu mounts as a
// whole only when `showMenu` flips, so hook counts stay stable.

function FriendMenu({
  friend,
  circles,
  onPin,
  onBlock,
  onDelete,
  onSetNickname,
  onCompare,
  onMessage,
  onInviteToLobby,
  onToggleCircle,
  onClose,
}: FriendCardProps & { onClose: () => void }) {
  const { t } = useLanguage();
  const compareProps = useFocusable(() => {
    onCompare();
    onClose();
  });
  const messageProps = useFocusable(() => {
    onMessage();
    onClose();
  });
  const inviteProps = useFocusable(() => {
    onInviteToLobby();
    onClose();
  });
  const pinProps = useFocusable(() => {
    onPin();
    onClose();
  });
  const nicknameProps = useFocusable(() => {
    onSetNickname();
    onClose();
  });
  const blockProps = useFocusable(() => {
    onBlock();
    onClose();
  });
  const deleteProps = useFocusable(() => {
    onDelete();
    onClose();
  });
  const cancelProps = useFocusable(onClose);

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-friendoptions-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-friendoptions-head">
          <FriendAvatar avatar={friend.avatar} name={friend.name} className="bigscreen-friend-avatar bigscreen-friend-avatar--sm" />
          <h4 className="bigscreen-friendoptions-title">{displayName(friend)}</h4>
        </div>

        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...compareProps}>
          {Icons.compare()}
          {t("friends.compare")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...messageProps}>
          {Icons.message()}
          {t("friends.message")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...inviteProps}>
          {Icons.calendar()}
          {t("friends.invite")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...pinProps}>
          {Icons.pin(friend.pinned)}
          {friend.pinned ? t("bigscreen.friends.unpinFriend") : t("bigscreen.friends.pinFriend")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...nicknameProps}>
          {Icons.edit()}
          {t("bigscreen.friends.setNickname")}
        </button>

        {circles.length > 0 && (
          <div className="bigscreen-friendmenu-circles">
            <div className="bigscreen-friendmenu-circles-label">{t("friendsPage.manageCircles")}</div>
            {circles.map((c) => (
              <FriendCircleToggle
                key={c.id}
                circle={c}
                active={(friend.groups || []).includes(c.id)}
                onToggle={() => onToggleCircle(c.id)}
              />
            ))}
          </div>
        )}

        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn" {...blockProps}>
          {Icons.block()}
          {friend.blocked ? t("bigscreen.friends.unblockFriend") : t("bigscreen.friends.blockFriend")}
        </button>
        <button type="button" className="bigscreen-details-btn bigscreen-details-btn--danger bigscreen-details-btn--compact bigscreen-popover-btn" {...deleteProps}>
          {Icons.trash()}
          {t("bigscreen.friends.deleteFriend")}
        </button>
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact bigscreen-popover-btn bigscreen-popover-btn--cancel"
          {...cancelProps}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

// ─── Circle toggle row (own component: stable useFocusable count) ─

function FriendCircleToggle({
  circle,
  active,
  onToggle,
}: {
  circle: FriendCircle;
  active: boolean;
  onToggle: () => void;
}) {
  const toggleProps = useFocusable(onToggle);
  return (
    <button
      type="button"
      className={`bigscreen-friendmenu-circle${active ? " active" : ""}`}
      {...toggleProps}
    >
      <span className="bigscreen-friendmenu-circle-dot" aria-hidden />
      {circle.name}
      {active && <span className="bigscreen-friendmenu-circle-check">{Icons.check()}</span>}
    </button>
  );
}

// Small local helper (no i18n needed — numbers only).
function isBlacklistedName(name?: string): boolean {
  if (!name) return true;
  return name.toLowerCase().includes("wallpaper engine");
}
