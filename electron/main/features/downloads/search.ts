/**
 * Download search pipeline (sources + plugins) — pure logic.
 *
 * Ported from the retired Rust commands in `src-tauri/src/plugins/mod.rs`:
 *
 *  - `search_downloads` (merged, non-streaming search), and
 *  - `search_downloads_stream` (`search-downloads-progress` frames).
 *
 * The Rust build searched its FTS index for built-in sources and ran every
 * enabled plugin in a sandbox. This build keeps the same result shape
 * (`MatchedDownload` + the plugin extensions the modal reads) but sources the
 * two halves from `features/stores/sources.ts` (cached catalogues) and the
 * plugin runtime (`searchWithPlugins`).
 *
 * Everything here is dependency-free on purpose: `searchHost.ts` injects the
 * real plugin runtime / source cache / IPC emitter, and the `%TEMP%` harness
 * injects fakes, so the merge, ranking, dedupe, progress and cancellation
 * behaviour can be exercised without Electron.
 */
import type { MatchedDownload } from "../../../../src/types/source";
import type { PluginDownloadResult, PluginSearchOptions } from "../plugins/types";
import { cleanSearchQuery, normalizeTitle } from "../plugins/scoring";

/**
 * One combined search hit — the renderer's `DownloadSearchResult`
 * (`src/types/plugins.ts`). Field names are the wire contract: do not rename.
 *
 * `id` is carried by the Rust wire format (`sourceId` for source hits,
 * `pluginId:rawId` for plugins); the modal assigns its own display id, but the
 * update checker and dedupe diagnostics read this one.
 */
export interface DownloadSearchResult extends MatchedDownload {
  id?: string;
  /** "source" = cached custom-source match, "plugin" = plugin result. */
  provider: "source" | "plugin";
  pluginId?: string;
  infohash?: string | null;
  seeds?: number | null;
  peers?: number | null;
  torrentUrl?: string | null;
  verified?: boolean | null;
  detailUrl?: string | null;
  platform?: string | null;
  provenance?: string | null;
  referer?: string | null;
  platformCategory?: string;
  matchTitle?: string | null;
  fileList?: { name: string; size: number }[] | null;
  checksums?: { algo: string; value: string }[] | null;
  version?: string | null;
  region?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  releaseGroup?: string | null;
  recommended?: boolean | null;
}

/** `search-downloads-progress` payload (renderer `SearchProgressEvent`). */
export interface DownloadSearchProgressEvent {
  searchId: string;
  sourceName: string;
  completedSources: number;
  totalSources: number;
  newResults: DownloadSearchResult[];
  isDone: boolean;
}

/** Optional narrowing the renderer may send alongside a search. */
export interface DownloadSearchFilters {
  /** Source ids / plugin ids / source names to keep (case-insensitive). */
  sourceIds: string[] | null;
  /** Drop rows below this score (0..1). `null` keeps the pipeline default. */
  minScore: number | null;
  /** `relevance` | `date` | `seeds` | `size_desc` | `size_asc` | `source`. */
  sort: string | null;
}

export const DEFAULT_SEARCH_FILTERS: DownloadSearchFilters = {
  sourceIds: null,
  minScore: null,
  sort: null,
};

/** One enabled plugin, as the search pipeline needs it. */
export interface DownloadSearchPlugin {
  id: string;
  name: string;
  platformCategory: string;
}

/** Everything the pipeline needs from the host (injected for testability). */
export interface DownloadSearchDeps {
  /** Every enabled plugin (disabled plugins never run). */
  listPlugins(): DownloadSearchPlugin[];
  /** Run one plugin and return its already-scored conversion. */
  searchPlugin(
    plugin: DownloadSearchPlugin,
    query: string,
    options: PluginSearchOptions,
  ): Promise<PluginDownloadResult[]>;
  /** The runtime's `lastError` for a plugin, or null when the last run worked. */
  pluginError(pluginId: string): string | null;
  /** Cached custom-source matches (`searchSources`). */
  searchSources(query: string): MatchedDownload[];
  /** Progress sink; the host forwards it to `search-downloads-progress`. */
  emitProgress?(event: DownloadSearchProgress): void;
}

