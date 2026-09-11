import { Pin } from "lucide-react";
import type { GameNote } from "../../../types/gameNote";
import { noteExcerpt } from "../../../utils/gameNotes";
import { useLanguage } from "../../../context/LanguageContext";

interface NoteListItemProps {
  note: GameNote;
  active: boolean;
  updatedLabel: string;
  onSelect: (id: string) => void;
}

/** One row in the Notes tab list sidebar. */
export default function NoteListItem({
  note,
  active,
  updatedLabel,
  onSelect,
}: NoteListItemProps) {
  const { t } = useLanguage();
  const title = note.title.trim() || t("notes.untitled");
  return (
    <button
      type="button"
      className={`note-list-item${active ? " is-active" : ""}`}
      onClick={() => onSelect(note.id)}
      aria-current={active ? "true" : undefined}
    >
      <span className="note-list-item__head">
        {note.pinned && (
          <Pin size={12} className="note-list-item__pin" aria-label={t("notes.pinned")} />
        )}
        <span className="note-list-item__title">{title}</span>
      </span>
      <span className="note-list-item__excerpt">
        {noteExcerpt(note.content) || t("notes.emptyNote")}
      </span>
      <span className="note-list-item__meta">
        <span className="note-list-item__time">{updatedLabel}</span>
        {note.tags.length > 0 && (
          <span className="note-list-item__tags">
            {note.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="note-tag">
                {tag}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
