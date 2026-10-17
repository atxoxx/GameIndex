import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime, gameDisplayName } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { useSettings } from "../../context/SettingsContext";
import { formatTemp } from "../../utils/temp";
import { GameThumbnail } from "./GameThumbnail";
import { GameSessionDetail } from "../game/GameSessionDetail";
import { ConfirmModal } from "../ui/ConfirmModal";
import { useFocusProps } from "./focusable";
import * as Icons from "./Icons";
import { Button } from "../ui";

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

  const handleSaveNote = () => {
    if (!session) return;
    setNote(session.id, noteText);
    setTags(session.id, tagsList);
    setIsEditingNote(false);
  };

  const handleAddTag = (e?: React.KeyboardEvent | React.MouseEvent) => {
    if (e && "key" in e && e.key !== "Enter") return;
    if (!session) return;
    const clean = tagInput.trim();
    if (clean && !tagsList.includes(clean)) {
      const next = [...tagsList, clean];
      setTagsList(next);
      setTags(session.id, next);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (!session) return;
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

  const closeFocus = useFocusProps(onClose);
  const editNoteFocus = useFocusProps(() => setIsEditingNote(true));
  const addTagFocus = useFocusProps(() => handleAddTag());
  const saveNoteFocus = useFocusProps(handleSaveNote);
  const cancelNoteFocus = useFocusProps(() => setIsEditingNote(false));
  const deleteFocus = useFocusProps(() => setConfirmDelete(true));
  const goToGameFocus = useFocusProps(handleGoToGame);
  const launchFocus = useFocusProps(() => {
    onClose();
    if (game) onLaunchGame?.(game);
  });

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

  const m = session.metrics;
  const hasHw = m && (m.avgCpuUsage > 0 || (m.avgFps && m.avgFps > 0));

  return createPortal(
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
                name={game ? gameDisplayName(game) : session.gameName}
                className="act-modal__game-thumb"
              />
              <div>
                <h3 className="act-modal__title">{game ? gameDisplayName(game) : session.gameName}</h3>
                <span className="act-modal__sub">
                  {formattedDate} • {formattedStartTime} – {formattedEndTime}
                </span>
              </div>
            </div>

            <div className="act-modal__header-actions">
              <Button variant="ghost" size="sm" iconOnly leftIcon={<Icons.X size={16} />}
                ref={closeFocus.ref}
                tabIndex={closeFocus.tabIndex}
                type="button"
                
                onClick={closeFocus.onClick}
                aria-label={t("common.close")}
              ></Button>
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
                  <Button variant="secondary" size="sm"
                    ref={editNoteFocus.ref}
                    tabIndex={editNoteFocus.tabIndex}
                    type="button"
                    
                    onClick={editNoteFocus.onClick}
                  > <Icons.Edit3 size={12} /> {noteText ? t("common.edit") : t("sessionNotes.addNote")} </Button>
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
                    <Button variant="secondary" size="sm"
                      ref={addTagFocus.ref}
                      tabIndex={addTagFocus.tabIndex}
                      type="button"
                      
                      onClick={addTagFocus.onClick}
                    > <Icons.Tag size={12} /> {t("sessionNotes.addTag")} </Button>
                  </div>
                  <div className="act-inspector-notes__editor-actions">
                    <Button variant="primary" size="md"
                      ref={saveNoteFocus.ref}
                      tabIndex={saveNoteFocus.tabIndex}
                      type="button"
                      
                      onClick={saveNoteFocus.onClick}
                    > <Icons.Check size={13} /> {t("common.save")} </Button>
                    <Button variant="ghost" size="md"
                      ref={cancelNoteFocus.ref}
                      tabIndex={cancelNoteFocus.tabIndex}
                      type="button"
                      
                      onClick={cancelNoteFocus.onClick}
                    > {t("common.cancel")} </Button>
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
                        <InspectorTag
                          key={tag}
                          tag={tag}
                          editing={isEditingNote}
                          onRemove={() => handleRemoveTag(tag)}
                        />
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
                <Button variant="danger" size="md"
                  ref={deleteFocus.ref}
                  tabIndex={deleteFocus.tabIndex}
                  type="button"
                  
                  onClick={deleteFocus.onClick}
                > <Icons.Trash2 size={13} /> {t("activity.deleteSessionBtn")} </Button>
              )}
            </div>

            <div className="act-modal__footer-right">
              {game && (
                <>
                  <Button variant="secondary" size="md"
                    ref={goToGameFocus.ref}
                    tabIndex={goToGameFocus.tabIndex}
                    type="button"
                    
                    onClick={goToGameFocus.onClick}
                  > <Icons.ExternalLink size={13} /> {t("gameActivity.viewGamePage")} </Button>
                  {onLaunchGame && (
                    <Button variant="primary" size="md"
                      ref={launchFocus.ref}
                      tabIndex={launchFocus.tabIndex}
                      type="button"
                      
                      onClick={launchFocus.onClick}
                    > <Icons.Play size={13} /> {t("game.play")} </Button>
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
            game: game ? gameDisplayName(game) : session.gameName,
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
    </>,
    document.body
  );
}

function InspectorTag({
  tag,
  editing,
  onRemove,
}: {
  tag: string;
  editing: boolean;
  onRemove: () => void;
}) {
  const focus = useFocusProps(onRemove);
  return (
    <span className="act-inspector-tag">
      <Icons.Tag size={10} /> {tag}
      {editing && (
        <button
          ref={focus.ref}
          tabIndex={focus.tabIndex}
          type="button"
          className="act-inspector-tag__remove"
          onClick={focus.onClick}
        >
          <Icons.X size={10} />
        </button>
      )}
    </span>
  );
}
