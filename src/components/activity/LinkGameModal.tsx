import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useActivity } from "../../context/ActivityContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { calculateLinkedPlaytime } from "./activityLinkUtils";
import { GameThumbnail } from "./GameThumbnail";
import * as Icons from "./Icons";

export interface LinkGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  unlinkedGameId: string;
  unlinkedGameTitle: string;
  games: Game[];
  onLinked?: (targetGame: Game) => void;
}

export function LinkGameModal({
  isOpen,
  onClose,
  unlinkedGameId,
  unlinkedGameTitle,
  games,
  onLinked,
}: LinkGameModalProps) {
  const { t } = useLanguage();
  const { sessions, relinkSessionsForGame } = useActivity();
  const { updateGame } = useGames();
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => g.name.toLowerCase().includes(q));
  }, [games, searchQuery]);

  const selectedTargetGame = useMemo(() => {
    return games.find((g) => g.id === selectedTargetId) ?? null;
  }, [games, selectedTargetId]);

  const projectedUpdate = useMemo(() => {
    if (!selectedTargetGame) return null;
    const unlinkedSessions = sessions.filter((s) => s.gameId === unlinkedGameId);
    const targetSessions = sessions.filter((s) => s.gameId === selectedTargetGame.id);
    return calculateLinkedPlaytime(selectedTargetGame, unlinkedSessions, targetSessions);
  }, [selectedTargetGame, sessions, unlinkedGameId]);

  if (!isOpen) return null;

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetGame || !projectedUpdate) return;

    setLinking(true);
    try {
      await relinkSessionsForGame(
        unlinkedGameId,
        selectedTargetGame.id,
        selectedTargetGame.name
      );

      const updates: Partial<Game> = {
        playTime: projectedUpdate.playTime,
      };
      if (projectedUpdate.lastPlayed) {
        updates.lastPlayed = projectedUpdate.lastPlayed;
      }

      updateGame(selectedTargetGame.id, updates);

      const updatedGame: Game = {
        ...selectedTargetGame,
        ...updates,
      };

      showToast(
        t("activityLink.success", {
          from: unlinkedGameTitle,
          to: selectedTargetGame.name,
        }),
        "success"
      );
      onLinked?.(updatedGame);
      onClose();
    } catch (err) {
      console.error("Failed to link activity game:", err);
      showToast(t("activityLink.error"), "error");
    } finally {
      setLinking(false);
    }
  };

  return createPortal(
    <div className="act-modal-backdrop" onClick={onClose}>
      <div
        className="act-modal act-link-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="act-link-modal-title"
      >
        <div className="act-modal__header">
          <div className="act-link-modal__header-info">
            <h3 id="act-link-modal-title" className="act-modal__title">
              <Icons.Link2 size={16} /> {t("activityLink.modalTitle")}
            </h3>
            <p className="act-link-modal__desc">
              {t("activityLink.modalDesc", { name: unlinkedGameTitle })}
            </p>
          </div>
          <button
            type="button"
            className="act-modal__close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icons.X size={16} />
          </button>
        </div>

        <form onSubmit={handleLink} className="act-link-modal__form">
          {/* Search Input */}
          <div className="act-link-modal__search-wrapper">
            <Icons.Search size={14} className="act-link-modal__search-icon" />
            <input
              type="text"
              className="act-link-modal__search-input"
              placeholder={t("activityLink.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="act-link-modal__search-clear"
                onClick={() => setSearchQuery("")}
              >
                <Icons.X size={12} />
              </button>
            )}
          </div>

          {/* Games list */}
          <div className="act-link-modal__list" role="listbox">
            {filteredGames.map((g) => {
              const isSelected = g.id === selectedTargetId;
              return (
                <div
                  key={g.id}
                  role="option"
                  aria-selected={isSelected}
                  className={`act-link-modal__item ${
                    isSelected ? "act-link-modal__item--selected" : ""
                  }`}
                  onClick={() => setSelectedTargetId(g.id)}
                >
                  <GameThumbnail
                    iconUrl={g.iconUrl}
                    coverArtUrl={g.coverArtUrl}
                    steamAppId={g.steamAppId}
                    name={g.name}
                    className="act-link-modal__item-thumb"
                  />
                  <div className="act-link-modal__item-info">
                    <span className="act-link-modal__item-name">{g.name}</span>
                    <span className="act-link-modal__item-meta">
                      <span className="act-link-modal__badge">{g.platform || "Local"}</span>
                      {g.playTime && (
                        <span className="act-link-modal__badge">{g.playTime}</span>
                      )}
                      {g.installed && (
                        <span className="act-link-modal__badge act-link-modal__badge--installed">
                          {t("filter.installed")}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="act-link-modal__item-select">
                    {isSelected ? (
                      <span className="act-link-modal__check">
                        <Icons.Check size={14} />
                      </span>
                    ) : (
                      <span className="act-link-modal__circle" />
                    )}
                  </div>
                </div>
              );
            })}

            {filteredGames.length === 0 && (
              <div className="act-link-modal__empty">
                <Icons.Search size={20} />
                <span>{t("activityLink.noGames")}</span>
              </div>
            )}
          </div>

          {/* Playtime update preview */}
          {selectedTargetGame && projectedUpdate && (
            <div className="act-link-modal__preview">
              <span className="act-link-modal__preview-label">
                {t("hero.playTime")}:
              </span>
              <span className="act-link-modal__preview-val">
                {selectedTargetGame.playTime || "0h"} → <strong>{projectedUpdate.playTime}</strong>
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="act-modal__actions">
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--ghost"
              onClick={onClose}
              disabled={linking}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="act-inspector-btn act-inspector-btn--primary"
              disabled={linking || !selectedTargetGame}
            >
              <Icons.Link2 size={13} />{" "}
              {linking ? t("activityLink.linking") : t("activityLink.confirm")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
