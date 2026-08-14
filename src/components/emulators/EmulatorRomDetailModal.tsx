import { useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game } from "../../types/game";
import { formatBytesShort } from "../../types/download";
import { Button } from "../ui";

interface RomDetailModalProps {
  game: Game;
  isRunning: boolean;
  onClose: () => void;
  onLaunch: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function formatDate(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function EmulatorRomDetailModal({
  game,
  isRunning,
  onClose,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
}: RomDetailModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cover = game.coverArtUrl || game.iconUrl;

  const copyPath = () => {
    if (!game.romPath) return;
    navigator.clipboard.writeText(game.romPath);
    showToast(t("gameInfo.copied") + " ✓", "success");
  };

  return (
    <div className="modal-overlay emulators-modal-overlay" onMouseDown={onClose}>
      <div
        className="modal emulators-modal emu-rom-inspect-modal"
        role="dialog"
        aria-modal="true"
        aria-label={game.name}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title">{game.name}</h2>
            <span className="emu-rom-inspect-platform">{game.platform}</span>
          </div>
          <button className="modal-close" aria-label={t("common.close")} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body emu-rom-inspect-body">
          <div className="emu-rom-inspect-media">
            {cover ? (
              <img src={cover} alt={game.name} className="emu-rom-inspect-cover" />
            ) : (
              <div className="emu-rom-inspect-fallback">
                <span className="emu-rom-inspect-fallback-glyph">🕹️</span>
                <span>{game.platform}</span>
              </div>
            )}
          </div>

          <div className="emu-rom-inspect-info">
            <div className="emu-rom-inspect-field">
              <span className="emu-rom-inspect-label">
                <svg {...ICON}>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                {t("bigscreen.emulators.romPath")}
              </span>
              <div className="emu-rom-inspect-path-box">
                <span className="emu-mono emu-rom-inspect-path" title={game.romPath}>
                  {game.romPath || t("emulators.games.noRomPath")}
                </span>
                {game.romPath && (
                  <div className="emu-rom-inspect-path-actions">
                    <button
                      type="button"
                      className="emu-icon-btn"
                      title={t("gameInfo.copyClipboard")}
                      onClick={copyPath}
                    >
                      <svg {...ICON}>
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="emu-icon-btn"
                      title={t("emulators.games.openLocation")}
                      onClick={() => game.romPath && onOpenLocation(game.romPath)}
                    >
                      <svg {...ICON}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="emu-rom-inspect-meta-grid">
              <div className="emu-rom-inspect-meta-item">
                <span className="emu-rom-inspect-label">
                  <svg {...ICON}>
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  {t("emulators.games.size")}
                </span>
                <span className="emu-rom-inspect-val">
                  {game.sizeBytes ? formatBytesShort(game.sizeBytes) : "—"}
                  {game.modsSizeBytes ? (
                    <span className="emu-game-mods"> + {formatBytesShort(game.modsSizeBytes)}</span>
                  ) : null}
                </span>
              </div>

              <div className="emu-rom-inspect-meta-item">
                <span className="emu-rom-inspect-label">
                  <svg {...ICON}>
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {t("game.playTime")}
                </span>
                <span className="emu-rom-inspect-val">{game.playTime || "0h"}</span>
              </div>

              {game.lastPlayed && (
                <div className="emu-rom-inspect-meta-item">
                  <span className="emu-rom-inspect-label">
                    <svg {...ICON}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {t("game.lastPlayed")}
                  </span>
                  <span className="emu-rom-inspect-val">{formatDate(game.lastPlayed)}</span>
                </div>
              )}
            </div>

            {game.launchArguments && (
              <div className="emu-rom-inspect-field">
                <span className="emu-rom-inspect-label">
                  <svg {...ICON}>
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                  {t("emulators.argumentsTemplate")}
                </span>
                <span className="emu-mono emu-rom-inspect-args">{game.launchArguments}</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <Button
              variant="danger"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                </svg>
              }
              onClick={() => {
                onClose();
                onDelete(game);
              }}
            >
              {t("emulators.games.deleteRom")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <svg {...ICON}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              }
              onClick={() => {
                onClose();
                onRename(game);
              }}
            >
              {t("emulators.games.rename")}
            </Button>
          </div>

          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose}>
              {t("common.close")}
            </Button>
            <Button
              variant="primary"
              leftIcon={
                <svg {...ICON}>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              }
              onClick={() => {
                onClose();
                onLaunch(game);
              }}
              disabled={isRunning}
            >
              {isRunning ? "…" : t("emulators.games.launch")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
