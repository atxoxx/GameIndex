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
 * Click-to-expand companion to `<PlayerCountBadge>`.
 * Shows live Steam player count, aggregate review breakdown,
 * 24h-180d historical CCU activity sparkline/chart, and quick
 * links to Steam Store, Steam Community Hub, and SteamDB.
 */

interface PlayerCountPopoverProps {
  appId: number;
  /** Ref to the badge element the popover anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Live Steam count captured from the badge (0 when none). */
  steamCount: number;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 12;
const FALLBACK_WIDTH_PX = 440;

export default function PlayerCountPopover({
  appId,
  anchorRef,
  steamCount,
  onClose,
}: PlayerCountPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const { t } = useLanguage();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // ── Position state ──────────────────────────────────────────────
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
  }, [anchorRef]);

  return createPortal(
    <div
      ref={popoverRef}
      className={`steam-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`.trim()}
      style={{ top: position.top, left: position.left }}
      role="dialog"
      aria-modal="true"
      aria-label={t("playerStats.aria")}
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

      {/* ── Popover Body ─────────────────────────────────────────── */}
      <SteamStatsPopoverBody appId={appId} currentCount={steamCount} />
    </div>,
    document.body
  );
}
