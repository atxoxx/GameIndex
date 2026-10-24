import { CalendarPlus, Gamepad2, Pencil, Tag, UserPlus, Users } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { UserProfile } from "../friendsTypes";
import { FriendAvatar } from "./FriendAvatar";
import { SyncStatusChip } from "./SyncStatusChip";

interface FriendsCockpitProps {
  profile: UserProfile;
  currentlyPlaying?: string;
  onlineCount: number;
  totalFriends: number;
  inGameCount: number;
  isSyncing: boolean;
  lastSyncedTime: string;
  lastSyncMessage?: string;
  onAddFriend: () => void;
  onStartSession: () => void;
  onManageCircles: () => void;
  onEditProfile: () => void;
  onSyncNow: () => void;
  onOpenDiagnostics: () => void;
}

/**
 * The friends page's answer to the stats cockpit: your own identity on the
 * left, the actions that start something on the right, and sync folded into
 * a single status chip instead of a toolbar of icon buttons.
 */
export function FriendsCockpit({
  profile,
  currentlyPlaying,
  onlineCount,
  totalFriends,
  inGameCount,
  isSyncing,
  lastSyncedTime,
  lastSyncMessage,
  onAddFriend,
  onStartSession,
  onManageCircles,
  onEditProfile,
  onSyncNow,
  onOpenDiagnostics,
}: FriendsCockpitProps) {
  const { t } = useLanguage();

  return (
    <section className="friends-cockpit" aria-label={t("friendsPage.playerCard")}>
      <div className="friends-cockpit__identity">
        <FriendAvatar name={profile.name} avatar={profile.avatar} size="lg" online />
        <div className="friends-cockpit__text">
          <span className="friends-cockpit__eyebrow">{t("friendsPage.playerCard")}</span>
          <h1 className="friends-cockpit__name">{profile.name}</h1>
          <p className="friends-cockpit__status">
            <span className="friends-cockpit__live" aria-hidden="true" />
            <span>{currentlyPlaying ? t("friendsPage.playingGame", { game: currentlyPlaying }) : profile.status}</span>
            {profile.region && <span className="friends-cockpit__region">{profile.region}</span>}
          </p>
        </div>
        <button
          type="button"
          className="friends-cockpit__edit"
          onClick={onEditProfile}
          title={t("friendsPage.editProfile")}
          aria-label={t("friendsPage.editProfile")}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="friends-cockpit__pulse" aria-label={t("friendsPage.circlePulse")}>
        <span className="friends-cockpit__pulse-icon" aria-hidden="true">
          <Users size={14} />
        </span>
        <span>
          <strong>{onlineCount}</strong> / {totalFriends} {t("friendsPage.onlineNowShort")}
        </span>
        <span className="friends-cockpit__pulse-sep" aria-hidden="true" />
        <span className="friends-cockpit__pulse-icon" aria-hidden="true">
          <Gamepad2 size={14} />
        </span>
        <span>
          <strong>{inGameCount}</strong> {t("friendsPage.inGameShort")}
        </span>
      </div>

      <div className="friends-cockpit__actions">
        <button type="button" className="friends-cockpit__action is-primary" onClick={onAddFriend}>
          <UserPlus size={15} aria-hidden="true" />
          {t("friends.addFriend")}
        </button>
        <button type="button" className="friends-cockpit__action" onClick={onStartSession}>
          <CalendarPlus size={15} aria-hidden="true" />
          {t("friendsPage.startSession")}
        </button>
        <button
          type="button"
          className="friends-cockpit__icon-action"
          onClick={onManageCircles}
          title={t("friendsPage.manageCircles")}
          aria-label={t("friendsPage.manageCircles")}
        >
          <Tag size={15} aria-hidden="true" />
        </button>
        <SyncStatusChip
          isSyncing={isSyncing}
          lastSyncedTime={lastSyncedTime}
          lastMessage={lastSyncMessage}
          onSyncNow={onSyncNow}
          onOpenDiagnostics={onOpenDiagnostics}
        />
      </div>
    </section>
  );
}

export default FriendsCockpit;
