// SocialTab — Recommendations + Wishlist Shares for the Big Screen hub.
//
// Two sub-feeds behind a sub-tab bar, each with filter chips, reaction
// buttons, want-to-play / add-to-wishlist actions, threaded comments,
// and a composer modal (recommend a library game, or share a game from
// the wishlist). Every interactive element is a dedicated component so
// useFocusable counts stay stable.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGames } from "../../../context/GameContext";
import { useWishlistContext } from "../../../context/WishlistContext";
import {
  type GameRecommendation,
  type GameSuggestion,
  type ReactionKind,
  type SuggestionReactionKind,
} from "../../../pages/friendsStorage";
import type { UseFriendsSocialResult } from "../../../hooks/useFriendsSocial";
import { FilterChip, Icons, formatLastSeen, useFocusableInput, useOverlayEscape } from "./friendsUtils";

type SocialSubTab = "recs" | "suggestions";
type RecFilter = "all" | "to_me" | "by_me" | "want";
type SugFilter = "all" | "by_me" | "to_me" | "added" | "unadded";

export default function SocialTab({ social, profileName }: { social: UseFriendsSocialResult; profileName: string }) {
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<SocialSubTab>("recs");
  const [recFilter, setRecFilter] = useState<RecFilter>("all");
  const [sugFilter, setSugFilter] = useState<SugFilter>("all");
  const [showRecComposer, setShowRecComposer] = useState(false);
  const [showSugComposer, setShowSugComposer] = useState(false);

  const { recommendations, suggestions } = social;
  const activeRecs = useMemo(() => recommendations.filter((r) => !r.deleted), [recommendations]);
  const activeSugs = useMemo(() => suggestions.filter((s) => !s.deleted), [suggestions]);

  const visibleRecs = useMemo(() => {
    return activeRecs.filter((rec) => {
      if (recFilter === "to_me") return rec.recommendedTo === profileName || rec.recommendedTo === "All Friends";
      if (recFilter === "by_me") return rec.recommendedBy === profileName;
      if (recFilter === "want") return !!rec.wantToPlay;
      return true;
    });
  }, [activeRecs, recFilter, profileName]);

  const visibleSugs = useMemo(() => {
    return [...activeSugs]
      .filter((s) => {
        if (sugFilter === "by_me") return s.suggestedBy === profileName;
        if (sugFilter === "to_me") return s.suggestedTo === profileName || s.suggestedTo === "All Friends";
        if (sugFilter === "added") return !!s.addedToWishlist;
        if (sugFilter === "unadded") return !s.addedToWishlist;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [activeSugs, sugFilter, profileName]);

  return (
    <div className="bigscreen-social">
      <div className="bigscreen-friends-subtabs" role="group" aria-label={t("friends.tab.recs")}>
        <FilterChip label={t("friends.tab.recs")} active={subTab === "recs"} onActivate={() => setSubTab("recs")} />
        <FilterChip label={t("friends.tab.suggestions")} active={subTab === "suggestions"} onActivate={() => setSubTab("suggestions")} />
      </div>

      {subTab === "recs" ? (
        <>
          <div className="bigscreen-friends-controls">
            <div className="bigscreen-filter-chips">
              <FilterChip label={t("friendsPage.recFilterAll", { count: activeRecs.length })} active={recFilter === "all"} onActivate={() => setRecFilter("all")} />
              <FilterChip label={t("friendsPage.recFilterToMe", { count: activeRecs.filter((r) => r.recommendedTo === profileName || r.recommendedTo === "All Friends").length })} active={recFilter === "to_me"} onActivate={() => setRecFilter("to_me")} />
              <FilterChip label={t("friendsPage.recFilterByMe", { count: activeRecs.filter((r) => r.recommendedBy === profileName).length })} active={recFilter === "by_me"} onActivate={() => setRecFilter("by_me")} />
              <FilterChip label={t("friendsPage.recFilterWant", { count: activeRecs.filter((r) => r.wantToPlay).length })} active={recFilter === "want"} onActivate={() => setRecFilter("want")} />
            </div>
            <div className="bigscreen-friends-controls-tools">
              <ComposerButton
                icon={Icons.star(true)}
                label={t("friendsPage.recommendGame")}
                onActivate={() => setShowRecComposer(true)}
              />
            </div>
          </div>

          {activeRecs.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friendsPage.noRecsYet")}</p>
              <p>{t("friendsPage.recsEmptyDesc")}</p>
            </div>
          ) : visibleRecs.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friends.noMatch")}</p>
            </div>
          ) : (
            <div className="bigscreen-social-list">
              {visibleRecs.map((rec) => (
                <RecommendationCard key={rec.id} rec={rec} social={social} profileName={profileName} />
              ))}
            </div>
          )}

          {showRecComposer && <RecommendationComposer social={social} onClose={() => setShowRecComposer(false)} />}
        </>
      ) : (
        <>
          <div className="bigscreen-friends-controls">
            <div className="bigscreen-filter-chips">
              <FilterChip label={t("friendsPage.sugFilterAll", { count: activeSugs.length })} active={sugFilter === "all"} onActivate={() => setSugFilter("all")} />
              <FilterChip label={t("friendsPage.sugFilterByMe", { count: activeSugs.filter((s) => s.suggestedBy === profileName).length })} active={sugFilter === "by_me"} onActivate={() => setSugFilter("by_me")} />
              <FilterChip label={t("friendsPage.sugFilterForMe", { count: activeSugs.filter((s) => s.suggestedTo === profileName || s.suggestedTo === "All Friends").length })} active={sugFilter === "to_me"} onActivate={() => setSugFilter("to_me")} />
              <FilterChip label={t("friendsPage.sugFilterAdded", { count: activeSugs.filter((s) => s.addedToWishlist).length })} active={sugFilter === "added"} onActivate={() => setSugFilter("added")} />
              <FilterChip label={t("friendsPage.sugFilterNotAdded", { count: activeSugs.filter((s) => !s.addedToWishlist).length })} active={sugFilter === "unadded"} onActivate={() => setSugFilter("unadded")} />
            </div>
            <div className="bigscreen-friends-controls-tools">
              <ComposerButton
                icon={Icons.heart()}
                label={t("friendsPage.shareGameWishlist")}
                onActivate={() => setShowSugComposer(true)}
              />
            </div>
          </div>

          {activeSugs.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friendsPage.noSharedGamesYet")}</p>
              <p>{t("friendsPage.sugEmptyDesc")}</p>
            </div>
          ) : visibleSugs.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friendsPage.noSharedGamesMatchTitle")}</p>
              <p>{t("friendsPage.noSharedGamesMatch")}</p>
            </div>
          ) : (
            <div className="bigscreen-social-list">
              {visibleSugs.map((sug) => (
                <SuggestionCard key={sug.id} sug={sug} social={social} profileName={profileName} />
              ))}
            </div>
          )}

          {showSugComposer && <SuggestionComposer social={social} onClose={() => setShowSugComposer(false)} />}
        </>
      )}
    </div>
  );
}

