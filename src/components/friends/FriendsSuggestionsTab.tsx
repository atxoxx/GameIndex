import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSuggestion, UserProfile, Friend, SuggestionReactionKind } from "./friendsTypes";
import SuggestionCard from "./SuggestionCard";
import {
  displayName,
  SuggestionIcon,
  PlusIcon,
  XIcon,
} from "./friendsUtils";

interface FriendsSuggestionsTabProps {
  suggestions: GameSuggestion[];
  profile: UserProfile;
  friends: Friend[];
  wishlistGames: any[];
  onReact: (suggestionId: string, kind: SuggestionReactionKind) => void;
  onToggleWishlist: (gameId: string, gameName: string) => void;
  onAddComment: (suggestionId: string, text: string) => void;
  onCreateSuggestion: (sug: Omit<GameSuggestion, "id" | "comments" | "createdAt" | "updatedAt">) => void;
  onDeleteSuggestion: (suggestionId: string) => void;
  onOpenGame?: (gameId: string, gameName: string, slug?: string) => void;
}

export default function FriendsSuggestionsTab({
  suggestions,
  profile,
  friends,
  wishlistGames,
  onReact,
  onToggleWishlist,
  onAddComment,
  onCreateSuggestion,
  onDeleteSuggestion,
  onOpenGame,
}: FriendsSuggestionsTabProps) {
  const { t } = useLanguage();
  const [filterMode, setFilterMode] = useState<"all" | "by_me" | "to_me" | "added">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form state
  const [selectedWishlistGameId, setSelectedWishlistGameId] = useState("");
  const [targetFriend, setTargetFriend] = useState("All Friends");
  const [note, setNote] = useState("");

  const activeSuggestions = useMemo(() => {
    return suggestions.filter((s) => !s.deleted);
  }, [suggestions]);

  const myWishlistGameIds = useMemo(() => {
    return new Set(wishlistGames.map((g) => String(g.id || g.slug || g.name)));
  }, [wishlistGames]);

  const filteredSuggestions = useMemo(() => {
    let list = [...activeSuggestions];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.gameName.toLowerCase().includes(q) ||
          s.suggestedBy.toLowerCase().includes(q) ||
          s.note.toLowerCase().includes(q)
      );
    }

    if (filterMode === "by_me") {
      list = list.filter((s) => s.suggestedBy === profile.name);
    } else if (filterMode === "to_me") {
      list = list.filter(
        (s) => s.suggestedTo === profile.name || s.suggestedTo === "All Friends"
      );
    } else if (filterMode === "added") {
      list = list.filter((s) => myWishlistGameIds.has(s.gameId));
    }

    list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    return list;
  }, [activeSuggestions, searchQuery, filterMode, profile.name, myWishlistGameIds]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosenGame = wishlistGames.find((g) => String(g.id || g.slug || g.name) === selectedWishlistGameId);
    if (!chosenGame) return;

    onCreateSuggestion({
      gameId: String(chosenGame.id || chosenGame.slug || chosenGame.name),
      gameName: chosenGame.name,
      coverUrl: chosenGame.coverUrl || chosenGame.coverArtUrl,
      slug: chosenGame.slug || undefined,
      suggestedBy: profile.name,
      suggestedTo: targetFriend,
      note: note.trim(),
      reactions: {},
    });

    setShowCreateModal(false);
    setSelectedWishlistGameId("");
    setTargetFriend("All Friends");
    setNote("");
  };

  return (
    <div className="friends-suggestions-section">
      <div className="suggestions-toolbar">
        <div className="suggestions-search-wrapper">
          <input
            type="text"
            className="profile-input suggestions-search-input"
            placeholder={t("friendsPage.searchSuggestionsPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="suggestions-filter-pills">
          <button
            type="button"
            className={`filter-pill${filterMode === "all" ? " active" : ""}`}
            onClick={() => setFilterMode("all")}
          >
            {t("friends.all")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "to_me" ? " active" : ""}`}
            onClick={() => setFilterMode("to_me")}
          >
            {t("friendsPage.sharedWithYou")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "by_me" ? " active" : ""}`}
            onClick={() => setFilterMode("by_me")}
          >
            {t("friendsPage.sharedByYou")}
          </button>
          <button
            type="button"
            className={`filter-pill${filterMode === "added" ? " active" : ""}`}
            onClick={() => setFilterMode("added")}
          >
            {t("friendsPage.inWishlist")}
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary btn--mini"
          onClick={() => setShowCreateModal(true)}
          disabled={wishlistGames.length === 0}
        >
          <PlusIcon /> {t("friendsPage.shareFromWishlist")}
        </button>
      </div>

      {filteredSuggestions.length === 0 ? (
        <div className="friends-empty-state">
          <div className="friends-empty-icon">
            <SuggestionIcon />
          </div>
          <h3 className="friends-empty-title">{t("friendsPage.noSuggestionsYet")}</h3>
          <p className="friends-empty-desc">
            {wishlistGames.length === 0
              ? t("friendsPage.wishlistEmptyToAdd")
              : t("friendsPage.noSuggestionsDesc")}
          </p>
          {wishlistGames.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
            >
              <PlusIcon /> {t("friendsPage.shareFromWishlist")}
            </button>
          )}
        </div>
      ) : (
        <div className="suggestions-feed-grid">
          {filteredSuggestions.map((sug) => (
            <SuggestionCard
              key={sug.id}
              suggestion={sug}
              currentUserName={profile.name}
              inMyWishlist={myWishlistGameIds.has(sug.gameId)}
              onReact={onReact}
              onToggleWishlist={onToggleWishlist}
              onAddComment={onAddComment}
              onDelete={onDeleteSuggestion}
              onOpenGame={onOpenGame}
            />
          ))}
        </div>
      )}

      {/* Share from Wishlist Modal */}
      {showCreateModal &&
        createPortal(
          <div className="friends-modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="friends-modal-box friends-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="friends-modal-header">
              <h2 className="friends-modal-title">
                <SuggestionIcon /> {t("friendsPage.shareFromWishlist")}
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
                  <label className="form-label">{t("friendsPage.selectWishlistGame")}</label>
                  <select
                    className="profile-input"
                    value={selectedWishlistGameId}
                    onChange={(e) => setSelectedWishlistGameId(e.target.value)}
                    required
                  >
                    <option value="">{t("friendsPage.chooseFromWishlist")}</option>
                    {wishlistGames.map((g) => (
                      <option key={String(g.id || g.slug || g.name)} value={String(g.id || g.slug || g.name)}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">{t("friendsPage.shareWithFriend")}</label>
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
                  <label className="form-label">{t("friendsPage.whyShareThisGame")}</label>
                  <textarea
                    className="profile-input"
                    rows={3}
                    placeholder={t("friendsPage.suggestionNotePlaceholder")}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
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
                <button type="submit" className="btn btn-primary" disabled={!selectedWishlistGameId}>
                  <PlusIcon /> {t("friendsPage.shareSuggestion")}
                </button>
              </div>
            </form>
          </div>
          </div>,
          document.body
        )}
    </div>
  );
}
