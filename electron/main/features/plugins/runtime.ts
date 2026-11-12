/**
 * Plugin manager: install/toggle/config/search/availability.
 *
 * Ported from `src-tauri/src/plugins/mod.rs` (`PluginManager` + the
 * `plugins_*` Tauri commands). Behavioural notes:
 *
 * - `plugins_import_file` only reads, hashes and validates; nothing is
 *   persisted until `plugins_install` re-verifies the hash and re-evaluates.
 * - Every search evaluates the source in a brand-new sandbox and is cached per
 *   `(plugin, query)` for `cacheTtlSecs` (default 15 min, capped at 1 h).
 * - One failing plugin never fails the whole search: the error is recorded in
 *   `lastError`, the other plugins continue.
 * - `plugins_check_availability` reports one row per enabled plugin, including
 *   plugins that found nothing or errored.
 */
import fs from "node:fs";

import { httpText } from "../../lib/http";
import {
  evaluatePluginSource,
  runPluginSearch,
  type HttpTextFn,
  type SandboxLimits,
} from "./sandbox";
import {
  MAX_PLUGIN_SOURCE_BYTES,
  assertValidPluginId,
  normalizePlatformCategory,
  toStoredManifest,
  type PluginManifest,
} from "./manifest";
import {
  PluginRegistry,
  sha256Hex,
  type PluginConfigStore,
  type PluginDocumentStore,
  type SecretCipher,
} from "./registry";
import {
  applyReleaseYearAdjustment,
  bestTitleSimilarity,
  cleanSearchQuery,
  normalizeTitle,
} from "./scoring";
import type {
  PluginAvailabilityHit,
  PluginBulkToggleResult,
  PluginCandidate,
  PluginDownloadResult,
  PluginInfo,
  PluginRawResult,
  PluginRecord,
  PluginSearchOptions,
  PluginSearchSource,
} from "./types";

/** Same match floor the cached-source search applies. */
export const MIN_MATCH_SCORE = 0.2;
const PLUGIN_CACHE_TTL_MS = 15 * 60 * 1000;
const PLUGIN_CACHE_MAX_ENTRIES = 64;
const MAX_ALIASES = 8;

export interface InstallPluginArgs {
  /** Candidate returned by `plugins_import_file`. */
  candidate?: Partial<PluginCandidate> | null;
  /** Inline source, for renderer flows that keep the file contents. */
  source?: string;
  /** Alias for `source`. */
  script?: string;
}

export interface PluginRuntimeOptions {
  /** `userData/plugins`. */
  baseDir: string;
  document: PluginDocumentStore;
  cipher?: SecretCipher | null;
  /** Where secret config values live (SQLite in the app, file in tests). */
  configStore?: PluginConfigStore;
  httpText?: HttpTextFn;
  limits?: SandboxLimits;
  logger?: (...args: unknown[]) => void;
  now?: () => number;
}

