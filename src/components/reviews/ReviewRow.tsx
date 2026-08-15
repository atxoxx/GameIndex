import { useMemo, useState } from "react";
import { type ReviewItem } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { BbCodeRenderer } from "./BbCodeRenderer";
import { getHardwareLines } from "./hardwareParser";
import {
  type SteamReaction,
  formatPlayTime,
  reactionImagePath,
  STEAM_REACTIONS,
} from "../../types/game";

const STEAM_PROFILE_URL = "https://steamcommunity.com/profiles";

interface ReviewRowProps {
  review: ReviewItem;
  appId: number | null;
  searchQuery?: string;
}

function ThumbBadge({ sentiment }: { sentiment: ReviewItem["sentiment"] }) {
  const { t } = useLanguage();
  if (sentiment !== "positive" && sentiment !== "negative") return null;
  const isPos = sentiment === "positive";
  const thumbPath =
    "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";

  return (
    <div className={`rv-thumb-badge${isPos ? " rv-thumb-pos" : " rv-thumb-neg"}`}>
      <svg className="rv-thumb-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {isPos ? (
          <path d={thumbPath} />
        ) : (
          <path transform="translate(0 24) scale(1 -1)" d={thumbPath} />
        )}
      </svg>
      <span className="rv-thumb-label">{isPos ? t("review.recommended") : t("review.notRecommended")}</span>
    </div>
  );
}

