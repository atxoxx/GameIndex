import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { SteamGameReviews } from "../types/game";
import { useSteamGameStats } from "../hooks/useSteamGameStats";
import { useLanguage } from "../context/LanguageContext";
import SteamPlayerHistoryChart from "./SteamPlayerHistoryChart";

/**
 * SteamPlayerCountPopover
 *
 *  Click-to-expand companion to `<SteamPlayerCount>`. Renders a compact
 *  anchored card next to the badge with three layers of info:
 *
 *   1. **Live current players** — pulled from the parent's count so
 *      the badge and the popover header agree at click time.
 *   2. **Aggregate review breakdown** — positive/total ratio as a
 *      horizontal bar with Steam's qualitative label ("Very Positive",
 *      "Mixed", …) and the raw counts underneath.
 *   3. **Player activity (24h)** — compact sparkline + Peak / Avg /
 *      Samples summary so the user gets the trend without leaving the
 *      popover.
 *
 *  Static metadata (developer / publisher / release date / price) was
 *  moved off the popover:
 *    - Developer / publisher / release date live on the Game page
 *      Info card (more appropriate context, doesn't compete with the
 *      sparkline for vertical space).
 *    - Price is rendered as the 4th KPI tile in `InfoKpiCard` next
 *      to Status / Play Time / Size, fetched via the same shared
 *      `useSteamGameStats` hook.
 *
 *  All three popover sections are populated by a single
 *  `get_steam_game_stats` Tauri command so the IPC round-trip is one
 *  and the two HTTP fetches fan out in parallel on the Rust side.
 *  Each section degrades independently — a Steam hiccup on
 *  `appdetails` blanks only the dependent data, leaving the live
 *  count and reviews intact.
 *
 *  Positioning & dismissal
 *  ───────────────────────
 *  - Rendered into `document.body` via a React portal so the popover
 *    is never clipped by the banner's `overflow: hidden` (every
 *    surface this lives on has one).
 *  - Anchored to the badge by `anchorRef`. Position is recomputed on
 *    mount, window resize, and any scroll so the card stays pinned
 *    to the badge as the user scrolls the page.
 *  - Flips horizontally when the badge sits close to the right edge
 *    of the viewport (typical on the Game page where the banner is
 *    full-width) and clamps against the viewport edges with a 12px
 *    margin so it never sticks flush to a side.
 *  - Dismissed by clicking outside the popover + anchor, by pressing
 *    Escape, or by clicking the X in the header.
 *
 *  Accessibility
 *  ─────────────
 *  - `role="dialog"` + `aria-modal="true"` so screen readers
 *    announce it as a modal even though there's no full-page backdrop.
 *  - Focus moves to the close button on open and is restored to the
 *    badge on close so keyboard users don't lose their place.
 *  - The live count is `aria-live="polite"` so an updated number
 *    doesn't interrupt the user's screen-reader flow.
 */

interface SteamPlayerCountPopoverProps {
  appId: number;
  /** Ref to the badge element the popover anchors to. Must be the
   *  same ref used by the click handler so click-outside detection,
   *  position recalc, and focus restoration all read from a single
   *  element. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Current count, captured at click time from the parent. Re-using
   *  the parent's number instead of awaiting the backend's `current`
   *  field keeps the popover header in lockstep with the badge. */
  currentCount: number;
  onClose: () => void;
}

/**
 * SteamStatsPopoverBody
 * ─────────────────────
 * The Steam sections of the popover (live count, review breakdown,
 * 24h activity sparkline, "View on Steam" footer link), extracted so
 * the `PlayerCountPopover` can render them as
 * its Steam tab without duplicating the fetch/derive logic. Owns its
 * own `useSteamGameStats` call — the hook + Rust cache dedupe repeat
 * fetches, so embedding is free.
 */
