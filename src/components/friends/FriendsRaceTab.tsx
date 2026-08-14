import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Friend, UserProfile, SharedGameStat } from "./friendsTypes";
import {
  displayName,
  getInitials,
  getProceduralAvatarStyle,
  isAppBlacklisted,
  TrophyIcon,
} from "./friendsUtils";

interface FriendsRaceTabProps {
  friends: Friend[];
  profile: UserProfile;
  selfSharedGames: SharedGameStat[];
  libraryGames: any[];
}

export default function FriendsRaceTab({
  friends,
  profile,
  selfSharedGames,
  libraryGames,
}: FriendsRaceTabProps) {
  const { t } = useLanguage();
  const validFriends = useMemo(() => friends.filter((f) => !f.blocked), [friends]);

  const [selectedFriendId, setSelectedFriendId] = useState<string>(
    validFriends.length > 0 ? validFriends[0].id : ""
  );
  const [selectedGameKey, setSelectedGameKey] = useState<string>("");

  const activeFriend = useMemo(() => {
    return validFriends.find((f) => f.id === selectedFriendId) || validFriends[0] || null;
  }, [validFriends, selectedFriendId]);

  // Clean shared games
  const myGames = useMemo(() => {
    return selfSharedGames.filter((g) => !isAppBlacklisted(g.name, g.id));
  }, [selfSharedGames]);

  const friendGames = useMemo(() => {
    return (activeFriend?.games || []).filter((g) => !isAppBlacklisted(g.name, g.id));
  }, [activeFriend]);

  // Find all games both own
  const mutualGames = useMemo(() => {
    if (!activeFriend) return [];
    const friendMap = new Map(friendGames.map((g) => [g.name.toLowerCase().trim(), g]));
    return myGames
      .filter((g) => friendMap.has(g.name.toLowerCase().trim()))
      .map((g) => {
        const frG = friendMap.get(g.name.toLowerCase().trim())!;
        return {
          key: g.name.toLowerCase().trim(),
          name: g.name,
          myGame: g,
          friendGame: frG,
        };
      });
  }, [activeFriend, myGames, friendGames]);

  // Active chosen game for the race
  const activeMutualGame = useMemo(() => {
    if (selectedGameKey) {
      const found = mutualGames.find((g) => g.key === selectedGameKey);
      if (found) return found;
    }
    return mutualGames[0] || null;
  }, [mutualGames, selectedGameKey]);

  // Resolve cover for the active game
  const libraryCoverMap = useMemo(() => {
    const map = new Map<string, string>();
    libraryGames.forEach((g) => {
      if (g.coverArtUrl) map.set(g.name.toLowerCase().trim(), g.coverArtUrl);
    });
    return map;
  }, [libraryGames]);

  const activeCover = activeMutualGame ? libraryCoverMap.get(activeMutualGame.key) : undefined;

  const friendName = activeFriend ? displayName(activeFriend) : "";
  const myPercent = activeMutualGame?.myGame.achievementPercent || 0;
  const friendPercent = activeMutualGame?.friendGame.achievementPercent || 0;
  const leadGap = Math.abs(myPercent - friendPercent);
  const myLead = myPercent > friendPercent;
  const isTied = myPercent === friendPercent;

  return (
    <div className="friends-race-section">
      {/* Race Setup Toolbar */}
      <div className="race-toolbar">
        <div className="race-setup-controls">
          <div className="race-select-group">
            <label className="race-select-label">{t("friendsPage.rivalFriend")}:</label>
            <select
              className="profile-input race-select"
              value={activeFriend?.id || ""}
              onChange={(e) => setSelectedFriendId(e.target.value)}
            >
              {validFriends.map((f) => (
                <option key={f.id} value={f.id}>
                  {displayName(f)}
                </option>
              ))}
            </select>
          </div>

          <div className="race-select-group">
            <label className="race-select-label">{t("friendsPage.raceGame")}:</label>
            <select
              className="profile-input race-select"
              value={activeMutualGame?.key || ""}
              onChange={(e) => setSelectedGameKey(e.target.value)}
              disabled={mutualGames.length === 0}
            >
              {mutualGames.length === 0 ? (
                <option value="">{t("friendsPage.noMutualGamesToRace")}</option>
              ) : (
                mutualGames.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
      </div>

      {!activeMutualGame ? (
        <div className="friends-empty-state">
          <div className="friends-empty-icon">
            <TrophyIcon />
          </div>
          <h3 className="friends-empty-title">{t("friendsPage.noGamesForRace")}</h3>
          <p className="friends-empty-desc">
            {validFriends.length === 0
              ? t("friends.addFriendsDesc")
              : t("friendsPage.noMutualGamesDesc", { name: friendName })}
          </p>
        </div>
      ) : (
        <div className="race-arena-card">
          <div className="race-arena-header">
            {activeCover ? (
              <img src={activeCover} alt={activeMutualGame.name} className="race-game-cover" />
            ) : (
              <div className="race-cover-placeholder">
                {activeMutualGame.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <span className="race-heading-tag">{t("friendsPage.achievementRace")}</span>
              <h2 className="race-game-name">{activeMutualGame.name}</h2>
            </div>

            <div className="race-lead-badge-wrapper">
              {isTied ? (
                <span className="race-lead-badge tied">{t("friendsPage.deadHeatTied")}</span>
              ) : myLead ? (
                <span className="race-lead-badge win">
                  {t("friendsPage.youLeadBy", { gap: leadGap })}
                </span>
              ) : (
                <span className="race-lead-badge trail">
                  {t("friendsPage.friendLeadsBy", { name: friendName, gap: leadGap })}
                </span>
              )}
            </div>
          </div>

          <div className="race-tracks-container">
            {/* Player 1 Track (You) */}
            <div className={`race-player-track${myLead ? " leading" : ""}`}>
              <div className="race-player-meta">
                <div className="race-player-avatar-wrapper">
                  {profile.avatar && profile.avatar.startsWith("data:") ? (
                    <img src={profile.avatar} alt={profile.name} className="race-player-avatar" />
                  ) : (
                    <div
                      className="race-player-avatar-procedural"
                      style={getProceduralAvatarStyle(profile.name)}
                    >
                      {getInitials(profile.name)}
                    </div>
                  )}
                </div>
                <div>
                  <span className="race-player-name">{profile.name} ({t("friendsPage.you")})</span>
                  <span className="race-player-val">{myPercent}% {t("friendsPage.unlocked")}</span>
                </div>
              </div>

              <div className="race-progress-bar-bg">
                <div
                  className="race-progress-bar-fill my-fill"
                  style={{ width: `${Math.max(4, myPercent)}%` }}
                >
                  <span className="race-runner-icon">🏁</span>
                </div>
              </div>
            </div>

            {/* Player 2 Track (Friend) */}
            <div className={`race-player-track${!myLead && !isTied ? " leading" : ""}`}>
              <div className="race-player-meta">
                <div className="race-player-avatar-wrapper">
                  {activeFriend?.avatar && activeFriend.avatar.startsWith("data:") ? (
                    <img src={activeFriend.avatar} alt={friendName} className="race-player-avatar" />
                  ) : (
                    <div
                      className="race-player-avatar-procedural"
                      style={getProceduralAvatarStyle(friendName)}
                    >
                      {getInitials(friendName)}
                    </div>
                  )}
                </div>
                <div>
                  <span className="race-player-name">{friendName}</span>
                  <span className="race-player-val">{friendPercent}% {t("friendsPage.unlocked")}</span>
                </div>
              </div>

              <div className="race-progress-bar-bg">
                <div
                  className="race-progress-bar-fill friend-fill"
                  style={{ width: `${Math.max(4, friendPercent)}%` }}
                >
                  <span className="race-runner-icon">🏁</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
