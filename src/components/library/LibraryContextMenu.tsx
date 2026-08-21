import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game, PlayStatus } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";

interface LibraryContextMenuProps {
  x: number;
  y: number;
  game: Game;
  isRunning: boolean;
  onLaunch: () => void;
  onViewDetails: () => void;
  onUpdatePlayStatus?: (gameId: string, status: PlayStatus) => void;
  onRemove: () => void;
}

const STATUS_KEYS: PlayStatus[] = ["playing", "completed", "backlog", "on_hold", "abandoned"];

export default function LibraryContextMenu({
  x,
  y,
  game,
  isRunning,
  onLaunch,
  onViewDetails,
  onUpdatePlayStatus,
  onRemove,
}: LibraryContextMenuProps) {
  const { t } = useLanguage();
  const [showStatusSubmenu, setShowStatusSubmenu] = useState(false);

  const menuWidth = 220;
  const menuHeight = 220;
  const adjustedX = window.innerWidth - x < menuWidth ? Math.max(10, x - menuWidth) : x;
  const adjustedY = window.innerHeight - y < menuHeight ? Math.max(10, y - menuHeight) : y;

  const handleOpenFolder = async () => {
    if (!game.path) return;
    try {
      await invoke("open_folder", { path: game.path });
    } catch (err) {
      console.warn("Failed to open folder for game:", err);
    }
  };

  return (
    <div
      className="context-menu lib-context-menu"
      style={{ left: adjustedX, top: adjustedY, zIndex: "var(--z-sticky)" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="context-menu-header">
        <span className="context-menu-title" title={game.name}>{game.name}</span>
        <span className="lib-context-menu__platform">{game.platform}</span>
      </div>

      <button
        type="button"
        className="context-menu-item play-action"
        onClick={onLaunch}
        disabled={isRunning}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>{isRunning ? t("game.running") : t("game.playGame")}</span>
      </button>

      <button type="button" className="context-menu-item" onClick={onViewDetails}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{t("game.viewDetails")}</span>
      </button>

      {onUpdatePlayStatus && (
        <div
          className="context-menu-submenu-trigger-wrap"
          onMouseEnter={() => setShowStatusSubmenu(true)}
          onMouseLeave={() => setShowStatusSubmenu(false)}
        >
          <button type="button" className="context-menu-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span>{t("library.context.markStatus")}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" style={{ marginLeft: "auto" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {showStatusSubmenu && (
            <div className="context-menu lib-context-submenu">
              {STATUS_KEYS.map((status) => {
                const meta = PLAY_STATUS_DETAILS[status];
                const isActive = (game.playStatus || "backlog") === status;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`context-menu-item${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      onUpdatePlayStatus(game.id, status);
                      setShowStatusSubmenu(false);
                    }}
                  >
                    <span className={`lib-status-dot lib-status-dot--${status}`} />
                    <span>{t(meta.labelKey)}</span>
                    {isActive && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12" style={{ marginLeft: "auto" }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {game.path && (
        <button type="button" className="context-menu-item" onClick={handleOpenFolder}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>{t("library.context.openFolder")}</span>
        </button>
      )}

      <div className="context-menu-separator" />

      <button type="button" className="context-menu-item remove-action" onClick={onRemove}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span>{t("game.remove")}</span>
      </button>
    </div>
  );
}
