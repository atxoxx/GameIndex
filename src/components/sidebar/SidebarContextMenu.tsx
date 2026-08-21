import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS, type PlayStatus } from "../../types/game";
import type { SidebarContextMenuProps } from "./types";

const STATUS_ORDER: PlayStatus[] = ["backlog", "playing", "completed", "on_hold", "abandoned"];

/**
 * SidebarContextMenu
 * ──────────────────
 * Portaled context menu displayed when right-clicking a game row in the sidebar.
 * Features viewport edge boundary calculation and a portaled play-status submenu.
 */
export default function SidebarContextMenu({
  x,
  y,
  game,
  isRunning,
  isPinned,
  onLaunch,
  onViewDetails,
  onRemove,
  onTogglePin,
  onSetStatus,
  onShowInFolder,
  onOpenStore,
  onCopyPath,
}: SidebarContextMenuProps) {
  const { t } = useLanguage();
  const menuWidth = 230;
  const menuHeight = 360;
  const adjustedX = window.innerWidth - x < menuWidth ? Math.max(8, x - menuWidth) : x;
  const adjustedY = window.innerHeight - y < menuHeight ? Math.max(8, y - menuHeight) : y;

  const [statusOpen, setStatusOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const hasSubmenuRef = useRef<HTMLDivElement>(null);

  function toggleStatusSubmenu() {
    setStatusOpen((prev) => {
      const next = !prev;
      if (next && hasSubmenuRef.current) {
        const rect = hasSubmenuRef.current.getBoundingClientRect();
        const SUBMENU_MIN_WIDTH = 168;
        const PAGE_MARGIN = 8;
        let left = rect.right + 4;
        if (left + SUBMENU_MIN_WIDTH > window.innerWidth - PAGE_MARGIN) {
          left = Math.max(PAGE_MARGIN, rect.left - SUBMENU_MIN_WIDTH - 4);
        }
        let top = rect.top;
        const ESTIMATED_SUBMENU_HEIGHT = 156;
        if (top + ESTIMATED_SUBMENU_HEIGHT > window.innerHeight - PAGE_MARGIN) {
          top = Math.max(PAGE_MARGIN, window.innerHeight - ESTIMATED_SUBMENU_HEIGHT - PAGE_MARGIN);
        }
        setSubmenuPos({ top, left });
      }
      return next;
    });
  }

  return (
    <div
      className="context-menu"
      data-sidebar-context-menu="true"
      style={{ left: adjustedX, top: adjustedY, zIndex: "var(--z-sticky)" }}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      aria-label={game.name}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">{game.name}</span>
      </div>

      <button
        type="button"
        className="context-menu-item play-action"
        onClick={onLaunch}
        disabled={isRunning}
        role="menuitem"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {isRunning ? t("game.running") : t("game.playGame")}
      </button>

      <button
        type="button"
        className="context-menu-item"
        onClick={onViewDetails}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {t("game.viewDetails")}
      </button>

      <button
        type="button"
        className="context-menu-item"
        onClick={onTogglePin}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill={isPinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
        </svg>
        {isPinned ? t("sidebar.unpin") : t("sidebar.pinToTop")}
      </button>

      <div
        ref={hasSubmenuRef}
        className={`context-menu-item has-submenu${statusOpen ? " submenu-open" : ""}`}
        onClick={toggleStatusSubmenu}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleStatusSubmenu();
          }
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21.64 3-2.28 2.28" />
          <path d="M3 21l9-9" />
          <path d="M14.5 6.5 21 13" />
          <circle cx="9" cy="7" r="3" />
        </svg>
        {t("sidebar.setStatus")}
      </div>

      {statusOpen && submenuPos &&
        createPortal(
          <div
            className="sidebar-context-submenu open"
            data-sidebar-context-menu="true"
            style={{
              position: "fixed",
              top: submenuPos.top,
              left: submenuPos.left,
              zIndex: "calc(var(--z-sticky) + 1)",
            }}
            role="menu"
            aria-label={t("sidebar.playStatusOptions")}
          >
            {STATUS_ORDER.map((s) => {
              const meta = PLAY_STATUS_DETAILS[s];
              const active = (game.playStatus || "backlog") === s;
              return (
                <button
                  key={s}
                  type="button"
                  className={`sidebar-context-submenu__item${active ? " active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetStatus(s);
                  }}
                  role="menuitem"
                >
                  <span className="dot" style={{ background: meta.color }} aria-hidden="true" />
                  {t(meta.labelKey)}
                </button>
              );
            })}
          </div>,
          document.body
        )}

      <button
        type="button"
        className="context-menu-item"
        onClick={onShowInFolder}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        {t("sidebar.showInFolder")}
      </button>

      <button
        type="button"
        className="context-menu-item"
        onClick={onOpenStore}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
        {t("sidebar.openInStore")}
      </button>

      <button
        type="button"
        className="context-menu-item"
        onClick={onCopyPath}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
        {t("sidebar.copyPath")}
      </button>

      <div className="context-menu-separator" />

      <button
        type="button"
        className="context-menu-item remove-action"
        onClick={onRemove}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {t("sidebar.removeFromLibrary")}
      </button>
    </div>
  );
}
