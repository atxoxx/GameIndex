import { CalendarPlus, Gamepad2, MessageCircle, Users } from "lucide-react";
import { StatBand, type StatBandItem } from "../../../components/ui/StatBand";
import { useLanguage } from "../../../context/LanguageContext";
import type { Friend, GameSession } from "../friendsTypes";
import { safeCurrentlyPlaying } from "../friendsUtils";
import { FriendAvatar } from "./FriendAvatar";

export type FriendsRosterFilter = "all" | "online" | "ingame" | "pinned" | "blocked";

interface FriendsHeroBandProps {
  friends: Friend[];
  sessions: GameSession[];
  myGameIds: Set<string>;
  onFilter: (filter: FriendsRosterFilter) => void;
  onOpenSessions: () => void;
  onOpenCompare: () => void;
  onOpenFriend: (friend: Friend) => void;
  onMessageFriend: (friend: Friend) => void;
  onInviteFriend: (friend: Friend) => void;
}

/**
 * The at-a-glance band under the cockpit: five numbers that double as
 * navigation, plus the "playing now" rail with the two actions people
 * actually want from presence — message and invite.
 */
export function FriendsHeroBand({
  friends,
  sessions,
  myGameIds,
  onFilter,
  onOpenSessions,
  onOpenCompare,
  onOpenFriend,
  onMessageFriend,
  onInviteFriend,
}: FriendsHeroBandProps) {
  const { t } = useLanguage();

  const visibleFriends = friends.filter((f) => !f.blocked);
  const online = visibleFriends.filter((f) => {
    const playing = safeCurrentlyPlaying(f.currentlyPlaying);
    return (
      !!playing ||
      f.status?.toLowerCase().includes("online") ||
      f.status?.toLowerCase().includes("playing") ||
      (!!f.lastActive && Math.floor(Date.now() / 1000) - f.lastActive < 180)
    );
  });
  const playingFriends = visibleFriends.filter((f) => !!safeCurrentlyPlaying(f.currentlyPlaying));
  const upcoming = sessions.filter((s) => !s.deleted && new Date(s.scheduledAt).getTime() > Date.now());

  const sharedGameIds = new Set<string>();
  visibleFriends.forEach((friend) => {
    (friend.games || []).forEach((game) => {
      if (myGameIds.has(game.id)) sharedGameIds.add(game.id);
    });
  });

  const items: StatBandItem[] = [
    {
      id: "friends",
      label: t("friendsPage.friendList"),
      value: visibleFriends.length,
      icon: <Users size={14} aria-hidden="true" />,
      onClick: () => onFilter("all"),
      hint: t("friendsPage.filterAllHint"),
    },
    {
      id: "online",
      label: t("friendsPage.onlineNow"),
      value: online.length,
      tone: "success",
      onClick: () => onFilter("online"),
      hint: t("friendsPage.filterOnlineHint"),
    },
    {
      id: "ingame",
      label: t("friendsPage.inGame"),
      value: playingFriends.length,
      tone: "accent",
      onClick: () => onFilter("ingame"),
      hint: t("friendsPage.filterInGameHint"),
    },
    {
      id: "sessions",
      label: t("friendsPage.upcomingSessions"),
      value: upcoming.length,
      tone: "warning",
      onClick: onOpenSessions,
      hint: t("friendsPage.openSessionsHint"),
    },
    {
      id: "shared",
      label: t("friendsPage.sharedGames"),
      value: sharedGameIds.size,
      tone: "info",
      onClick: onOpenCompare,
      hint: t("friendsPage.openCompareHint"),
    },
  ];

  return (
    <section className="friends-hero-band" aria-label={t("friendsPage.overview")}>
      <StatBand items={items} ariaLabel={t("friendsPage.overview")} className="friends-hero-band__stats" />

      {playingFriends.length > 0 && (
        <div className="friends-presence">
          <div className="friends-presence__head">
            <span className="friends-presence__title">
              <Gamepad2 size={14} aria-hidden="true" />
              {t("friendsPage.friendsPlayingNow", { count: playingFriends.length })}
            </span>
            <span className="friends-presence__hint">{t("friendsPage.presenceHint")}</span>
          </div>
          <div className="friends-presence__rail">
            {playingFriends.map((friend) => {
              const game = safeCurrentlyPlaying(friend.currentlyPlaying);
              return (
                <div
                  key={friend.id}
                  className="friends-presence__card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenFriend(friend)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenFriend(friend);
                    }
                  }}
                >
                  <FriendAvatar friend={friend} size="sm" />
                  <span className="friends-presence__meta">
                    <span className="friends-presence__name">{friend.nickname?.trim() || friend.name}</span>
                    <span className="friends-presence__game">{game}</span>
                  </span>
                  <span className="friends-presence__actions">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onMessageFriend(friend);
                      }}
                      title={t("friends.message")}
                      aria-label={t("friendsPage.messageFriendTitle", { name: friend.name })}
                    >
                      <MessageCircle size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onInviteFriend(friend);
                      }}
                      title={t("friends.invite")}
                      aria-label={t("friendsPage.inviteToSessionTitle", { name: friend.name })}
                    >
                      <CalendarPlus size={14} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default FriendsHeroBand;
