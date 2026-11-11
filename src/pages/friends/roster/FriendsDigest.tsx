import { useMemo } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Lightbulb,
  MessageCircle,
  Sparkles,
  ThumbsUp,
  UserPlus,
  X,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { displayName, visibleMessages } from "../../friendsStorage";
import type {
  DmThread,
  Friend,
  FriendInvitation,
  GameRecommendation,
  GameSession,
  GameSuggestion,
  UserProfile,
} from "../friendsTypes";
import type { FriendsTabKey } from "../friendsTypes";
import { formatLastSeen } from "../friendsUtils";
import { FriendAvatar } from "../shared/FriendAvatar";

interface FriendsDigestProps {
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  dms: DmThread[];
  profile: UserProfile;
  /** Inbound requests still waiting on an answer. */
  invitations?: FriendInvitation[];
  onAcceptInvitation?: (invite: FriendInvitation) => void;
  onDenyInvitation?: (syncId: string) => void;
  onNavigate: (tab: FriendsTabKey) => void;
}

type DigestKind = "message" | "session" | "recommendation" | "suggestion";

interface DigestItem {
  id: string;
  kind: DigestKind;
  /** Friend behind the row, so a share shows their face instead of an icon. */
  author?: string;
  title: string;
  detail?: string;
  timestamp: number;
  action: FriendsTabKey;
}

/** How many rows the card shows before it stops being a summary. */
const MAX_DIGEST_ROWS = 5;
/** Games named in a grouped row before the rest collapse into "+N". */
const MAX_NAMED_GAMES = 3;

/** Buckets shares by author and keeps each bucket newest-first. */
function groupByAuthor<T>(
  items: T[],
  authorOf: (item: T) => string,
  timeOf: (item: T) => number
): { author: string; items: T[]; timestamp: number }[] {
  const buckets = new Map<string, T[]>();
  items.forEach((item) => {
    const author = authorOf(item);
    const bucket = buckets.get(author);
    if (bucket) bucket.push(item);
    else buckets.set(author, [item]);
  });

  return [...buckets.entries()].map(([author, bucket]) => {
    const sorted = [...bucket].sort((a, b) => timeOf(b) - timeOf(a));
    return {
      author,
      items: sorted,
      timestamp: Math.max(...sorted.map(timeOf)),
    };
  });
}

/** "Hades · Celeste · Tunic +2" — enough names to be useful, never a wall. */
function summarizeGames(
  names: string[],
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
  const shown = names.slice(0, MAX_NAMED_GAMES).join(" · ");
  const extra = names.length - MAX_NAMED_GAMES;
  return extra > 0 ? `${shown} ${t("friendsPage.digest.moreGames", { count: extra })}` : shown;
}

