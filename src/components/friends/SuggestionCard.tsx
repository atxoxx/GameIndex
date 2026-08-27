import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSuggestion, SuggestionReactionKind } from "./friendsTypes";
import {
  formatLastSeen,
  ThumbsUpIcon,
  HeartIcon,
  FireIcon,
  CheckIcon,
  TrashIcon,
  MessageIcon,
  SendIcon,
  PlusIcon,
} from "./friendsUtils";

interface SuggestionCardProps {
  suggestion: GameSuggestion;
  currentUserName: string;
  inMyWishlist?: boolean;
  onReact: (suggestionId: string, kind: SuggestionReactionKind) => void;
  onToggleWishlist: (gameId: string, gameName: string) => void;
  onAddComment: (suggestionId: string, text: string) => void;
  onDelete: (suggestionId: string) => void;
  onOpenGame?: (gameId: string, gameName: string, slug?: string) => void;
}

export default function SuggestionCard({
  suggestion,
  currentUserName,
  inMyWishlist = false,
  onReact,
  onToggleWishlist,
  onAddComment,
  onDelete,
  onOpenGame,
}: SuggestionCardProps) {
  const { t } = useLanguage();
  const [commentDraft, setCommentDraft] = useState("");
  const [showComments, setShowComments] = useState(false);

  const isAuthor = suggestion.suggestedBy === currentUserName;
  const reactions = suggestion.reactions || {};
  const myReaction = reactions[currentUserName];

  const likesCount = Object.values(reactions).filter((r) => r === "like").length;
  const lovesCount = Object.values(reactions).filter((r) => r === "love").length;
  const firesCount = Object.values(reactions).filter((r) => r === "interest").length;
  const playedCount = Object.values(reactions).filter((r) => r === "played").length;

  const handleSendComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    onAddComment(suggestion.id, text);
    setCommentDraft("");
  };

  return (
    <div className="sug-card">
      <div className="sug-card-head">
        <div className="sug-card-game-info">
          {suggestion.coverUrl ? (
            <img
              src={suggestion.coverUrl}
              alt={suggestion.gameName}
              className="sug-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="sug-cover-placeholder">
              {suggestion.gameName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div
              className={`sug-game-title${onOpenGame ? " clickable" : ""}`}
              onClick={() => onOpenGame && onOpenGame(suggestion.gameId, suggestion.gameName, suggestion.slug)}
              title={suggestion.gameName}
            >
              {suggestion.gameName}
            </div>
            <div className="sug-by-line">
              {t("friendsPage.sharedByLabel")}
              <span className="sug-author">{isAuthor ? t("friendsPage.me") : suggestion.suggestedBy}</span>
              {suggestion.suggestedTo && suggestion.suggestedTo !== "All Friends" && (
                <span className="sug-target">
                  {" "}→ {suggestion.suggestedTo === currentUserName ? t("friendsPage.me") : suggestion.suggestedTo}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="sug-card-head-actions">
          <button
            type="button"
            className={`sug-wishlist-btn${inMyWishlist ? " in-wishlist" : ""}`}
            onClick={() => onToggleWishlist(suggestion.gameId, suggestion.gameName)}
            title={inMyWishlist ? t("friendsPage.inWishlist") : t("friendsPage.addToWishlist")}
          >
            {inMyWishlist ? <CheckIcon /> : <PlusIcon />}
            <span>{inMyWishlist ? t("friendsPage.inWishlist") : t("friendsPage.addToWishlist")}</span>
          </button>

          {isAuthor && (
            <button
              type="button"
              className="friend-delete-btn friend-delete-btn--inline"
              onClick={() => onDelete(suggestion.id)}
              title={t("friendsPage.deleteSuggestionTitle")}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {suggestion.note && (
        <div className="sug-note-box">
          <p className="sug-note-text">"{suggestion.note}"</p>
        </div>
      )}

      <div className="sug-reactions-row">
        <div className="sug-reactions-buttons">
          <button
            type="button"
            className={`sug-react-btn${myReaction === "like" ? " active" : ""}`}
            onClick={() => onReact(suggestion.id, "like")}
            title={t("friendsPage.like")}
          >
            <ThumbsUpIcon />
            {likesCount > 0 && <span className="sug-react-count">{likesCount}</span>}
          </button>

          <button
            type="button"
            className={`sug-react-btn${myReaction === "love" ? " active" : ""}`}
            onClick={() => onReact(suggestion.id, "love")}
            title={t("friendsPage.love")}
          >
            <HeartIcon />
            {lovesCount > 0 && <span className="sug-react-count">{lovesCount}</span>}
          </button>

          <button
            type="button"
            className={`sug-react-btn${myReaction === "interest" ? " active" : ""}`}
            onClick={() => onReact(suggestion.id, "interest")}
            title={t("friendsPage.wantToTry")}
          >
            <FireIcon />
            {firesCount > 0 && <span className="sug-react-count">{firesCount}</span>}
          </button>

          <button
            type="button"
            className={`sug-react-btn${myReaction === "played" ? " active" : ""}`}
            onClick={() => onReact(suggestion.id, "played")}
            title={t("friendsPage.played")}
          >
            <CheckIcon />
            {playedCount > 0 && <span className="sug-react-count">{playedCount}</span>}
          </button>
        </div>

        <button
          type="button"
          className={`sug-comments-toggle${showComments ? " active" : ""}`}
          onClick={() => setShowComments((v) => !v)}
        >
          <MessageIcon />
          <span>
            {suggestion.comments.length > 0 ? suggestion.comments.length : t("friendsPage.comment")}
          </span>
        </button>
      </div>

      {showComments && (
        <div className="sug-comments-section">
          <div className="sug-comments-list">
            {suggestion.comments.length === 0 ? (
              <div className="sug-comments-empty">{t("friendsPage.noCommentsYet")}</div>
            ) : (
              suggestion.comments.map((c) => (
                <div key={c.id} className="sug-comment-bubble">
                  <div className="sug-comment-header">
                    <span className="sug-comment-author">{c.authorName}</span>
                    <span className="sug-comment-time">
                      {formatLastSeen(Math.floor(c.timestamp / 1000), t)}
                    </span>
                  </div>
                  <div className="sug-comment-text">{c.text}</div>
                </div>
              ))
            )}
          </div>

          <div className="sug-comment-composer">
            <input
              className="profile-input sug-comment-input"
              placeholder={t("friendsPage.writeComment")}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
            />
            <button
              type="button"
              className="btn btn-primary btn--mini"
              onClick={handleSendComment}
              disabled={!commentDraft.trim()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