// ─── Composer launcher ────────────────────────────────────────────

function ComposerButton({
  icon,
  label,
  onActivate,
}: {
  icon: ReactNode;
  label: string;
  onActivate: () => void;
}) {
  const btnProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
      {...btnProps}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Recommendation card ──────────────────────────────────────────

const REC_KINDS: { kind: ReactionKind; icon: ReactNode; labelKey: string }[] = [
  { kind: "like", icon: Icons.thumbsUp(), labelKey: "bigscreen.friends.reactionLike" },
  { kind: "love", icon: Icons.heart(), labelKey: "bigscreen.friends.reactionLove" },
  { kind: "play", icon: Icons.gamepad(), labelKey: "bigscreen.friends.reactionPlay" },
];

function RecommendationCard({
  rec,
  social,
  profileName,
}: {
  rec: GameRecommendation;
  social: UseFriendsSocialResult;
  profileName: string;
}) {
  const { t } = useLanguage();
  const myReaction = rec.reactions?.[profileName];
  const reactionCounts: Record<string, number> = {};
  if (rec.reactions) {
    Object.values(rec.reactions).forEach((k) => {
      reactionCounts[k] = (reactionCounts[k] || 0) + 1;
    });
  }

  return (
    <article className="bigscreen-social-card">
      <div className="bigscreen-social-head">
        <div className="bigscreen-social-meta">
          <span className="bigscreen-social-game">{rec.gameName}</span>
          <span className="bigscreen-social-author">
            {t("friendsPage.recommendedByTo", {
              by: rec.recommendedBy,
              to: rec.recommendedTo === "All Friends" ? t("friendsPage.allFriends") : rec.recommendedTo,
            })}
          </span>
        </div>
        <div className="bigscreen-social-head-actions">
          <span className="bigscreen-star-rating" aria-label={t("friendsPage.rating")}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <span key={idx} className={idx < rec.rating ? "active" : ""}>
                ★
              </span>
            ))}
          </span>
          {rec.recommendedBy === profileName && (
            <DeleteOwnButton onDelete={() => void social.handleDeleteRecommendation(rec.id)} />
          )}
        </div>
      </div>

      {rec.reason && <p className="bigscreen-social-reason">"{rec.reason}"</p>}

      <div className="bigscreen-reactions-row">
        {REC_KINDS.map(({ kind, icon, labelKey }) => (
          <ReactionButton
            key={kind}
            icon={icon}
            label={t(labelKey)}
            count={reactionCounts[kind] || 0}
            active={myReaction === kind}
            onToggle={() => void social.handleToggleReaction(rec.id, kind)}
          />
        ))}
        <WantToPlayButton
          active={!!rec.wantToPlay}
          onToggle={() => void social.handleToggleWantToPlay(rec.id)}
        />
      </div>

      <CommentsSection
        count={rec.comments.length}
        comments={rec.comments}
        profileName={profileName}
        onAdd={(text) => void social.handleAddComment(rec.id, text)}
        onDelete={(commentId, authorName) => void social.handleDeleteComment(rec.id, commentId, authorName)}
      />
    </article>
  );
}

