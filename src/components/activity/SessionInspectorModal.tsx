import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useSettings } from "../../context/SettingsContext";
import { formatTemp } from "../../utils/temp";
import { GameThumbnail } from "./GameThumbnail";
import { GameSessionDetail } from "../game/GameSessionDetail";
import { ConfirmModal } from "../ui/ConfirmModal";
import * as Icons from "./Icons";

export interface SessionInspectorModalProps {
  session: GameSession | null;
  game: Game | undefined;
  onClose: () => void;
  onDeleteSession?: (sessionId: string) => void;
  onLaunchGame?: (game: Game) => void;
}

export function SessionInspectorModal({
  session,
  game,
  onClose,
  onDeleteSession,
  onLaunchGame,
}: SessionInspectorModalProps) {
  const { t, language } = useLanguage();
  const { tempUnit } = useSettings();
  const { getNote, setNote, setTags } = useSessionNotes();
  const navigate = useNavigate();

  const [noteText, setNoteText] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);

  useEffect(() => {
    if (session) {
      const stored = getNote(session.id);
      setNoteText(stored.note);
      setTagsList(stored.tags);
    }
  }, [session, getNote]);

  if (!session) return null;

  const durationMs = session.durationMin * 60 * 1000;
  const endDate = new Date(session.date);
  const startDate = new Date(endDate.getTime() - durationMs);

  const formattedDate = endDate.toLocaleDateString(language, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const formattedStartTime = startDate.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const formattedEndTime = endDate.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleSaveNote = () => {
    setNote(session.id, noteText);
    setTags(session.id, tagsList);
    setIsEditingNote(false);
  };

  const handleAddTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ("key" in e && e.key !== "Enter") return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean)) {
      const next = [...tagsList, clean];
      setTagsList(next);
      setTags(session.id, next);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const next = tagsList.filter((t) => t !== tagToRemove);
    setTagsList(next);
    setTags(session.id, next);
  };

  const handleGoToGame = () => {
    onClose();
    if (game?.id) {
      navigate(`/library/${game.id}`);
    }
  };

  const m = session.metrics;
  const hasHw = m && (m.avgCpuUsage > 0 || (m.avgFps && m.avgFps > 0));

  return (
    <>
      <div className="act-modal-backdrop" onClick={onClose}>
        <div
          className="act-modal act-modal--inspector"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="act-modal__header">
            <div className="act-modal__title-group">
              <GameThumbnail
                iconUrl={game?.iconUrl}
                coverArtUrl={game?.coverArtUrl}
                steamAppId={game?.steamAppId}
                name={game?.name || session.gameName}
                className="act-modal__game-thumb"
              />
              <div>
                <h3 className="act-modal__title">{game?.name || session.gameName}</h3>
                <span className="act-modal__sub">
                  {formattedDate} • {formattedStartTime} – {formattedEndTime}
                </span>
              </div>
            </div>

            <div className="act-modal__header-actions">
              <button
                type="button"
                className="act-modal__close-btn"
                onClick={onClose}
                aria-label={t("common.close")}
              >
                <Icons.X size={16} />
              </button>
            </div>
          </div>

          <div className="act-modal__body">
            <div className="act-inspector-summary">
              <div className="act-inspector-stat">
                <span className="act-inspector-stat__label">{t("activityGantt.duration")}</span>
                <span className="act-inspector-stat__val">{formatPlayTime(session.durationMin)}</span>
              </div>
              <div className="act-inspector-stat">
                <span className="act-inspector-stat__label">{t("activityPage.source")}</span>
                <span className="act-inspector-stat__val">{game?.platform || "Local"}</span>
              </div>
              {m?.avgFps && m.avgFps > 0 && (
                <div className="act-inspector-stat">
                  <span className="act-inspector-stat__label">{t("activityPerf.avgFps")}</span>
                  <span className="act-inspector-stat__val act-inspector-stat__val--good">
                    {m.avgFps} FPS
                  </span>
                </div>
              )}
              {m?.avgCpuTemp && m.avgCpuTemp > 0 && (
                <div className="act-inspector-stat">
                  <span className="act-inspector-stat__label">{t("activityPerf.cpuTemp")}</span>
                  <span className="act-inspector-stat__val">{formatTemp(m.avgCpuTemp, tempUnit)}</span>
                </div>
              )}
              {m?.avgGpuTemp && m.avgGpuTemp > 0 && (
                <div className="act-inspector-stat">
                  <span className="act-inspector-stat__label">{t("activityPerf.gpuTemp")}</span>
                  <span className="act-inspector-stat__val">{formatTemp(m.avgGpuTemp, tempUnit)}</span>
                </div>
              )}
              {m?.resolution && (
                <div className="act-inspector-stat">
                  <span className="act-inspector-stat__label">{t("activityGantt.resolution")}</span>
                  <span className="act-inspector-stat__val">{m.resolution}</span>
                </div>
              )}
            </div>

            {hasHw && (
              <div className="act-inspector-telemetry">
                <h4 className="act-inspector-section-title">
                  <Icons.Activity size={14} /> {t("activity.sessionTelemetry")}
                </h4>
                <GameSessionDetail
                  session={session}
                  tempUnit={tempUnit}
                  hasTemps={Boolean(m?.avgCpuTemp || m?.avgGpuTemp)}
                />
              </div>
            )}

            <div className="act-inspector-notes">
              <div className="act-inspector-notes__header">
                <h4 className="act-inspector-section-title">
                  <Icons.FileText size={14} /> {t("sessionNotes.title")}
                </h4>
                {!isEditingNote && (
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--sm"
                    onClick={() => setIsEditingNote(true)}
                  >
                    <Icons.Edit3 size={12} /> {noteText ? t("common.edit") : t("sessionNotes.addNote")}
                  </button>
                )}
              </div>

              {isEditingNote ? (
                <div className="act-inspector-notes__editor">
                  <textarea
                    className="act-inspector-notes__textarea"
                    rows={3}
                    placeholder={t("sessionNotes.placeholder")}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                  />
                  <div className="act-inspector-notes__tags-input-row">
                    <input
                      type="text"
                      className="act-inspector-notes__tag-input"
                      placeholder={t("sessionNotes.tagPlaceholder")}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleAddTag}
                    />
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--sm"
                      onClick={handleAddTag}
                    >
                      <Icons.Tag size={12} /> {t("sessionNotes.addTag")}
                    </button>
                  </div>
                  <div className="act-inspector-notes__editor-actions">
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--primary"
                      onClick={handleSaveNote}
                    >
                      <Icons.Check size={13} /> {t("common.save")}
                    </button>
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--ghost"
                      onClick={() => setIsEditingNote(false)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="act-inspector-notes__display">
                  {noteText ? (
                    <p className="act-inspector-notes__text">{noteText}</p>
                  ) : (
                    <p className="act-inspector-notes__empty">{t("sessionNotes.noNotes")}</p>
                  )}
                  {tagsList.length > 0 && (
                    <div className="act-inspector-notes__tags">
                      {tagsList.map((tag) => (
                        <span key={tag} className="act-inspector-tag">
                          <Icons.Tag size={10} /> {tag}
                          {isEditingNote && (
                            <button
                              type="button"
                              className="act-inspector-tag__remove"
                              onClick={() => handleRemoveTag(tag)}
                            >
                              <Icons.X size={10} />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="act-modal__footer">
            <div className="act-modal__footer-left">
              {onDeleteSession && (
                <button
                  type="button"
                  className="act-inspector-btn act-inspector-btn--danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icons.Trash2 size={13} /> {t("activity.deleteSessionBtn")}
                </button>
              )}
            </div>

            <div className="act-modal__footer-right">
              {game && (
                <>
                  <button
                    type="button"
                    className="act-inspector-btn act-inspector-btn--secondary"
                    onClick={handleGoToGame}
                  >
                    <Icons.ExternalLink size={13} /> {t("gameActivity.viewGamePage")}
                  </button>
                  {onLaunchGame && (
                    <button
                      type="button"
                      className="act-inspector-btn act-inspector-btn--primary"
                      onClick={() => {
                        onClose();
                        onLaunchGame(game);
                      }}
                    >
                      <Icons.Play size={13} /> {t("game.play")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDelete && onDeleteSession && (
        <ConfirmModal
          open={confirmDelete}
          title={t("activitySessions.deleteConfirmTitle")}
          message={t("activitySessions.deleteConfirmBody", {
            game: game?.name || session.gameName,
            date: formattedDate,
          })}
          confirmLabel={t("common.delete")}
          onConfirm={() => {
            onDeleteSession(session.id);
            setConfirmDelete(false);
            onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
