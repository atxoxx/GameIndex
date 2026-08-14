import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, UserProfile, SharedGameStat } from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isOnline,
  formatHours,
  LeaderboardIcon,
  TrophyIcon,
  GamepadIcon,
  StarIcon,
} from "./friendsUtils";

interface FriendsLeaderboardTabProps {
  friends: Friend[];
  profile: UserProfile;
  selfStats: {
    gamesCount: number;
    playtimeMinutes: number;
    achievementsCount: number;
  };
  selfSharedGames: SharedGameStat[];
  onSelectFriend?: (friend: Friend) => void;
}

type LeaderboardMetric = "achievements" | "playtime" | "library" | "completion";

interface LeaderboardEntry {
  id: string;
  name: string;
  avatar: string;
  isSelf: boolean;
  online: boolean;
  achievements: number;
  playtimeMinutes: number;
  gamesCount: number;
  completionRate: number;
  score: number;
  formattedScore: string;
}

export default function FriendsLeaderboardTab({
  friends,
  profile,
  selfStats,
  selfSharedGames,
  onSelectFriend,
}: FriendsLeaderboardTabProps) {
  const { t } = useLanguage();
  const [metric, setMetric] = useState<LeaderboardMetric>("achievements");

  // Calculate self average completion rate
  const selfCompletionRate = useMemo(() => {
    if (selfSharedGames.length === 0) return 0;
    const sum = selfSharedGames.reduce((acc, g) => acc + g.achievementPercent, 0);
    return Math.round(sum / selfSharedGames.length);
  }, [selfSharedGames]);

  // Combine self + unblocked friends into ranked list
  const rankedEntries = useMemo(() => {
    const list: LeaderboardEntry[] = [];

    // Self Entry
    list.push({
      id: "self",
      name: profile.name,
      avatar: profile.avatar,
      isSelf: true,
      online: true,
      achievements: selfStats.achievementsCount,
      playtimeMinutes: selfStats.playtimeMinutes,
      gamesCount: selfStats.gamesCount,
      completionRate: selfCompletionRate,
      score: 0,
      formattedScore: "",
    });

    // Friends Entries
    friends
      .filter((f) => !f.blocked)
      .forEach((f) => {
        const stats = f.libStats || {
          gamesCount: 0,
          playtimeMinutes: 0,
          achievementsCount: 0,
        };

        const games = f.games || [];
        const completionRate =
          games.length > 0
            ? Math.round(games.reduce((acc, g) => acc + g.achievementPercent, 0) / games.length)
            : 0;

        list.push({
          id: f.id,
          name: displayName(f),
          avatar: f.avatar,
          isSelf: false,
          online: isOnline(f),
          achievements: stats.achievementsCount,
          playtimeMinutes: stats.playtimeMinutes,
          gamesCount: stats.gamesCount,
          completionRate,
          score: 0,
          formattedScore: "",
        });
      });

    // Compute metric scores and format strings
    list.forEach((entry) => {
      if (metric === "achievements") {
        entry.score = entry.achievements;
        entry.formattedScore = `${entry.achievements} ${t("friendsPage.achievements")}`;
      } else if (metric === "playtime") {
        entry.score = entry.playtimeMinutes;
        entry.formattedScore = formatHours(entry.playtimeMinutes, t);
      } else if (metric === "library") {
        entry.score = entry.gamesCount;
        entry.formattedScore = t("friendsPage.gamesCount", { count: entry.gamesCount });
      } else if (metric === "completion") {
        entry.score = entry.completionRate;
        entry.formattedScore = `${entry.completionRate}%`;
      }
    });

    list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return list;
  }, [friends, profile, selfStats, selfCompletionRate, metric, t]);

  const topThree = rankedEntries.slice(0, 3);
  const podiumOrder = [
    topThree[1] || null, // 2nd Silver (left)
    topThree[0] || null, // 1st Gold (center)
    topThree[2] || null, // 3rd Bronze (right)
  ];

  return (
    <div className="friends-leaderboard-section">
      {/* Metric Switcher Toolbar */}
      <div className="leaderboard-toolbar">
        <div className="leaderboard-metric-pills">
          <button
            type="button"
            className={`leaderboard-pill${metric === "achievements" ? " active" : ""}`}
            onClick={() => setMetric("achievements")}
          >
            <TrophyIcon /> {t("friendsPage.achievements")}
          </button>
          <button
            type="button"
            className={`leaderboard-pill${metric === "playtime" ? " active" : ""}`}
            onClick={() => setMetric("playtime")}
          >
            <GamepadIcon /> {t("friendsPage.playtime")}
          </button>
          <button
            type="button"
            className={`leaderboard-pill${metric === "library" ? " active" : ""}`}
            onClick={() => setMetric("library")}
          >
            <StarIcon /> {t("friendsPage.librarySize")}
          </button>
          <button
            type="button"
            className={`leaderboard-pill${metric === "completion" ? " active" : ""}`}
            onClick={() => setMetric("completion")}
          >
            <LeaderboardIcon /> {t("friendsPage.completionRate")}
          </button>
        </div>
      </div>

      {/* Top 3 Podium Showcase */}
      {topThree.length > 0 && (
        <div className="leaderboard-podium-container">
          {podiumOrder.map((entry, idx) => {
            if (!entry) return <div key={idx} className="podium-slot empty" />;
            const rank = entry === topThree[0] ? 1 : entry === topThree[1] ? 2 : 3;
            const rankClass = rank === 1 ? "gold" : rank === 2 ? "silver" : "bronze";

            return (
              <div
                key={entry.id}
                className={`podium-card rank-${rankClass}${entry.isSelf ? " is-self" : ""}${!entry.isSelf && onSelectFriend ? " clickable" : ""}`}
                onClick={() => {
                  if (!entry.isSelf && onSelectFriend) {
                    const f = friends.find((fr) => fr.id === entry.id);
                    if (f) onSelectFriend(f);
                  }
                }}
              >
                <div className="podium-rank-crown">
                  {rank === 1 ? "👑" : rank === 2 ? "🥈" : "🥉"}
                </div>
                <div className="podium-avatar-wrapper">
                  {entry.avatar && entry.avatar.startsWith("data:") ? (
                    <img src={entry.avatar} alt={entry.name} className="podium-avatar" />
                  ) : (
                    <div
                      className="podium-avatar-procedural"
                      style={getProceduralAvatarStyle(entry.name)}
                    >
                      {getInitials(entry.name)}
                    </div>
                  )}
                  {entry.online && <span className="podium-online-dot" />}
                </div>
                <div className="podium-name" title={entry.name}>
                  {entry.isSelf ? `${entry.name} (${t("friendsPage.you")})` : entry.name}
                </div>
                <div className="podium-score">{entry.formattedScore}</div>
                <div className="podium-base">
                  <span>#{rank}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Leaderboard Table */}
      <div className="leaderboard-table-wrapper">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="th-rank">{t("friendsPage.rank")}</th>
              <th>{t("friendsPage.player")}</th>
              <th>{t("friendsPage.score")}</th>
              <th>{t("friendsPage.games")}</th>
              <th>{t("friendsPage.playtime")}</th>
              <th>{t("friendsPage.achievements")}</th>
            </tr>
          </thead>
          <tbody>
            {rankedEntries.map((entry, index) => {
              const rank = index + 1;
              return (
                <tr
                  key={entry.id}
                  className={`leaderboard-row${entry.isSelf ? " is-self" : ""}${!entry.isSelf && onSelectFriend ? " clickable" : ""}`}
                  onClick={() => {
                    if (!entry.isSelf && onSelectFriend) {
                      const f = friends.find((fr) => fr.id === entry.id);
                      if (f) onSelectFriend(f);
                    }
                  }}
                >
                  <td className="td-rank">
                    <span className={`rank-badge${rank <= 3 ? ` rank-${rank}` : ""}`}>
                      #{rank}
                    </span>
                  </td>
                  <td className="td-player">
                    <div className="player-meta-cell">
                      {entry.avatar && entry.avatar.startsWith("data:") ? (
                        <img src={entry.avatar} alt={entry.name} className="leaderboard-avatar" />
                      ) : (
                        <div
                          className="leaderboard-avatar-procedural"
                          style={getProceduralAvatarStyle(entry.name)}
                        >
                          {getInitials(entry.name)}
                        </div>
                      )}
                      <div>
                        <span className="player-name">
                          {entry.isSelf ? `${entry.name} (${t("friendsPage.you")})` : entry.name}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="td-score font-semibold">{entry.formattedScore}</td>
                  <td>{entry.gamesCount}</td>
                  <td>{formatHours(entry.playtimeMinutes, t)}</td>
                  <td>{entry.achievements}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
