import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameNote } from "../types/gameNote";
import { deriveNoteTitle, sortNotes } from "../utils/gameNotes";

/**
 * useGameNotes
 *
 *  Owns the note list for one game: loads it from the `game_notes`
 *  SQLite domain, exposes optimistic create / update / delete, and
 *  keeps the list ordered (pinned first, then most recently updated).
 *
 *  Legacy migration: games that predate the Notes tab only have the
 *  single-string `game.notes` field. On first load with no note rows,
 *  that string is promoted to a real note and the caller is asked to
 *  clear the old field, so the migration runs exactly once.
 *
 *  When the Tauri bridge is unavailable (frontend-only dev), notes
 *  fall back to a `localStorage` map keyed by game id so the tab still
 *  behaves during `npm run dev`.
 */

export interface GameNoteDraft {
  title: string;
  content: string;
  tags?: string[];
}

export interface UseGameNotesResult {
  notes: GameNote[];
  loading: boolean;
  createNote: (draft: GameNoteDraft) => Promise<GameNote | null>;
  updateNote: (note: GameNote) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

const LOCAL_STORAGE_KEY = "gamelib-game-notes";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function newNoteId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readLocal(gameId: string): GameNote[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, GameNote[]>;
    return Array.isArray(all[gameId]) ? all[gameId] : [];
  } catch {
    return [];
  }
}

function writeLocal(gameId: string, notes: GameNote[]): void {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, GameNote[]>) : {};
    all[gameId] = notes;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full / unavailable — the in-memory list still works.
  }
}

export function useGameNotes(
  gameId: string,
  legacyNotes?: string,
  onLegacyMigrated?: () => void,
): UseGameNotesResult {
  const [notes, setNotes] = useState<GameNote[]>([]);
  const [loading, setLoading] = useState(true);

  // Refs keep the load effect keyed on `gameId` alone while still
  // reading the latest legacy value / callback at migration time.
  const legacyRef = useRef(legacyNotes);
  legacyRef.current = legacyNotes;
  const migratedRef = useRef(onLegacyMigrated);
  migratedRef.current = onLegacyMigrated;

  const setSorted = useCallback((updater: (prev: GameNote[]) => GameNote[]) => {
    setNotes((prev) => sortNotes(updater(prev)));
  }, []);

  // Latest list for the localStorage fallback writers, which run from
  // callbacks that must not be re-created on every note change.
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const persist = useCallback(
    async (note: GameNote): Promise<GameNote> => {
      if (!hasTauriRuntime()) return note;
      return invoke<GameNote>("save_game_note", { note });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      let rows: GameNote[] = [];
      if (hasTauriRuntime()) {
        try {
          rows = await invoke<GameNote[]>("load_game_notes", { gameId });
        } catch (err) {
          console.error("Failed to load game notes:", err);
        }
      } else {
        rows = readLocal(gameId);
      }

      if (cancelled) return;

      const legacy = legacyRef.current?.trim();
      if (rows.length === 0 && legacy) {
        const migrated: GameNote = {
          id: newNoteId(),
          gameId,
          title: deriveNoteTitle(legacy, ""),
          content: legacy,
          tags: [],
          pinned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        try {
          const saved = await persist(migrated);
          if (cancelled) return;
          rows = [saved];
          if (!hasTauriRuntime()) writeLocal(gameId, rows);
          migratedRef.current?.();
        } catch (err) {
          console.error("Failed to migrate legacy game notes:", err);
          rows = [migrated];
        }
      }

      if (cancelled) return;
      setNotes(sortNotes(rows));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, persist]);

  const createNote = useCallback(
    async (draft: GameNoteDraft): Promise<GameNote | null> => {
      const now = Date.now();
      const draftNote: GameNote = {
        id: newNoteId(),
        gameId,
        title: draft.title.trim(),
        content: draft.content,
        tags: draft.tags ?? [],
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      setSorted((prev) => [...prev, draftNote]);
      if (!hasTauriRuntime()) {
        writeLocal(gameId, sortNotes([...notesRef.current, draftNote]));
        return draftNote;
      }
      try {
        const saved = await invoke<GameNote>("save_game_note", { note: draftNote });
        setSorted((prev) => prev.map((n) => (n.id === draftNote.id ? saved : n)));
        return saved;
      } catch (err) {
        console.error("Failed to create game note:", err);
        setSorted((prev) => prev.filter((n) => n.id !== draftNote.id));
        return null;
      }
    },
    [gameId, notes, setSorted],
  );

  const updateNote = useCallback(
    async (note: GameNote): Promise<void> => {
      const stamped: GameNote = { ...note, updatedAt: Date.now() };
      setSorted((prev) => prev.map((n) => (n.id === stamped.id ? stamped : n)));
      if (!hasTauriRuntime()) {
        const next = sortNotes(
          notesRef.current.some((n) => n.id === stamped.id)
            ? notesRef.current.map((n) => (n.id === stamped.id ? stamped : n))
            : [...notesRef.current, stamped],
        );
        writeLocal(gameId, next);
        return;
      }
      const saved = await invoke<GameNote>("save_game_note", { note: stamped });
      setSorted((prev) => prev.map((n) => (n.id === saved.id ? saved : n)));
    },
    [gameId, setSorted],
  );

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      setSorted((prev) => prev.filter((n) => n.id !== id));
      if (!hasTauriRuntime()) {
        writeLocal(gameId, sortNotes(notesRef.current.filter((n) => n.id !== id)));
        return;
      }
      await invoke<number>("delete_game_note", { id });
    },
    [gameId, setSorted],
  );

  const sortedNotes = useMemo(() => sortNotes(notes), [notes]);

  return { notes: sortedNotes, loading, createNote, updateNote, deleteNote };
}