function ReactionBadge({ reactionType, count }: { reactionType: number; count: number }) {
  const [imgErr, setImgErr] = useState(false);
  const meta = STEAM_REACTIONS[reactionType] ?? { emoji: "❓", label: `Reaction ${reactionType}`, description: "" };
  const imgPath = reactionImagePath(reactionType);

  return (
    <span className="rv-reaction-badge" title={`${meta.label}: ${count.toLocaleString()}`}>
      {imgPath && !imgErr ? (
        <img
          className="rv-reaction-img"
          src={imgPath}
          alt={meta.label}
          onError={() => setImgErr(true)}
        />
      ) : (
        <span className="rv-reaction-emoji">{meta.emoji}</span>
      )}
      <span className="rv-reaction-count">{count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</span>
    </span>
  );
}

function ReactionBar({ review }: { review: ReviewItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasVotesUp = (review.votesUp ?? 0) > 0;
  const hasVotesFunny = (review.votesFunny ?? 0) > 0;
  const reactions = review.reactions ?? [];

  const augmented: SteamReaction[] = useMemo(() => {
    const seen = new Set(reactions.map((r) => r.reactionType));
    const list = [...reactions];
    if (hasVotesUp && !seen.has(1)) list.push({ reactionType: 1, count: review.votesUp ?? 0 });
    if (hasVotesFunny && !seen.has(3)) list.push({ reactionType: 3, count: review.votesFunny ?? 0 });
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [reactions, hasVotesUp, hasVotesFunny, review.votesUp, review.votesFunny]);

  if (augmented.length === 0) return null;
  const visible = expanded ? augmented : augmented.slice(0, 4);

  return (
    <div className="rv-card-reactions">
      {visible.map((r) => (
        <ReactionBadge key={r.reactionType} reactionType={r.reactionType} count={r.count} />
      ))}
      {augmented.length > 4 && !expanded && (
        <button
          type="button"
          className="rv-reaction-show-more"
          onClick={() => setExpanded(true)}
          title="Show all reactions"
        >
          +{augmented.length - 4} more
        </button>
      )}
    </div>
  );
}

function HardwareSpecs({ hw }: { hw: ReviewItem["hw"] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => getHardwareLines(hw), [hw]);
  if (lines.length === 0) return null;

  return (
    <div className="rv-hw-specs-wrapper">
      <button
        type="button"
        className="rv-hw-specs-toggle"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>{t("reviewsTab.hardwareSpecs")}</span>
        <svg className={`rv-expand-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="rv-hw-specs">
          <ul>
            {lines.map((line) => (
              <li key={line.label}>
                <span className="rv-hw-specs-key">{line.label}</span>
                <span className="rv-hw-specs-value">{line.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatShortDate(ts?: number): string {
  if (!ts) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function ReviewRow({ review, appId, searchQuery }: ReviewRowProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const isSteam = review.source === "steam";
  const username = review.username || "Steam Player";
  const profileUrl =
    isSteam && review.authorSteamId
      ? `${STEAM_PROFILE_URL}/${review.authorSteamId}/`
      : null;

  const handleCopyReview = async () => {
    try {
      await navigator.clipboard.writeText(review.content);
      showToast(t("reviewsTab.reviewCopiedToast"), "info");
    } catch {
      // ignore
    }
  };

  const isLong = review.content.length > 420;

  return (
    <article className={`rv-row rv-source-${review.source}`}>
      {/* ── Row Header ── */}
      <div className="rv-row-header">
        <ThumbBadge sentiment={review.sentiment} />

        <div className="rv-row-meta">
          <div className="rv-row-name-row">
            {profileUrl ? (
              <a
                className="rv-row-name"
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${username}'s Steam profile`}
              >
                {username}
              </a>
            ) : (
              <span className="rv-row-name">{username}</span>
            )}
          </div>

          <div className="rv-row-details">
            {review.authorPlaytimeAtReview !== undefined && (
              <span className="rv-row-pill" title={t("reviews.playtimeAtReview")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatPlayTime(review.authorPlaytimeAtReview)} on record
              </span>
            )}
            {review.authorPlaytimeForever !== undefined && (
              <span className="rv-row-pill rv-row-pill-muted" title={t("reviews.totalPlaytimeAll")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                {formatPlayTime(review.authorPlaytimeForever)} total
              </span>
            )}
            {review.dateAdded && (
              <span className="rv-row-date">{formatShortDate(review.dateAdded)}</span>
            )}
          </div>

          {/* Badges Row */}
          <div className="rv-row-badges">
            {review.steamPurchase !== undefined && (
              <span
                className={`rv-row-icon-btn${review.steamPurchase ? " rv-row-icon-btn-on" : ""}`}
                title={review.steamPurchase ? t("review.steamPurchase") : t("review.otherSources")}
              >
                {review.steamPurchase ? "☑ " + t("review.steamPurchase") : "☐ " + t("review.otherSources")}
              </span>
            )}
            {review.primarilySteamDeck && (
              <span className="rv-context-badge rv-context-badge-info" title={t("reviews.playedMostlySteamDeck")}>
                🎮 {t("review.playedOnSteamDeck")}
              </span>
            )}
            {review.receivedForFree && (
              <span className="rv-row-badge-free">{t("review.productReceivedFree")}</span>
            )}
            {review.writtenDuringEarlyAccess && (
              <span className="rv-row-badge-ea">{t("review.earlyAccessReview")}</span>
            )}
          </div>
        </div>

        {/* Quick action: Copy review */}
        <div className="rv-row-top-actions">
          <button
            type="button"
            className="rv-copy-review-btn"
            onClick={handleCopyReview}
            title={t("reviewsTab.copyReviewText")}
            aria-label={t("reviewsTab.copyReviewText")}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      {review.title && <h3 className="rv-row-title">{review.title}</h3>}
      {review.content && (
        <div className="rv-row-body">
          <div className={`rv-row-content${!expanded && isLong ? " clamp" : ""}`}>
            <BbCodeRenderer text={review.content} highlightQuery={searchQuery} />
          </div>
          {isLong && (
            <button
              type="button"
              className="rv-expand-btn"
              onClick={() => setExpanded((p) => !p)}
              aria-expanded={expanded}
            >
              {t(expanded ? "review.showLess" : "review.showMore")}
              <svg
                className={`rv-expand-chevron${expanded ? " open" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="rv-row-footer">
        <div className="rv-row-helpful">
          {(review.votesUp ?? 0) > 0 && (
            <span className="rv-helpful-text">
              👍 {t("review.foundHelpful", { count: (review.votesUp ?? 0).toLocaleString() })}
            </span>
          )}
          {(review.votesFunny ?? 0) > 0 && (
            <span className="rv-helpful-text">
              😄 {t("review.foundFunny", { count: (review.votesFunny ?? 0).toLocaleString() })}
            </span>
          )}
        </div>

        {Boolean(review.commentCount && review.commentCount > 0 && review.authorSteamId && appId) && (
          <a
            className="rv-card-comments-link"
            href={`https://steamcommunity.com/profiles/${review.authorSteamId}/recommended/${appId}/`}
            target="_blank"
            rel="noopener noreferrer"
            title={`${review.commentCount} comments on Steam`}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {review.commentCount?.toLocaleString()} comments
          </a>
        )}
      </div>

      <ReactionBar review={review} />
      <HardwareSpecs hw={review.hw} />
    </article>
  );
}
