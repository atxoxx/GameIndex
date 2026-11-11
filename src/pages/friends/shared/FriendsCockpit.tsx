import { CalendarPlus, Check, Gamepad2, Pencil, Tag, UserPlus, Users, X } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { FriendsSyncPhase, ManualSyncState } from "../../../sync/friends/engine";
import type { FriendInvitation, UserProfile } from "../friendsTypes";
import { FriendAvatar } from "./FriendAvatar";
import { SyncStatusChip } from "./SyncStatusChip";

interface FriendsCockpitProps {
  profile: UserProfile;
  currentlyPlaying?: string;
  onlineCount: number;
  totalFriends: number;
  inGameCount: number;
  syncPhase: FriendsSyncPhase;
  manualSync?: ManualSyncState;
  pendingPublish?: number;
  lastSyncedTime: string;
  lastSyncMessage?: string;
  /** Inbound requests still waiting on an answer. */
  invitations?: FriendInvitation[];
  onAcceptInvitation?: (invite: FriendInvitation) => void;
  onDenyInvitation?: (syncId: string) => void;
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
 *
 * Connection requests sit here rather than only in the roster because they
 * are the one thing on this page that is waiting on the user.
 */
export function FriendsCockpit({
  profile,
  currentlyPlaying,
  onlineCount,
  totalFriends,
  inGameCount,
  syncPhase,
  manualSync,
  pendingPublish = 0,
  lastSyncedTime,
  lastSyncMessage,
  invitations = [],
  onAcceptInvitation,
  onDenyInvitation,
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

      {invitations.length > 0 && (
        <div className="friends-cockpit__invites">
          <span className="friends-cockpit__invites-label">
            <UserPlus size={13} aria-hidden="true" />
            {t("friendsPage.invitesNeedAnswer", { count: invitations.length })}
          </span>
          {invitations.slice(0, 3).map((invite) => (
            <span key={invite.syncId} className="friends-cockpit__invite">
              <FriendAvatar name={invite.name} avatar={invite.avatar} size="sm" />
              <span className="friends-cockpit__invite-name">{invite.name}</span>
              <button
                type="button"
                className="friends-cockpit__invite-accept"
                onClick={() => onAcceptInvitation?.(invite)}
                title={t("friendsPage.acceptInvite")}
                aria-label={t("friendsPage.acceptRequestFrom", { name: invite.name })}
              >
                <Check size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="friends-cockpit__invite-deny"
                onClick={() => onDenyInvitation?.(invite.syncId)}
                title={t("friendsPage.denyInvite")}
                aria-label={t("friendsPage.declineRequestFrom", { name: invite.name })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

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
          phase={syncPhase}
          manualSync={manualSync}
          pendingPublish={pendingPublish}
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
