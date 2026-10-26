import { useEffect, useState } from "react";
import { Check, Edit3, FileText, Tag, X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import { Button } from "../ui";

export interface ActivitySessionNotesProps {
  sessionId: string;
  /** Extra action rendered beside the title. */
  action?: React.ReactNode;
}

/**
 * The session note editor used by the inspector drawer. Notes and tags are
 * owned by SessionNotesContext, so the same content appears wherever a
 * session is shown.
 */
export function ActivitySessionNotes({ sessionId, action }: ActivitySessionNotesProps) {
  const { t } = useLanguage();
  const { getNote, setNote, setTags } = useSessionNotes();
  const noteData = getNote(sessionId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(noteData.note);
  const [tags, setTagsDraft] = useState(noteData.tags);
  const [tagInput, setTagInput] = useState("");

  // Switching to another session while the editor is open should show that
  // session's note, not carry the previous draft across.
  useEffect(() => {
    setEditing(false);
    setDraft(noteData.note);
    setTagsDraft(noteData.tags);
    setTagInput("");
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    setNote(sessionId, draft);
    setTags(sessionId, tags);
    setEditing(false);
  };

  const addTag = () => {
    const clean = tagInput.trim();
    if (!clean || tags.includes(clean)) return;
    const next = [...tags, clean];
    setTagsDraft(next);
    setTags(sessionId, next);
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    const next = tags.filter((entry) => entry !== tag);
    setTagsDraft(next);
    setTags(sessionId, next);
  };

  return (
    <section className="activity-note">
      <header className="activity-note__head">
        <h3 className="activity-note__title">
          <FileText size={14} aria-hidden="true" />
          {t("sessionNotes.title")}
        </h3>
        <div className="activity-note__actions">
          {action}
          {!editing && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Edit3 size={13} />}
              onClick={() => {
                setDraft(noteData.note);
                setTagsDraft(noteData.tags);
                setEditing(true);
              }}
            >
              {noteData.note ? t("common.edit") : t("sessionNotes.addNote")}
            </Button>
          )}
        </div>
      </header>

      {editing ? (
        <div className="activity-note__editor">
          <textarea
            className="activity-note__textarea"
            rows={4}
            value={draft}
            placeholder={t("sessionNotes.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="activity-note__tag-row">
            <input
              type="text"
              className="activity-note__tag-input"
              value={tagInput}
              placeholder={t("sessionNotes.tagPlaceholder")}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag();
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Tag size={12} />}
              onClick={addTag}
              disabled={!tagInput.trim()}
            >
              {t("sessionNotes.addTag")}
            </Button>
          </div>
          {tags.length > 0 && (
            <div className="activity-note__tags">
              {tags.map((tag) => (
                <span key={tag} className="activity-note__tag">
                  {tag}
                  <button
                    type="button"
                    className="activity-note__tag-remove"
                    aria-label={`${t("common.delete")} ${tag}`}
                    onClick={() => removeTag(tag)}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="activity-note__editor-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(noteData.note);
                setTagsDraft(noteData.tags);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Check size={13} />}
              onClick={commit}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="activity-note__body">
          {noteData.note ? (
            <p className="activity-note__text">{noteData.note}</p>
          ) : (
            <p className="activity-note__empty">{t("sessionNotes.noNotes")}</p>
          )}
          {noteData.tags.length > 0 && (
            <div className="activity-note__tags">
              {noteData.tags.map((tag) => (
                <span key={tag} className="activity-note__tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default ActivitySessionNotes;
