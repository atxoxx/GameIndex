import { useEffect, useRef, useState } from "react";
import type { Game } from "../../types/game";
import { IconFileText } from "./icons";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * NotesSection
 *
 *  Inline-editable "Notes" card on the Game page overview. Keeps a
 *  local draft in sync with `game.notes` and persists edits through
 *  `GameContext.updateGame` after a short debounce, so a user typing
 *  continuously triggers a single save instead of one per keystroke.
 *
 *  Empty notes still render the card (the whole point is a place to
 *  jot quick thoughts), with a muted "Saved automatically" hint so the
 *  silent persistence doesn't read as a missing save button.
 */

interface NotesSectionProps {
  game: Game;
}

const SAVE_DEBOUNCE_MS = 600;

export default function NotesSection({ game }: NotesSectionProps) {
  const { t } = useLanguage();
  const { updateGame } = useGames();
  const [draft, setDraft] = useState(game.notes ?? "");
  const debounceRef = useRef<number | null>(null);

  // Keep the local draft in sync when the game id (or persisted notes)
  // changes — e.g. navigating between games or an external notes write.
  useEffect(() => {
    setDraft(game.notes ?? "");
  }, [game.id, game.notes]);

  // Clear any pending save on unmount so a torn-down component never
  // fires a stale updateGame against a game it no longer owns.
  useEffect(() => {
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const handleChange = (value: string) => {
    setDraft(value);
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      updateGame(game.id, {
        notes: value.trim() ? value : undefined,
      });
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <section className="game-section notes-section">
      <h2 className="game-section-title">
        <span className="game-section-title__icon" aria-hidden>
          <IconFileText size={16} />
        </span>
        {t("notes.title")}
        <span className="notes-section__hint">{t("notes.hint")}</span>
      </h2>
      <textarea
        className="notes-section__textarea"
        placeholder={t("notes.placeholder")}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        aria-label={t("notes.title")}
      />
    </section>
  );
}