interface CachedResults {
  at: number;
  results: PluginRawResult[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pluginIdOf(source: string | PluginSearchSource | null | undefined): string | null {
  if (typeof source === "string") return source.trim() || null;
  if (!source || typeof source !== "object") return null;
  if (typeof source.pluginId === "string" && source.pluginId.trim()) {
    return source.pluginId.trim();
  }
  if (typeof source.id === "string" && source.id.trim()) return source.id.trim();
  if (typeof source.url === "string" && source.url.startsWith("plugin:")) {
    return source.url.slice("plugin:".length).trim() || null;
  }
  return null;
}

function normalizeAliases(aliases: readonly string[] | undefined, query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of aliases ?? []) {
    const alias = typeof raw === "string" ? raw.trim() : "";
    if (!alias || alias === query || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
    if (out.length >= MAX_ALIASES) break;
  }
  return out;
}

function formatUploadDate(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class PluginRuntime {
  private readonly registry: PluginRegistry;
  private readonly httpText: HttpTextFn;
  private readonly limits: SandboxLimits;
  private readonly logger: (...args: unknown[]) => void;
  private readonly cache = new Map<string, CachedResults>();

  constructor(options: PluginRuntimeOptions) {
    this.logger = options.logger ?? ((...args) => console.warn(...args));
    this.registry = new PluginRegistry({
      baseDir: options.baseDir,
      document: options.document,
      cipher: options.cipher ?? null,
      configStore: options.configStore,
      now: options.now,
      logger: this.logger,
    });
    this.httpText =
      options.httpText ??
      ((url, requestOptions) => httpText(url, requestOptions));
    this.limits = options.limits ?? {};
  }

  // ── Inventory ─────────────────────────────────────────────────────────

  list(): PluginInfo[] {
    const records = this.registry.list();
    for (const record of records) {
      if (record.lastError !== null) continue;
      // A file deleted/renamed on disk is the one failure the index cannot see
      // on its own. Flag it here (the Rust build did this at startup) so the
      // Settings row explains why the plugin stopped working.
      try {
        if (!fs.existsSync(this.registry.sourcePath(record.id))) {
          record.lastError = "Plugin file is missing";
          this.registry.patch(record.id, { lastError: record.lastError });
        }
      } catch (error) {
        this.logger(`[plugins] could not check ${record.id}:`, error);
      }
    }
    return records.map(toInfo);
  }

  get(id: string): PluginInfo | null {
    const record = this.registry.get(id);
    return record ? toInfo(record) : null;
  }

  // ── Import / install / remove ─────────────────────────────────────────

  /**
   * Validate a plugin file without installing it. The returned candidate keeps
   * the source path so `plugins_install` can re-read and re-hash the file the
   * user actually confirmed.
   */
  async importFile(filePath: string): Promise<PluginCandidate> {
    const file = typeof filePath === "string" ? filePath.trim() : "";
    if (!file) {
      throw new Error("plugins_import_file expects a non-empty file path");
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch (error) {
      throw new Error(`read plugin file ${file}: ${messageOf(error)}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Not a plugin file: ${file}`);
    }
    if (stat.size > MAX_PLUGIN_SOURCE_BYTES) {
      throw new Error(
        `Plugin file is too large (${stat.size} bytes; max ${MAX_PLUGIN_SOURCE_BYTES})`,
      );
    }

    const source = this.readSourceFile(file);
    const manifest = await this.evaluateSource(source, "import");
    if (this.registry.get(manifest.id)) {
      throw new Error("Plugin already installed");
    }

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      sourceUrl: manifest.sourceUrl,
      fileHash: sha256Hex(source),
      filePath: file,
      manifest,
    };
  }

  /**
   * Install an imported candidate, or an inline `{ source }` payload. The file
   * is re-read and re-hashed because it may have been edited after the trust
   * gate was shown.
   */
  async install(args: InstallPluginArgs): Promise<PluginInfo> {
    const candidate =
      args.candidate && typeof args.candidate === "object" ? args.candidate : null;
    const inline =
      typeof args.source === "string"
        ? args.source
        : typeof args.script === "string"
          ? args.script
          : null;

    let source: string;
    if (inline !== null) {
      source = inline;
    } else {
      const filePath = typeof candidate?.filePath === "string" ? candidate.filePath.trim() : "";
      if (!filePath) {
        throw new Error(
          "plugins_install needs the candidate from plugins_import_file (or an inline source)",
        );
      }
      source = this.readSourceFile(filePath);
    }

    if (source.length > MAX_PLUGIN_SOURCE_BYTES) {
      throw new Error(
        `Plugin source is too large (${source.length} chars; max ${MAX_PLUGIN_SOURCE_BYTES})`,
      );
    }

    const fileHash = sha256Hex(source);
    if (
      typeof candidate?.fileHash === "string" &&
      candidate.fileHash &&
      candidate.fileHash !== fileHash
    ) {
      throw new Error("Plugin file changed since it was imported (sha256 mismatch)");
    }

    const manifest = await this.evaluateSource(source, candidate?.id ?? "install");
    assertValidPluginId(manifest.id);
    if (
      typeof candidate?.id === "string" &&
      candidate.id.trim() &&
      candidate.id !== manifest.id
    ) {
      throw new Error("Plugin id changed since it was imported");
    }
    if (this.registry.get(manifest.id)) {
      throw new Error("Plugin already installed");
    }

    const record: PluginRecord = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      sourceUrl: manifest.sourceUrl,
      platformCategory: normalizePlatformCategory(manifest.platformCategory),
      fileHash,
      enabled: true,
      importedAt: this.registry.nowSeconds(),
      lastError: null,
      manifest: toStoredManifest(manifest),
    };
    const stored = this.registry.install(record, source);
    this.invalidate(stored.id);
    return toInfo(stored);
  }

  /** Idempotent, matching the Rust `plugins_remove`. */
  remove(id: string): void {
    const safeId = assertValidPluginId(id);
    this.registry.remove(safeId);
    this.invalidate(safeId);
  }

  // ── Toggles ───────────────────────────────────────────────────────────

  async toggle(id: string): Promise<void> {
    const record = this.requireRecord(id);
    this.invalidate(record.id);
    if (record.enabled) {
      this.registry.patch(record.id, { enabled: false });
      return;
    }

    try {
      const manifest = await this.reloadManifest(record);
      this.registry.writeManifest(record.id, manifest);
      this.registry.patch(record.id, {
        enabled: true,
        lastError: null,
        manifest: toStoredManifest(manifest),
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        description: manifest.description,
        sourceUrl: manifest.sourceUrl,
        platformCategory: normalizePlatformCategory(manifest.platformCategory),
      });
    } catch (error) {
      const message = messageOf(error);
      this.recordError(record.id, message);
      throw new Error(`Plugin failed validation: ${message}`);
    }
  }

  async setAllEnabled(enabled: boolean): Promise<PluginBulkToggleResult> {
    const records = this.registry.list();
    let changed = 0;
    const failed: string[] = [];

    if (enabled) {
      for (const record of records) {
        if (record.enabled) continue;
        try {
          const manifest = await this.reloadManifest(record);
          this.registry.writeManifest(record.id, manifest);
          this.registry.patch(record.id, {
            enabled: true,
            lastError: null,
            manifest: toStoredManifest(manifest),
            name: manifest.name,
            version: manifest.version,
            author: manifest.author,
            description: manifest.description,
            sourceUrl: manifest.sourceUrl,
            platformCategory: normalizePlatformCategory(manifest.platformCategory),
          });
          changed += 1;
        } catch (error) {
          const message = messageOf(error);
          this.recordError(record.id, message);
          failed.push(`${record.id}: ${message}`);
        }
        this.invalidate(record.id);
      }
    } else {
      for (const record of records) {
        if (!record.enabled) continue;
        this.registry.patch(record.id, { enabled: false });
        this.invalidate(record.id);
        changed += 1;
      }
    }

    return { changed, failed };
  }

  // ── Per-plugin config ─────────────────────────────────────────────────

  setConfig(id: string, key: string, value: string): void {
    const record = this.requireRecord(id);
    if (typeof key !== "string" || !key.trim()) {
      throw new Error("plugins_set_config expects a config key");
    }
    if (typeof value !== "string") {
      throw new Error("plugins_set_config expects a string value");
    }
    this.registry.setConfig(record.id, key.trim(), value);
    // A config change must take effect on the next search.
    this.invalidate(record.id);
  }

  clearConfig(id: string, key: string): void {
    const record = this.requireRecord(id);
    if (typeof key !== "string" || !key.trim()) {
      throw new Error("plugins_clear_config expects a config key");
    }
    this.registry.clearConfig(record.id, key.trim());
    this.invalidate(record.id);
  }

  configStatus(id: string): Record<string, boolean> {
    return this.registry.configStatus(this.requireRecord(id).id);
  }

  // ── Search ────────────────────────────────────────────────────────────

  /**
   * Fresh, uncached search for one plugin (the Settings → Plugins "Test
   * search" button). Reads and re-evaluates the file from disk so the result
   * reflects the current source even if it was edited after load.
   */
  async testSearch(id: string, query: string): Promise<PluginRawResult[]> {
    const record = this.requireRecord(id);
    if (typeof query !== "string" || !query.trim()) {
      throw new Error("plugins_test_search expects a non-empty query");
    }
    const trimmed = query.trim();

    try {
      const source = this.registry.readSource(record.id);
      let manifest: PluginManifest;
      try {
        manifest = await this.evaluateSource(source, record.id);
      } catch (error) {
        throw new Error(`evaluate ${record.id}: ${messageOf(error)}`);
      }
      const results = await this.runSandbox(record, source, manifest, trimmed);
      this.clearError(record.id);
      return results;
    } catch (error) {
      const message = messageOf(error);
      this.recordError(record.id, message);
      throw new Error(message);
    }
  }

  /**
   * Probe every enabled plugin for one game and report per-plugin hit counts
   * for the Store's availability filter. Never rejects as a whole: a plugin
   * that errors is reported in its own row.
   */
  async checkAvailability(options: {
    query: string;
    releaseYear?: number | null;
    aliases?: readonly string[];
  }): Promise<PluginAvailabilityHit[]> {
    const query = typeof options.query === "string" ? options.query.trim() : "";
    if (!query) return [];
    const releaseYear =
      typeof options.releaseYear === "number" && Number.isFinite(options.releaseYear)
        ? Math.trunc(options.releaseYear)
        : null;
    const aliases = normalizeAliases(options.aliases, query);

    const records = this.registry.list().filter((record) => record.enabled);
    return Promise.all(
      records.map((record) => this.probeAvailability(record, query, aliases, releaseYear)),
    );
  }

  /**
   * Run every enabled plugin and merge the hits into the download-search
   * shape. This is the internal entry point the sources workstream can call
   * from `sources_search_game` / `SourceContext` without touching the runtime
   * internals.
   */
  async searchWithPlugins(
    gameName: string,
    sources: readonly (string | PluginSearchSource)[] = [],
    options: PluginSearchOptions = {},
  ): Promise<PluginDownloadResult[]> {
    const query = typeof gameName === "string" ? gameName.trim() : "";
    if (!query) return [];

    const wanted = new Set<string>();
    const overrides = new Map<string, PluginSearchSource>();
    for (const source of sources) {
      const rawId = pluginIdOf(source);
      if (!rawId) continue;
      try {
        const id = assertValidPluginId(rawId);
        wanted.add(id);
        if (typeof source === "object" && source) overrides.set(id, source);
      } catch {
        // A malformed id simply does not select anything.
      }
    }

    const records = this.registry
      .list()
      .filter((record) => record.enabled)
      .filter((record) => wanted.size === 0 || wanted.has(record.id))
      .map((record) => {
        const descriptor = overrides.get(record.id);
        if (!descriptor) return record;
        return {
          ...record,
          name: descriptor.name?.trim() || record.name,
          platformCategory: normalizePlatformCategory(
            descriptor.platformCategory ?? record.platformCategory,
          ),
        };
      });

    return this.searchRecords(records, query, {
      aliases: options.aliases ?? [],
      releaseYear: options.releaseYear ?? null,
      matchFloor: options.matchFloor ?? MIN_MATCH_SCORE,
    });
  }

  /** Invalidate cached results for one plugin (config/toggle/remove). */
  invalidate(id: string): void {
    const prefix = `${id}\u0000`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private requireRecord(id: string): PluginRecord {
    const safeId = assertValidPluginId(id);
    const record = this.registry.get(safeId);
    if (!record) throw new Error(`Plugin not found: ${safeId}`);
    return record;
  }

  private readSourceFile(file: string): string {
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (error) {
      throw new Error(`read plugin file ${file}: ${messageOf(error)}`);
    }
    if (source.includes("\u0000")) {
      throw new Error(`Plugin file is not text: ${file}`);
    }
    return source;
  }

  private evaluateSource(source: string, label: string): Promise<PluginManifest> {
    return evaluatePluginSource(source, {
      pluginId: label,
      limits: this.limits,
      httpText: this.httpText,
      logger: (line) => this.logger(line),
    });
  }

  private reloadManifest(record: PluginRecord): Promise<PluginManifest> {
    const source = this.registry.readSource(record.id);
    return this.evaluateSource(source, record.id);
  }

  private runSandbox(
    record: PluginRecord,
    source: string,
    manifest: PluginManifest,
    query: string,
  ): Promise<PluginRawResult[]> {
    return runPluginSearch({
      pluginId: record.id,
      source,
      manifest,
      query,
      config: this.registry.configValues(record.id),
      limits: this.limits,
      httpText: this.httpText,
      logger: (line) => this.logger(line),
    });
  }

  private cacheTtlMs(record: PluginRecord): number {
    const declared = record.manifest.cacheTtlSecs;
    if (typeof declared === "number" && Number.isFinite(declared) && declared >= 0) {
      return Math.min(declared, 3600) * 1000;
    }
    return PLUGIN_CACHE_TTL_MS;
  }

  private async searchRecord(
    record: PluginRecord,
    query: string,
  ): Promise<PluginRawResult[]> {
    const key = `${record.id}\u0000${query}`;
    const ttl = this.cacheTtlMs(record);
    if (ttl > 0) {
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.at < ttl) {
        return cached.results;
      }
    }

    const source = this.registry.readSource(record.id);
    const manifest = await this.evaluateSource(source, record.id);
    const results = await this.runSandbox(record, source, manifest, query);

    if (ttl > 0) {
      const now = Date.now();
      // Drop expired entries so the map does not retain every query ever run.
      for (const [entryKey, entry] of this.cache) {
        if (now - entry.at >= PLUGIN_CACHE_TTL_MS) this.cache.delete(entryKey);
      }
      while (this.cache.size >= PLUGIN_CACHE_MAX_ENTRIES) {
        let oldestKey: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        for (const [entryKey, entry] of this.cache) {
          if (entry.at < oldestAt) {
            oldestAt = entry.at;
            oldestKey = entryKey;
          }
        }
        if (oldestKey === null) break;
        this.cache.delete(oldestKey);
      }
      this.cache.set(key, { at: now, results });
    }

    return results;
  }

  private async searchRecords(
    records: PluginRecord[],
    query: string,
    options: { aliases: string[]; releaseYear: number | null; matchFloor: number },
  ): Promise<PluginDownloadResult[]> {
    if (records.length === 0) return [];
    const settled = await Promise.allSettled(
      records.map(async (record) => ({
        record,
        results: await this.searchRecord(record, query),
      })),
    );

    const raw: { record: PluginRecord; result: PluginRawResult }[] = [];
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      const record = records[index];
      if (outcome.status === "fulfilled") {
        this.clearError(record.id);
        for (const result of outcome.value.results) raw.push({ record, result });
      } else {
        const message = messageOf(outcome.reason);
        this.logger(`[plugins] search ${record.id} failed: ${message}`);
        this.recordError(record.id, message);
      }
    }

    // Newest first by raw Unix upload date; undated rows sort last.
    raw.sort(
      (a, b) =>
        (b.result.uploadDate ?? Number.NEGATIVE_INFINITY) -
        (a.result.uploadDate ?? Number.NEGATIVE_INFINITY),
    );

    const converted: PluginDownloadResult[] = [];
    for (const { record, result } of raw) {
      const row = toDownloadResult(record, result, query, options.aliases, options.releaseYear);
      if (row && row.matchScore >= options.matchFloor) converted.push(row);
    }
    return mergeDuplicates(converted);
  }

  private countMatches(
    record: PluginRecord,
    results: PluginRawResult[],
    query: string,
    aliases: string[],
    releaseYear: number | null,
  ): number {
    let matches = 0;
    for (const raw of results) {
      const row = toDownloadResult(record, raw, query, aliases, releaseYear);
      if (row && row.matchScore >= MIN_MATCH_SCORE) matches += 1;
    }
    return matches;
  }

  private async probeAvailability(
    record: PluginRecord,
    query: string,
    aliases: string[],
    releaseYear: number | null,
  ): Promise<PluginAvailabilityHit> {
    const base = {
      pluginId: record.id,
      name: record.name,
      platformCategory: normalizePlatformCategory(record.platformCategory),
    };

    try {
      const results = await this.searchRecord(record, query);
      let matches = this.countMatches(record, results, query, aliases, releaseYear);
      if (matches === 0) {
        const cleaned = cleanSearchQuery(query);
        if (cleaned && cleaned !== query) {
          const retry = await this.searchRecord(record, cleaned);
          matches = this.countMatches(record, retry, cleaned, aliases, releaseYear);
        }
      }
      this.clearError(record.id);
      return { ...base, matches, error: null };
    } catch (error) {
      const message = messageOf(error);
      this.logger(`[plugins] availability ${record.id} failed: ${message}`);
      this.recordError(record.id, message);
      return { ...base, matches: 0, error: message };
    }
  }

  private recordError(id: string, message: string): void {
    try {
      const record = this.registry.get(id);
      if (!record || record.lastError === message) return;
      this.registry.patch(id, { lastError: message });
    } catch (error) {
      this.logger(`[plugins] could not record error for ${id}:`, error);
    }
  }

  private clearError(id: string): void {
    try {
      const record = this.registry.get(id);
      if (!record || record.lastError === null) return;
      this.registry.patch(id, { lastError: null });
    } catch (error) {
      this.logger(`[plugins] could not clear error for ${id}:`, error);
    }
  }
}

function toInfo(record: PluginRecord): PluginInfo {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    author: record.author,
    description: record.description,
    sourceUrl: record.sourceUrl,
    fileHash: record.fileHash,
    filePath: "",
    manifest: record.manifest,
    enabled: record.enabled,
    importedAt: record.importedAt,
    lastError: record.lastError,
    platformCategory: normalizePlatformCategory(record.platformCategory),
  };
}

