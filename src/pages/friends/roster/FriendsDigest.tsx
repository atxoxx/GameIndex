import { useMemo } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Lightbulb,
  MessageCircle,
  Sparkles,
  ThumbsUp,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { visibleMessages } from "../../friendsStorage";
import type {
  DmThread,
  Friend,
  GameRecommendation,
  GameSession,
  GameSuggestion,
  UserProfile,
} from "../friendsTypes";
import type { FriendsTabKey } from "../friendsTypes";
import { formatLastSeen } from "../friendsUtils";

interface FriendsDigestProps {
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  dms: DmThread[];
  profile: UserProfile;
  onNavigate: (tab: FriendsTabKey) => void;
}

interface DigestItem {
  id: string;
  kind: "message" | "session" | "recommendation" | "suggestion";
  title: string;
  detail?: string;
  timestamp: number;
  action: FriendsTabKey;
}

export function FriendsDigest({
  friends,
  sessions,
  recommendations,
  suggestions,
  dms,
  profile,
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

    recommendations.forEach((rec) => {
      if (rec.deleted || rec.recommendedBy === profile.name) return;
      if ((rec.updatedAt || rec.createdAt || 0) < weekAgo) return;
      list.push({
        id: `rec_${rec.id}`,
        kind: "recommendation",
        title: t("friendsPage.digest.newRecommendation", { name: rec.recommendedBy, game: rec.gameName }),
        detail: rec.reason,
        timestamp: rec.updatedAt || rec.createdAt || now,
        action: "recs",
      });
    });

    suggestions.forEach((suggestion) => {
      if (suggestion.deleted || suggestion.suggestedBy === profile.name) return;
      if ((suggestion.updatedAt || suggestion.createdAt || 0) < weekAgo) return;
      list.push({
        id: `sug_${suggestion.id}`,
        kind: "suggestion",
        title: t("friendsPage.digest.newSuggestion", {
          name: suggestion.suggestedBy,
          game: suggestion.gameName,
        }),
        detail: suggestion.note,
        timestamp: suggestion.updatedAt || suggestion.createdAt || now,
        action: "suggestions",
      });
    });

    return list.sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);
  }, [dms, sessions, recommendations, suggestions, profile.name, t]);

  const iconFor = (kind: DigestItem["kind"]) => {
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
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`friends-digest__item is-${item.kind}`}
              onClick={() => onNavigate(item.action)}
            >
              <span className="friends-digest__icon" aria-hidden="true">
                {iconFor(item.kind)}
              </span>
              <span className="friends-digest__body">
                <span className="friends-digest__title">{item.title}</span>
                {item.detail && <span className="friends-digest__detail">{item.detail}</span>}
                <span className="friends-digest__time">{formatLastSeen(Math.floor(item.timestamp / 1000), t)}</span>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="friends-digest__all" onClick={() => onNavigate("activity")}>
            {t("friendsPage.digest.viewActivity")}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="friends-digest__footer">
        <span>
          {t("friendsPage.digest.people", { count: friends.filter((friend) => !friend.blocked).length })}
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
