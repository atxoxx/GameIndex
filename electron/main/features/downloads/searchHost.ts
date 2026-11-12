/**
 * Electron wiring for the download search pipeline.
 *
 * `search.ts` holds the pure merge/rank/dedupe/progress logic; this module
 * supplies the real inputs (the plugin runtime and the cached custom-source
 * index), forwards progress as `search-downloads-progress` events and owns the
 * per-`searchId` cancellation registry the renderer's streaming search uses.
 *
 * The renderer generates the `searchId` (`SourceContext.searchDownloadsStream`)
 * and listens for matching frames. A second invocation with the same id (or an
 * explicit `cancel: true`) supersedes/cancels the running search, and every run
 * always ends with an `isDone: true` frame so the modal cannot keep spinning.
 */
import { emit } from "../../ipc";
import { getPluginRuntime } from "../plugins";
import type { PluginDownloadResult } from "../plugins/types";
import { searchSources } from "../stores/sources";
import {
  DEFAULT_SEARCH_FILTERS,
  DownloadSearchProgress,
  SEARCH_MATCH_FLOOR,
  runDownloadSearch,
  type DownloadSearchDeps,
  type DownloadSearchFilters,
  type DownloadSearchPlugin,
  type DownloadSearchProgressEvent,
  type DownloadSearchResult,
} from "./search";

/** One in-flight search, keyed by the renderer's `searchId`. */
interface SearchRun {
  cancelled: boolean;
  /** A newer run (or an explicit cancel) owns the id now: stay silent. */
  superseded: boolean;
  startedAt: number;
}

const activeSearches = new Map<string, SearchRun>();
const SEARCH_EVENT = "search-downloads-progress";

function realDeps(): DownloadSearchDeps {
  const runtime = getPluginRuntime();
  return {
    listPlugins(): DownloadSearchPlugin[] {
      return runtime
        .list()
        .filter((plugin) => plugin.enabled)
        .map((plugin) => ({
          id: plugin.id,
          name: plugin.name || plugin.id,
          platformCategory: plugin.platformCategory || "pc",
        }));
    },
    searchPlugin(plugin, query, options): Promise<PluginDownloadResult[]> {
      // One plugin per call so each frame maps to exactly one source and a
      // single failing plugin cannot blank the whole result set.
      return runtime.searchWithPlugins(
        query,
        [
          {
            pluginId: plugin.id,
            name: plugin.name,
            platformCategory: plugin.platformCategory,
          },
        ],
        options,
      );
    },
    pluginError(pluginId: string): string | null {
      return runtime.get(pluginId)?.lastError ?? null;
    },
    searchSources(query: string) {
      return searchSources(query);
    },
  };
}

function asStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return out.length > 0 ? out : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface DownloadSearchRequest {
  query: string;
  aliases: readonly string[];
  releaseYear: number | null;
  filters: DownloadSearchFilters;
  searchId: string;
  /** The renderer asked to abort this id instead of starting a search. */
  cancel: boolean;
}

/**
 * Tolerant read of the search arguments. The renderer's current call site sends
 * `query`, `steamAppId`, `searchId`, `releaseYear` and `aliases`; the extra
 * filter keys are accepted so a future modal can narrow a search server-side
 * without a new command.
 */
export function parseDownloadSearchRequest(args: Record<string, unknown>): DownloadSearchRequest {
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const query = (text(args.query) || text(args.gameName) || text(args.game_name)).trim();
  const aliases = asStringList(args.aliases) ?? [];
  const releaseYear = asNumberOrNull(args.releaseYear ?? args.release_year);
  const filters: DownloadSearchFilters = {
    sourceIds:
      asStringList(args.sourceIds) ??
      asStringList(args.source_ids) ??
      asStringList(args.sources) ??
      DEFAULT_SEARCH_FILTERS.sourceIds,
    minScore:
      asNumberOrNull(args.minScore ?? args.min_score) ?? DEFAULT_SEARCH_FILTERS.minScore,
    sort: (text(args.sort) || text(args.sortBy) || text(args.sort_by)).trim() || null,
  };
  return {
    query,
    aliases,
    releaseYear,
    filters,
    searchId: text(args.searchId) || text(args.search_id),
    cancel: args.cancel === true || args.cancelled === true,
  };
}

