// CompareTab — Library Compare + Leaderboard + Achievement Race.
//
// The desktop Friends page keeps these three as separate tabs; the hub
// groups them behind one tab with an internal sub-tab bar. Compare has
// its own Overview / Games / Genres / Insights sub-tabs. Every
// interactive element is a dedicated component so useFocusable counts
// stay stable.

import { useMemo, useState } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import type { UserProfile } from "../../../pages/friendsStorage";
import {
  type CompareItem,
  type UseFriendsSocialResult,
} from "../../../hooks/useFriendsSocial";
import { FilterChip, FriendAvatar, Icons, formatHours, useFocusableInput } from "./friendsUtils";

type CompareSubTab = "compare" | "leaderboard" | "race";

export default function CompareTab({
  social,
  profile,
  selfStats,
}: {
  social: UseFriendsSocialResult;
  profile: UserProfile;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
}) {
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<CompareSubTab>("compare");

  return (
    <div className="bigscreen-compare">
      <div className="bigscreen-friends-subtabs" role="group" aria-label={t("friendsPage.compareSubtabsAria")}>
        <FilterChip label={t("friends.tab.compare")} active={subTab === "compare"} onActivate={() => setSubTab("compare")} />
        <FilterChip label={t("friends.tab.leaderboard")} active={subTab === "leaderboard"} onActivate={() => setSubTab("leaderboard")} />
        <FilterChip label={t("friends.tab.race")} active={subTab === "race"} onActivate={() => setSubTab("race")} />
      </div>

      {subTab === "compare" && <CompareSection social={social} profile={profile} selfStats={selfStats} />}
      {subTab === "leaderboard" && <LeaderboardSection social={social} />}
      {subTab === "race" && <RaceSection social={social} />}
    </div>
  );
}

// ─── Compare section ──────────────────────────────────────────────

type CmpView = "overview" | "games" | "genres" | "insights";

function CompareSection({
  social,
  profile,
  selfStats,
}: {
  social: UseFriendsSocialResult;
  profile: UserProfile;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
}) {
  const { t } = useLanguage();
  const { compareFriend } = social;
  const { friends } = social;

  return (
    <div className="bigscreen-compare-section">
      {/* Friend selector */}
      <div className="bigscreen-compare-selector">
        <span className="bigscreen-compare-selector-label">{t("friendsPage.compareWith")}</span>
        <div className="bigscreen-filter-chips">
          {friends.map((f) => (
            <FilterChip
              key={f.id}
              label={f.name}
              active={social.selectedCompareFriendId === f.id}
              onActivate={() => social.setSelectedCompareFriendId(f.id)}
            />
          ))}
          {friends.length === 0 && (
            <span className="bigscreen-compare-selector-empty">{t("friendsPage.chooseFriend")}</span>
          )}
        </div>
      </div>

      {!compareFriend ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.selectAFriendFirst")}</p>
          <p>{t("friendsPage.compareEmptyDesc")}</p>
        </div>
      ) : (
        <CompareBody social={social} profile={profile} selfStats={selfStats} />
      )}
    </div>
  );
}

