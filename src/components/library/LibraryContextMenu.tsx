import type { Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  onLaunch: () => void;
  onViewDetails: () => void;
  onRemove: () => void;
}

/**
 * Right-click menu for a library grid card. Reuses the shared
 * `.context-menu` styling (defined in game-page.css / sidebar.css) so the
 * look matches the sidebar's context menu. Clamped to the viewport so a
 * menu opened at the bottom-right edge never clips off-screen.
 */
export default function LibraryContextMenu({
  x,
  y,
  game,
  isRunning,
  onLaunch,
  onViewDetails,
  onRemove,
}: LibraryContextMenuProps) {
  const { t } = useLanguage();
  const menuWidth = 190;
  const menuHeight = 130;
  const adjustedX = window.innerWidth - x < menuWidth ? x - menuWidth : x;
  const adjustedY = window.innerHeight - y < menuHeight ? y - menuHeight : y;

  return (
    <div
      className="context-menu lib-context-menu"
      style={{ left: adjustedX, top: adjustedY, zIndex: 9200 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-header">
        <span className="context-menu-title">{game.name}</span>
        <span className="lib-context-menu__platform">{game.platform}</span>
      </div>
      <button className="context-menu-item play-action" onClick={onLaunch} disabled={isRunning}>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        {isRunning ? t("game.running") : t("game.playGame")}
      </button>
      <button className="context-menu-item" onClick={onViewDetails}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        {t("game.viewDetails")}
      </button>
      <div className="context-menu-separator" />
      <button className="context-menu-item remove-action" onClick={onRemove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        {t("game.remove")}
      </button>
    </div>
  );
}
