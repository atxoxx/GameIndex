import { useCallback, useEffect, useState } from "react";
import {
  FILTER_PRESETS_MAX,
  FILTER_PRESETS_STORAGE_KEY,
  loadFilterPresets,
  parseStoredPresets,
  type FilterPreset,
  type LibraryFilters,
} from "./libraryFilters";

/**
 * useFilterPresets — localStorage-backed saved filter presets (max 10).
 * Stores under `gameindex:filter-presets` as FilterPreset[].
 * Provides savePreset / deletePreset / apply semantics for LibraryPage.
 */
export function useFilterPresets() {
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadFilterPresets());

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, FILTER_PRESETS_MAX)));
    } catch {
      // ignore
    }
  }, [presets]);

  // Cross-tab sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== FILTER_PRESETS_STORAGE_KEY) return;
      try {
        const raw = e.newValue ? JSON.parse(e.newValue) : [];
        setPresets(parseStoredPresets(raw));
      } catch {
        /* keep current */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const savePreset = useCallback((name: string, filters: LibraryFilters) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Store filters without search; keep sort both in filters.sort and top-level sort
    const { search: _search, ...rest } = filters;
    const preset: FilterPreset = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      filters: rest,
      sort: filters.sort,
    };
    setPresets((prev) => {
      const next = [preset, ...prev].slice(0, FILTER_PRESETS_MAX);
      return next;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /**
   * Apply a preset: returns the LibraryFilters that should be set.
   * Caller is responsible for writing to the filter context (keeps this hook storage-only,
   * avoiding circular dependency on LibraryFilterContext).
   */
  const getPresetFilters = useCallback((preset: FilterPreset): LibraryFilters => {
    return {
      search: "",
      genres: preset.filters.genres,
      platforms: preset.filters.platforms,
      yearMin: preset.filters.yearMin,
      yearMax: preset.filters.yearMax,
      ratingMin: preset.filters.ratingMin,
      status: preset.filters.status,
      source: preset.filters.source,
      playStatus: preset.filters.playStatus,
      sort: preset.sort,
    };
  }, []);

  return { presets, savePreset, deletePreset, getPresetFilters };
}

export type { FilterPreset };