function CompareBody({
  social,
  profile,
  selfStats,
}: {
  social: UseFriendsSocialResult;
  profile: UserProfile;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
}) {
  const { t } = useLanguage();
  const [view, setView] = useState<CmpView>("overview");
  const { compareFriend, comparisonData, matchScore, compatibilityScore } = social;

  return (
    <>
      {/* You vs friend header */}
      <div className="bigscreen-compare-header">
        <div className="bigscreen-compare-user">
          <FriendAvatar avatar={profile.avatar} name={profile.name} className="bigscreen-compare-avatar" />
          <span className="bigscreen-compare-user-name">
            {profile.name} <span className="bigscreen-compare-you">{t("friendsPage.you")}</span>
          </span>
        </div>
        <div className="bigscreen-compare-scores">
          <div className="bigscreen-compare-score-badge">
            <span className="bigscreen-compare-score-label">{t("friendsPage.matchScoreBadge")}</span>
            <strong>{matchScore}%</strong>
          </div>
          <div className="bigscreen-compare-score-badge compat">
            <span className="bigscreen-compare-score-label">{t("friendsPage.compatibilityBadge")}</span>
            <strong>{compatibilityScore}%</strong>
          </div>
        </div>
        <div className="bigscreen-compare-user right">
          <FriendAvatar avatar={compareFriend!.avatar} name={compareFriend!.name} className="bigscreen-compare-avatar" />
          <span className="bigscreen-compare-user-name">{compareFriend!.name}</span>
        </div>
      </div>

      {/* Compare sub-tabs */}
      <div className="bigscreen-friends-subtabs" role="group" aria-label={t("friendsPage.compareSubtabsAria")}>
        <FilterChip label={t("friendsPage.compareTab.overview")} active={view === "overview"} onActivate={() => setView("overview")} />
        <FilterChip label={t("friendsPage.compareTab.games")} active={view === "games"} onActivate={() => setView("games")} />
        <FilterChip label={t("friendsPage.compareTab.genres")} active={view === "genres"} onActivate={() => setView("genres")} />
        <FilterChip label={t("friendsPage.compareTab.insights")} active={view === "insights"} onActivate={() => setView("insights")} />
      </div>

      {view === "overview" && <CompareOverview social={social} profile={profile} selfStats={selfStats} />}
      {view === "games" && <CompareGames social={social} />}
      {view === "genres" && <CompareGenres social={social} />}
      {view === "insights" && <CompareInsightsView social={social} />}

      {comparisonData.length === 0 && view === "overview" && (
        <div className="system-view-empty">
          <p>{t("friendsPage.noCompareMatches")}</p>
        </div>
      )}
    </>
  );
}

// ─── Overview ─────────────────────────────────────────────────────

