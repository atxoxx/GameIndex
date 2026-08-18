import { useState, useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameRecommendation, UserProfile, Friend, ReactionKind } from "./friendsTypes";
import RecommendationCard from "./RecommendationCard";
import {
  displayName,
  GamePicker,
  RecommendIcon,
  PlusIcon,
  StarIcon,
  XIcon,
} from "./friendsUtils";

interface FriendsRecsTabProps {
  recommendations: GameRecommendation[];
  profile: UserProfile;
  friends: Friend[];
  libraryGames: any[];
  onReact: (recId: string, kind: ReactionKind) => void;
  onToggleWantToPlay: (recId: string) => void;
  onAddComment: (recId: string, text: string) => void;
  onCreateRec: (rec: Omit<GameRecommendation, "id" | "comments" | "createdAt" | "updatedAt">) => void;
  onDeleteRec: (recId: string) => void;
  onOpenGame?: (gameId: string, gameName: string) => void;
}

export default function FriendsRecsTab({
  recommendations,
  profile,
  friends,
  libraryGames,
  onReact,
  onToggleWantToPlay,
  onAddComment,
  onCreateRec,
  onDeleteRec,
  onOpenGame,
}: FriendsRecsTabProps) {
  const { t } = useLanguage();
  const [filterMode, setFilterMode] = useState<"all" | "to_me" | "by_me" | "want">("all");
  const [viewMode, setViewMode] = useState<"feed" | "top">("feed");
  const [topGameFilter, setTopGameFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form State for creating recommendation
  const [gameId, setGameId] = useState("");
  const [gameName, setGameName] = useState("");
  const [targetFriend, setTargetFriend] = useState("All Friends");
  const [rating, setRating] = useState(5);
  const [reason, setReason] = useState("");

  const activeRecs = useMemo(() => {
    return recommendations.filter((r) => !r.deleted);
  }, [recommendations]);

  // Games recommended by 2+ friends, deduped per game with combined scores.
  const topPicks = useMemo(() => {
    const byGame = new Map<string, GameRecommendation[]>();
    activeRecs.forEach((r) => {
      const list = byGame.get(r.gameId) || [];
      list.push(r);
      byGame.set(r.gameId, list);
    });
    return Array.from(byGame.entries())
      .map(([gameId, recs]) => {
        const recommenders = Array.from(new Set(recs.map((r) => r.recommendedBy)));
        const avgRating = recs.reduce((sum, r) => sum + (r.rating || 0), 0) / recs.length;
        const reactionCount = recs.reduce((sum, r) => sum + Object.keys(r.reactions || {}).length, 0);
        const latest = recs.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a));
        return {
          gameId,
          gameName: recs[0].gameName,
          recommenders,
          count: recommenders.length,
          avgRating,
          reactionCount,
          latestReason: latest.reason,
          wantToPlay: recs.some((r) => r.wantToPlay),
          recs,
        };
      })
      .filter((pick) => pick.count > 1)
      .sort((a, b) => b.count - a.count || b.avgRating - a.avgRating);
  }, [activeRecs]);

  const filteredRecs = useMemo(() => {
    let list = [...activeRecs];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.gameName.toLowerCase().includes(q) ||
          r.recommendedBy.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q)
      );
    }

    if (topGameFilter) {
      list = list.filter((r) => r.gameId === topGameFilter);
    }

    if (filterMode === "to_me") {
      list = list.filter(
        (r) => r.recommendedTo === profile.name || r.recommendedTo === "All Friends"
      );
    } else if (filterMode === "by_me") {
      list = list.filter((r) => r.recommendedBy === profile.name);
    } else if (filterMode === "want") {
      list = list.filter((r) => r.wantToPlay);
    }

    list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return list;
  }, [activeRecs, searchQuery, filterMode, topGameFilter, profile.name]);

  const libraryCoverMap = useMemo(() => {
    const map = new Map<string, string>();
    libraryGames.forEach((g) => {
      if (g.coverArtUrl) map.set(String(g.id), g.coverArtUrl);
    });
    return map;
  }, [libraryGames]);

  const getCover = (r: GameRecommendation) => libraryCoverMap.get(r.gameId);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameName.trim()) return;

    onCreateRec({
      gameId: gameId || `custom_${Date.now()}`,
      gameName: gameName.trim(),
      recommendedBy: profile.name,
      recommendedTo: targetFriend,
      rating,
      reason: reason.trim(),
      reactions: {},
      wantToPlay: false,
    });

    setShowCreateModal(false);
    setGameId("");
    setGameName("");
    setTargetFriend("All Friends");
    setRating(5);
    setReason("");
  };

  return (
    <div className="friends-recs-section">
      <div className="recs-toolbar">
        <div className="recs-view-toggle">
          <button
            type="button"
            className={`recs-view-pill${viewMode === "feed" ? " active" : ""}`}
            onClick={() => {
              setViewMode("feed");
              setTopGameFilter(null);
            }}
          >
            {t("friendsPage.recsFeed")}
          </button>
          <button
            type="button"
            className={`recs-view-pill${viewMode === "top" ? " active" : ""}`}
            onClick={() => setViewMode("top")}
          >
            {t("friendsPage.topPicks")}
            {topPicks.length > 0 && <span className="recs-view-pill-count">{topPicks.length}</span>}
          </button>
        </div>

        <div className="recs-search-wrapper">
          <input
            type="text"
            className="profile-input recs-search-input"
            placeholder={t("friendsPage.searchRecsPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="recs-filter-pills">
          <button
            type="button"
            className={`filter-pill${filterMode === "all" ? " active" : ""}`}
            onClick={() => {
              setFilterMode("all");
              setTopGameFilter(null);
            }}
          >
            {t("friends.all")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "to_me" ? " active" : ""}`}
            onClick={() => {
              setFilterMode("to_me");
              setTopGameFilter(null);
            }}
          >
            {t("friendsPage.forYou")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "by_me" ? " active" : ""}`}
            onClick={() => {
              setFilterMode("by_me");
              setTopGameFilter(null);
            }}
          >
            {t("friendsPage.byYou")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "want" ? " active" : ""}`}
            onClick={() => {
              setFilterMode("want");
              setTopGameFilter(null);
            }}
          >
            <StarIcon /> {t("friendsPage.backlog")}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary btn--mini"
          onClick={() => setShowCreateModal(true)}
        >
          <PlusIcon /> {t("friends.recommendGame")}
        </button>
      </div>

      {topGameFilter && (
        <div className="recs-filter-banner">
          <span>
            {t("friendsPage.recsForGame", {
              game: activeRecs.find((r) => r.gameId === topGameFilter)?.gameName || "",
            })}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn--mini"
            onClick={() => setTopGameFilter(null)}
          >
            <XIcon /> {t("common.clear")}
          </button>
        </div>
      )}

      {viewMode === "top" ? (
        topPicks.length === 0 ? (
          <div className="friends-empty-state">
            <div className="friends-empty-icon">
              <RecommendIcon />
            </div>
            <h3 className="friends-empty-title">{t("friendsPage.noTopPicks")}</h3>
            <p className="friends-empty-desc">{t("friendsPage.noTopPicksDesc")}</p>
          </div>
        ) : (
          <div className="recs-feed-grid">
            {topPicks.map((pick) => (
              <div key={pick.gameId} className="rec-top-card">
                <div className="rec-top-cover">
                  {libraryCoverMap.get(pick.gameId) ? (
                    <img
                      src={libraryCoverMap.get(pick.gameId)}
                      alt={pick.gameName}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <span>{pick.gameName.slice(0, 2).toUpperCase()}</span>
                  )}
                </div>
                <div className="rec-top-body">
                  <h4 className="rec-top-title">{pick.gameName}</h4>
                  <div className="rec-top-friends">
                    {pick.recommenders.map((name) => (
                      <span key={name} className="rec-top-friend-chip" title={name}>
                        {name.slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                    <span className="rec-top-count">
                      {t("friendsPage.friendsRecommendCount", { count: pick.count })}
                    </span>
                  </div>
                  <div className="rec-top-rating">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <span key={s} className={`rec-top-star${s <= Math.round(pick.avgRating) ? " filled" : ""}`}>
                        ★
                      </span>
                    ))}
                    <span className="rec-top-avg">{pick.avgRating.toFixed(1)}</span>
                    {pick.reactionCount > 0 && (
                      <span className="rec-top-reactions">
                        {t("friendsPage.reactionCount", { count: pick.reactionCount })}
                      </span>
                    )}
                  </div>
                  {pick.latestReason && <p className="rec-top-reason">&ldquo;{pick.latestReason}&rdquo;</p>}
                  <div className="rec-top-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn--mini"
                      onClick={() => {
                        setTopGameFilter(pick.gameId);
                        setViewMode("feed");
                      }}
                    >
                      {t("friendsPage.viewRecs")}
                    </button>
                    <button
                      type="button"
                      className={`btn btn-secondary btn--mini${pick.wantToPlay ? " active" : ""}`}
                      onClick={() => {
                        const target = !pick.wantToPlay;
                        pick.recs.forEach((r) => {
                          if (r.wantToPlay !== target) onToggleWantToPlay(r.id);
                        });
                      }}
                    >
                      <StarIcon /> {pick.wantToPlay ? t("friendsPage.backlog") : t("friendsPage.wantToPlayAdd")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filteredRecs.length === 0 ? (
        <div className="friends-empty-state">
          <div className="friends-empty-icon">
            <RecommendIcon />
          </div>
          <h3 className="friends-empty-title">{t("friends.noRecommendations")}</h3>
          <p className="friends-empty-desc">{t("friendsPage.noRecsDesc")}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            <PlusIcon /> {t("friends.recommendGame")}
          </button>
        </div>
      ) : (
        <div className="recs-feed-grid">
          {filteredRecs.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              currentUserName={profile.name}
              gameCover={getCover(rec)}
              onReact={onReact}
              onToggleWantToPlay={onToggleWantToPlay}
              onAddComment={onAddComment}
              onDelete={onDeleteRec}
              onOpenGame={onOpenGame}
            />
          ))}
        </div>
      )}

      {/* Recommend Game Modal */}
      {showCreateModal && (
        <div className="friends-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="friends-modal-box friends-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="friends-modal-header">
              <h2 className="friends-modal-title">
                <RecommendIcon /> {t("friends.recommendGame")}
              </h2>
              <button
                type="button"
                className="friends-modal-close"
                onClick={() => setShowCreateModal(false)}
                title={t("common.close")}
              >
                <XIcon />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="friends-modal-body">
                <div className="form-group">
                  <label className="form-label">{t("friendsPage.selectGame")}</label>
                  <GamePicker
                    libraryGames={libraryGames}
                    friends={friends}
                    selectedGameId={gameId}
                    selectedGameName={gameName}
                    onSelect={(g) => {
                      setGameId(g.id);
                      setGameName(g.name);
                    }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.recommendToFriend")}</label>
                  <select
                    className="profile-input"
                    value={targetFriend}
                    onChange={(e) => setTargetFriend(e.target.value)}
                  >
                    <option value="All Friends">{t("friendsPage.allFriends")}</option>
                    {friends.map((f) => (
                      <option key={f.id} value={f.name}>
                        {displayName(f)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.yourRating")}</label>
                  <div className="rating-star-selector">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        className={`star-select-btn${star <= rating ? " active" : ""}`}
                        onClick={() => setRating(star)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.whyRecommend")}</label>
                  <textarea
                    className="profile-input"
                    rows={3}
                    placeholder={t("friendsPage.recReasonPlaceholder")}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </div>

              <div className="friends-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn btn-primary" disabled={!gameName.trim()}>
                  <PlusIcon /> {t("friendsPage.postRecommendation")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
