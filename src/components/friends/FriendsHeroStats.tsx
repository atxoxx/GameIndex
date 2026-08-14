import { useLanguage } from "../../context/LanguageContext";
import type { Friend, GameSession } from "./friendsTypes";
import { isOnline, safeCurrentlyPlaying, UsersIcon, GamepadIcon, CalendarIcon, StarIcon } from "./friendsUtils";

interface FriendsHeroStatsProps {
  friends: Friend[];
  sessions: GameSession[];
  myGameIds: Set<string>;
}

export default function FriendsHeroStats({ friends, sessions, myGameIds }: FriendsHeroStatsProps) {
  const { t } = useLanguage();

  const totalFriends = friends.length;
  const onlineFriends = friends.filter((f) => !f.blocked && isOnline(f)).length;
  const inGameFriends = friends.filter((f) => !f.blocked && !!safeCurrentlyPlaying(f.currentlyPlaying)).length;

  const now = Date.now();
  const upcomingSessions = sessions.filter(
    (s) => !s.deleted && new Date(s.scheduledAt).getTime() > now
  ).length;

  let totalSharedGames = 0;
  const countedShared = new Set<string>();
  friends.forEach((f) => {
    if (f.blocked || !f.games) return;
    f.games.forEach((g) => {
      if (myGameIds.has(g.id) && !countedShared.has(g.id)) {
        countedShared.add(g.id);
        totalSharedGames++;
      }
    });
  });

  return (
    <div className="friends-hero-stats">
      <div className="friends-hero-stat-card">
        <div className="friends-hero-stat-icon friends-hero-stat-icon--friends">
          <UsersIcon />
        </div>
        <div className="friends-hero-stat-body">
          <span className="friends-hero-stat-val">{totalFriends}</span>
          <span className="friends-hero-stat-lbl">{t("friends.tab.friends")}</span>
        </div>
      </div>

      <div className="friends-hero-stat-card">
        <div className="friends-hero-stat-icon friends-hero-stat-icon--online">
          <span className="friends-hero-stat-pulse" />
        </div>
        <div className="friends-hero-stat-body">
          <span className="friends-hero-stat-val">{onlineFriends}</span>
          <span className="friends-hero-stat-lbl">{t("friendsPage.onlineNow")}</span>
        </div>
      </div>

      <div className="friends-hero-stat-card">
        <div className="friends-hero-stat-icon friends-hero-stat-icon--ingame">
          <GamepadIcon />
        </div>
        <div className="friends-hero-stat-body">
          <span className="friends-hero-stat-val">{inGameFriends}</span>
          <span className="friends-hero-stat-lbl">{t("friendsPage.inGame")}</span>
        </div>
      </div>

      <div className="friends-hero-stat-card">
        <div className="friends-hero-stat-icon friends-hero-stat-icon--sessions">
          <CalendarIcon />
        </div>
        <div className="friends-hero-stat-body">
          <span className="friends-hero-stat-val">{upcomingSessions}</span>
          <span className="friends-hero-stat-lbl">{t("friendsPage.upcomingSessions")}</span>
        </div>
      </div>

      <div className="friends-hero-stat-card">
        <div className="friends-hero-stat-icon friends-hero-stat-icon--shared">
          <StarIcon />
        </div>
        <div className="friends-hero-stat-body">
          <span className="friends-hero-stat-val">{totalSharedGames}</span>
          <span className="friends-hero-stat-lbl">{t("friendsPage.sharedGames")}</span>
        </div>
      </div>
    </div>
  );
}