export function SteamStatsPopoverBody({
  appId,
  currentCount,
}: {
  appId: number;
  /** Live Steam count from the parent badge (0 when Steam has none). */
  currentCount: number;
}) {
  const {
    data: stats,
    isLoading: statsLoading,
    error: fetchError,
  } = useSteamGameStats(appId);
  const { t } = useLanguage();

  const reviewsLoading = statsLoading;

  // Memoize positive-percent
  const reviewPositivePct = useMemo(() => {
    if (!stats?.reviews) return null;
    const total = stats.reviews.totalReviews;
    if (total <= 0) return null;
    return Math.round((stats.reviews.totalPositive / total) * 100);
  }, [stats?.reviews]);

  // Review score tone tier: 7+ = good (green), 5-6 = mid (amber), <=4 = bad (red)
  const reviewTone = useMemo<"good" | "mid" | "bad" | "none">(() => {
    const s = stats?.reviews?.score;
    if (s == null || s === 0) return "none";
    if (s >= 7) return "good";
    if (s >= 5) return "mid";
    return "bad";
  }, [stats?.reviews?.score]);

  const reviewSummary: SteamGameReviews | null = stats?.reviews ?? null;
  const details = stats?.details ?? null;

  return (
    <>
      <div className="steam-stats-popover-body">
        {/* Steam Hero Banner Card — Live Player Count + Review Summary */}
        <div className="steam-stats-hero-banner">
          <div className="steam-stats-hero-row">
            <div className="steam-stats-live-badge">
              <span className="steam-stats-live-dot" aria-hidden="true" />
              <div className="steam-stats-live-info">
                <span
                  className="steam-stats-live-count"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {currentCount > 0 ? currentCount.toLocaleString() : "—"}
                </span>
                <span className="steam-stats-live-label">
                  {t("steamPlayer.playingNow")}
                </span>
              </div>
            </div>

            {reviewsLoading ? (
              <span className="steam-stats-popover-skeleton-pill" />
            ) : reviewSummary ? (
              <span
                className={`steam-stats-popover-section-badge steam-stats-popover-tone-${reviewTone}`}
              >
                {reviewSummary.scoreDesc ?? t("steamPlayer.unrated")}
              </span>
            ) : (
              <span className="steam-stats-popover-section-empty">—</span>
            )}
          </div>

          {/* Review breakdown progress bar */}
          {reviewsLoading ? (
            <div className="steam-stats-popover-skeleton-bar" />
          ) : reviewSummary ? (
            <div className="steam-stats-hero-reviews">
              <div
                className={`steam-stats-popover-reviews-bar steam-stats-popover-tone-${reviewTone}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={reviewPositivePct ?? 0}
                aria-label={t("steamPlayer.positiveReviewsAria", { pct: reviewPositivePct ?? 0 })}
              >
                <div
                  className="steam-stats-popover-reviews-bar-fill"
                  style={{ width: `${reviewPositivePct ?? 0}%` }}
                />
              </div>
              <div className="steam-stats-popover-reviews-count">
                <strong>{reviewPositivePct ?? 0}%</strong> {t("steamPlayer.positive")}
                <span className="steam-stats-popover-reviews-count-sep">·</span>
                {reviewSummary.totalReviews.toLocaleString()} {t("steamPlayer.total")}
              </div>
            </div>
          ) : (
            <div className="steam-stats-popover-section-error">
              {stats?.reviewsError ?? t("steamPlayer.noReviewData")}
            </div>
          )}

          {/* Optional meta row if genres / pricing are available */}
          {details && (details.genres.length > 0 || details.releaseDate) && (
            <div className="steam-stats-hero-meta">
              {details.genres.slice(0, 3).map((g) => (
                <span key={g} className="steam-stats-hero-tag">
                  {g}
                </span>
              ))}
              {details.releaseDate && (
                <span className="steam-stats-hero-date">
                  {details.releaseDate}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Player activity — historical line chart */}
        <SteamPlayerHistoryChart appId={appId} />

        {/* If the whole fetch failed (e.g. offline), surface a single inline message */}
        {fetchError && !stats && (
          <div className="steam-stats-popover-fetch-error" role="alert">
            {t("steamPlayer.reachError")}
          </div>
        )}
      </div>

      <footer className="steam-stats-popover-footer">
        <div className="steam-stats-popover-footer-actions">
          <a
            href={`https://store.steampowered.com/app/${appId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="steam-stats-popover-footer-link"
            title="Open Steam Store Page"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {t("steamPlayer.viewOnSteam")}
          </a>
          <a
            href={`https://steamcommunity.com/app/${appId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="steam-stats-popover-footer-link secondary"
            title="Open Steam Community Hub"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {t("steamPlayer.communityHub") || "Community Hub"}
          </a>
          <a
            href={`https://steamdb.info/app/${appId}/charts/`}
            target="_blank"
            rel="noopener noreferrer"
            className="steam-stats-popover-footer-link secondary"
            title="Open SteamDB Charts"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            {t("steamPlayer.steamDb") || "SteamDB"}
          </a>
        </div>
      </footer>
    </>
  );
}

const VIEWPORT_MARGIN = 12;
const FALLBACK_WIDTH_PX = 440;

export default function SteamPlayerCountPopover({
  appId,
  anchorRef,
  currentCount,
  onClose,
}: SteamPlayerCountPopoverProps) {
  const { t } = useLanguage();
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ── Position state ─────────────────────────────────────────────────
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    growFromLeft: boolean;
  }>({ top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN, growFromLeft: true });

  useLayoutEffect(() => {
    function recompute() {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const rect = anchor.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const popWidth = popRect.width || FALLBACK_WIDTH_PX;
      const popHeight = popRect.height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const spaceRight = vw - rect.right - VIEWPORT_MARGIN;
      const spaceLeft = rect.left - VIEWPORT_MARGIN;
      let left: number;
      let growFromLeft: boolean;
      if (spaceRight >= popWidth) {
        left = rect.right + 6;
        growFromLeft = true;
      } else if (spaceLeft >= popWidth) {
        left = rect.left - popWidth - 6;
        growFromLeft = false;
      } else if (spaceRight >= spaceLeft) {
        left = rect.right + 6;
        growFromLeft = true;
      } else {
        left = rect.left - popWidth - 6;
        growFromLeft = false;
      }
      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, vw - popWidth - VIEWPORT_MARGIN)
      );

      const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      let top: number;
      if (popHeight <= spaceBelow) {
        top = rect.top;
      } else if (popHeight <= spaceAbove) {
        top = rect.top - popHeight;
      } else {
        top = Math.max(VIEWPORT_MARGIN, vh - popHeight - VIEWPORT_MARGIN);
      }

      setPosition({ top, left, growFromLeft });
    }

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    const ro = new ResizeObserver(recompute);
    if (popoverRef.current) ro.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
      ro.disconnect();
    };
  }, [anchorRef]);

  // ── Focus capture + global dismissal ────────────────────────────────
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    requestAnimationFrame(() => {
      const target =
        popoverRef.current?.querySelector<HTMLElement>(
          ".steam-stats-popover-close"
        ) ?? popoverRef.current;
      target?.focus();
    });

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    }
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    }

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handlePointerDown);
      previouslyFocused?.focus();
    };
  }, [anchorRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label={t("steamPlayer.steamStatsTitle")}
    >
      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            className="steam-brand-icon"
          >
            <path d="M12 2a10 10 0 0 0-10 10c0 4.7 3.25 8.65 7.66 9.7l2.84-4.14a2.98 2.98 0 0 1-.5-.06l-3.23-1.32a3.02 3.02 0 0 1-1.77-2.78c0-1.66 1.34-3 3-3 .76 0 1.45.28 1.99.75l3.24-1.32c.1-.8.5-1.5 1.12-2.02A4.5 4.5 0 0 1 21 12.5a4.5 4.5 0 0 1-4.5 4.5c-.75 0-1.46-.19-2.08-.52l-2.42 3.52c4.4-.38 7.84-4.08 7.84-8.6A10 10 0 0 0 12 2zm4.5 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
          </svg>
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">
            {t("steamPlayer.steam")} · {t("steamPlayer.livePlayerStats")}
          </div>
          <div className="steam-stats-popover-header-subtitle">
            App ID: {appId}
          </div>
        </div>
        <button
          type="button"
          className="steam-stats-popover-close"
          onClick={onClose}
          aria-label={t("steamPlayer.closeStatsAria")}
          title={t("steamPlayer.close")}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      {/* ── Body + footer ─────────────────────────────────────────── */}
      <SteamStatsPopoverBody appId={appId} currentCount={currentCount} />
    </div>,
    document.body
  );
}
