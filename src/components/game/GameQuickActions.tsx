import { useState, useRef, useEffect } from "react";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";
import type { Game } from "../../types/game";

export interface GameQuickActionsProps {
  game?: Game;
  gameName: string;
  steamAppId?: number | null;
  executablePath?: string | null;
  onEdit?: () => void;
  onRemove?: () => void;
  onToggleTrack?: () => void;
  isStoreMode?: boolean;
}

export default function GameQuickActions({
  game,
  gameName,
  steamAppId,
  executablePath,
  onEdit,
  onRemove,
  onToggleTrack,
  isStoreMode,
}: GameQuickActionsProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { isGameUntracked, toggleGameTracking } = useGames();

  const isUntracked = game ? (game.untracked ?? isGameUntracked(game.id)) : false;

  const handleToggleTracking = () => {
    if (!game) return;
    if (onToggleTrack) {
      onToggleTrack();
    } else {
      const nextUntracked = !isUntracked;
      toggleGameTracking(game.id, nextUntracked);
      showToast(
        nextUntracked
          ? t("gamePage.trackingDisabledToast", { name: game.name || gameName })
          : t("gamePage.trackingEnabledToast", { name: game.name || gameName }),
        "info"
      );
    }
    setOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t("common.copiedToClipboard", { label }), "success");
      setOpen(false);
    } catch {
      showToast(t("common.copyFailed"), "error");
    }
  };

  const handleOpenFolder = async () => {
    if (!executablePath) return;
    try {
      const trimmed = executablePath.replace(/[\\/]+$/, "");
      const lastSep = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
      const folder = lastSep > 0 ? trimmed.slice(0, lastSep) : trimmed;
      await openPath(folder);
      setOpen(false);
    } catch (err) {
      showToast(t("gameInfo.openFolderFailed", { error: String(err) }), "error");
    }
  };

  const handleOpenExternal = async (url: string) => {
    try {
      await openUrl(url);
      setOpen(false);
    } catch {
      window.open(url, "_blank");
      setOpen(false);
    }
  };

  return (
    <div className="game-quick-actions" ref={menuRef}>
      <button
        type="button"
        className={`game-quick-actions__trigger ${open ? "active" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        title={t("gamePage.quickActions")}
        aria-label={t("gamePage.quickActions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      </button>

      {open && (
        <div className="game-quick-actions__menu" role="menu">
          {/* Header */}
          <div className="game-quick-actions__header">
            <span className="game-quick-actions__game-title">{gameName}</span>
            {steamAppId && <span className="game-quick-actions__appid">AppID: {steamAppId}</span>}
          </div>

          <div className="game-quick-actions__divider" />

          {/* Quick External Links Section */}
          <div className="game-quick-actions__section-title">{t("gamePage.externalLinks")}</div>

          {steamAppId && (
            <>
              <button
                type="button"
                className="game-quick-actions__item"
                role="menuitem"
                onClick={() => handleOpenExternal(`https://store.steampowered.com/app/${steamAppId}`)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a10 10 0 0 0-10 10c0 4.42 2.87 8.17 6.84 9.5l1.66-2.4a3.5 3.5 0 0 1 1.76-4.66L14.7 13a4.5 4.5 0 1 1 4.5 4.5l-3.2-1.74a3.5 3.5 0 0 1-4.75 1.78l-1.92 2.76A10 10 0 1 0 12 2z" />
                </svg>
                <span>{t("gamePage.steamStorePage")}</span>
                <span className="game-quick-actions__shortcut">↗</span>
              </button>

              <button
                type="button"
                className="game-quick-actions__item"
                role="menuitem"
                onClick={() => handleOpenExternal(`https://www.protondb.com/app/${steamAppId}`)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24" />
                </svg>
                <span>{t("gamePage.protonDbReports")}</span>
                <span className="game-quick-actions__shortcut">↗</span>
              </button>

              <button
                type="button"
                className="game-quick-actions__item"
                role="menuitem"
                onClick={() => handleOpenExternal(`https://www.pcgamingwiki.com/api/appid.php?appid=${steamAppId}`)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
                <span>{t("gamePage.pcGamingWiki")}</span>
                <span className="game-quick-actions__shortcut">↗</span>
              </button>
            </>
          )}

          <button
            type="button"
            className="game-quick-actions__item"
            role="menuitem"
            onClick={() => handleOpenExternal(`https://howlongtobeat.com/?q=${encodeURIComponent(gameName)}`)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{t("gamePage.howLongToBeat")}</span>
            <span className="game-quick-actions__shortcut">↗</span>
          </button>

          <button
            type="button"
            className="game-quick-actions__item"
            role="menuitem"
            onClick={() => handleOpenExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(gameName + " gameplay trailer")}`)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" />
              <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
            </svg>
            <span>{t("gamePage.youtubeTrailers")}</span>
            <span className="game-quick-actions__shortcut">↗</span>
          </button>

          <div className="game-quick-actions__divider" />

          {/* Local Utilities Section */}
          <div className="game-quick-actions__section-title">{t("gamePage.utilities")}</div>

          {executablePath && (
            <button
              type="button"
              className="game-quick-actions__item"
              role="menuitem"
              onClick={handleOpenFolder}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>{t("gameInfo.openContainingFolder")}</span>
            </button>
          )}

          <button
            type="button"
            className="game-quick-actions__item"
            role="menuitem"
            onClick={() => copyToClipboard(gameName, t("gamePage.gameTitle"))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{t("gamePage.copyTitle")}</span>
          </button>

          {steamAppId && (
            <button
              type="button"
              className="game-quick-actions__item"
              role="menuitem"
              onClick={() => copyToClipboard(String(steamAppId), "Steam AppID")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>{t("gamePage.copyAppId")}</span>
            </button>
          )}

          {/* Edit / Untrack / Remove actions in Library Mode */}
          {!isStoreMode && (onEdit || onRemove || game) && (
            <>
              <div className="game-quick-actions__divider" />
              {game && (
                <button
                  type="button"
                  className="game-quick-actions__item"
                  role="menuitem"
                  onClick={handleToggleTracking}
                >
                  {isUntracked ? (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>{t("gamePage.enableTracking")}</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a10 10 0 1 0 10 10" />
                        <path d="M12 6v6l4 2" />
                        <line x1="2" y1="2" x2="22" y2="22" />
                      </svg>
                      <span>{t("gamePage.disableTracking")}</span>
                    </>
                  )}
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  className="game-quick-actions__item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onEdit();
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span>{t("common.edit")}</span>
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="game-quick-actions__item game-quick-actions__item--danger"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onRemove();
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>{t("common.remove")}</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
