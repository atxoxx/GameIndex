import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, SharedGameStat } from "./friendsTypes";
import {
  displayName,
  formatHours,
  isAppBlacklisted,
  CompareIcon,
  BarChartIcon,
  TagIcon,
  LightbulbIcon,
  HandshakeIcon,
  GamepadIcon,
} from "./friendsUtils";

interface FriendsCompareTabProps {
  friends: Friend[];
  selfSharedGames: SharedGameStat[];
  selectedFriendId: string;
  onSelectFriendId: (id: string) => void;
  onLaunchGame?: (gameId: string) => void;
}

export default function FriendsCompareTab({
  friends,
  selfSharedGames,
  selectedFriendId,
  onSelectFriendId,
  onLaunchGame,
}: FriendsCompareTabProps) {
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<"overview" | "games" | "genres" | "insights">("overview");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "shared" | "me_only" | "friend_only" | "unplayed">("all");
  const [sortOption, setSortOption] = useState<"name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement">("name");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const validFriends = useMemo(() => friends.filter((f) => !f.blocked), [friends]);
  const activeFriend = useMemo(() => {
    return validFriends.find((f) => f.id === selectedFriendId) || validFriends[0] || null;
  }, [validFriends, selectedFriendId]);

  // Clean shared game lists without blacklisted apps
  const myGames = useMemo(() => {
    return selfSharedGames.filter((g) => !isAppBlacklisted(g.name, g.id));
  }, [selfSharedGames]);

  const friendGames = useMemo(() => {
    return (activeFriend?.games || []).filter((g) => !isAppBlacklisted(g.name, g.id));
  }, [activeFriend]);

  // Build unified comparison dataset
  const comparisonData = useMemo(() => {
    if (!activeFriend) return [];

    const myMap = new Map(myGames.map((g) => [g.name.toLowerCase().trim(), g]));
    const friendMap = new Map(friendGames.map((g) => [g.name.toLowerCase().trim(), g]));

    const allKeys = new Set([...myMap.keys(), ...friendMap.keys()]);
    const list: {
      key: string;
      name: string;
      myGame?: SharedGameStat;
      friendGame?: SharedGameStat;
      bothOwn: boolean;
      myPlaytime: number;
      friendPlaytime: number;
      myAchievement: number;
      friendAchievement: number;
      genres: string[];
    }[] = [];

    allKeys.forEach((key) => {
      const myG = myMap.get(key);
      const frG = friendMap.get(key);
      const name = myG?.name || frG?.name || key;
      const bothOwn = !!myG && !!frG;
      const myPlaytime = myG?.playTimeMin || 0;
      const friendPlaytime = frG?.playTimeMin || 0;
      const myAchievement = myG?.achievementPercent || 0;
      const friendAchievement = frG?.achievementPercent || 0;
      const genres = Array.from(new Set([...(myG?.genres || []), ...(frG?.genres || [])]));

      list.push({
        key,
        name,
        myGame: myG,
        friendGame: frG,
        bothOwn,
        myPlaytime,
        friendPlaytime,
        myAchievement,
        friendAchievement,
        genres,
      });
    });

    return list;
  }, [activeFriend, myGames, friendGames]);

  // KPI Overview Calculations
  const stats = useMemo(() => {
    const bothOwnList = comparisonData.filter((g) => g.bothOwn);
    const myTotalPlaytime = myGames.reduce((acc, g) => acc + g.playTimeMin, 0);
    const friendTotalPlaytime = friendGames.reduce((acc, g) => acc + g.playTimeMin, 0);
    const sharedPlaytime = bothOwnList.reduce((acc, g) => acc + g.myPlaytime + g.friendPlaytime, 0);

    const myAvgAch =
      myGames.length > 0
        ? Math.round(myGames.reduce((acc, g) => acc + g.achievementPercent, 0) / myGames.length)
        : 0;
    const friendAvgAch =
      friendGames.length > 0
        ? Math.round(friendGames.reduce((acc, g) => acc + g.achievementPercent, 0) / friendGames.length)
        : 0;

    return {
      sharedCount: bothOwnList.length,
      myCount: myGames.length,
      friendCount: friendGames.length,
      myTotalPlaytime,
      friendTotalPlaytime,
      sharedPlaytime,
      myAvgAch,
      friendAvgAch,
    };
  }, [comparisonData, myGames, friendGames]);

  // All distinct genres
  const allGenres = useMemo(() => {
    const set = new Set<string>();
    comparisonData.forEach((g) => g.genres.forEach((gen) => set.add(gen)));
    return Array.from(set).sort();
  }, [comparisonData]);

  // Genre breakdown stats
  const genreStats = useMemo(() => {
    const map = new Map<string, { genre: string; myCount: number; friendCount: number; sharedCount: number }>();
    allGenres.forEach((gen) => {
      map.set(gen, { genre: gen, myCount: 0, friendCount: 0, sharedCount: 0 });
    });

    comparisonData.forEach((g) => {
      g.genres.forEach((gen) => {
        const item = map.get(gen);
        if (item) {
          if (g.myGame) item.myCount++;
          if (g.friendGame) item.friendCount++;
          if (g.bothOwn) item.sharedCount++;
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => b.sharedCount - a.sharedCount || b.myCount - a.myCount);
  }, [allGenres, comparisonData]);

  // Filtered & sorted games
  const filteredGames = useMemo(() => {
    let list = [...comparisonData];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((g) => g.name.toLowerCase().includes(q));
    }

    if (genreFilter !== "all") {
      list = list.filter((g) => g.genres.includes(genreFilter));
    }

    if (ownershipFilter === "shared") {
      list = list.filter((g) => g.bothOwn);
    } else if (ownershipFilter === "me_only") {
      list = list.filter((g) => g.myGame && !g.friendGame);
    } else if (ownershipFilter === "friend_only") {
      list = list.filter((g) => !g.myGame && g.friendGame);
    } else if (ownershipFilter === "unplayed") {
      list = list.filter((g) => g.bothOwn && (g.myPlaytime === 0 || g.friendPlaytime === 0));
    }

    list.sort((a, b) => {
      if (sortOption === "myPlaytime") return b.myPlaytime - a.myPlaytime;
      if (sortOption === "friendPlaytime") return b.friendPlaytime - a.friendPlaytime;
      if (sortOption === "gap") return Math.abs(b.myPlaytime - b.friendPlaytime) - Math.abs(a.myPlaytime - a.friendPlaytime);
      if (sortOption === "achievement") return b.myAchievement + b.friendAchievement - (a.myAchievement + a.friendAchievement);
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [comparisonData, searchQuery, genreFilter, ownershipFilter, sortOption]);

  if (!activeFriend) {
    return (
      <div className="friends-empty-state">
        <CompareIcon />
        <h3>{t("friendsPage.noFriendsToCompare")}</h3>
        <p>{t("friends.addFriendsDesc")}</p>
      </div>
    );
  }

  const friendDisplayName = displayName(activeFriend);

  return (
    <div className="friends-compare-section">
      {/* Friend Selector Header */}
      <div className="compare-header-selector">
        <div className="compare-friend-pick">
          <label className="compare-friend-label">{t("friendsPage.comparingWith")}:</label>
          <select
            className="profile-input compare-friend-select"
            value={activeFriend.id}
            onChange={(e) => onSelectFriendId(e.target.value)}
          >
            {validFriends.map((f) => (
              <option key={f.id} value={f.id}>
                {displayName(f)}
              </option>
            ))}
          </select>
        </div>

        <div className="compare-subtabs-row">
          <button
            type="button"
            className={`compare-subtab-btn${subTab === "overview" ? " active" : ""}`}
            onClick={() => setSubTab("overview")}
          >
            <BarChartIcon /> {t("friendsPage.overview")}
          </button>
          <button
            type="button"
            className={`compare-subtab-btn${subTab === "games" ? " active" : ""}`}
            onClick={() => setSubTab("games")}
          >
            <GamepadIcon /> {t("friendsPage.allGames")} ({comparisonData.length})
          </button>
          <button
            type="button"
            className={`compare-subtab-btn${subTab === "genres" ? " active" : ""}`}
            onClick={() => setSubTab("genres")}
          >
            <TagIcon /> {t("friendsPage.genres")}
          </button>
          <button
            type="button"
            className={`compare-subtab-btn${subTab === "insights" ? " active" : ""}`}
            onClick={() => setSubTab("insights")}
          >
            <LightbulbIcon /> {t("friendsPage.insights")}
          </button>
        </div>
      </div>

      {/* Subtab 1: Overview */}
      {subTab === "overview" && (
        <div className="compare-overview-view">
          <div className="compare-hero-cards-grid">
            <div className="compare-hero-kpi-card">
              <div className="compare-kpi-title">{t("friendsPage.gamesInCommon")}</div>
              <div className="compare-kpi-val">{stats.sharedCount}</div>
              <div className="compare-kpi-subtitle">
                {t("friendsPage.gamesOverlap", {
                  you: stats.myCount,
                  friend: stats.friendCount,
                })}
              </div>
            </div>

            <div className="compare-hero-kpi-card">
              <div className="compare-kpi-title">{t("friendsPage.totalPlaytime")}</div>
              <div className="compare-kpi-dual">
                <div>
                  <span className="compare-kpi-label">{t("friendsPage.you")}:</span>
                  <span className="compare-kpi-subval">{formatHours(stats.myTotalPlaytime, t)}</span>
                </div>
                <div>
                  <span className="compare-kpi-label">{friendDisplayName}:</span>
                  <span className="compare-kpi-subval">{formatHours(stats.friendTotalPlaytime, t)}</span>
                </div>
              </div>
            </div>

            <div className="compare-hero-kpi-card">
              <div className="compare-kpi-title">{t("friendsPage.avgAchievementRate")}</div>
              <div className="compare-kpi-dual">
                <div>
                  <span className="compare-kpi-label">{t("friendsPage.you")}:</span>
                  <span className="compare-kpi-subval">{stats.myAvgAch}%</span>
                </div>
                <div>
                  <span className="compare-kpi-label">{friendDisplayName}:</span>
                  <span className="compare-kpi-subval">{stats.friendAvgAch}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Highlight of Best Mutual Games */}
          <div className="compare-highlights-section">
            <h4 className="compare-section-title">
              <HandshakeIcon /> {t("friendsPage.topSharedGames")}
            </h4>
            <div className="compare-highlights-grid">
              {comparisonData
                .filter((g) => g.bothOwn)
                .sort((a, b) => b.myPlaytime + b.friendPlaytime - (a.myPlaytime + a.friendPlaytime))
                .slice(0, 6)
                .map((g) => (
                  <div key={g.key} className="compare-highlight-card">
                    <span className="compare-highlight-title">{g.name}</span>
                    <div className="compare-highlight-stats">
                      <span>{t("friendsPage.you")}: {formatHours(g.myPlaytime, t)}</span>
                      <span> · </span>
                      <span>{friendDisplayName}: {formatHours(g.friendPlaytime, t)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Subtab 2: All Games List */}
      {subTab === "games" && (
        <div className="compare-games-view">
          <div className="compare-toolbar-row">
            <input
              type="text"
              className="profile-input compare-search-input"
              placeholder={t("friendsPage.searchGamesToCompare")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              className="profile-input compare-genre-select"
              value={ownershipFilter}
              onChange={(e) => setOwnershipFilter(e.target.value as any)}
              aria-label={t("library.filter.status")}
            >
              <option value="all">{t("friends.all")} ({comparisonData.length})</option>
              <option value="shared">{t("friendsPage.bothOwn")} ({stats.sharedCount})</option>
              <option value="me_only">{t("friendsPage.onlyYouOwn")}</option>
              <option value="friend_only">{t("friendsPage.onlyFriendOwns", { name: friendDisplayName })}</option>
            </select>

            <select
              className="profile-input compare-genre-select"
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
            >
              <option value="all">{t("friendsPage.allGenres")}</option>
              {allGenres.map((gen) => (
                <option key={gen} value={gen}>
                  {gen}
                </option>
              ))}
            </select>

            <select
              className="profile-input compare-sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as any)}
            >
              <option value="name">{t("friendsPage.sortName")}</option>
              <option value="myPlaytime">{t("friendsPage.sortYourPlaytime")}</option>
              <option value="friendPlaytime">{t("friendsPage.sortFriendPlaytime")}</option>
              <option value="achievement">{t("friendsPage.sortAchievementRate")}</option>
            </select>
          </div>

          <div className="compare-table-wrapper">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>{t("friendsPage.game")}</th>
                  <th>{t("friendsPage.ownership")}</th>
                  <th>{t("friendsPage.yourPlaytime")}</th>
                  <th>{t("friendsPage.friendPlaytime", { name: friendDisplayName })}</th>
                  <th>{t("friendsPage.achievements")}</th>
                  {onLaunchGame && <th>{t("friendsPage.actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {filteredGames.map((g) => (
                  <tr key={g.key}>
                    <td className="compare-game-cell">
                      <span className="compare-game-name">{g.name}</span>
                    </td>
                    <td>
                      <span className={`ownership-badge${g.bothOwn ? " shared" : ""}`}>
                        {g.bothOwn
                          ? t("friendsPage.bothOwn")
                          : g.myGame
                          ? t("friendsPage.you")
                          : friendDisplayName}
                      </span>
                    </td>
                    <td>{g.myGame ? formatHours(g.myPlaytime, t) : "-"}</td>
                    <td>{g.friendGame ? formatHours(g.friendPlaytime, t) : "-"}</td>
                    <td>
                      <div className="compare-achievement-dual-cell">
                        {g.myGame && <span>{t("friendsPage.you")}: {g.myAchievement}%</span>}
                        {g.friendGame && <span>{friendDisplayName}: {g.friendAchievement}%</span>}
                      </div>
                    </td>
                    {onLaunchGame && (
                      <td>
                        {g.myGame && (
                          <button
                            type="button"
                            className="btn btn-secondary btn--mini"
                            onClick={() => onLaunchGame(g.myGame!.id)}
                            title={t("game.play")}
                          >
                            <GamepadIcon />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Subtab 3: Genres Breakdown */}
      {subTab === "genres" && (
        <div className="compare-genres-view">
          <div className="compare-genres-grid">
            {genreStats.map((gen) => (
              <div key={gen.genre} className="genre-stat-card">
                <div className="genre-stat-head">
                  <span className="genre-name">{gen.genre}</span>
                  <span className="genre-shared-count">
                    {t("friendsPage.sharedCountLabel", { count: gen.sharedCount })}
                  </span>
                </div>
                <div className="genre-bars-container">
                  <div className="genre-bar-row">
                    <span className="genre-bar-label">{t("friendsPage.you")}: {gen.myCount}</span>
                    <div className="genre-progress-track">
                      <div
                        className="genre-progress-fill my-fill"
                        style={{ width: `${Math.min(100, (gen.myCount / (stats.myCount || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="genre-bar-row">
                    <span className="genre-bar-label">{friendDisplayName}: {gen.friendCount}</span>
                    <div className="genre-progress-track">
                      <div
                        className="genre-progress-fill friend-fill"
                        style={{ width: `${Math.min(100, (gen.friendCount / (stats.friendCount || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subtab 4: Insights & Best Together */}
      {subTab === "insights" && (
        <div className="compare-insights-view">
          <div className="compare-insight-card">
            <h4 className="compare-insight-title">
              <HandshakeIcon /> {t("friendsPage.bestTogetherHeading")}
            </h4>
            <p className="compare-insight-desc">
              {t("friendsPage.bestTogetherDesc", { name: friendDisplayName })}
            </p>
            <div className="compare-highlights-grid">
              {comparisonData
                .filter((g) => g.bothOwn)
                .slice(0, 4)
                .map((g) => (
                  <div key={g.key} className="compare-highlight-card">
                    <span className="compare-highlight-title">{g.name}</span>
                    <span className="compare-highlight-subtitle">
                      {t("friendsPage.bothOwnAndReady")}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
