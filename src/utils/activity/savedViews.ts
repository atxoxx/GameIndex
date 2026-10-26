import {
  ACTIVITY_RANGE_KEYS,
  DEFAULT_ACTIVITY_RANGE,
  type ActivityRangeKey,
} from "./range";
import {
  DEFAULT_SESSION_FILTERS,
  sanitizeSessionFilters,
  type ActivitySessionFilters,
} from "./sessionQuery";

export type ActivityTab = "overview" | "sessions" | "performance" | "wrapped";

export const ACTIVITY_TABS: readonly ActivityTab[] = [
  "overview",
  "sessions",
  "performance",
  "wrapped",
];

export const SAVED_VIEWS_KEY = "gamelib.activity.savedViews.v1";
export const MAX_SAVED_VIEWS = 12;

export interface SavedActivityView {
  id: string;
  name: string;
  tab: ActivityTab;
  rangeKey: ActivityRangeKey;
  from: string;
  to: string;
  source: string;
  gameId: string | null;
  filters: ActivitySessionFilters;
  createdAt: number;
}

function isTab(value: unknown): value is ActivityTab {
  return typeof value === "string" && (ACTIVITY_TABS as readonly string[]).includes(value);
}

function isRange(value: unknown): value is ActivityRangeKey {
  return typeof value === "string" && (ACTIVITY_RANGE_KEYS as readonly string[]).includes(value);
}

function cleanString(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dayString(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * Accept only complete, known-shape records. A saved view is a URL-shaped
 * snapshot, so every field is validated independently and falls back to the
 * page default rather than rejecting the whole record.
 */
export function sanitizeSavedView(raw: unknown): SavedActivityView | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanString(record.id, 80);
  const name = cleanString(record.name, 60);
  if (!id || !name) return null;
  return {
    id,
    name,
    tab: isTab(record.tab) ? record.tab : "overview",
    rangeKey: isRange(record.rangeKey) ? record.rangeKey : DEFAULT_ACTIVITY_RANGE,
    from: dayString(record.from),
    to: dayString(record.to),
    source: cleanString(record.source) || "all",
    gameId: cleanString(record.gameId) || null,
    filters: sanitizeSessionFilters(
      record.filters && typeof record.filters === "object"
        ? (record.filters as Partial<Record<keyof ActivitySessionFilters, unknown>>)
        : DEFAULT_SESSION_FILTERS,
    ),
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
  };
}

export function sanitizeSavedViews(raw: unknown): SavedActivityView[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const views: SavedActivityView[] = [];
  for (const entry of raw) {
    const view = sanitizeSavedView(entry);
    if (!view || seen.has(view.id)) continue;
    seen.add(view.id);
    views.push(view);
    if (views.length >= MAX_SAVED_VIEWS) break;
  }
  return views;
}

export function readSavedViews(storage: Storage | undefined = globalThis.localStorage): SavedActivityView[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    return sanitizeSavedViews(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeSavedViews(
  views: SavedActivityView[],
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views.slice(0, MAX_SAVED_VIEWS)));
  } catch {
    /* Storage may be unavailable or full; the in-memory list still works. */
  }
}

let idCounter = 0;

export function makeSavedViewId(now = Date.now()): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `view-${now.toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Add or replace a view. Names are unique case-insensitively so saving the
 * same setup twice updates it instead of filling the list with duplicates.
 */
export function upsertSavedView(
  views: SavedActivityView[],
  input: Omit<SavedActivityView, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
  now = Date.now(),
): SavedActivityView[] {
  const name = input.name.trim().slice(0, 60);
  if (!name) return views;
  const existing = views.find((view) => view.name.toLowerCase() === name.toLowerCase());
  const next: SavedActivityView = {
    id: input.id ?? existing?.id ?? makeSavedViewId(now),
    name,
    tab: input.tab,
    rangeKey: input.rangeKey,
    from: input.from,
    to: input.to,
    source: input.source || "all",
    gameId: input.gameId || null,
    filters: sanitizeSessionFilters(input.filters),
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
  };
  const without = views.filter((view) => view.id !== next.id);
  return [next, ...without].slice(0, MAX_SAVED_VIEWS);
}

export function removeSavedView(views: SavedActivityView[], id: string): SavedActivityView[] {
  return views.filter((view) => view.id !== id);
}