/**
 * Convert one raw plugin hit into the merged download-search shape. Returns
 * null when the title does not clear the 0.2 floor (the year penalty is
 * applied after the floor check, exactly like the Rust pipeline).
 */
export function toDownloadResult(
  record: PluginRecord,
  raw: PluginRawResult,
  query: string,
  aliases: readonly string[],
  releaseYear: number | null,
): PluginDownloadResult | null {
  const matchSource =
    raw.matchTitle && raw.matchTitle.trim() ? raw.matchTitle.trim() : raw.title ?? "";
  const floorScore = bestTitleSimilarity(query, aliases, matchSource);
  if (floorScore < MIN_MATCH_SCORE) return null;
  const matchScore = applyReleaseYearAdjustment(floorScore, matchSource, releaseYear);

  const uris: string[] = [];
  for (const uri of [raw.magnet, raw.torrentUrl, ...(raw.directUrls ?? [])]) {
    if (typeof uri === "string" && uri && !uris.includes(uri)) uris.push(uri);
  }
  const magnet =
    raw.magnet && raw.magnet.trim()
      ? raw.magnet
      : uris.find((uri) => uri.startsWith("magnet:")) ?? null;

  const uploadDate =
    raw.uploadDateIso && raw.uploadDateIso.trim()
      ? raw.uploadDateIso
      : typeof raw.uploadDate === "number" && Number.isFinite(raw.uploadDate)
        ? formatUploadDate(raw.uploadDate)
        : null;

  const platformCategory = normalizePlatformCategory(record.platformCategory);

  return {
    id: `${record.id}:${raw.id ?? ""}`,
    sourceName: record.name,
    sourceId: record.id,
    title: raw.title ?? "",
    fileSize: raw.size ?? "",
    uris,
    magnet,
    uploadDate,
    matchScore,
    isNew: false,
    provider: "plugin",
    pluginId: record.id,
    infohash: raw.infohash ?? null,
    seeds: raw.seeds ?? null,
    peers: raw.peers ?? null,
    torrentUrl: raw.torrentUrl ?? null,
    verified: raw.verified ?? null,
    detailUrl: raw.url ?? null,
    platform: raw.platform ?? null,
    provenance: raw.provenance ?? null,
    referer: raw.referer ?? null,
    platformCategory,
    matchTitle: raw.matchTitle?.trim() ? raw.matchTitle : null,
    fileList: raw.fileList && raw.fileList.length > 0 ? raw.fileList : null,
    checksums: raw.checksums && raw.checksums.length > 0 ? raw.checksums : null,
    version: raw.version ?? null,
    region: raw.region ?? null,
    coverUrl: raw.coverUrl ?? null,
    description: raw.description ?? null,
    releaseGroup: raw.releaseGroup ?? null,
    recommended: raw.recommended ?? null,
  };
}

