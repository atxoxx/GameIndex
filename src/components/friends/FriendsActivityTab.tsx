import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type {
  Friend,
  GameSession,
  GameRecommendation,
  GameSuggestion,
  UserProfile,
} from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  safeCurrentlyPlaying,
  formatDateTime,
  formatLastSeen,
  ActivityIcon,
  GamepadIcon,
  CalendarIcon,
  RecommendIcon,
  SuggestionIcon,
  CompareIcon,
} from "./friendsUtils";

interface FriendsActivityTabProps {
  friends: Friend[];
  sessions: GameSession[];
  recommendations: GameRecommendation[];
  suggestions: GameSuggestion[];
  profile: UserProfile;
  onNavigateTab: (tab: any) => void;
  onSelectCompareFriend?: (friendId: string) => void;
}

interface ActivityItem {
  id: string;
  type: "playing" | "session" | "recommendation" | "suggestion" | "profile";
  timestamp: number;
  actorName: string;
  actorAvatar?: string;
  title: string;
  subtitle?: string;
  gameName?: string;
  extra?: any;
}

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
  const [filterCategory, setFilterCategory] = useState<"all" | "playing" | "session" | "recommendation" | "suggestion">("all");

  const timelineItems = useMemo(() => {
    const items: ActivityItem[] = [];

    // 1. Friends currently playing or recently seen playing
    friends.forEach((f) => {
      if (f.blocked) return;
      const playing = safeCurrentlyPlaying(f.currentlyPlaying);
      if (playing) {
        items.push({
          id: `play_${f.id}`,
          type: "playing",
          timestamp: (f.lastSeen || Math.floor(Date.now() / 1000)) * 1000,
          actorName: displayName(f),
          actorAvatar: f.avatar,
          title: t("friendsPage.isCurrentlyPlaying", { name: displayName(f), game: playing }),
          gameName: playing,
          extra: { friendId: f.id },
        });
      }
    });

    // 2. Scheduled multiplayer sessions
    sessions.forEach((s) => {
      if (s.deleted) return;
      const friend = friends.find((f) => f.name === s.creatorName);
      items.push({
        id: `sess_${s.id}`,
        type: "session",
        timestamp: s.updatedAt || new Date(s.scheduledAt).getTime(),
        actorName: s.creatorName === profile.name ? t("friendsPage.me") : s.creatorName,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.scheduledGameSession", {
          name: s.creatorName === profile.name ? t("friendsPage.you") : s.creatorName,
          game: s.gameName,
        }),
        subtitle: formatDateTime(s.scheduledAt, s.creatorTimezone),
        gameName: s.gameName,
        extra: s,
      });
    });

    // 3. Game Recommendations
    recommendations.forEach((r) => {
      if (r.deleted) return;
      const friend = friends.find((f) => f.name === r.recommendedBy);
      items.push({
        id: `rec_${r.id}`,
        type: "recommendation",
        timestamp: r.updatedAt || r.createdAt || Date.now(),
        actorName: r.recommendedBy === profile.name ? t("friendsPage.me") : r.recommendedBy,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.recommendedGame", {
          name: r.recommendedBy === profile.name ? t("friendsPage.you") : r.recommendedBy,
          game: r.gameName,
        }),
        subtitle: r.reason ? `"${r.reason}"` : undefined,
        gameName: r.gameName,
        extra: r,
      });
    });

    // 4. Wishlist Suggestions
    suggestions.forEach((s) => {
      if (s.deleted) return;
      const friend = friends.find((f) => f.name === s.suggestedBy);
      items.push({
        id: `sug_${s.id}`,
        type: "suggestion",
        timestamp: s.updatedAt || s.createdAt || Date.now(),
        actorName: s.suggestedBy === profile.name ? t("friendsPage.me") : s.suggestedBy,
        actorAvatar: friend?.avatar,
        title: t("friendsPage.sharedWishlistGame", {
          name: s.suggestedBy === profile.name ? t("friendsPage.you") : s.suggestedBy,
          game: s.gameName,
        }),
        subtitle: s.note ? `"${s.note}"` : undefined,
        gameName: s.gameName,
        extra: s,
      });
    });

    // Sort newest first
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  }, [friends, sessions, recommendations, suggestions, profile, t]);

  const filteredTimeline = useMemo(() => {
    if (filterCategory === "all") return timelineItems;
    return timelineItems.filter((i) => i.type === filterCategory);
  }, [timelineItems, filterCategory]);

  const getIconForType = (type: ActivityItem["type"]) => {
    switch (type) {
      case "playing":
        return <GamepadIcon />;
      case "session":
        return <CalendarIcon />;
      case "recommendation":
        return <RecommendIcon />;
      case "suggestion":
        return <SuggestionIcon />;
      default:
        return <ActivityIcon />;
    }
  };

  return (
    <div className="friends-activity-section">
      <div className="activity-toolbar">
        <div className="activity-filter-chips">
          <button
            type="button"
            className={`activity-chip${filterCategory === "all" ? " active" : ""}`}
            onClick={() => setFilterCategory("all")}
          >
            {t("friends.all")}
          </button>
          <button
            type="button"
            className={`activity-chip${filterCategory === "playing" ? " active" : ""}`}
            onClick={() => setFilterCategory("playing")}
          >
            <GamepadIcon /> {t("friendsPage.inGame")}
          </button>
          <button
            type="button"
            className={`activity-chip${filterCategory === "session" ? " active" : ""}`}
            onClick={() => setFilterCategory("session")}
          >
            <CalendarIcon /> {t("friends.tab.sessions")}
          </button>
          <button
            type="button"
            className={`activity-chip${filterCategory === "recommendation" ? " active" : ""}`}
            onClick={() => setFilterCategory("recommendation")}
          >
            <RecommendIcon /> {t("friends.tab.recs")}
          </button>
          <button
            type="button"
            className={`activity-chip${filterCategory === "suggestion" ? " active" : ""}`}
            onClick={() => setFilterCategory("suggestion")}
          >
            <SuggestionIcon /> {t("friends.tab.suggestions")}
          </button>
        </div>
      </div>

      {filteredTimeline.length === 0 ? (
        <div className="friends-empty-state">
          <div className="friends-empty-icon">
            <ActivityIcon />
          </div>
          <h3 className="friends-empty-title">{t("friendsPage.noActivityYet")}</h3>
          <p className="friends-empty-desc">{t("friendsPage.noActivityDesc")}</p>
        </div>
      ) : (
        <div className="activity-timeline-feed">
          {filteredTimeline.map((item) => (
            <div key={item.id} className={`activity-timeline-card type-${item.type}`}>
              <div className="activity-card-icon-wrapper">
                <span className="activity-type-icon">{getIconForType(item.type)}</span>
              </div>

              <div className="activity-card-body">
                <div className="activity-card-header">
                  <div className="activity-card-actor-info">
                    {item.actorAvatar && item.actorAvatar.startsWith("data:") ? (
                      <img src={item.actorAvatar} alt={item.actorName} className="activity-actor-avatar" />
                    ) : (
                      <div
                        className="activity-actor-avatar-procedural"
                        style={getProceduralAvatarStyle(item.actorName)}
                      >
                        {getInitials(item.actorName)}
                      </div>
                    )}
                    <span className="activity-actor-name">{item.actorName}</span>
                  </div>
                  <span className="activity-card-timestamp">
                    {formatLastSeen(Math.floor(item.timestamp / 1000), t)}
                  </span>
                </div>

                <div className="activity-card-content">
                  <p className="activity-card-title">{item.title}</p>
                  {item.subtitle && <p className="activity-card-subtitle">{item.subtitle}</p>}
                </div>

                {item.type === "playing" && onSelectCompareFriend && item.extra?.friendId && (
                  <div className="activity-card-cta">
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => onSelectCompareFriend(item.extra.friendId)}
                    >
                      <CompareIcon /> {t("friends.compare")}
                    </button>
                  </div>
                )}

                {item.type === "session" && (
                  <div className="activity-card-cta">
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => onNavigateTab("sessions")}
                    >
                      <CalendarIcon /> {t("friendsPage.viewSession")}
                    </button>
                  </div>
                )}

                {item.type === "recommendation" && (
                  <div className="activity-card-cta">
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => onNavigateTab("recs")}
                    >
                      <RecommendIcon /> {t("friendsPage.viewRec")}
                    </button>
                  </div>
                )}

                {item.type === "suggestion" && (
                  <div className="activity-card-cta">
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => onNavigateTab("suggestions")}
                    >
                      <SuggestionIcon /> {t("friendsPage.viewSuggestion")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
