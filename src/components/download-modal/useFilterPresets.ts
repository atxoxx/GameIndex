import { useCallback, useState } from "react";
import type { DownloadTypeFilter, PlatformFilter, SortKey } from "./types";

/** The complete, persistable filter/sort state of the results toolbar. */
export interface DownloadFilters {
  searchQuery: string;
  sourceFilter: string;
  groupFilter: string;
  platformFilter: PlatformFilter;
  typeFilter: DownloadTypeFilter;
  updatesOnly: boolean;
  sortBy: SortKey;
}

export const DEFAULT_FILTERS: DownloadFilters = {
  searchQuery: "",
  sourceFilter: "all",
  groupFilter: "all",
  platformFilter: "all",
  typeFilter: "all",
  updatesOnly: false,
  sortBy: "recommended",
};

export interface FilterPreset {
  id: string;
  name: string;
  filters: DownloadFilters;
}

const PRESETS_KEY = "gamelib-download-filter-presets";
const LAST_KEY = "gamelib-download-last-filters";
const MAX_PRESETS = 12;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Filters carried over from the previous session (defaults merged in). */
export function loadLastFilters(): DownloadFilters {
  const stored = readJson<Partial<DownloadFilters>>(LAST_KEY, {});
  return { ...DEFAULT_FILTERS, ...stored };
}

/** Remember the current filters for the next time the modal opens. */
export function saveLastFilters(filters: DownloadFilters): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(filters));
  } catch {
    // Storage may be unavailable (private mode); filtering still works.
  }
}

export interface FilterPresetsApi {
  presets: FilterPreset[];
  savePreset: (name: string, filters: DownloadFilters) => void;
  deletePreset: (id: string) => void;
}

/** Named filter presets, persisted to localStorage. */
export function useFilterPresets(): FilterPresetsApi {
  const [presets, setPresets] = useState<FilterPreset[]>(() =>
    readJson<FilterPreset[]>(PRESETS_KEY, []),
  );

  const mutate = useCallback(
    (updater: (prev: FilterPreset[]) => FilterPreset[]) => {
      setPresets((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
        } catch {
          // Ignore persistence failures.
        }
        return next;
      });
    },
    [],
  );

  const savePreset = useCallback(
    (name: string, filters: DownloadFilters) => {
      const trimmed = name.trim() || "Preset";
      mutate((prev) => {
        const withoutDuplicate = prev.filter(
          (p) => p.name.toLowerCase() !== trimmed.toLowerCase(),
        );
        const preset: FilterPreset = {
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: trimmed,
          filters,
        };
        return [...withoutDuplicate, preset].slice(-MAX_PRESETS);
      });
    },
    [mutate],
  );

  const deletePreset = useCallback(
    (id: string) => mutate((prev) => prev.filter((p) => p.id !== id)),
    [mutate],
  );

  return { presets, savePreset, deletePreset };
}
