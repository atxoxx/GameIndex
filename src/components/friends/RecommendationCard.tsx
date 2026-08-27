import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameRecommendation, ReactionKind } from "./friendsTypes";
import {
  formatLastSeen,
  StarIcon,
  ThumbsUpIcon,
  HeartIcon,
  GamepadIcon,
  TrashIcon,
  MessageIcon,
  SendIcon,
} from "./friendsUtils";

interface RecommendationCardProps {
  rec: GameRecommendation;
  currentUserName: string;
  gameCover?: string;
  onReact: (recId: string, kind: ReactionKind) => void;
  onToggleWantToPlay: (recId: string) => void;
  onAddComment: (recId: string, text: string) => void;
  onDelete: (recId: string) => void;
  onOpenGame?: (gameId: string, gameName: string, slug?: string) => void;
}

export default function RecommendationCard({
  rec,
  currentUserName,
  gameCover,
  onReact,
  onToggleWantToPlay,
  onAddComment,
  onDelete,
  onOpenGame,
}: RecommendationCardProps) {
  const { t } = useLanguage();
  const [commentDraft, setCommentDraft] = useState("");
  const [showComments, setShowComments] = useState(false);

  const isAuthor = rec.recommendedBy === currentUserName;
  const reactions = rec.reactions || {};
  const myReaction = reactions[currentUserName];

  const likesCount = Object.values(reactions).filter((r) => r === "like").length;
  const lovesCount = Object.values(reactions).filter((r) => r === "love").length;
  const playsCount = Object.values(reactions).filter((r) => r === "play").length;

  const handleSendComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    onAddComment(rec.id, text);
    setCommentDraft("");
  };

  return (
    <div className="rec-card">
      <div className="rec-card-head">
        <div className="rec-card-game-info">
          {gameCover ? (
            <img
              src={gameCover}
              alt={rec.gameName}
              className="rec-cover"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="rec-cover-placeholder">
              {rec.gameName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div
              className={`rec-game-title${onOpenGame ? " clickable" : ""}`}
              onClick={() => onOpenGame && onOpenGame(rec.gameId, rec.gameName, rec.slug)}
              title={rec.gameName}
            >
              {rec.gameName}
            </div>
            <div className="rec-by-line">
              {t("friendsPage.by")}{" "}
              <span className="rec-author">{isAuthor ? t("friendsPage.me") : rec.recommendedBy}</span>
              {rec.recommendedTo && rec.recommendedTo !== "All Friends" && (
                <span className="rec-target">
                  {" "}→ {rec.recommendedTo === currentUserName ? t("friendsPage.me") : rec.recommendedTo}
                </span>
              )}
            </div>
            <div className="rec-stars" title={`${rec.rating} / 5 stars`}>
              {[1, 2, 3, 4, 5].map((star) => (
                <span key={star} className={`star-item${star <= rec.rating ? " filled" : ""}`}>
                  ★
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="rec-card-head-actions">
          <button
            type="button"
            className={`rec-want-btn${rec.wantToPlay ? " active" : ""}`}
            onClick={() => onToggleWantToPlay(rec.id)}
            title={rec.wantToPlay ? t("friendsPage.inYourBacklog") : t("friendsPage.addToBacklog")}
          >
            <StarIcon />
            <span>{rec.wantToPlay ? t("friendsPage.inBacklog") : t("friendsPage.wantToPlay")}</span>
          </button>

          {isAuthor && (
            <button
              type="button"
              className="friend-delete-btn friend-delete-btn--inline"
              onClick={() => onDelete(rec.id)}
              title={t("friendsPage.deleteRecTitle")}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {rec.reason && (
        <div className="rec-reason-box">
          <p className="rec-reason-text">"{rec.reason}"</p>
        </div>
      )}

      <div className="rec-reactions-row">
        <div className="rec-reactions-buttons">
          <button
            type="button"
            className={`rec-react-btn${myReaction === "like" ? " active" : ""}`}
            onClick={() => onReact(rec.id, "like")}
            title={t("friendsPage.like")}
          >
            <ThumbsUpIcon />
            {likesCount > 0 && <span className="rec-react-count">{likesCount}</span>}
          </button>

          <button
            type="button"
            className={`rec-react-btn${myReaction === "love" ? " active" : ""}`}
            onClick={() => onReact(rec.id, "love")}
            title={t("friendsPage.love")}
          >
            <HeartIcon />
            {lovesCount > 0 && <span className="rec-react-count">{lovesCount}</span>}
          </button>

          <button
            type="button"
            className={`rec-react-btn${myReaction === "play" ? " active" : ""}`}
            onClick={() => onReact(rec.id, "play")}
            title={t("friendsPage.played")}
          >
            <GamepadIcon />
            {playsCount > 0 && <span className="rec-react-count">{playsCount}</span>}
          </button>
        </div>

        <button
          type="button"
          className={`rec-comments-toggle${showComments ? " active" : ""}`}
          onClick={() => setShowComments((v) => !v)}
        >
          <MessageIcon />
          <span>
            {rec.comments.length > 0 ? rec.comments.length : t("friendsPage.comment")}
          </span>
        </button>
      </div>

      {showComments && (
        <div className="rec-comments-section">
          <div className="rec-comments-list">
            {rec.comments.length === 0 ? (
              <div className="rec-comments-empty">{t("friendsPage.noCommentsYet")}</div>
            ) : (
              rec.comments.map((c) => (
                <div key={c.id} className="rec-comment-bubble">
                  <div className="rec-comment-header">
                    <span className="rec-comment-author">{c.authorName}</span>
                    <span className="rec-comment-time">
                      {formatLastSeen(Math.floor(c.timestamp / 1000), t)}
                    </span>
                  </div>
                  <div className="rec-comment-text">{c.text}</div>
                </div>
              ))
            )}
          </div>

          <div className="rec-comment-composer">
            <input
              className="profile-input rec-comment-input"
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
