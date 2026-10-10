import { useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { useOverlay } from "../../../context/OverlayContext";
import { useGameNotes } from "../../../hooks/useGameNotes";
import { useLanguage } from "../../../context/LanguageContext";
import { Card, Skeleton } from "../../ui";

/**
 * Quick notes for the running game. Reuses the existing per-game notes store
 * (`useGameNotes` → `load_game_notes` / `save_game_note`); edits autosave
 * after a short debounce so the overlay never needs an explicit save button.
 */
export default function NotesWidget() {
  const { session } = useOverlay();
  const { t } = useLanguage();

  if (!session) {
    return (
      <Card variant="glass" className="overlay-widget">
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <StickyNote />
          </span>
          <h3 className="overlay-widget__title">{t("overlay.widget.notes")}</h3>
        </div>
        <p className="overlay-widget__empty">{t("overlay.noSession")}</p>
      </Card>
    );
  }

  return <NotesEditor key={session.gameId} gameId={session.gameId} />;
}

function NotesEditor({ gameId }: { gameId: string }) {
  const { t } = useLanguage();
  const { notes, loading, createNote, updateNote } = useGameNotes(gameId);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const seededRef = useRef(false);
  const noteIdRef = useRef<string | null>(null);
  const storedRef = useRef("");
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const saveRef = useRef({ createNote, updateNote });
  saveRef.current = { createNote, updateNote };

  // Seed the draft once the note list settles, without clobbering typing.
  useEffect(() => {
    if (loading || seededRef.current) return;
    seededRef.current = true;
    const latest = notes[0];
    if (latest) {
      noteIdRef.current = latest.id;
      storedRef.current = latest.content;
      setDraft(latest.content);
    }
  }, [loading, notes]);

  // Debounced autosave — update the existing note, or create the first one.
  useEffect(() => {
    if (!seededRef.current || draft === storedRef.current) return;
    const timer = setTimeout(() => {
      void (async () => {
        const { createNote: create, updateNote: update } = saveRef.current;
        const id = noteIdRef.current;
        if (id) {
          const existing = notesRef.current.find((n) => n.id === id);
          if (existing && existing.content !== draft) {
            await update({ ...existing, content: draft });
          }
        } else if (draft.trim()) {
          const created = await create({ title: "", content: draft });
          if (created) noteIdRef.current = created.id;
        }
        storedRef.current = draft;
        setSaved(true);
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <Card variant="glass" className="overlay-widget">
      <div className="overlay-widget__head">
        <span className="overlay-widget__icon" aria-hidden>
          <StickyNote />
        </span>
        <h3 className="overlay-widget__title">{t("overlay.widget.notes")}</h3>
        {saved && (
          <span className="overlay-widget__status">{t("overlay.notes.saved")}</span>
        )}
      </div>

      {loading ? (
        <Skeleton shape="rect" height="4.5em" />
      ) : (
        <textarea
          className="overlay-notes__input"
          value={draft}
          onChange={(event) => {
            setSaved(false);
            setDraft(event.target.value);
          }}
          placeholder={t("overlay.notes.placeholder")}
          aria-label={t("overlay.widget.notes")}
          rows={4}
        />
      )}
    </Card>
  );
}
