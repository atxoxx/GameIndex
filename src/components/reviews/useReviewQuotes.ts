import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ReviewQuote, ReviewQuoteDraft } from "../../types/reviewQuote";

const LOCAL_KEY = "gamelib.review-quotes.v1";

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `quote-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readLocal(): ReviewQuote[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReviewQuote[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(quotes: ReviewQuote[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(quotes.slice(0, 500)));
  } catch {
    // Storage unavailable — the backend store is the real owner.
  }
}

/**
 * Saved review bookmarks and excerpts for one game.
 *
 * Quotes are durable app state (kv domain through the `review_quote_*`
 * commands); frontend-only dev falls back to localStorage so the Reviews tab
 * remains usable without the native shell.
 */
export function useReviewQuotes(gameId: string) {
  const [quotes, setQuotes] = useState<ReviewQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    if (!hasTauriRuntime()) {
      const local = readLocal()
        .filter((quote) => quote.gameId === gameId)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (requestRef.current === request) {
        setQuotes(local);
        setLoading(false);
      }
      return;
    }
    try {
      const list = await invoke<ReviewQuote[]>("review_quote_list", {
        gameId,
      });
      if (requestRef.current === request) setQuotes(list ?? []);
    } catch (err) {
      if (requestRef.current === request) {
        setError(err instanceof Error ? err.message : String(err));
        setQuotes([]);
      }
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (draft: ReviewQuoteDraft): Promise<ReviewQuote | null> => {
      const candidate: ReviewQuote = {
        ...draft,
        id: draft.id ?? "",
        createdAt: draft.createdAt ?? Date.now(),
      };
      try {
        const saved = hasTauriRuntime()
          ? await invoke<ReviewQuote>("review_quote_save", { quote: candidate })
          : { ...candidate, id: candidate.id || newId() };
        setQuotes((prev) => {
          const next = prev.filter(
            (quote) =>
              quote.id !== saved.id &&
              !(
                saved.kind === "review" &&
                quote.kind === "review" &&
                quote.reviewKey === saved.reviewKey &&
                quote.gameId === saved.gameId
              ),
          );
          const merged = [saved, ...next];
          if (!hasTauriRuntime()) writeLocal(merged);
          return merged;
        });
        setError(null);
        return saved;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      if (hasTauriRuntime()) {
        await invoke<number>("review_quote_delete", { id });
      }
      setQuotes((prev) => {
        const next = prev.filter((quote) => quote.id !== id);
        if (!hasTauriRuntime()) writeLocal(next);
        return next;
      });
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const bookmarkedKeys = useMemo(
    () =>
      new Set(
        quotes
          .filter((quote) => quote.kind === "review")
          .map((quote) => quote.reviewKey),
      ),
    [quotes],
  );

  return {
    quotes,
    loading,
    error,
    reload: load,
    save,
    remove,
    isBookmarked: (reviewKey: string) => bookmarkedKeys.has(reviewKey),
  };
}

export default useReviewQuotes;
