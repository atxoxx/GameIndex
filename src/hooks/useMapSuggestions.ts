import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const SUGGESTION_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Autocomplete titles from the resolvable map-provider catalogs. The backend
 * reads the same day-long cache the initial lookup filled, so results are
 * cheap; keystrokes are debounced and superseded requests are dropped.
 */
export function useMapSuggestions(query: string, enabled: boolean): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await invoke<string[]>("search_map_games", {
          query: trimmed,
          limit: 8,
        });
        if (!cancelled) setSuggestions(found ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return suggestions;
}