function CompareOverview({
  social,
  profile,
  selfStats,
}: {
  social: UseFriendsSocialResult;
  profile: UserProfile;
  selfStats: { gamesCount: number; playtimeMinutes: number; achievementsCount: number };
}) {
  const { t } = useLanguage();
  const { comparisonSummary, compareInsights, genreBreakdown, genreAffinity, compareFriend } = social;
  if (!comparisonSummary || !compareInsights || !compareFriend) return null;

  const rows = [
    {
      label: t("friendsPage.stat.gamesOwned"),
      me: selfStats.gamesCount,
      friend: compareFriend.libStats?.gamesCount || comparisonSummary.friendOwned,
      fmt: (v: number) => `${v}`,
    },
    {
      label: t("friendsPage.stat.totalPlaytime"),
      me: selfStats.playtimeMinutes,
      friend: compareFriend.libStats?.playtimeMinutes || comparisonSummary.friendPlaytime,
      fmt: (v: number) => formatHours(v, t),
    },
    {
      label: t("friendsPage.stat.avgAchievements"),
      me: comparisonSummary.averageMyAchievements,
      friend: comparisonSummary.averageFriendAchievements,
      fmt: (v: number) => `${v}%`,
    },
    {
      label: t("friendsPage.stat.uniqueTitles"),
      me: comparisonSummary.meOnlyCount,
      friend: comparisonSummary.friendOnlyCount,
      fmt: (v: number) => `${v}`,
    },
  ];

  return (
    <div className="bigscreen-compare-overview">
      <div className="bigscreen-compare-h2h">
        {rows.map((row) => {
          const max = Math.max(row.me, row.friend, 1);
          return (
            <div key={row.label} className="bigscreen-compare-h2h-row">
              <div className="bigscreen-compare-h2h-side left">
                <span className={`bigscreen-compare-h2h-val${row.me > row.friend ? " win" : ""}`}>{row.fmt(row.me)}</span>
                <div className="bigscreen-compare-h2h-bar">
                  <div className="bigscreen-compare-h2h-fill left" style={{ width: `${(row.me / max) * 100}%` }} />
                </div>
              </div>
              <span className="bigscreen-compare-h2h-label">{row.label}</span>
              <div className="bigscreen-compare-h2h-side right">
                <div className="bigscreen-compare-h2h-bar">
                  <div className="bigscreen-compare-h2h-fill right" style={{ width: `${(row.friend / max) * 100}%` }} />
                </div>
                <span className={`bigscreen-compare-h2h-val${row.friend > row.me ? " win" : ""}`}>{row.fmt(row.friend)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bigscreen-compare-overlap">
        <div className="bigscreen-compare-overlap-seg me">
          <span className="bigscreen-compare-overlap-num">{comparisonSummary.meOnlyCount}</span>
          <span className="bigscreen-compare-overlap-lbl">{t("friendsPage.onlyYou")}</span>
        </div>
        <div className="bigscreen-compare-overlap-seg shared">
          <span className="bigscreen-compare-overlap-num">{comparisonSummary.sharedCount}</span>
          <span className="bigscreen-compare-overlap-lbl">{t("friendsPage.shared")}</span>
        </div>
        <div className="bigscreen-compare-overlap-seg friend">
          <span className="bigscreen-compare-overlap-num">{comparisonSummary.friendOnlyCount}</span>
          <span className="bigscreen-compare-overlap-lbl">{t("friendsPage.onlyThem", { name: compareFriend.name })}</span>
        </div>
      </div>

      <div className="bigscreen-compare-highlights">
        {compareInsights.topShared && (
          <div className="bigscreen-compare-highlight">
            <span className="bigscreen-compare-highlight-icon">{Icons.handshake()}</span>
            <div className="bigscreen-compare-highlight-body">
              <span className="bigscreen-compare-highlight-title">{t("friendsPage.bestPlayTogether")}</span>
              <span className="bigscreen-compare-highlight-value">{compareInsights.topShared.name}</span>
              <span className="bigscreen-compare-highlight-sub">
                {t("friendsPage.highlightPlayTogetherSub", {
                  you: formatHours(compareInsights.topShared.playTimeMe, t),
                  them: formatHours(compareInsights.topShared.playTimeFriend, t),
                })}
              </span>
            </div>
          </div>
        )}
        <div className="bigscreen-compare-highlight">
          <span className="bigscreen-compare-highlight-icon">{Icons.trophy()}</span>
          <div className="bigscreen-compare-highlight-body">
            <span className="bigscreen-compare-highlight-title">{t("friendsPage.achievementLeader")}</span>
            <span className="bigscreen-compare-highlight-value">
              {compareInsights.achLeaderMe === compareInsights.achLeaderFriend
                ? t("friendsPage.compareNeckAndNeck")
                : compareInsights.achLeaderMe > compareInsights.achLeaderFriend
                  ? `${profile.name} (${t("friendsPage.you")})`
                  : compareFriend.name}
            </span>
            <span className="bigscreen-compare-highlight-sub">
              {t("friendsPage.highlightAchLeaderSub", {
                me: compareInsights.achLeaderMe,
                them: compareInsights.achLeaderFriend,
              })}
            </span>
          </div>
        </div>
        <div className="bigscreen-compare-highlight">
          <span className="bigscreen-compare-highlight-icon">{Icons.tag()}</span>
          <div className="bigscreen-compare-highlight-body">
            <span className="bigscreen-compare-highlight-title">{t("friendsPage.genreAffinity")}</span>
            <span className="bigscreen-compare-highlight-value">
              {t("friendsPage.genreAffinityValue", { pct: genreAffinity })}
            </span>
            <span className="bigscreen-compare-highlight-sub">
              {t("friendsPage.genreAffinitySub", {
                count: genreBreakdown.filter((g) => g.meOwned > 0 && g.friendOwned > 0).length,
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Games ────────────────────────────────────────────────────────

function CompareGames({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { comparisonData } = social;

  const filtered = useMemo(() => {
    const q = social.compareSearch.trim().toLowerCase();
    return comparisonData.filter((item) => {
      if (social.compareFilter === "shared" && !(item.ownedByMe && item.ownedByFriend)) return false;
      if (social.compareFilter === "me_only" && !(item.ownedByMe && !item.ownedByFriend)) return false;
      if (social.compareFilter === "friend_only" && !(!item.ownedByMe && item.ownedByFriend)) return false;
      if (social.compareGenre !== "all" && !item.genres.some((g) => g.toLowerCase() === social.compareGenre.toLowerCase())) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [comparisonData, social.compareFilter, social.compareGenre, social.compareSearch]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    if (social.compareSort === "myPlaytime") return list.sort((a, b) => b.playTimeMe - a.playTimeMe);
    if (social.compareSort === "friendPlaytime") return list.sort((a, b) => b.playTimeFriend - a.playTimeFriend);
    if (social.compareSort === "gap")
      return list.sort((a, b) => Math.abs(b.playTimeMe - b.playTimeFriend) - Math.abs(a.playTimeMe - a.playTimeFriend));
    if (social.compareSort === "achievement")
      return list.sort((a, b) => Math.max(b.achievementMe, b.achievementFriend) - Math.max(a.achievementMe, a.achievementFriend));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, social.compareSort]);

  return (
    <div className="bigscreen-compare-games">
      <div className="bigscreen-friends-controls">
        <div className="bigscreen-filter-chips" role="group" aria-label={t("friendsPage.compareFiltersAria")}>
          <FilterChip label={t("friendsPage.cmpFilterAll", { count: comparisonData.length })} active={social.compareFilter === "all"} onActivate={() => social.setCompareFilter("all")} />
          <FilterChip label={t("friendsPage.cmpFilterShared", { count: comparisonData.filter((i) => i.ownedByMe && i.ownedByFriend).length })} active={social.compareFilter === "shared"} onActivate={() => social.setCompareFilter("shared")} />
          <FilterChip label={t("friendsPage.cmpFilterMeOnly", { count: comparisonData.filter((i) => i.ownedByMe && !i.ownedByFriend).length })} active={social.compareFilter === "me_only"} onActivate={() => social.setCompareFilter("me_only")} />
          <FilterChip label={t("friendsPage.cmpFilterFriendOnly", { count: comparisonData.filter((i) => !i.ownedByMe && i.ownedByFriend).length })} active={social.compareFilter === "friend_only"} onActivate={() => social.setCompareFilter("friend_only")} />
        </div>
        <div className="bigscreen-friends-controls-tools">
          <CompareSearch value={social.compareSearch} onChange={social.setCompareSearch} />
          <CompareSortSelect value={social.compareSort} onChange={social.setCompareSort} />
          {social.compareGenres.length > 0 && (
            <CompareGenreSelect genres={social.compareGenres} value={social.compareGenre} onChange={social.setCompareGenre} />
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.noCompareMatches")}</p>
        </div>
      ) : (
        <div className="bigscreen-compare-games-grid">
          {sorted.map((game) => (
            <CompareGameCard key={game.id} game={game} friendName={social.compareFriend?.name || ""} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompareSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  return (
    <div className="bigscreen-friends-search">
      <span className="bigscreen-friends-search-icon">{Icons.search()}</span>
      <input
        ref={setInputRef}
        type="search"
        className="bigscreen-input"
        placeholder={t("friendsPage.compareSearchGames")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
    </div>
  );
}

function CompareSortSelect({
  value,
  onChange,
}: {
  value: "name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement";
  onChange: (v: "name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement") => void;
}) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLSelectElement>();
  return (
    <select
      ref={setInputRef}
      className="bigscreen-input bigscreen-select"
      value={value}
      onChange={(e) => onChange(e.target.value as "name" | "myPlaytime" | "friendPlaytime" | "gap" | "achievement")}
      tabIndex={inputProps.tabIndex}
      role={inputProps.role}
      onClick={inputProps.onClick}
      aria-label={t("friendsPage.sortLabel")}
    >
      <option value="name">{t("friendsPage.compareSortName")}</option>
      <option value="myPlaytime">{t("friendsPage.compareSortMyPlaytime")}</option>
      <option value="friendPlaytime">{t("friendsPage.compareSortFriendPlaytime")}</option>
      <option value="gap">{t("friendsPage.sortPlaytimeGap")}</option>
      <option value="achievement">{t("friendsPage.sortAchievements")}</option>
    </select>
  );
}

function CompareGenreSelect({
  genres,
  value,
  onChange,
}: {
  genres: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  const { setInputRef, inputProps } = useFocusableInput<HTMLSelectElement>();
  return (
    <select
      ref={setInputRef}
      className="bigscreen-input bigscreen-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      tabIndex={inputProps.tabIndex}
      role={inputProps.role}
      onClick={inputProps.onClick}
      aria-label={t("friendsPage.genreLabel")}
    >
      <option value="all">{t("friendsPage.allGenres")}</option>
      {genres.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}

function CompareGameCard({ game, friendName }: { game: CompareItem; friendName: string }) {
  const { t } = useLanguage();
  const maxPlayTime = Math.max(game.playTimeMe, game.playTimeFriend, 1);
  const myPlayPercent = (game.playTimeMe / maxPlayTime) * 100;
  const friendPlayPercent = (game.playTimeFriend / maxPlayTime) * 100;
  const badge = game.ownedByMe && game.ownedByFriend ? "both" : game.ownedByMe ? "me" : "friend";
  const badgeLabel = game.ownedByMe && game.ownedByFriend
    ? t("friendsPage.bothOwn")
    : game.ownedByMe
      ? t("friendsPage.youOwn")
      : t("friendsPage.theyOwn");

  return (
    <div className="bigscreen-compare-game-card">
      <div className="bigscreen-compare-game-head">
        <span className="bigscreen-compare-game-name" title={game.name}>{game.name}</span>
        <span className={`bigscreen-own-badge ${badge}`}>{badgeLabel}</span>
      </div>
      <div className="bigscreen-compare-game-stats">
        <div className="bigscreen-compare-player-stat">
          <div className="bigscreen-compare-player-label">
            <span className="bigscreen-compare-player-dot left" aria-hidden />
            {t("friendsPage.you")}
          </div>
          {game.ownedByMe ? (
            <>
              <div className="bigscreen-compare-bar-row">
                <span className="bigscreen-compare-bar-value">{formatHours(game.playTimeMe, t)}</span>
                <div className="bigscreen-compare-playtime-bar">
                  <div className="bigscreen-compare-playtime-fill left" style={{ width: `${myPlayPercent}%` }} />
                </div>
              </div>
              <span className="bigscreen-compare-ach">{t("friendsPage.achPercent", { pct: game.achievementMe })}</span>
            </>
          ) : (
            <span className="bigscreen-compare-not-owned">{t("friendsPage.compareNotInLibrary")}</span>
          )}
        </div>
        <div className="bigscreen-compare-player-stat">
          <div className="bigscreen-compare-player-label">
            <span className="bigscreen-compare-player-dot right" aria-hidden />
            {friendName}
          </div>
          {game.ownedByFriend ? (
            <>
              <div className="bigscreen-compare-bar-row">
                <span className="bigscreen-compare-bar-value">{formatHours(game.playTimeFriend, t)}</span>
                <div className="bigscreen-compare-playtime-bar">
                  <div className="bigscreen-compare-playtime-fill right" style={{ width: `${friendPlayPercent}%` }} />
                </div>
              </div>
              <span className="bigscreen-compare-ach">{t("friendsPage.achPercent", { pct: game.achievementFriend })}</span>
            </>
          ) : (
            <span className="bigscreen-compare-not-owned">{t("friendsPage.compareNotInTheirLibrary")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Genres ───────────────────────────────────────────────────────

function CompareGenres({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { genreBreakdown } = social;
  if (genreBreakdown.length === 0) {
    return (
      <div className="system-view-empty">
        <p>{t("friendsPage.noGenreData")}</p>
      </div>
    );
  }
  return (
    <div className="bigscreen-compare-genres">
      {genreBreakdown.map((g) => {
        const max = Math.max(g.meOwned, g.friendOwned, 1);
        return (
          <div key={g.genre} className="bigscreen-compare-genre-row">
            <div className="bigscreen-compare-genre-head">
              <span className="bigscreen-compare-genre-name">{g.genre}</span>
              <span className="bigscreen-compare-genre-shared">
                {g.shared > 0 ? t("friendsPage.genreSharedCount", { count: g.shared }) : t("friendsPage.genreNoOverlap")}
              </span>
            </div>
            <div className="bigscreen-compare-genre-bars">
              <div className="bigscreen-compare-genre-bar-side">
                <span className="bigscreen-compare-genre-count left">{g.meOwned}</span>
                <div className="bigscreen-compare-genre-bar-track">
                  <div className="bigscreen-compare-genre-bar-fill left" style={{ width: `${(g.meOwned / max) * 100}%` }} />
                </div>
              </div>
              <div className="bigscreen-compare-genre-bar-side">
                <div className="bigscreen-compare-genre-bar-track reverse">
                  <div className="bigscreen-compare-genre-bar-fill right" style={{ width: `${(g.friendOwned / max) * 100}%` }} />
                </div>
                <span className="bigscreen-compare-genre-count right">{g.friendOwned}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Insights ─────────────────────────────────────────────────────

function CompareInsightsView({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { compareInsights, compareFriend } = social;
  if (!compareInsights || !compareFriend) return null;

  return (
    <div className="bigscreen-compare-insights">
      <div className="bigscreen-compare-insight-columns">
        <div className="bigscreen-compare-insight-panel">
          <h4>{t("friendsPage.insightForYouTitle", { name: compareFriend.name })}</h4>
          {compareInsights.forYou.length === 0 ? (
            <p className="bigscreen-compare-insight-empty">{t("friendsPage.ownEverything")}</p>
          ) : (
            <ul className="bigscreen-compare-insight-list">
              {compareInsights.forYou.map((g) => (
                <li key={g.id} className="bigscreen-compare-insight-item">
                  <span className="bigscreen-compare-insight-game">{g.name}</span>
                  <span className="bigscreen-compare-insight-meta">{formatHours(g.playTimeFriend, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bigscreen-compare-insight-panel">
          <h4>{t("friendsPage.insightForThemTitle", { name: compareFriend.name })}</h4>
          {compareInsights.forThem.length === 0 ? (
            <p className="bigscreen-compare-insight-empty">{t("friendsPage.compareInsightAllFavOwned")}</p>
          ) : (
            <ul className="bigscreen-compare-insight-list">
              {compareInsights.forThem.map((g) => (
                <li key={g.id} className="bigscreen-compare-insight-item">
                  <span className="bigscreen-compare-insight-game">{g.name}</span>
                  <span className="bigscreen-compare-insight-meta">{formatHours(g.playTimeMe, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bigscreen-compare-insight-panel">
          <h4>{t("friendsPage.insightIPlayMoreTitle")}</h4>
          {compareInsights.iPlayMore.length === 0 ? (
            <p className="bigscreen-compare-insight-empty">{t("friendsPage.noAheadGamesMessage")}</p>
          ) : (
            <ul className="bigscreen-compare-insight-list">
              {compareInsights.iPlayMore.map((g) => (
                <li key={g.id} className="bigscreen-compare-insight-item">
                  <span className="bigscreen-compare-insight-game">{g.name}</span>
                  <span className="bigscreen-compare-insight-meta win">
                    +{formatHours(g.playTimeMe - g.playTimeFriend, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bigscreen-compare-insight-panel">
          <h4>{t("friendsPage.insightTheyPlayMoreTitle", { name: compareFriend.name })}</h4>
          {compareInsights.theyPlayMore.length === 0 ? (
            <p className="bigscreen-compare-insight-empty">{t("friendsPage.compareInsightYouLeadAll")}</p>
          ) : (
            <ul className="bigscreen-compare-insight-list">
              {compareInsights.theyPlayMore.map((g) => (
                <li key={g.id} className="bigscreen-compare-insight-item">
                  <span className="bigscreen-compare-insight-game">{g.name}</span>
                  <span className="bigscreen-compare-insight-meta win friend">
                    +{formatHours(g.playTimeFriend - g.playTimeMe, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Leaderboard ──────────────────────────────────────────────────

function LeaderboardSection({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { leaderboardPlayers } = social;

  return (
    <div className="bigscreen-leaderboard">
      <div className="bigscreen-friends-section-head">
        <h3>{t("friendsPage.friendsLeaderboard")}</h3>
        <span className="bigscreen-friends-section-hint">{t("friendsPage.leaderboardSubtitle")}</span>
      </div>
      <div className="bigscreen-filter-chips" role="group" aria-label={t("friendsPage.leaderboardMetricAria")}>
        <FilterChip label={t("friendsPage.playtime")} active={social.leaderboardMetric === "playtime"} onActivate={() => social.setLeaderboardMetric("playtime")} />
        <FilterChip label={t("friendsPage.gamesOwned")} active={social.leaderboardMetric === "games"} onActivate={() => social.setLeaderboardMetric("games")} />
        <FilterChip label={t("friendsPage.sortAchievements")} active={social.leaderboardMetric === "achievements"} onActivate={() => social.setLeaderboardMetric("achievements")} />
      </div>

      {leaderboardPlayers.filter((p) => p.value > 0).length === 0 ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.noStatsYet")}</p>
          <p>{t("friendsPage.noStatsDesc")}</p>
        </div>
      ) : (
        <div className="bigscreen-leaderboard-list">
          {leaderboardPlayers.map((p) => (
            <LeaderboardRow
              key={p.key}
              player={p}
              metric={social.leaderboardMetric}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({
  player,
  metric,
}: {
  player: {
    rank: number;
    name: string;
    avatar: string;
    isYou: boolean;
    currentlyPlaying?: string;
    value: number;
    max: number;
  };
  metric: "playtime" | "games" | "achievements";
}) {
  const { t } = useLanguage();
  const valueLabel =
    metric === "playtime"
      ? formatHours(player.value, t)
      : metric === "games"
        ? `${player.value}`
        : `${player.value}%`;
  return (
    <div className={`bigscreen-leaderboard-row${player.isYou ? " is-you" : ""}${player.rank <= 3 ? " top-three" : ""}`}>
      <span className={`bigscreen-leaderboard-rank rank-${player.rank}`}>{player.rank}</span>
      <FriendAvatar avatar={player.avatar} name={player.name} className="bigscreen-friend-avatar bigscreen-friend-avatar--sm" />
      <div className="bigscreen-leaderboard-player-info">
        <div className="bigscreen-leaderboard-player-name">
          {player.name}
          {player.isYou && <span className="bigscreen-leaderboard-you-badge">{t("friendsPage.you")}</span>}
          {player.currentlyPlaying && <span className="bigscreen-leaderboard-now-playing">{player.currentlyPlaying}</span>}
        </div>
        <div className="bigscreen-leaderboard-bar-track">
          <div
            className="bigscreen-leaderboard-bar-fill"
            style={{ width: `${Math.max((player.value / player.max) * 100, 2)}%` }}
          />
        </div>
      </div>
      <span className="bigscreen-leaderboard-value">{valueLabel}</span>
    </div>
  );
}

// ─── Race ─────────────────────────────────────────────────────────

function RaceSection({ social }: { social: UseFriendsSocialResult }) {
  const { t } = useLanguage();
  const { achievementRaces } = social;

  return (
    <div className="bigscreen-race">
      <div className="bigscreen-friends-section-head">
        <h3>{t("friendsPage.raceTitle")}</h3>
        <span className="bigscreen-friends-section-hint">{t("friendsPage.raceSubtitle")}</span>
      </div>

      {achievementRaces.length === 0 ? (
        <div className="system-view-empty">
          <p>{t("friendsPage.raceEmpty")}</p>
          <p>{t("friendsPage.raceEmptyDesc")}</p>
        </div>
      ) : (
        <div className="bigscreen-race-list">
          {achievementRaces.map((r) => {
            const gap = r.me - r.them;
            const leader = gap >= 0 ? t("friendsPage.me") : r.friendName;
            const myWins = gap > 0;
            return (
              <div key={r.key} className="bigscreen-race-row">
                <div className="bigscreen-race-game">
                  <span className="bigscreen-race-game-name">{r.gameName}</span>
                  <span className="bigscreen-race-vs">{t("friendsPage.raceVs", { friend: r.friendName })}</span>
                </div>
                <div className="bigscreen-race-bars">
                  <div className="bigscreen-race-bar-group">
                    <span className="bigscreen-race-bar-label">{t("friendsPage.me")} · {r.me}%</span>
                    <div className="bigscreen-race-bar-track">
                      <div className="bigscreen-race-bar-fill race-bar-me" style={{ width: `${Math.min(Math.max(r.me, 0), 100)}%` }} />
                    </div>
                  </div>
                  <div className="bigscreen-race-bar-group">
                    <span className="bigscreen-race-bar-label">{r.friendName} · {r.them}%</span>
                    <div className="bigscreen-race-bar-track">
                      <div className="bigscreen-race-bar-fill race-bar-them" style={{ width: `${Math.min(Math.max(r.them, 0), 100)}%` }} />
                    </div>
                  </div>
                </div>
                <div className={`bigscreen-race-result${myWins ? " leading" : gap === 0 ? " tied" : " trailing"}`}>
                  {gap === 0 ? t("friendsPage.raceTied") : t("friendsPage.raceLeading", { who: leader, gap: Math.abs(gap) })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
