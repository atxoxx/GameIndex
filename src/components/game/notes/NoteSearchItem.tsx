import { Pin } from "lucide-react";
import type { GameNote } from "../../../types/gameNote";
import { noteExcerpt } from "../../../utils/gameNotes";
import { useLanguage } from "../../../context/LanguageContext";

interface NoteSearchItemProps {
  note: GameNote;
  gameName: string;
  coverUrl?: string;
  active: boolean;
  updatedLabel: string;
  onSelect: (note: GameNote) => void;
}

/** A cross-game search result: which game the note belongs to matters. */
export default function NoteSearchItem({
  note,
  gameName,
  coverUrl,
  active,
  updatedLabel,
  onSelect,
}: NoteSearchItemProps) {
  const { t } = useLanguage();
  const title = note.title.trim() || t("notes.untitled");

  return (
    <button
      type="button"
      className={`note-list-item note-list-item--search${active ? " is-active" : ""}`}
      onClick={() => onSelect(note)}
      aria-current={active ? "true" : undefined}
    >
      <span className="note-search-item__game">
        <span className="note-search-item__cover" aria-hidden="true">
          {coverUrl ? <img src={coverUrl} alt="" loading="lazy" /> : null}
        </span>
        <span className="note-search-item__game-name">{gameName}</span>
      </span>
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