// ─── Suggestion card ──────────────────────────────────────────────

const SUG_KINDS: { kind: SuggestionReactionKind; icon: ReactNode; labelKey: string }[] = [
  { kind: "like", icon: Icons.thumbsUp(), labelKey: "bigscreen.friends.reactionLike" },
  { kind: "love", icon: Icons.heart(), labelKey: "bigscreen.friends.reactionLove" },
  { kind: "interest", icon: Icons.fire(), labelKey: "bigscreen.friends.reactionInterest" },
  { kind: "played", icon: Icons.check(), labelKey: "bigscreen.friends.reactionPlayed" },
];

function SuggestionCard({
  sug,
  social,
  profileName,
}: {
  sug: GameSuggestion;
  social: UseFriendsSocialResult;
  profileName: string;
}) {
  const { t } = useLanguage();
  const { wishlist } = useWishlistContext();
  const myReaction = sug.reactions?.[profileName];
  const reactionCounts: Record<string, number> = {};
  if (sug.reactions) {
    Object.values(sug.reactions).forEach((k) => {
      reactionCounts[k] = (reactionCounts[k] || 0) + 1;
    });
  }
  const alreadyWishlisted = wishlist.some((w) => w.slug === sug.gameId);

  return (
    <article className="bigscreen-social-card">
      <div className="bigscreen-social-head">
        {sug.coverUrl ? (
          <img src={sug.coverUrl} alt={sug.gameName} className="bigscreen-social-cover" loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="bigscreen-social-cover bigscreen-social-cover-fallback">
            {sug.gameName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="bigscreen-social-meta">
          <span className="bigscreen-social-game">{sug.gameName}</span>
          <span className="bigscreen-social-author">
            {t("friendsPage.sharedBy", { name: sug.suggestedBy })}{" "}
            {sug.suggestedTo === "All Friends"
              ? t("friendsPage.sharedWithEveryone")
              : t("friendsPage.sharedTo", { name: sug.suggestedTo })}
          </span>
        </div>
        <div className="bigscreen-social-head-actions">
          {sug.suggestedBy === profileName && (
            <DeleteOwnButton onDelete={() => void social.handleDeleteSuggestion(sug.id)} />
          )}
        </div>
      </div>

      {sug.note && <p className="bigscreen-social-reason">"{sug.note}"</p>}

      <div className="bigscreen-reactions-row">
        {SUG_KINDS.map(({ kind, icon, labelKey }) => (
          <ReactionButton
            key={kind}
            icon={icon}
            label={t(labelKey)}
            count={reactionCounts[kind] || 0}
            active={myReaction === kind}
            onToggle={() => void social.handleToggleSuggestionReaction(sug.id, kind)}
          />
        ))}
        <AddWishlistButton
          active={alreadyWishlisted || !!sug.addedToWishlist}
          onActivate={() => void social.handleAddSuggestionToWishlist(sug)}
        />
      </div>

      <CommentsSection
        count={sug.comments.length}
        comments={sug.comments}
        profileName={profileName}
        onAdd={(text) => void social.handleAddSuggestionComment(sug.id, text)}
        onDelete={(commentId, authorName) => void social.handleDeleteSuggestionComment(sug.id, commentId, authorName)}
      />
    </article>
  );
}

// ─── Shared card parts ────────────────────────────────────────────

function DeleteOwnButton({ onDelete }: { onDelete: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onDelete);
  return (
    <button
      type="button"
      className="bigscreen-social-delete"
      aria-label={t("friendsPage.removeRecommendation")}
      title={t("friendsPage.removeRecommendation")}
      {...props}
    >
      {Icons.trash()}
    </button>
  );
}

function ReactionButton({
  icon,
  label,
  count,
  active,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
}) {
  const props = useFocusable(onToggle);
  return (
    <button
      type="button"
      className={`bigscreen-reaction-btn${active ? " active" : ""}`}
      title={label}
      aria-pressed={active}
      {...props}
    >
      <span className="bigscreen-reaction-icon">{icon}</span>
      {count > 0 && <span className="bigscreen-reaction-count">{count}</span>}
    </button>
  );
}

function WantToPlayButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onToggle);
  return (
    <button
      type="button"
      className={`bigscreen-reaction-btn bigscreen-want-btn${active ? " active" : ""}`}
      title={t("friendsPage.addToWantToPlay")}
      aria-pressed={active}
      {...props}
    >
      <span className="bigscreen-reaction-icon">{active ? Icons.check() : Icons.star(true)}</span>
      <span className="bigscreen-want-label">
        {active ? t("friendsPage.wantToPlayAlready") : t("friendsPage.wantToPlayAdd")}
      </span>
    </button>
  );
}

function AddWishlistButton({ active, onActivate }: { active: boolean; onActivate: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onActivate);
  return (
    <button
      type="button"
      className={`bigscreen-reaction-btn bigscreen-want-btn${active ? " active" : ""}`}
      title={active ? t("friendsPage.inWishlistShort") : t("friendsPage.addToMyWishlist")}
      disabled={active}
      {...props}
    >
      <span className="bigscreen-reaction-icon">{active ? Icons.check() : Icons.star(true)}</span>
      <span className="bigscreen-want-label">
        {active ? t("friendsPage.inWishlistShort") : t("friendsPage.addToWishlistShort")}
      </span>
    </button>
  );
}

// ─── Comments ─────────────────────────────────────────────────────

function CommentsSection({
  count,
  comments,
  profileName,
  onAdd,
  onDelete,
}: {
  count: number;
  comments: { id: string; authorName: string; text: string; timestamp: number }[];
  profileName: string;
  onAdd: (text: string) => void;
  onDelete: (commentId: string, authorName: string) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const postProps = useFocusable(() => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  });

  return (
    <div className="bigscreen-comments">
      <div className="bigscreen-comments-title">{t("friendsPage.commentsCount", { count })}</div>
      {comments.length > 0 && (
        <div className="bigscreen-comments-list">
          {comments.map((c) => (
            <div key={c.id} className="bigscreen-comment">
              <span className="bigscreen-comment-author">{c.authorName}</span>
              <span className="bigscreen-comment-text">{c.text}</span>
              <span className="bigscreen-comment-meta">
                <span className="bigscreen-comment-time">{formatLastSeen(Math.floor(c.timestamp / 1000), t)}</span>
                {c.authorName === profileName && (
                  <CommentDeleteButton onDelete={() => onDelete(c.id, c.authorName)} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="bigscreen-comment-input-row">
        <input
          ref={setInputRef}
          type="text"
          className="bigscreen-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("friendsPage.commentPlaceholder")}
          tabIndex={inputProps.tabIndex}
          role={inputProps.role}
          onClick={inputProps.onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") postProps.onClick();
          }}
        />
        <button
          type="button"
          className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
          {...postProps}
        >
          {t("friendsPage.postComment")}
        </button>
      </div>
    </div>
  );
}

function CommentDeleteButton({ onDelete }: { onDelete: () => void }) {
  const { t } = useLanguage();
  const props = useFocusable(onDelete);
  return (
    <button type="button" className="bigscreen-comment-delete" aria-label={t("friendsPage.deleteCommentTitle")} {...props}>
      {Icons.x()}
    </button>
  );
}

// ─── Recommendation composer ──────────────────────────────────────

function RecommendationComposer({
  social,
  onClose,
}: {
  social: UseFriendsSocialResult;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { games } = useGames();
  const [gameId, setGameId] = useState("");
  const [to, setTo] = useState("All Friends");
  const [rating, setRating] = useState(5);
  const [reason, setReason] = useState("");
  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const submitProps = useFocusable(() => {
    void (async () => {
      await social.handleCreateRecommendation({ gameId, to, rating, reason });
      if (gameId && reason.trim()) onClose();
    })();
  });

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-composer-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{t("friendsPage.recommendGame")}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>

        <div className="bigscreen-overlay-drawer-content bigscreen-composer-content">
          <div className="bigscreen-input-group">
            <label>{t("friendsPage.gameLabel")}</label>
            <ComposerGamePicker
              games={games.map((g) => ({ id: g.id, name: g.name }))}
              selectedId={gameId}
              onSelect={setGameId}
              placeholder={t("friendsPage.searchGameRecommend")}
            />
          </div>

          <div className="bigscreen-input-group">
            <label>{t("friendsPage.recommendTo")}</label>
            <FriendSelect
              value={to}
              friends={social.friends}
              allLabel={t("friendsPage.allFriends")}
              onChange={setTo}
            />
          </div>

          <div className="bigscreen-input-group">
            <label>{t("friendsPage.rating")}</label>
            <div className="bigscreen-rating-picker" role="radiogroup" aria-label={t("friendsPage.rating")}>
              {[1, 2, 3, 4, 5].map((star) => (
                <RatingStar key={star} star={star} active={star <= rating} onPick={() => setRating(star)} />
              ))}
            </div>
          </div>

          <div className="bigscreen-input-group">
            <label>{t("friendsPage.recommendWhy")}</label>
            <ComposerNote
              value={reason}
              onChange={setReason}
              placeholder={t("friendsPage.reviewNotesPlaceholder")}
            />
          </div>
        </div>

        <div className="bigscreen-modal-footer">
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
            {...useFocusable(onClose)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
            disabled={!gameId || !reason.trim()}
            {...submitProps}
          >
            {Icons.star(true)}
            {t("friendsPage.recommendCta")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Suggestion composer ──────────────────────────────────────────

function SuggestionComposer({
  social,
  onClose,
}: {
  social: UseFriendsSocialResult;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const { wishlist } = useWishlistContext();
  const [gameId, setGameId] = useState("");
  const [to, setTo] = useState("All Friends");
  const [note, setNote] = useState("");
  const closeProps = useFocusable(onClose);
  useOverlayEscape(onClose);
  const submitProps = useFocusable(() => {
    void (async () => {
      await social.handleCreateSuggestion({ gameId, to, note });
      if (gameId) onClose();
    })();
  });

  return (
    <div
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal bigscreen-composer-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{t("friendsPage.shareGameWishlist")}</h3>
          <button type="button" className="bigscreen-overlay-drawer-close" aria-label={t("common.close")} {...closeProps}>
            {Icons.x()}
          </button>
        </div>

        <div className="bigscreen-overlay-drawer-content bigscreen-composer-content">
          {wishlist.length === 0 ? (
            <div className="system-view-empty">
              <p>{t("friendsPage.noWishlistYet")}</p>
              <p>{t("friendsPage.wishlistEmptyDesc")}</p>
            </div>
          ) : (
            <>
              <div className="bigscreen-input-group">
                <label>{t("friendsPage.gameFromWishlist")}</label>
                <ComposerGamePicker
                  games={wishlist.map((w) => ({ id: w.slug, name: w.name }))}
                  selectedId={gameId}
                  onSelect={setGameId}
                  placeholder={t("friends.selectWishlistedGame")}
                />
              </div>

              <div className="bigscreen-input-group">
                <label>{t("friendsPage.shareWith")}</label>
                <FriendSelect
                  value={to}
                  friends={social.friends}
                  allLabel={t("friendsPage.allFriends")}
                  onChange={setTo}
                />
              </div>

              <div className="bigscreen-input-group">
                <label>{t("friendsPage.shareNoteOptional")}</label>
                <ComposerNote
                  value={note}
                  onChange={setNote}
                  placeholder={t("friendsPage.shareNotePlaceholder")}
                />
              </div>
            </>
          )}
        </div>

        <div className="bigscreen-modal-footer">
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
            {...useFocusable(onClose)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="bigscreen-details-btn bigscreen-details-btn--primary bigscreen-details-btn--compact"
            disabled={!gameId}
            {...submitProps}
          >
            {Icons.heart()}
            {t("friendsPage.shareToFriendsCta")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Composer parts ───────────────────────────────────────────────

function ComposerGamePicker({
  games,
  selectedId,
  onSelect,
  placeholder,
}: {
  games: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const { setInputRef, inputProps } = useFocusableInput<HTMLInputElement>();
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games.slice(0, 8);
    return games.filter((g) => g.name.toLowerCase().includes(q)).slice(0, 8);
  }, [games, query]);

  const selected = games.find((g) => g.id === selectedId);

  if (selected) {
    return (
      <div className="bigscreen-gamepick-selected">
        <span className="bigscreen-gamepick-selected-name">{selected.name}</span>
        <ChangeGameButton onActivate={() => onSelect("")} />
      </div>
    );
  }
  return (
    <div className="bigscreen-gamepick">
      <input
        ref={setInputRef}
        type="text"
        className="bigscreen-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        tabIndex={inputProps.tabIndex}
        role={inputProps.role}
        onClick={inputProps.onClick}
      />
      <div className="bigscreen-gamepick-results">
        {results.map((g) => (
          <GamePickRow key={g.id} name={g.name} onPick={() => onSelect(g.id)} />
        ))}
      </div>
    </div>
  );
}

function GamePickRow({ name, onPick }: { name: string; onPick: () => void }) {
  const rowProps = useFocusable(onPick);
  return (
    <button type="button" className="bigscreen-gamepick-row" {...rowProps}>
      {name}
    </button>
  );
}

function ChangeGameButton({ onActivate }: { onActivate: () => void }) {
  const { t } = useLanguage();
  const btnProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className="bigscreen-details-btn bigscreen-details-btn--secondary bigscreen-details-btn--compact"
      {...btnProps}
    >
      {t("common.change")}
    </button>
  );
}

function FriendSelect({
  value,
  friends,
  allLabel,
  onChange,
}: {
  value: string;
  friends: { id: string; name: string; nickname?: string }[];
  allLabel: string;
  onChange: (v: string) => void;
}) {
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
    >
      <option value="All Friends">{allLabel}</option>
      {friends.map((f) => (
        <option key={f.id} value={f.nickname?.trim() || f.name}>
          {f.nickname?.trim() || f.name}
        </option>
      ))}
    </select>
  );
}

function RatingStar({ star, active, onPick }: { star: number; active: boolean; onPick: () => void }) {
  const props = useFocusable(onPick);
  return (
    <button
      type="button"
      className={`bigscreen-rating-star${active ? " active" : ""}`}
      aria-label={String(star)}
      {...props}
    >
      ★
    </button>
  );
}

function ComposerNote({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { setInputRef, inputProps } = useFocusableInput<HTMLTextAreaElement>();
  return (
    <textarea
      ref={setInputRef}
      className="bigscreen-input bigscreen-input--textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      tabIndex={inputProps.tabIndex}
      role={inputProps.role}
      onClick={inputProps.onClick}
    />
  );
}
