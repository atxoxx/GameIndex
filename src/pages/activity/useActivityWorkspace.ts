import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ACTIVITY_RANGE_KEYS,
  DEFAULT_ACTIVITY_RANGE,
  type ActivityRangeKey,
} from "../../utils/activity/range";
import {
  ACTIVITY_TABS,
  type ActivityTab,
  type SavedActivityView,
} from "../../utils/activity/savedViews";
import {
  DEFAULT_SESSION_FILTERS,
  sanitizeSessionFilters,
  type ActivitySessionFilters,
} from "../../utils/activity/sessionQuery";

export type ActivitySessionView = "list" | "timeline";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function readEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readDay(value: string | null): string {
  return value && DATE_KEY.test(value) ? value : "";
}

export interface ActivityWorkspace {
  tab: ActivityTab;
  rangeKey: ActivityRangeKey;
  from: string;
  to: string;
  source: string;
  gameId: string | null;
  filters: ActivitySessionFilters;
  sessionView: ActivitySessionView;
  update: (patch: Partial<ActivityWorkspace>, options?: { push?: boolean }) => void;
  setCustomRange: (from: string, to: string) => void;
  applySavedView: (view: SavedActivityView) => void;
  resetScope: () => void;
  isDefaultScope: boolean;
}

/**
 * URL-backed state for the Activity page.
 *
 * The URL is the source of truth so every scope is shareable and the Back
 * button undoes a navigation. Only non-default values are written, which
 * keeps a plain `/activity` clean and a deep link self-describing.
 */
export function useActivityWorkspace(): ActivityWorkspace {
  const [params, setParams] = useSearchParams();

  const tab = readEnum(params.get("tab"), ACTIVITY_TABS, "overview");
  const rangeKey = readEnum(params.get("range"), ACTIVITY_RANGE_KEYS, DEFAULT_ACTIVITY_RANGE);
  const from = readDay(params.get("from"));
  const to = readDay(params.get("to"));
  const source = params.get("source")?.trim() || "all";
  const gameId = params.get("game")?.trim() || null;
  const sessionView = readEnum<ActivitySessionView>(
    params.get("view"),
    ["list", "timeline"],
    "list",
  );
  const filters = useMemo(
    () =>
      sanitizeSessionFilters({
        telemetry: params.get("sData"),
        duration: params.get("sDur"),
        sort: params.get("sSort"),
        dir: params.get("sDir"),
        density: params.get("sDen"),
      }),
    [params],
  );

  const update = useCallback(
    (patch: Partial<ActivityWorkspace>, options?: { push?: boolean }) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          const apply = <T extends string>(name: string, value: T, fallback: T) => {
            if (value === fallback) next.delete(name);
            else next.set(name, value);
          };

          if (patch.tab !== undefined) apply("tab", patch.tab, "overview");
          if (patch.rangeKey !== undefined) apply("range", patch.rangeKey, DEFAULT_ACTIVITY_RANGE);
          if (patch.source !== undefined) apply("source", patch.source || "all", "all");
          if (patch.sessionView !== undefined) apply("view", patch.sessionView, "list");

          if (patch.gameId !== undefined) {
            if (patch.gameId) next.set("game", patch.gameId);
            else next.delete("game");
          }

          const nextRange = patch.rangeKey ?? rangeKey;
          const nextFrom = patch.from ?? from;
          const nextTo = patch.to ?? to;
          if (nextRange === "custom") {
            if (nextFrom) next.set("from", nextFrom);
            else next.delete("from");
            if (nextTo) next.set("to", nextTo);
            else next.delete("to");
          } else {
            next.delete("from");
            next.delete("to");
          }

          if (patch.filters) {
            const merged = sanitizeSessionFilters({ ...filters, ...patch.filters });
            const write = (name: string, value: string, fallback: string) => {
              if (value === fallback) next.delete(name);
              else next.set(name, value);
            };
            write("sData", merged.telemetry, DEFAULT_SESSION_FILTERS.telemetry);
            write("sDur", merged.duration, DEFAULT_SESSION_FILTERS.duration);
            write("sSort", merged.sort, DEFAULT_SESSION_FILTERS.sort);
            write("sDir", merged.dir, DEFAULT_SESSION_FILTERS.dir);
            write("sDen", merged.density, DEFAULT_SESSION_FILTERS.density);
          }

          return next;
        },
        { replace: !options?.push },
      );
    },
    [filters, from, rangeKey, setParams, to],
  );

  const setCustomRange = useCallback(
    (nextFrom: string, nextTo: string) => {
      update({ rangeKey: "custom", from: nextFrom, to: nextTo });
    },
    [update],
  );

  const applySavedView = useCallback(
    (view: SavedActivityView) => {
      update(
        {
          tab: view.tab,
          rangeKey: view.rangeKey,
          from: view.from,
          to: view.to,
          source: view.source,
          gameId: view.gameId,
          filters: view.filters,
        },
        { push: true },
      );
    },
    [update],
  );

  const resetScope = useCallback(() => {
    update({
      rangeKey: DEFAULT_ACTIVITY_RANGE,
      from: "",
      to: "",
      source: "all",
      gameId: null,
      filters: DEFAULT_SESSION_FILTERS,
    });
  }, [update]);

  const isDefaultScope =
    rangeKey === DEFAULT_ACTIVITY_RANGE &&
    !from &&
    !to &&
    source === "all" &&
    !gameId &&
    JSON.stringify(filters) === JSON.stringify(DEFAULT_SESSION_FILTERS);

  return {
    tab,
    rangeKey,
    from,
    to,
    source,
    gameId,
    filters,
    sessionView,
    update,
    setCustomRange,
    applySavedView,
    resetScope,
    isDefaultScope,
  };
}
