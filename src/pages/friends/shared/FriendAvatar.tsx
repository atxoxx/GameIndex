import { getInitials, getProceduralAvatarStyle, isOnline, safeCurrentlyPlaying } from "../friendsUtils";
import type { Friend } from "../friendsTypes";

type AvatarSize = "sm" | "md" | "lg" | "xl";

interface FriendAvatarProps {
  name?: string;
  avatar?: string;
  size?: AvatarSize;
  /** Pass a friend to let the avatar derive the presence dot automatically. */
  friend?: Friend;
  online?: boolean;
  playing?: boolean;
  className?: string;
}

/**
 * One avatar treatment for the roster, the detail pane, the presence rail
 * and the cockpit. Sizes map to fixed square tokens so rows line up.
 */
export function FriendAvatar({
  name,
  avatar,
  size = "md",
  friend,
  online,
  playing,
  className,
}: FriendAvatarProps) {
  const isFriendOnline = online ?? (friend ? isOnline(friend) : false);
  const isPlaying = playing ?? (friend ? !!safeCurrentlyPlaying(friend.currentlyPlaying) : false);
  const source = avatar ?? friend?.avatar;
  const display = name ?? friend?.name ?? "";

  return (
    <span className={["friend-avatar", `friend-avatar--${size}`, className ?? ""].filter(Boolean).join(" ")}>
      {source && source.startsWith("data:") ? (
        <img src={source} alt="" className="friend-avatar__image" />
      ) : (
        <span className="friend-avatar__initials" style={getProceduralAvatarStyle(display)} aria-hidden="true">
          {getInitials(display)}
        </span>
      )}
      <span
        className={[
          "friend-avatar__presence",
          isPlaying ? "is-playing" : isFriendOnline ? "is-online" : "is-offline",
        ].join(" ")}
        aria-hidden="true"
      />
    </span>
  );
}

export default FriendAvatar;