export function FriendsDigest({
  friends,
  sessions,
  recommendations,
  suggestions,
  dms,
  profile,
  invitations = [],
  onAcceptInvitation,
  onDenyInvitation,
  onNavigate,
}: FriendsDigestProps) {
  const { t } = useLanguage();

  const unreadMessages = useMemo(() => {
    return dms
      .filter((thread) => !thread.deleted && thread.participants.includes(profile.name))
      .reduce((count, thread) => {
        const lastRead = thread.lastReadAt?.[profile.name] || 0;
        return (
          count +
          visibleMessages(thread.messages).filter((message) => message.author !== profile.name && message.timestamp > lastRead).length
        );
      }, 0);
  }, [dms, profile.name]);

  const nextSession = useMemo(() => {
    const now = Date.now();
    return sessions
      .filter((session) => !session.deleted && new Date(session.scheduledAt).getTime() > now)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  }, [sessions]);

  const friendsByName = useMemo(() => {
    const map = new Map<string, Friend>();
    friends.forEach((friend) => {
      map.set(friend.name, friend);
      const label = displayName(friend);
      if (!map.has(label)) map.set(label, friend);
    });
    return map;
  }, [friends]);

  const items = useMemo<DigestItem[]>(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const list: DigestItem[] = [];

    dms.forEach((thread) => {
      if (thread.deleted || !thread.participants.includes(profile.name)) return;
      const lastRead = thread.lastReadAt?.[profile.name] || 0;
      const unread = visibleMessages(thread.messages).filter(
        (message) => message.author !== profile.name && message.timestamp > lastRead
      );
      if (unread.length === 0) return;
      const last = unread[unread.length - 1];
      list.push({
        id: `dm_${thread.id}`,
        kind: "message",
        author: last.author,
        title: t("friendsPage.digest.newMessages", { name: last.author, count: unread.length }),
        detail: last.text,
        timestamp: last.timestamp,
        action: "dms",
      });
    });

    sessions.forEach((session) => {
      if (session.deleted || session.creatorName === profile.name) return;
      if ((session.updatedAt || 0) < weekAgo) return;
      list.push({
        id: `session_${session.id}`,
        kind: "session",
        author: session.creatorName,
        title: t("friendsPage.digest.newSession", { name: session.creatorName, game: session.gameName }),
        detail: new Date(session.scheduledAt).toLocaleString(undefined, {
          weekday: "short",
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp: session.updatedAt || new Date(session.scheduledAt).getTime(),
        action: "sessions",
      });
    });

    // A friend who shared five wishlist games is one piece of news, not five.
    const recentRecommendations = recommendations.filter(
      (rec) =>
        !rec.deleted &&
        rec.recommendedBy !== profile.name &&
        (rec.updatedAt || rec.createdAt || 0) >= weekAgo
    );
    groupByAuthor(
      recentRecommendations,
      (rec) => rec.recommendedBy,
      (rec) => rec.updatedAt || rec.createdAt || now
    ).forEach(({ author, items: group, timestamp }) => {
      const names = group.map((rec) => rec.gameName);
      list.push({
        id: `rec_${author}`,
        kind: "recommendation",
        author,
        title:
          group.length > 1
            ? t("friendsPage.digest.recommendationGroup", { name: author, count: group.length })
            : t("friendsPage.digest.newRecommendation", { name: author, game: names[0] }),
        detail: group.length > 1 ? summarizeGames(names, t) : group[0].reason || summarizeGames(names, t),
        timestamp,
        action: "recs",
      });
    });

    const recentSuggestions = suggestions.filter(
      (suggestion) =>
        !suggestion.deleted &&
        suggestion.suggestedBy !== profile.name &&
        (suggestion.updatedAt || suggestion.createdAt || 0) >= weekAgo
    );
    groupByAuthor(
      recentSuggestions,
      (suggestion) => suggestion.suggestedBy,
      (suggestion) => suggestion.updatedAt || suggestion.createdAt || now
    ).forEach(({ author, items: group, timestamp }) => {
      const names = group.map((suggestion) => suggestion.gameName);
      list.push({
        id: `sug_${author}`,
        kind: "suggestion",
        author,
        title:
          group.length > 1
            ? t("friendsPage.digest.wishlistGroup", { name: author, count: group.length })
            : t("friendsPage.digest.newSuggestion", { name: author, game: names[0] }),
        detail: group.length > 1 ? summarizeGames(names, t) : group[0].note || summarizeGames(names, t),
        timestamp,
        action: "suggestions",
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_DIGEST_ROWS);
  }, [dms, sessions, recommendations, suggestions, profile.name, t]);

  const iconFor = (kind: DigestKind) => {
    if (kind === "message") return <MessageCircle size={14} aria-hidden="true" />;
    if (kind === "session") return <CalendarClock size={14} aria-hidden="true" />;
    if (kind === "recommendation") return <ThumbsUp size={14} aria-hidden="true" />;
    return <Lightbulb size={14} aria-hidden="true" />;
  };

  return (
    <section className="friends-digest" aria-label={t("friendsPage.digest.title")}>
      <header className="friends-digest__head">
        <div>
          <span className="friends-digest__eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            {t("friendsPage.digest.eyebrow")}
          </span>
          <h2>{t("friendsPage.digest.title")}</h2>
          <p>{t("friendsPage.digest.subtitle")}</p>
        </div>
        {unreadMessages > 0 && (
          <button type="button" className="friends-digest__unread" onClick={() => onNavigate("dms")}>
            <Inbox size={14} aria-hidden="true" />
            {t("friendsPage.digest.unread", { count: unreadMessages })}
          </button>
        )}
      </header>

      {invitations.length > 0 && (
        <section className="friends-digest__invites" aria-label={t("friendsPage.pendingInvitations", { count: invitations.length })}>
          <div className="friends-digest__invites-head">
            <UserPlus size={14} aria-hidden="true" />
            {t("friendsPage.pendingInvitations", { count: invitations.length })}
          </div>
          {invitations.slice(0, 4).map((invite) => (
            <div key={invite.syncId} className="friends-digest__invite">
              <span className="friends-digest__invite-name">{invite.name}</span>
              <span className="friends-digest__invite-status">{t("friendsPage.wantsToConnect")}</span>
              <button
                type="button"
                className="friends-digest__invite-accept"
                onClick={() => onAcceptInvitation?.(invite)}
                title={t("friendsPage.acceptInvite")}
                aria-label={t("friendsPage.acceptRequestFrom", { name: invite.name })}
              >
                <Check size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="friends-digest__invite-deny"
                onClick={() => onDenyInvitation?.(invite.syncId)}
                title={t("friendsPage.denyInvite")}
                aria-label={t("friendsPage.declineRequestFrom", { name: invite.name })}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </section>
      )}

      {nextSession && (
        <button type="button" className="friends-digest__next" onClick={() => onNavigate("sessions")}>
          <span className="friends-digest__next-icon" aria-hidden="true">
            <CalendarClock size={18} />
          </span>
          <span className="friends-digest__next-main">
            <span className="friends-digest__next-label">{t("friendsPage.digest.nextUp")}</span>
            <strong>{nextSession.gameName}</strong>
            <span>
              {new Date(nextSession.scheduledAt).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "short",
              })}
              {" · "}
              {new Date(nextSession.scheduledAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {" · "}
              {nextSession.creatorName}
            </span>
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      {items.length === 0 ? (
        <div className="friends-empty friends-empty--digest">
          <span className="friends-empty__icon is-success" aria-hidden="true">
            <CheckCircle2 size={22} />
          </span>
          <h3>{t("friendsPage.digest.allCaughtUp")}</h3>
          <p>{t("friendsPage.digest.allCaughtUpHint")}</p>
          <button type="button" className="friends-empty__action" onClick={() => onNavigate("activity")}>
            {t("friendsPage.digest.viewActivity")}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="friends-digest__list">
          {items.map((item) => {
            const authorFriend = item.author ? friendsByName.get(item.author) : undefined;
            return (
              <button
                key={item.id}
                type="button"
                className={`friends-digest__item is-${item.kind}`}
                onClick={() => onNavigate(item.action)}
              >
                <span className="friends-digest__media">
                  {item.author ? (
                    <FriendAvatar friend={authorFriend} name={item.author} size="sm" />
                  ) : (
                    <span className="friends-digest__icon" aria-hidden="true">
                      {iconFor(item.kind)}
                    </span>
                  )}
                  {item.author && (
                    <span className={`friends-digest__kind is-${item.kind}`} aria-hidden="true">
                      {iconFor(item.kind)}
                    </span>
                  )}
                </span>
                <span className="friends-digest__body">
                  <span className="friends-digest__title">{item.title}</span>
                  {item.detail && <span className="friends-digest__detail">{item.detail}</span>}
                </span>
                <span className="friends-digest__meta">
                  <span className="friends-digest__time">
                    {formatLastSeen(Math.floor(item.timestamp / 1000), t)}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </span>
              </button>
            );
          })}
          <button type="button" className="friends-digest__all" onClick={() => onNavigate("activity")}>
            {t("friendsPage.digest.viewActivity")}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="friends-digest__footer">
        <span>
          {t("friendsPage.digest.people", {
            count: friends.filter((friend) => !friend.blocked && friend.consent !== "pending").length,
          })}
        </span>
        <button type="button" onClick={() => onNavigate("compare")}>
          {t("friendsPage.digest.compare")}
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export default FriendsDigest;
