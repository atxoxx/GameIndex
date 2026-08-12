import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { SteamStatsPopoverBody } from "./SteamPlayerCountPopover";
import { useLanguage } from "../context/LanguageContext";

/**
 * PlayerCountPopover
 *
 *  Click-to-expand companion to the `<PlayerCountBadge>`.
 *  One anchored card with a Steam tab: live count, aggregate review
 *  breakdown, 24h player activity sparkline, "View on Steam" link
 *  (`SteamStatsPopoverBody`, shared with the legacy Steam-only
 *  popover).
 *
 *  The header shows the combined total so the badge and popover agree
 *  at click time.
 *
 *  Positioning, dismissal, and accessibility mirror
 *  `SteamPlayerCountPopover` exactly (portal into body, anchor-flip +
 *  viewport clamp, Escape / click-outside / X to close, dialog
 *  semantics, focus restore). Reuses the `steam-stats-popover` CSS
 *  skeleton; the tab strip is the only new block.
 */

interface PlayerCountPopoverProps {
  appId: number;
  /** Ref to the badge element the popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Live Steam count captured from the badge (0 when none). */
  steamCount: number;
  onClose: () => void;
}

type StatsTab = "steam" | "hydra";

const VIEWPORT_MARGIN = 12;
/** Fallback width for the first-paint position pass, before the
 *  browser has measured the rendered popover (canonical width lives
 *  in `store.css` on `.steam-stats-popover`). */
const FALLBACK_WIDTH_PX = 420;

export default function PlayerCountPopover({
  appId,
  anchorRef,
  steamCount,
  onClose,
}: PlayerCountPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  // Keep the latest onClose in a ref so the global keydown / mousedown
  // handlers (registered once on mount) always call the freshest
  // version without re-binding on every parent render.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const total = steamCount;

  const [tab, setTab] = useState<StatsTab>("steam");

  // ── Position state ──────────────────────────────────────────────
  // Same anchor-flip + viewport-clamp math as SteamPlayerCountPopover.
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

      // Vertical: open below the anchor (top-aligned) when there's
      // room; otherwise flip above (bottom-aligned to the anchor's
      // top) so the popover never gets clipped by the viewport
      // bottom. Matters now that the historical chart can make the
      // card tall.
      const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      let top: number;
      if (popHeight <= spaceBelow) {
        top = rect.top;
      } else if (popHeight <= spaceAbove) {
        top = rect.top - popHeight;
      } else {
        // Doesn't fit either side — pin to the bottom edge, best effort.
        top = Math.max(VIEWPORT_MARGIN, vh - popHeight - VIEWPORT_MARGIN);
      }

      setPosition({ top, left, growFromLeft });
    }

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    // The chart fetches asynchronously and grows the popover after
    // mount; re-clamp whenever its measured height changes so it never
    // ends up clipped at the bottom.
    const ro = new ResizeObserver(recompute);
    if (popoverRef.current) ro.observe(popoverRef.current);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
      ro.disconnect();
    };
    // anchorRef is a stable ref object — intentionally excluded.
    // `tab` included so switching tabs (content height changes)
    // re-clamps against the bottom of the viewport.
  }, [anchorRef, tab]);

  // ── Focus capture + global dismissal ────────────────────────────
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
    // anchorRef intentionally excluded (stable ref).
  }, [anchorRef]);

  const { t } = useLanguage();

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`.trim()}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label={t("playerStats.aria")}
    >
      {/* ── Header — combined total, agrees with the badge. ──────── */}
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <span className="steam-stats-popover-header-dot" />
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">
            {total.toLocaleString()} playing now
          </div>
          <div className="steam-stats-popover-header-subtitle">
            {steamCount.toLocaleString()} Steam
          </div>
        </div>
        <button
          type="button"
          className="steam-stats-popover-close"
          onClick={onClose}
          aria-label={t("playerStats.closeAria")}
          title={t("common.close")}
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

      {/* ── Source tabs ───────────────────────────────────────────── */}
      <div className="player-stats-tabs" role="tablist" aria-label={t("playerStats.sourceAria")}>
        <button
          type="button"
          role="tab"
          id="player-stats-tab-steam"
          aria-selected={tab === "steam"}
          aria-controls="player-stats-panel-steam"
          className={`player-stats-tab player-stats-tab--steam ${tab === "steam" ? "is-active" : ""}`.trim()}
          onClick={() => setTab("steam")}
        >
          <span className="player-stats-tab-dot" aria-hidden="true" />
          Steam
        </button>
      </div>

      {/* ── Tab panel — body shared with the single-source popover,
          so content and styling stay in lockstep. ─────────────────── */}
      {tab === "steam" ? (
        <div
          role="tabpanel"
          id="player-stats-panel-steam"
          aria-labelledby="player-stats-tab-steam"
        >
          <SteamStatsPopoverBody appId={appId} currentCount={steamCount} />
        </div>
      ) : null}
    </div>,
    document.body
  );
}
