import { useMemo, useState } from "react";
import {
  Activity,
  CalendarDays,
  Gamepad2,
  Lightbulb,
  Swords,
  ThumbsUp,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type {
  Friend,
  GameRecommendation,
  GameSession,
  GameSuggestion,
  UserProfile,
} from "../friendsTypes";
import type { FriendsTabKey } from "../friendsTypes";
import {
  displayName,
  formatDateTime,
  formatLastSeen,
  getInitials,
  getProceduralAvatarStyle,
  safeCurrentlyPlaying,
} from "../friendsUtils";

type ActivityFilter = "all" | "playing" | "session" | "recommendation" | "suggestion";
type ActivityKind = Exclude<ActivityFilter, "all">;

interface ActivityItem {
  id: string;
  type: ActivityKind;
  timestamp: number;
  actorName: string;
  actorAvatar?: string;
  title: string;
  subtitle?: string;
  friendId?: string;
  action: FriendsTabKey;
  actionLabel: string;
}

interface FriendsActivityTabProps {
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  profile: UserProfile;
  onNavigateTab: (tab: FriendsTabKey) => void;
  onSelectCompareFriend?: (friendId: string) => void;
}

const FILTERS: ActivityFilter[] = ["all", "playing", "session", "recommendation", "suggestion"];

export default function FriendsActivityTab({
  friends,
  sessions,
  recommendations,
  suggestions,
  profile,
  onNavigateTab,
  onSelectCompareFriend,
}: FriendsActivityTabProps) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const timelineItems = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    friends.forEach((friend) => {
      if (friend.blocked) return;
      const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
      if (!playing) return;
      items.push({
        id: `play_${friend.id}`,
        type: "playing",
        timestamp: (friend.lastSeen || Math.floor(Date.now() / 1000)) * 1000,
        actorName: displayName(friend),
        actorAvatar: friend.avatar,
        title: t("friendsPage.isCurrentlyPlaying", { name: displayName(friend), game: playing }),
        subtitle: friend.favoriteGame ? `${t("friendsPage.favoriteGame")}: ${friend.favoriteGame}` : undefined,
        friendId: friend.id,
        action: "compare",
        actionLabel: t("friends.compare"),
      });
    });

    sessions.forEach((session) => {
      if (session.deleted) return;
      const friend = friends.find((candidate) => candidate.name === session.creatorName);
      const mine = session.creatorName === profile.name;
      items.push({
        id: `sess_${session.id}`,
        type: "session",
        timestamp: session.updatedAt || new Date(session.scheduledAt).getTime(),
        actorName: mine ? t("friendsPage.me") : session.creatorName,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.scheduledGameSession", {
          name: mine ? t("friendsPage.you") : session.creatorName,
          game: session.gameName,
        }),
        subtitle: formatDateTime(session.scheduledAt, session.creatorTimezone),
        action: "sessions",
        actionLabel: t("friendsPage.viewSession"),
      });
    });

    recommendations.forEach((rec) => {
      if (rec.deleted) return;
      const friend = friends.find((candidate) => candidate.name === rec.recommendedBy);
      const mine = rec.recommendedBy === profile.name;
      items.push({
        id: `rec_${rec.id}`,
        type: "recommendation",
        timestamp: rec.updatedAt || rec.createdAt || Date.now(),
        actorName: mine ? t("friendsPage.me") : rec.recommendedBy,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.recommendedGame", {
          name: mine ? t("friendsPage.you") : rec.recommendedBy,
          game: rec.gameName,
        }),
        subtitle: rec.reason ? `“${rec.reason}”` : undefined,
        action: "recs",
        actionLabel: t("friendsPage.viewRec"),
      });
    });

    suggestions.forEach((suggestion) => {
      if (suggestion.deleted) return;
      const friend = friends.find((candidate) => candidate.name === suggestion.suggestedBy);
      const mine = suggestion.suggestedBy === profile.name;
      items.push({
        id: `sug_${suggestion.id}`,
        type: "suggestion",
        timestamp: suggestion.updatedAt || suggestion.createdAt || Date.now(),
        actorName: mine ? t("friendsPage.me") : suggestion.suggestedBy,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.sharedWishlistGame", {
          name: mine ? t("friendsPage.you") : suggestion.suggestedBy,
          game: suggestion.gameName,
        }),
        subtitle: suggestion.note ? `“${suggestion.note}”` : undefined,
        action: "suggestions",
        actionLabel: t("friendsPage.viewSuggestion"),
      });
    });

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [friends, sessions, recommendations, suggestions, profile.name, t]);

  const filtered = useMemo(
    () => (filter === "all" ? timelineItems : timelineItems.filter((item) => item.type === filter)),
    [timelineItems, filter]
  );

  const counts = useMemo(() => {
    const map = new Map<ActivityFilter, number>([["all", timelineItems.length]]);
    (["playing", "session", "recommendation", "suggestion"] as ActivityKind[]).forEach((kind) => {
      map.set(kind, timelineItems.filter((item) => item.type === kind).length);
    });
    return map;
  }, [timelineItems]);

  const groups = useMemo(() => {
    const byDay = new Map<string, ActivityItem[]>();
    filtered.forEach((item) => {
      const date = new Date(item.timestamp);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const list = byDay.get(key) || [];
      list.push(item);
      byDay.set(key, list);
    });
    return Array.from(byDay.entries()).sort((a, b) => {
      const [ay, am, ad] = a[0].split("-").map(Number);
      const [by, bm, bd] = b[0].split("-").map(Number);
      return new Date(by, bm, bd).getTime() - new Date(ay, am, ad).getTime();
    });
  }, [filtered]);

  const dayLabel = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month, day);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t("friendsPage.today");
    if (date.toDateString() === yesterday.toDateString()) return t("friendsPage.yesterday");
    return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };

  const iconFor = (kind: ActivityKind) => {
    if (kind === "playing") return <Gamepad2 size={15} aria-hidden="true" />;
    if (kind === "session") return <CalendarDays size={15} aria-hidden="true" />;
    if (kind === "recommendation") return <ThumbsUp size={15} aria-hidden="true" />;
    return <Lightbulb size={15} aria-hidden="true" />;
  };

  const handleAction = (item: ActivityItem) => {
    if (item.type === "playing") {
      if (item.friendId && onSelectCompareFriend) onSelectCompareFriend(item.friendId);
      else onNavigateTab("compare");
      return;
    }
    onNavigateTab(item.action);
  };

  return (
    <div className="friends-activity">
      <header className="friends-view-head">
        <div>
          <span className="friends-view-eyebrow">{t("friendsPage.activityEyebrow")}</span>
          <h2>{t("friends.tab.activity")}</h2>
          <p>{t("friendsPage.activitySubtitle")}</p>
        </div>
        <div className="friends-view-head__stat">
          <Activity size={15} aria-hidden="true" />
          {t("friendsPage.activityCount", { count: timelineItems.length })}
        </div>
      </header>

      <div className="friends-filter-row" role="group" aria-label={t("friendsPage.filterActivity")}>
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={["friends-filter-chip", filter === key ? "is-active" : ""].filter(Boolean).join(" ")}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
          >
            {t(`friendsPage.activityFilter.${key}`)}
            {counts.get(key) ? <span>{counts.get(key)}</span> : null}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="friends-empty">
          <span className="friends-empty__icon" aria-hidden="true">
            <Activity size={22} />
          </span>
          <h3>{t("friendsPage.noActivityYet")}</h3>
          <p>{t("friendsPage.noActivityDesc")}</p>
        </div>
      ) : (
        <div className="friends-timeline">
          {groups.map(([day, dayItems]) => (
            <section key={day} className="friends-timeline__day">
              <h3 className="friends-timeline__day-label">{dayLabel(day)}</h3>
              <div className="friends-timeline__items">
                {dayItems.map((item) => (
                  <article key={item.id} className={`friends-timeline__item is-${item.type}`}>
                    <span className="friends-timeline__icon" aria-hidden="true">
                      {iconFor(item.type)}
                    </span>
                    <span className="friends-timeline__avatar" aria-hidden="true">
                      {item.actorAvatar && item.actorAvatar.startsWith("data:") ? (
                        <img src={item.actorAvatar} alt="" />
                      ) : (
                        <span style={getProceduralAvatarStyle(item.actorName)}>{getInitials(item.actorName)}</span>
                      )}
                    </span>
                    <div className="friends-timeline__body">
                      <p className="friends-timeline__title">{item.title}</p>
                      {item.subtitle && <p className="friends-timeline__subtitle">{item.subtitle}</p>}
                    </div>
                    <span className="friends-timeline__time">
                      {formatLastSeen(Math.floor(item.timestamp / 1000), t)}
                    </span>
                    <button type="button" className="friends-timeline__action" onClick={() => handleAction(item)}>
                      {item.type === "playing" && <Swords size={13} aria-hidden="true" />}
                      {item.actionLabel}
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
