import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameNote } from "../../../types/gameNote";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Library-wide note search for the Notes tab's "All games" scope.
 *
 * The query runs in SQLite (title, Markdown body and tags) and is debounced
 * because the scope is opened by typing. Frontend-only dev falls back to the
 * current game's notes — the only ones the stub can see.
 */
export function useGameNotesSearch(
  query: string,
  enabled: boolean,
  fallbackNotes: GameNote[],
) {
  const [results, setResults] = useState<GameNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const run = useCallback(
    async (search: string) => {
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      if (!hasTauriRuntime()) {
        const needle = search.trim().toLowerCase();
        const local = needle
          ? fallbackNotes.filter(
              (note) =>
                note.title.toLowerCase().includes(needle) ||
                note.content.toLowerCase().includes(needle) ||
                note.tags.some((tag) => tag.toLowerCase().includes(needle)),
            )
          : fallbackNotes;
        if (requestRef.current === request) {
          setResults(local);
          setLoading(false);
        }
        return;
      }
      try {
        const found = await invoke<GameNote[]>("search_game_notes", {
          query: search,
          limit: 80,
        });
        if (requestRef.current === request) setResults(found ?? []);
      } catch (err) {
        if (requestRef.current === request) {
          setError(err instanceof Error ? err.message : String(err));
          setResults([]);
        }
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    },
    [fallbackNotes, requestRef],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      void run(query);
    }, query.trim() ? 180 : 0);
    return () => window.clearTimeout(timer);
  }, [enabled, query, run]);

  const refresh = useCallback(() => {
    if (enabled) void run(query);
  }, [enabled, query, run]);

  const sorted = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
      ),
    [results],
  );

  return { results: sorted, loading, error, refresh };
}