/** Non-streaming search: merged, deduped, ranked, filtered. */
export async function searchDownloadSources(
  request: DownloadSearchRequest,
): Promise<DownloadSearchResult[]> {
  if (!request.query) return [];
  const outcome = await runDownloadSearch(
    {
      query: request.query,
      aliases: request.aliases,
      releaseYear: request.releaseYear,
      matchFloor: SEARCH_MATCH_FLOOR,
      filters: request.filters,
    },
    realDeps(),
  );
  return outcome.results;
}

/**
 * Streaming search. Emits coalesced per-source frames plus a terminal
 * `isDone: true` frame, and returns the same merged list the frames built.
 */
export async function streamDownloadSearch(
  request: DownloadSearchRequest,
): Promise<DownloadSearchResult[]> {
  const { searchId } = request;

  // A repeated id means the previous run is stale (modal reopened/retried).
  const previous = searchId ? activeSearches.get(searchId) : undefined;
  if (previous) {
    previous.cancelled = true;
    previous.superseded = true;
  }

  if (request.cancel) {
    if (searchId) {
      activeSearches.delete(searchId);
      emit(SEARCH_EVENT, {
        searchId,
        sourceName: "",
        completedSources: 1,
        totalSources: 1,
        newResults: [],
        isDone: true,
      } satisfies DownloadSearchProgressEvent);
    }
    return [];
  }

  if (!request.query) {
    if (searchId) {
      emit(SEARCH_EVENT, {
        searchId,
        sourceName: "",
        completedSources: 1,
        totalSources: 1,
        newResults: [],
        isDone: true,
      } satisfies DownloadSearchProgressEvent);
    }
    return [];
  }

  const deps = realDeps();
  let plugins: DownloadSearchPlugin[] = [];
  try {
    plugins = deps.listPlugins();
  } catch (error) {
    console.warn("[downloads] could not list plugins:", error);
  }
  const totalSources = 1 + plugins.length;

  const run: SearchRun = { cancelled: false, superseded: false, startedAt: Date.now() };
  if (searchId) activeSearches.set(searchId, run);

  const progress = new DownloadSearchProgress(searchId, totalSources, (event) => {
    emit(SEARCH_EVENT, event);
  });

  // Immediate frame so the modal shows a 0/N bar instead of an open-ended
  // spinner while the first (possibly slow) source runs.
  progress.announceStart();

  try {
    const outcome = await runDownloadSearch(
      {
        query: request.query,
        aliases: request.aliases,
        releaseYear: request.releaseYear,
        matchFloor: SEARCH_MATCH_FLOOR,
        filters: request.filters,
        isCancelled: () => run.cancelled,
        onSourceFinished: (sourceName, rows) => {
          if (run.cancelled || run.superseded) return;
          progress.sourceFinished(sourceName, rows);
        },
      },
      deps,
    );

    if (!run.superseded) {
      progress.finish(
        outcome.extraResults.length > 0 ? outcome.extraResults : undefined,
        undefined,
        run.cancelled || outcome.cancelled,
      );
    }
    return outcome.results;
  } catch (error) {
    // The pipeline is written not to throw, but a bug here must still end the
    // stream: emit the failure as a row and close the frame sequence.
    const message = error instanceof Error ? error.message : String(error);
    const failure: DownloadSearchResult = {
      id: "error:search",
      sourceName: "GameIndex",
      sourceId: "error:search",
      title: `Download search failed: ${message}`,
      fileSize: "",
      uris: [],
      magnet: null,
      uploadDate: null,
      matchScore: 0,
      isNew: false,
      provider: "source",
      platformCategory: "pc",
      description: message,
    };
    console.error("[downloads] search pipeline failed:", error);
    if (!run.superseded) progress.finish([failure], undefined, true);
    return [failure];
  } finally {
    progress.dispose();
    if (searchId && activeSearches.get(searchId) === run) activeSearches.delete(searchId);
  }
}

/** Cancel an in-flight search by id (idempotent). */
export function cancelDownloadSearch(searchId: string): void {
  const run = activeSearches.get(searchId);
  if (!run) return;
  run.cancelled = true;
  run.superseded = true;
  activeSearches.delete(searchId);
  emit(SEARCH_EVENT, {
    searchId,
    sourceName: "",
    completedSources: 1,
    totalSources: 1,
    newResults: [],
    isDone: true,
  } satisfies DownloadSearchProgressEvent);
}

/** Diagnostics used by the harness / settings page. */
export function activeDownloadSearches(): number {
  return activeSearches.size;
}