export interface DownloadSearchOptions {
  query: string;
  aliases?: readonly string[];
  releaseYear?: number | null;
  /** Minimum similarity for a plugin row (default 0.2, the Rust floor). */
  matchFloor?: number;
  filters?: DownloadSearchFilters;
  /** Per-plugin wall-clock budget; a slow plugin becomes an error entry. */
  pluginTimeoutMs?: number;
  /** Cooperative cancellation (a superseded/cancelled searchId). */
  isCancelled?: () => boolean;
  /**
   * Called once per finished source with that source's unfiltered-but-narrowed
   * rows, in completion order. The streaming command forwards these as
   * progress frames.
   */
  onSourceFinished?: (sourceName: string, rows: DownloadSearchResult[]) => void;
}

export interface DownloadSearchOutcome {
  /** Merged, deduped, ranked and filtered rows. */
  results: DownloadSearchResult[];
  /**
   * Rows produced only after every source finished (plugin-list failure, the
   * "nothing configured" notice). They were never part of a per-source frame,
   * so the streaming command appends them to the terminal frame.
   */
  extraResults: DownloadSearchResult[];
  completedSources: number;
  totalSources: number;
  cancelled: boolean;
}

/** Same floor the plugin runtime and cached-source search use. */
export const SEARCH_MATCH_FLOOR = 0.2;
const DEFAULT_PLUGIN_TIMEOUT_MS = 45_000;
const MAX_ALIASES = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeQueryAliases(aliases: readonly string[] | undefined, query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of aliases ?? []) {
    const alias = typeof raw === "string" ? raw.trim() : "";
    if (!alias || seen.has(alias) || alias === query) continue;
    seen.add(alias);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

// ─── Result conversion ──────────────────────────────────────────────────────

/** Widen a cached-source match into the merged download-search shape. */
export function fromSourceMatch(match: MatchedDownload): DownloadSearchResult {
  return {
    ...match,
    // Rust set the row id to the source id for built-in source hits.
    id: match.sourceId,
    provider: "source",
    infohash: null,
    seeds: null,
    peers: null,
    torrentUrl: null,
    verified: null,
    detailUrl: null,
    platform: null,
    provenance: null,
    referer: null,
    platformCategory: "pc",
    matchTitle: null,
    fileList: null,
    checksums: null,
    version: null,
    region: null,
    coverUrl: null,
    description: null,
    releaseGroup: null,
    recommended: null,
  };
}

/** Convert a plugin runtime row; `provider`/`pluginId` are already set. */
export function fromPluginResult(row: PluginDownloadResult): DownloadSearchResult {
  return { ...row, provider: "plugin" };
}

/**
 * A per-source error surfaced as a result row. The modal has no dedicated
 * error channel, so the reason is carried both in the title (always rendered)
 * and in `description` (inspector) — never a silent empty list.
 */
export function sourceErrorResult(
  sourceName: string,
  sourceId: string,
  provider: "source" | "plugin",
  message: string,
  platformCategory = "pc",
): DownloadSearchResult {
  const reason = message.trim() || "unknown error";
  const title = `${sourceName} — search failed: ${reason}`.slice(0, 300);
  return {
    id: `error:${provider}:${sourceId}`,
    sourceName,
    sourceId,
    title,
    fileSize: "",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 0,
    isNew: false,
    provider,
    ...(provider === "plugin" ? { pluginId: sourceId } : {}),
    infohash: null,
    seeds: null,
    peers: null,
    torrentUrl: null,
    verified: null,
    detailUrl: null,
    platform: null,
    provenance: null,
    referer: null,
    platformCategory,
    matchTitle: null,
    fileList: null,
    checksums: null,
    version: null,
    region: null,
    coverUrl: null,
    description: reason,
    releaseGroup: null,
    recommended: null,
  };
}

/** The "nothing is configured" notice (never a silent empty list). */
export function emptySetupNotice(): DownloadSearchResult {
  const message =
    "No download sources are enabled — enable a plugin or add a custom source in Settings → Sources.";
  return {
    id: "notice:no-sources",
    sourceName: "GameIndex",
    sourceId: "__gameindex_notice",
    title: message,
    fileSize: "",
    uris: [],
    magnet: null,
    uploadDate: null,
    matchScore: 1,
    isNew: false,
    provider: "source",
    infohash: null,
    seeds: null,
    peers: null,
    torrentUrl: null,
    verified: null,
    detailUrl: null,
    platform: null,
    provenance: null,
    referer: null,
    platformCategory: "pc",
    matchTitle: null,
    fileList: null,
    checksums: null,
    version: null,
    region: null,
    coverUrl: null,
    description: message,
    releaseGroup: null,
    recommended: null,
  };
}

function isDiagnosticRow(row: DownloadSearchResult): boolean {
  const id = row.id ?? "";
  return (
    row.sourceId.startsWith("__") ||
    row.sourceId.startsWith("error:") ||
    id.startsWith("error:") ||
    id.startsWith("notice:")
  );
}

// ─── Ranking ────────────────────────────────────────────────────────────────

/**
 * Effective ordering score.
 *
 * `matchScore` is the primary term (both halves of the search score against
 * the same title-similarity heuristics). "Source priority" is added on top:
 * built-in cached sources sort just above plugins on a tie (the Rust build
 * listed sources first), an explicit `recommended` flag ranks next, then
 * `verified`, and a tiny per-source position term keeps the order stable and
 * deterministic across identical scores.
 */
export function rankScore(row: DownloadSearchResult, sourceOrder: number, sourceCount: number): number {
  const positionBoost =
    sourceCount > 1 ? ((sourceCount - sourceOrder) / (sourceCount * 1000)) : 0;
  return (
    row.matchScore +
    (row.provider === "source" ? 0.01 : 0) +
    (row.recommended === true ? 0.03 : 0) +
    (row.verified === true ? 0.02 : 0) +
    positionBoost
  );
}

function compareRanked(
  a: { row: DownloadSearchResult; rank: number; order: number },
  b: { row: DownloadSearchResult; rank: number; order: number },
): number {
  if (b.rank !== a.rank) return b.rank - a.rank;
  const seeds = (b.row.seeds ?? 0) - (a.row.seeds ?? 0);
  if (seeds !== 0) return seeds;
  const aDate = a.row.uploadDate ? Date.parse(a.row.uploadDate) : 0;
  const bDate = b.row.uploadDate ? Date.parse(b.row.uploadDate) : 0;
  if (Number.isFinite(aDate) && Number.isFinite(bDate) && bDate !== aDate) {
    return bDate - aDate;
  }
  const title = a.row.title.localeCompare(b.row.title, undefined, { sensitivity: "base" });
  if (title !== 0) return title;
  return a.order - b.order;
}

// ─── Dedupe ─────────────────────────────────────────────────────────────────

function btihOf(row: DownloadSearchResult): string | null {
  const raw = row.infohash?.trim().toLowerCase() ?? "";
  if (/^[0-9a-f]{40}$/.test(raw)) return raw;
  for (const uri of [row.magnet, ...(row.uris ?? [])]) {
    if (!uri || !uri.startsWith("magnet:")) continue;
    const hash = magnetHash(uri);
    if (hash) return hash;
  }
  return null;
}

function magnetHash(uri: string): string | null {
  const match = /[?&]xt=urn:btih:([0-9a-fA-F]{40})/.exec(uri);
  return match ? match[1].toLowerCase() : null;
}

function normalizeUrlKey(uri: string): string {
  const trimmed = uri.trim();
  try {
    const parsed = new URL(trimmed);
    // Scheme/host case never matters; the path stays case-sensitive.
    return `u:${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
  } catch {
    return `u:${trimmed.toLowerCase()}`;
  }
}

/**
 * Identity keys for cross-provider dedupe, best first: the torrent's infohash,
 * any resolved URL/magnet, then the normalised multi-word title (which is what
 * catches the same release mirrored on two hosts under different links).
 */
export function identityKeys(row: DownloadSearchResult): string[] {
  const keys: string[] = [];
  const hash = btihOf(row);
  if (hash) keys.push(`h:${hash}`);
  const urls = new Set<string>();
  if (row.torrentUrl && row.torrentUrl.trim()) urls.add(row.torrentUrl.trim());
  for (const uri of row.uris ?? []) {
    if (typeof uri === "string" && uri.trim() && !uri.startsWith("magnet:")) {
      urls.add(uri.trim());
    }
  }
  for (const uri of urls) keys.push(normalizeUrlKey(uri));
  const title = normalizeTitle(row.title ?? "");
  if (title.split(/\s+/).filter(Boolean).length >= 2) keys.push(`t:${title}`);
  return keys;
}

function mergeInto(kept: DownloadSearchResult, incoming: DownloadSearchResult): void {
  const winner = incoming.matchScore > kept.matchScore ? incoming : kept;
  const loser = incoming.matchScore > kept.matchScore ? kept : incoming;

  const uris = [...(winner.uris ?? [])];
  for (const uri of loser.uris ?? []) {
    if (uri && !uris.includes(uri)) uris.push(uri);
  }
  const pick = <T>(a: T | null | undefined, b: T | null | undefined): T | null =>
    a === null || a === undefined || a === "" ? (b ?? null) : a;
  const max = (a: number | null | undefined, b: number | null | undefined): number | null => {
    if (a === null || a === undefined) return b ?? null;
    if (b === null || b === undefined) return a;
    return Math.max(a, b);
  };

  Object.assign(kept, winner, {
    uris,
    magnet: pick(winner.magnet, loser.magnet),
    infohash: pick(winner.infohash, loser.infohash),
    torrentUrl: pick(winner.torrentUrl, loser.torrentUrl),
    uploadDate: pick(winner.uploadDate, loser.uploadDate),
    verified: winner.verified ?? loser.verified ?? null,
    seeds: max(winner.seeds, loser.seeds),
    peers: max(winner.peers, loser.peers),
    matchTitle: pick(winner.matchTitle, loser.matchTitle),
    fileList: winner.fileList ?? loser.fileList ?? null,
    checksums: winner.checksums ?? loser.checksums ?? null,
    matchScore: Math.max(winner.matchScore, loser.matchScore),
  });
}

/** Collapse duplicate releases (same infohash, URL or normalised title). */
export function dedupeResults(rows: DownloadSearchResult[]): DownloadSearchResult[] {
  const out: DownloadSearchResult[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    if (isDiagnosticRow(row)) {
      out.push(row);
      continue;
    }
    const keys = identityKeys(row);
    let at: number | undefined;
    for (const key of keys) {
      const found = index.get(key);
      if (found !== undefined) {
        at = found;
        break;
      }
    }
    if (at === undefined) {
      const position = out.length;
      out.push(row);
      for (const key of keys) if (!index.has(key)) index.set(key, position);
      continue;
    }
    mergeInto(out[at], row);
    for (const key of keys) if (!index.has(key)) index.set(key, at);
  }
  return out;
}

// ─── Filtering / sorting ────────────────────────────────────────────────────

export function rowMatchesFilters(
  row: DownloadSearchResult,
  filters: DownloadSearchFilters,
): boolean {
  if (filters.minScore !== null && filters.minScore !== undefined) {
    // Diagnostics always survive: hiding the reason a search failed is exactly
    // the bug this pipeline exists to fix.
    if (!isDiagnosticRow(row) && row.matchScore < filters.minScore) return false;
  }
  const wanted = filters.sourceIds;
  if (wanted && wanted.length > 0) {
    if (isDiagnosticRow(row)) return true;
    const haystack = [row.sourceId, row.pluginId ?? "", row.sourceName].map((value) =>
      value.toLowerCase(),
    );
    const hit = wanted.some((entry) => {
      const needle = String(entry).trim().toLowerCase();
      return needle.length > 0 && haystack.includes(needle);
    });
    if (!hit) return false;
  }
  return true;
}

function sortValueDate(row: DownloadSearchResult): number {
  if (!row.uploadDate) return 0;
  const parsed = Date.parse(row.uploadDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseSizeToBytes(value: string | null | undefined): number {
  if (!value) return 0;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/.exec(value.trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  const unit = (match[2] ?? "B").toUpperCase();
  const factor: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
  };
  return amount * (factor[unit] ?? 1);
}

/** Deterministic sort for one or both provider blocks. */
export function sortResults(
  rows: DownloadSearchResult[],
  sort: string | null,
  rankOf: (row: DownloadSearchResult) => number,
): DownloadSearchResult[] {
  const copy = [...rows];
  const key = (sort ?? "").trim().toLowerCase();
  if (!key || key === "recommended" || key === "relevance" || key === "score" || key === "ranked") {
    copy.sort(
      (a, b) =>
        rankOf(b) - rankOf(a) ||
        (b.seeds ?? 0) - (a.seeds ?? 0) ||
        sortValueDate(b) - sortValueDate(a),
    );
    return copy;
  }
  const comparator = (a: DownloadSearchResult, b: DownloadSearchResult): number => {
    switch (key) {
      case "date":
      case "newest":
        return sortValueDate(b) - sortValueDate(a) || rankOf(b) - rankOf(a);
      case "seeds":
        return (b.seeds ?? 0) - (a.seeds ?? 0) || rankOf(b) - rankOf(a);
      case "size_desc":
        return parseSizeToBytes(b.fileSize) - parseSizeToBytes(a.fileSize) || rankOf(b) - rankOf(a);
      case "size_asc":
        return parseSizeToBytes(a.fileSize) - parseSizeToBytes(b.fileSize) || rankOf(b) - rankOf(a);
      case "source":
      case "name":
        return (
          a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: "base" }) ||
          rankOf(b) - rankOf(a)
        );
      default:
        return rankOf(b) - rankOf(a);
    }
  };
  copy.sort(comparator);
  return copy;
}

// ─── Progress reporting ─────────────────────────────────────────────────────

/**
 * Coalescing progress emitter. The Rust command emitted one frame per finished
 * source; with several fast plugins that can be dozens of frames in a few
 * milliseconds, so frames inside `throttleMs` are merged into the next one.
 * `finish` always flushes a terminal `isDone` frame, so the modal can never be
 * left spinning.
 */
export class DownloadSearchProgress {
  private completed = 0;
  private pending: DownloadSearchResult[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastEmit = 0;
  private lastSource = "";
  private disposed = false;

  constructor(
    private readonly searchId: string,
    private readonly totalSources: number,
    private readonly sink: (event: DownloadSearchProgressEvent) => void,
    private readonly throttleMs = 120,
  ) {}

  get completedSources(): number {
    return this.completed;
  }

  /** Record one finished source and (throttled) notify the renderer. */
  sourceFinished(sourceName: string, results: DownloadSearchResult[]): void {
    if (this.disposed) return;
    this.completed += 1;
    this.lastSource = sourceName;
    if (results.length > 0) this.pending.push(...results);
    const wait = this.throttleMs - (Date.now() - this.lastEmit);
    if (wait <= 0) {
      this.flush(false);
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush(false);
    }, Math.max(0, wait));
    this.timer.unref?.();
  }

  private flush(isDone: boolean, append?: DownloadSearchResult[]): void {
    if (this.disposed && !isDone) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const newResults =
      append && append.length > 0 ? [...this.pending, ...append] : this.pending;
    this.pending = [];
    this.lastEmit = Date.now();
    // Always leave at least one 100 % frame at the end of the run.
    const total = isDone ? Math.max(this.totalSources, this.completed) : this.totalSources;
    this.sink({
      searchId: this.searchId,
      sourceName: this.lastSource,
      completedSources: this.completed,
      totalSources: total,
      newResults,
      isDone,
    });
  }

  /** First frame (0/N) so the UI can render a bar before any source lands. */
  announceStart(): void {
    if (this.disposed) return;
    this.flush(false);
  }

  /**
   * Emit the terminal frame. `results` are appended to anything that arrived
   * since the previous frame (the streaming command passes the extra rows that
   * were never part of a per-source frame); omitting it flushes the buffer.
   * `completeAll` marks a cancelled run as 100 % so the UI never shows a
   * half-finished bar after it stops.
   */
  finish(results?: DownloadSearchResult[], sourceName?: string, completeAll = false): void {
    if (this.disposed) return;
    if (sourceName) this.lastSource = sourceName;
    if (completeAll) this.completed = Math.max(this.completed, this.totalSources);
    this.flush(true, results);
    this.disposed = true;
  }

  /** Stop emitting without a terminal frame (used after a cancellation). */
  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = [];
  }
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!(ms > 0)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface SourceOutcome {
  rows: DownloadSearchResult[];
  sourceName: string;
}

/**
 * Run every enabled plugin plus the cached custom-source index, then merge,
 * dedupe, rank and filter. Never rejects: a broken plugin/source becomes an
 * error row, and `progress` (when given) receives coalesced frames plus a
 * terminal one.
 */
export async function runDownloadSearch(
  options: DownloadSearchOptions,
  deps: DownloadSearchDeps,
): Promise<DownloadSearchOutcome> {
  const query = typeof options.query === "string" ? options.query.trim() : "";
  const filters = options.filters ?? DEFAULT_SEARCH_FILTERS;

  if (!query) {
    return {
      results: [],
      extraResults: [],
      completedSources: 0,
      totalSources: 0,
      cancelled: false,
    };
  }

  const aliases = normalizeQueryAliases(options.aliases, query);
  const releaseYear =
    typeof options.releaseYear === "number" && Number.isFinite(options.releaseYear)
      ? Math.trunc(options.releaseYear)
      : null;
  const pluginOptions: PluginSearchOptions = {
    aliases,
    releaseYear,
    matchFloor: options.matchFloor ?? SEARCH_MATCH_FLOOR,
  };
  const timeoutMs = options.pluginTimeoutMs ?? DEFAULT_PLUGIN_TIMEOUT_MS;
  const isCancelled = options.isCancelled ?? (() => false);

  let plugins: DownloadSearchPlugin[] = [];
  let listError: string | null = null;
  try {
    plugins = deps.listPlugins();
  } catch (error) {
    listError = errorMessage(error);
  }

  const outcomes: SourceOutcome[] = [];
  let cancelled = false;
  const announce = (outcome: SourceOutcome): SourceOutcome => {
    if (cancelled || (options.isCancelled?.() ?? false)) {
      cancelled = true;
    } else {
      options.onSourceFinished?.(outcome.sourceName, outcome.rows);
    }
    outcomes.push(outcome);
    return outcome;
  };

  // ── Cached custom sources ──────────────────────────────────────────────
  const sourcesTask = (async (): Promise<SourceOutcome> => {
    try {
      const rows = deps
        .searchSources(query)
        .map(fromSourceMatch)
        .filter((row) => rowMatchesFilters(row, filters));
      return announce({ rows, sourceName: "Sources" });
    } catch (error) {
      return announce({
        rows: [sourceErrorResult("Sources", "sources", "source", errorMessage(error))],
        sourceName: "Sources",
      });
    }
  })();

  // ── One task per enabled plugin ────────────────────────────────────────
  const pluginTasks = plugins.map((plugin): Promise<SourceOutcome> => {
    return (async (): Promise<SourceOutcome> => {
      if (isCancelled()) {
        cancelled = true;
        return { rows: [], sourceName: plugin.name };
      }
      const results: PluginDownloadResult[] = [];
      try {
        let rows = await withTimeout(
          deps.searchPlugin(plugin, query, pluginOptions),
          timeoutMs,
          `${plugin.name} search`,
        );
        if (rows.length === 0) {
          // Verbose titles miss upstream substring indexes; retry once with the
          // cleaned short query, exactly like the Rust pipeline.
          const cleaned = cleanSearchQuery(query);
          if (cleaned && cleaned !== query) {
            const retry = await withTimeout(
              deps.searchPlugin(plugin, cleaned, pluginOptions),
              timeoutMs,
              `${plugin.name} search`,
            );
            if (retry.length > 0) rows = retry;
          }
        }
        results.push(...rows);
      } catch (error) {
        return announce({
          rows: [
            sourceErrorResult(
              plugin.name,
              plugin.id,
              "plugin",
              errorMessage(error),
              plugin.platformCategory,
            ),
          ],
          sourceName: plugin.name,
        });
      }

      // A plugin that "succeeded" with zero rows can still have recorded a
      // runtime error (the sandbox swallows per-plugin failures by design).
      const recorded = deps.pluginError(plugin.id);
      if (recorded && results.length === 0) {
        return announce({
          rows: [
            sourceErrorResult(plugin.name, plugin.id, "plugin", recorded, plugin.platformCategory),
          ],
          sourceName: plugin.name,
        });
      }

      return announce({
        rows: results
          .map(fromPluginResult)
          .filter((row) => rowMatchesFilters(row, filters)),
        sourceName: plugin.name,
      });
    })();
  });

  await Promise.all([sourcesTask, ...pluginTasks]);

  // Merge in a deterministic source order (built-in sources first, then plugins
  // by name) rather than completion order, so the final ranking — and the
  // dedupe winner between two equal-score mirrors — does not depend on which
  // network call answered first.
  const orderedOutcomes = [...outcomes].sort((a, b) => {
    const aBuiltIn = a.sourceName === "Sources" ? 0 : 1;
    const bBuiltIn = b.sourceName === "Sources" ? 0 : 1;
    if (aBuiltIn !== bBuiltIn) return aBuiltIn - bBuiltIn;
    return a.sourceName.localeCompare(b.sourceName, undefined, { sensitivity: "base" });
  });

  let rows = orderedOutcomes.flatMap((outcome) => outcome.rows);
  const extraResults: DownloadSearchResult[] = [];
  if (listError !== null) {
    const row = sourceErrorResult("Plugins", "plugins", "plugin", listError);
    rows.push(row);
    extraResults.push(row);
  }
  if (!cancelled && isCancelled()) cancelled = true;

  // ── Notice when nothing at all is configured ──────────────────────────
  if (!cancelled && plugins.length === 0 && rows.length === 0) {
    const notice = emptySetupNotice();
    rows.push(notice);
    extraResults.push(notice);
  }

  // ── Merge, dedupe, rank ───────────────────────────────────────────────
  const sourceOrder = new Map<string, number>();
  for (const outcome of orderedOutcomes) {
    if (!sourceOrder.has(outcome.sourceName)) sourceOrder.set(outcome.sourceName, sourceOrder.size);
  }
  const ranked = dedupeResults(rows).map((row, order) => ({
    row,
    order,
    rank: rankScore(
      row,
      sourceOrder.get(row.sourceName) ?? sourceOrder.size,
      Math.max(1, sourceOrder.size),
    ),
  }));
  ranked.sort(compareRanked);

  const ordered = ranked.map((entry) => entry.row);
  const rankLookup = new Map<DownloadSearchResult, number>();
  for (const entry of ranked) rankLookup.set(entry.row, entry.rank);
  const results = sortResults(ordered, filters.sort, (row) => rankLookup.get(row) ?? row.matchScore);

  return {
    results,
    extraResults,
    completedSources: outcomes.length,
    totalSources: 1 + plugins.length,
    cancelled,
  };
}

/**
 * Source-count helper shared by the streaming command (the terminal frame must
 * know how many sources the run expects before any of them finish).
 */
export function countSearchSources(deps: Pick<DownloadSearchDeps, "listPlugins">): {
  plugins: DownloadSearchPlugin[];
  totalSources: number;
} {
  let plugins: DownloadSearchPlugin[] = [];
  try {
    plugins = deps.listPlugins();
  } catch {
    plugins = [];
  }
  return { plugins, totalSources: 1 + plugins.length };
}