function mergeKey(row: PluginDownloadResult): string | null {
  const infohash = row.infohash?.trim().toLowerCase();
  if (infohash) return `h:${infohash}`;
  const title = normalizeTitle(row.title);
  return title.length >= 2 ? `t:${title}` : null;
}

function mergeInto(kept: PluginDownloadResult, incoming: PluginDownloadResult): void {
  const max = (a: number | null, b: number | null): number | null =>
    a === null ? b : b === null ? a : Math.max(a, b);

  const winner = incoming.matchScore > kept.matchScore ? incoming : kept;
  const loser = incoming.matchScore > kept.matchScore ? kept : incoming;

  const uris = [...winner.uris];
  for (const uri of loser.uris) if (uri && !uris.includes(uri)) uris.push(uri);

  Object.assign(kept, winner, {
    uris,
    seeds: max(winner.seeds, loser.seeds),
    peers: max(winner.peers, loser.peers),
    verified: winner.verified ?? loser.verified,
    torrentUrl: winner.torrentUrl ?? loser.torrentUrl,
    uploadDate: winner.uploadDate ?? loser.uploadDate,
  });
}

/** Collapse duplicate releases (same infohash or normalised title). */
export function mergeDuplicates(rows: PluginDownloadResult[]): PluginDownloadResult[] {
  const out: PluginDownloadResult[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = mergeKey(row);
    if (key === null) {
      out.push(row);
      continue;
    }
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push(row);
    } else {
      mergeInto(out[at], row);
    }
  }
  return out;
}
