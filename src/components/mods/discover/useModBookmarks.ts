import { useCallback, useEffect, useState } from "react";
import type { RemoteModSummary } from "../../../types/mods";

export interface ModBookmark {
  mod: RemoteModSummary;
  gameId: string;
  gameTitle?: string;
  bookmarkedAt: number;
}

const STORAGE_KEY = "gamelib.mods.bookmarks_v1";

function readBookmarks(): ModBookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBookmarks(items: ModBookmark[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent("gamelib:mods:bookmarks_changed"));
  } catch {
    /* ignore storage errors */
  }
}

export function useModBookmarks(gameId?: string | null) {
  const [bookmarks, setBookmarks] = useState<ModBookmark[]>(readBookmarks);

  useEffect(() => {
    const onSync = () => setBookmarks(readBookmarks());
    window.addEventListener("gamelib:mods:bookmarks_changed", onSync);
    window.addEventListener("storage", onSync);
    return () => {
      window.removeEventListener("gamelib:mods:bookmarks_changed", onSync);
      window.removeEventListener("storage", onSync);
    };
  }, []);

  const isBookmarked = useCallback(
    (source: string, id: string): boolean => {
      return bookmarks.some(
        (b) =>
          b.mod.source === source &&
          b.mod.id === id &&
          (!gameId || b.gameId === gameId),
      );
    },
    [bookmarks, gameId],
  );

  const toggleBookmark = useCallback(
    (mod: RemoteModSummary, targetGameId?: string, targetGameTitle?: string) => {
      const gid = targetGameId || gameId || "global";
      const existing = readBookmarks();
      const index = existing.findIndex(
        (b) => b.mod.source === mod.source && b.mod.id === mod.id && b.gameId === gid,
      );

      let next: ModBookmark[];
      let added = false;
      if (index >= 0) {
        next = existing.filter((_, i) => i !== index);
        added = false;
      } else {
        next = [
          {
            mod,
            gameId: gid,
            gameTitle: targetGameTitle,
            bookmarkedAt: Date.now(),
          },
          ...existing,
        ];
        added = true;
      }
      writeBookmarks(next);
      setBookmarks(next);
      return added;
    },
    [gameId],
  );

  const removeBookmark = useCallback((source: string, id: string, targetGameId?: string) => {
    const gid = targetGameId || gameId;
    const existing = readBookmarks();
    const next = existing.filter(
      (b) => !(b.mod.source === source && b.mod.id === id && (!gid || b.gameId === gid)),
    );
    writeBookmarks(next);
    setBookmarks(next);
  }, [gameId]);

  const clearBookmarks = useCallback((targetGameId?: string) => {
    const gid = targetGameId || gameId;
    const existing = readBookmarks();
    const next = gid ? existing.filter((b) => b.gameId !== gid) : [];
    writeBookmarks(next);
    setBookmarks(next);
  }, [gameId]);

  const gameBookmarks = gameId
    ? bookmarks.filter((b) => b.gameId === gameId)
    : bookmarks;

  return {
    bookmarks: gameBookmarks,
    allBookmarks: bookmarks,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    clearBookmarks,
  };
}
