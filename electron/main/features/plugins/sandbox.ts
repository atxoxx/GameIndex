/**
 * QuickJS sandbox for search plugins.
 *
 * Ported from `src-tauri/src/plugins/runtime.rs` (`rquickjs`). Each evaluation
 * gets a **fresh** runtime and context, so a plugin can never observe state
 * from another plugin or from a previous query.
 *
 * ## Limits
 *
 * - **Memory**: `memoryLimitBytes` (default 64 MiB) is enforced by QuickJS's
 *   own heap accounting; a runaway `JSON.parse` throws instead of growing the
 *   app.
 * - **Wall clock**: `timeoutMs` (default 20 s) is enforced twice: an interrupt
 *   handler stops `while (true) {}` inside the interpreter, and a host timer
 *   tears the runtime down if the plugin is suspended in a slow request.
 * - **Network**: `httpGet*` only talks through the injected host transport
 *   (`lib/http.ts` in production), only over `http(s)`, only to the manifest's
 *   `allowedHosts` (when declared), with a per-host `rateLimitMs` gate, a
 *   request-count budget and a response-size cap.
 *
 * ## Globals
 *
 * The sandbox exposes exactly the documented I/O surface:
 * `httpGet`, `httpGetJson`, `httpGetXml`, `console` and `definePlugin`.
 * There is no `require`, no `import`, no filesystem, no `process`, no `fetch`
 * and no timers — QuickJS starts with none of those.
 *
 * `definePlugin` must be called exactly once. The plugin's `search` function
 * is stashed on the private `__pluginSearch` global; every search re-evaluates
 * the source (cheap, no network during `definePlugin`) so nothing persists.
 */
import {
  isFail,
  newAsyncContext,
  shouldInterruptAfterDeadline,
  type QuickJSAsyncContext,
  type QuickJSHandle,
  type VmCallResult,
} from "quickjs-emscripten";

import { normalizeManifest, type PluginManifest } from "./manifest";
import type { PluginRawResult } from "./types";
import { parseFeed } from "./xml";

export const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_REQUESTS = 64;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_RESULTS = 500;
const HTTP_MAX_ATTEMPTS = 3;
const HTTP_RETRY_BACKOFF_MS = [500, 1000] as const;
const HTTP_TIMEOUT_MS = 15_000;
const MAX_CONSOLE_LINE = 2_000;

export interface SandboxLimits {
  memoryLimitBytes?: number;
  timeoutMs?: number;
  maxRequests?: number;
  maxResponseBytes?: number;
}

export interface SandboxNetworkPolicy {
  /** False during import validation: any HTTP call is rejected. */
  allowNetwork: boolean;
  allowedHosts?: string[];
  rateLimitMs?: number;
}

/** Minimal shape of `httpText` from `lib/http.ts`. */
export type HttpTextFn = (
  url: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; ok: boolean; url: string; text: string }>;

export interface SandboxOptions {
  pluginId?: string;
  limits?: SandboxLimits;
  network?: SandboxNetworkPolicy;
  httpText?: HttpTextFn;
  logger?: (line: string) => void;
}

interface SandboxState {
  manifest: PluginManifest | null;
  hasSearch: boolean;
  requests: number;
}

interface SandboxSession {
  context: QuickJSAsyncContext;
  state: SandboxState;
  evaluate(code: string, filename: string, timeoutMs: number): Promise<string>;
  dispose(): Promise<void>;
}

/**
 * Process-global per-host pacing table. Shared across plugins and searches so
 * a plugin cannot sidestep its own rate limit by re-evaluating, and two
 * plugins hitting the same host still queue behind each other.
 */
const rateLimitSlots = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function normalizeAllowEntry(entry: string): string {
  let value = entry.trim().toLowerCase();
  if (!value) return "";
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0];
  value = value.replace(/^\./, "");
  return value;
}

function isHostAllowed(host: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((entry) => {
    const allowed = normalizeAllowEntry(entry);
    if (!allowed) return false;
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function reserveHostSlot(host: string, rateLimitMs: number): number {
  if (!Number.isFinite(rateLimitMs) || rateLimitMs <= 0) return 0;
  const now = Date.now();
  const next = rateLimitSlots.get(host) ?? 0;
  const scheduled = Math.max(now, next);
  rateLimitSlots.set(host, scheduled + rateLimitMs);
  return scheduled - now;
}

function describeThrown(context: QuickJSAsyncContext, thrown: QuickJSHandle): string {
  try {
    if (context.typeof(thrown) === "object") {
      const messageHandle = context.getProp(thrown, "message");
      try {
        if (context.typeof(messageHandle) === "string") {
          const message = context.getString(messageHandle);
          if (message) return message;
        }
      } finally {
        messageHandle.dispose();
      }
    }
    const dumped = context.dump(thrown);
    if (typeof dumped === "string" && dumped.trim()) return dumped;
    return JSON.stringify(dumped) ?? String(dumped);
  } catch {
    return "unknown plugin error";
  }
}

function readStringArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle,
  name: string,
): string {
  if (context.typeof(handle) !== "string") {
    throw new Error(`${name} must be a string`);
  }
  return context.getString(handle);
}

function optionalStringArg(
  context: QuickJSAsyncContext,
  handle: QuickJSHandle | undefined,
): string | undefined {
  if (!handle) return undefined;
  if (context.typeof(handle) === "undefined" || context.typeof(handle) === "null") {
    return undefined;
  }
  if (context.typeof(handle) !== "string") return undefined;
  const value = context.getString(handle);
  return value ? value : undefined;
}

async function openSandbox(options: SandboxOptions): Promise<SandboxSession> {
  const limits: Required<SandboxLimits> = {
    memoryLimitBytes: options.limits?.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    timeoutMs: options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRequests: options.limits?.maxRequests ?? DEFAULT_MAX_REQUESTS,
    maxResponseBytes: options.limits?.maxResponseBytes ?? MAX_RESPONSE_BYTES,
  };
  const pluginId = options.pluginId ?? "plugin";
  const network = options.network ?? { allowNetwork: false };
  const allowedHosts = network.allowedHosts ?? [];
  const logger = options.logger ?? (() => {});

  // A dedicated WebAssembly module per sandbox: asyncify allows only one
  // in-flight async action per module, and availability probes run plugins
  // concurrently.
  const context = await newAsyncContext();
  const runtime = context.runtime;
  runtime.setMemoryLimit(limits.memoryLimitBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs));

  const state: SandboxState = { manifest: null, hasSearch: false, requests: 0 };
  const controller = new AbortController();
  let disposed = false;
  let inFlight: Promise<unknown> | null = null;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
    // A timed-out evaluation may still be suspended inside a pending HTTP
    // call. Give it a moment to resume and settle before tearing the runtime
    // down, so QuickJS does not report leaked handles.
    if (inFlight) {
      try {
        await Promise.race([inFlight.catch(() => undefined), sleep(250)]);
      } catch {
        /* ignore */
      }
    }
    try {
      context.dispose();
    } catch (error) {
      // A runtime torn down mid-suspension can report a leak; the sandbox is
      // gone either way and the caller already has its error.
      logger(`[plugins] ${pluginId}: sandbox dispose: ${errorMessage(error)}`);
    }
  };

  const checkEgress = (url: string): void => {
    if (!network.allowNetwork) {
      throw new Error("httpGet is not available during import validation");
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`httpGet: blocked non-http(s) URL: ${url}`);
    }
    const host = hostOf(url);
    if (!host) throw new Error(`httpGet: invalid URL: ${url}`);
    if (allowedHosts.length > 0 && !isHostAllowed(host, allowedHosts)) {
      throw new Error(`host ${host} is not in the plugin's allowedHosts`);
    }
  };

  const fetchText = async (url: string, referer?: string): Promise<string> => {
    checkEgress(url);
    if (!options.httpText) {
      throw new Error("httpGet: no HTTP transport is configured");
    }
    const host = hostOf(url) ?? "";
    const wait = reserveHostSlot(host, network.rateLimitMs ?? 0);
    if (wait > 0) await sleep(wait);

    state.requests += 1;
    if (state.requests > limits.maxRequests) {
      throw new Error(
        `httpGet: request budget exhausted (${limits.maxRequests} requests per search)`,
      );
    }

    if (referer && /[\r\n]/.test(referer)) {
      throw new Error("httpGet: referer contains CR or LF");
    }
    const headers: Record<string, string> = {};
    if (referer) headers.referer = referer;

    let lastError = "";
    for (let attempt = 0; attempt < HTTP_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await sleep(HTTP_RETRY_BACKOFF_MS[attempt - 1] ?? 1000);
      }
      let response: { status: number; ok: boolean; url: string; text: string };
      try {
        response = await options.httpText(url, {
          headers,
          timeoutMs: HTTP_TIMEOUT_MS,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("httpGet: search cancelled");
        lastError = errorMessage(error);
        continue;
      }
      if (response.ok) {
        if (response.text.length > limits.maxResponseBytes) {
          throw new Error(
            `httpGet: ${url} response too large (${response.text.length} > ${limits.maxResponseBytes} bytes)`,
          );
        }
        return response.text;
      }
      if (response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      // 4xx and other deterministic failures never retry.
      throw new Error(`httpGet: ${url} -> HTTP ${response.status}`);
    }
    throw new Error(
      `httpGet: ${url} failed after ${HTTP_MAX_ATTEMPTS} attempts: ${lastError}`,
    );
  };

  // ── Globals ─────────────────────────────────────────────────────────────
  //
  // Asyncified host functions must **resolve** with an error handle rather
  // than reject: quickjs-emscripten cannot resume the unwound stack after a
  // rejected promise (it would hang the evaluation). A `VmCallResult` fail is
  // converted into a normal JS exception by the library.
  const guardAsync =
    <A extends QuickJSHandle[]>(
      label: string,
      impl: (...args: A) => Promise<QuickJSHandle>,
    ) =>
    async (
      ...args: A
    ): Promise<QuickJSHandle | VmCallResult<QuickJSHandle>> => {
      try {
        return await impl(...args);
      } catch (error) {
        const message = errorMessage(error);
        const text = message.startsWith(label) ? message : `${label}: ${message}`;
        return { error: context.newError(text) };
      }
    };

  const httpGet = context.newAsyncifiedFunction(
    "httpGet",
    guardAsync("httpGet", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpGet(url)");
      const referer = optionalStringArg(context, args[1]);
      const text = await fetchText(url, referer);
      return context.newString(text);
    }),
  );
  context.setProp(context.global, "httpGet", httpGet);
  httpGet.dispose();

  // `httpGetXml` parses in the host to keep XML handling out of the sandbox.
  const httpGetXmlJson = context.newAsyncifiedFunction(
    "httpGetXml",
    guardAsync("httpGetXml", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpGetXml(url)");
      const referer = optionalStringArg(context, args[1]);
      const text = await fetchText(url, referer);
      const parsed = parseFeed(text);
      return context.newString(JSON.stringify(parsed));
    }),
  );
  context.setProp(context.global, "__httpGetXmlJson", httpGetXmlJson);
  httpGetXmlJson.dispose();

  const consoleObject = context.newObject();
  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    const sink = context.newFunction(level, (...args: QuickJSHandle[]) => {
      const parts = args.map((arg) => {
        try {
          const dumped = context.dump(arg);
          return typeof dumped === "string"
            ? dumped
            : (JSON.stringify(dumped) ?? String(dumped));
        } catch {
          return "<unserializable>";
        }
      });
      logger(`[plugin:${pluginId}] ${clip(parts.join(" "), MAX_CONSOLE_LINE)}`);
    });
    context.setProp(consoleObject, level, sink);
    sink.dispose();
  }
  context.setProp(context.global, "console", consoleObject);
  consoleObject.dispose();

  const definePlugin = context.newFunction(
    "definePlugin",
    (descriptor: QuickJSHandle) => {
      if (state.manifest !== null) {
        throw new Error("definePlugin may only be called once");
      }
      if (context.typeof(descriptor) !== "object") {
        throw new Error("definePlugin must be called with a descriptor object");
      }

      const searchHandle = context.getProp(descriptor, "search");
      try {
        if (context.typeof(searchHandle) !== "function") {
          throw new Error(
            "plugin descriptor is missing a callable `search` function",
          );
        }
        context.setProp(context.global, "__pluginSearch", searchHandle);
        state.hasSearch = true;
      } finally {
        searchHandle.dispose();
      }

      const read = (key: string): unknown => {
        const property = context.getProp(descriptor, key);
        try {
          return context.dump(property);
        } finally {
          property.dispose();
        }
      };

      state.manifest = normalizeManifest({
        id: read("id"),
        name: read("name"),
        version: read("version"),
        author: read("author"),
        description: read("description"),
        sourceUrl: read("sourceUrl"),
        platformCategory: read("platformCategory"),
        allowedHosts: read("allowedHosts"),
        rateLimitMs: read("rateLimitMs"),
        cacheTtlSecs: read("cacheTtlSecs"),
        icon: read("icon"),
        homepage: read("homepage"),
        capabilities: read("capabilities"),
        config: read("config"),
      });
    },
  );
  context.setProp(context.global, "definePlugin", definePlugin);
  definePlugin.dispose();

  const wrappers = await context.evalCodeAsync(
    `
    globalThis.httpGetJson = function (url, referer) {
      return JSON.parse(httpGet(url, referer));
    };
    globalThis.httpGetXml = function (url, referer) {
      return JSON.parse(__httpGetXmlJson(url, referer));
    };
    `,
    "plugin-globals.js",
  );
  if (isFail(wrappers)) {
    const message = describeThrown(context, wrappers.error);
    wrappers.error.dispose();
    await dispose();
    throw new Error(`install sandbox globals: ${message}`);
  }
  wrappers.value.dispose();

  const evaluate = async (
    code: string,
    filename: string,
    timeoutMs: number,
  ): Promise<string> => {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          /* ignore */
        }
        reject(
          new Error(
            `plugin ${pluginId} timed out after ${Math.round(timeoutMs / 1000)}s`,
          ),
        );
      }, timeoutMs);
    });

    try {
      const pending = context.evalCodeAsync(code, filename);
      inFlight = pending;
      pending
        .catch(() => undefined)
        .finally(() => {
          if (inFlight === pending) inFlight = null;
        });
      const result = await Promise.race([pending, timeout]);
      if (isFail(result)) {
        const raw = describeThrown(context, result.error);
        result.error.dispose();
        if (/interrupted/i.test(raw)) {
          throw new Error(
            `plugin ${pluginId} timed out after ${Math.round(timeoutMs / 1000)}s (interrupted)`,
          );
        }
        throw new Error(raw);
      }
      const value = result.value;
      try {
        if (context.typeof(value) === "string") return context.getString(value);
        if (context.typeof(value) === "undefined") return "";
        return JSON.stringify(context.dump(value)) ?? "";
      } finally {
        value.dispose();
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return { context, state, evaluate, dispose };
}

export interface EvaluateOptions extends SandboxOptions {
  /** Defaults to 10 s: validation never performs network work. */
  timeoutMs?: number;
}

/**
 * Validate a plugin source and return its manifest. Equivalent to
 * `runtime::evaluate_plugin`: proves the file parses, calls `definePlugin`
 * exactly once and declares a callable `search`, without running a search.
 */
export async function evaluatePluginSource(
  source: string,
  options: EvaluateOptions = {},
): Promise<PluginManifest> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sandbox = await openSandbox({
    ...options,
    network: { allowNetwork: false },
    limits: { ...options.limits, timeoutMs },
  });
  try {
    await sandbox.evaluate(source, "plugin.js", timeoutMs);
    if (!sandbox.state.manifest) {
      throw new Error("plugin did not call definePlugin");
    }
    if (!sandbox.state.hasSearch) {
      throw new Error(
        "plugin descriptor is missing a callable `search` function",
      );
    }
    return sandbox.state.manifest;
  } finally {
    await sandbox.dispose();
  }
}

export interface RunSearchOptions extends SandboxOptions {
  source: string;
  manifest: PluginManifest;
  query: string;
  /** Values for the keys the manifest declares in `config`. */
  config?: Record<string, string>;
}

/** Run `search(query, config)` in a fresh sandbox and return raw results. */
export async function runPluginSearch(
  options: RunSearchOptions,
): Promise<PluginRawResult[]> {
  const timeoutMs = options.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sandbox = await openSandbox({
    ...options,
    network: {
      allowNetwork: true,
      allowedHosts: options.manifest.allowedHosts,
      rateLimitMs: options.manifest.rateLimitMs,
    },
    limits: { ...options.limits, timeoutMs },
  });

  try {
    await sandbox.evaluate(options.source, "plugin.js", timeoutMs);
    if (!sandbox.state.manifest) {
      throw new Error("plugin did not call definePlugin");
    }
    if (!sandbox.state.hasSearch) {
      throw new Error(
        "plugin descriptor is missing a callable `search` function",
      );
    }

    const queryHandle = sandbox.context.newString(String(options.query ?? ""));
    sandbox.context.setProp(sandbox.context.global, "__pluginQuery", queryHandle);
    queryHandle.dispose();

    const configJson = JSON.stringify(options.config ?? {});
    const configHandle = sandbox.context.newString(configJson);
    sandbox.context.setProp(
      sandbox.context.global,
      "__pluginConfigJson",
      configHandle,
    );
    configHandle.dispose();

    const text = await sandbox.evaluate(
      `(function () {
        var result = __pluginSearch(__pluginQuery, JSON.parse(__pluginConfigJson));
        if (result == null) result = [];
        if (!Array.isArray(result)) {
          throw new Error("plugin search() must return an array");
        }
        return JSON.stringify(result);
      })()`,
      "plugin-search.js",
      timeoutMs,
    );

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : [];
    } catch (error) {
      throw new Error(`parse plugin results: ${errorMessage(error)}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error("plugin search() must return an array");
    }
    return parsed
      .slice(0, MAX_PLUGIN_RESULTS)
      .map(normalizeRawResult)
      .filter((row): row is PluginRawResult => row !== null);
  } finally {
    await sandbox.dispose();
  }
}

// ── Tolerant result normalisation ─────────────────────────────────────────

function asString(value: unknown, max = 20_000): string {
  if (typeof value === "string") return clip(value, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asOptionalString(value: unknown, max = 20_000): string | undefined {
  const text = asString(value, max);
  return text ? text : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((entry) => asString(entry, 4_000))
    .filter((entry) => entry.length > 0);
  return out.length > 0 ? out : undefined;
}

function normalizeRawResult(value: unknown): PluginRawResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const row: PluginRawResult = {
    id: asString(input.id, 500),
    title: asString(input.title),
    size: asString(input.size, 200),
  };

  const sizeBytes = asOptionalNumber(input.sizeBytes);
  if (sizeBytes !== undefined) row.sizeBytes = sizeBytes;
  const infohash = asOptionalString(input.infohash, 200);
  if (infohash) row.infohash = infohash;
  const magnet = asOptionalString(input.magnet, 8_000);
  if (magnet) row.magnet = magnet;
  const torrentUrl = asOptionalString(input.torrentUrl, 4_000);
  if (torrentUrl) row.torrentUrl = torrentUrl;
  const seeds = asOptionalNumber(input.seeds);
  if (seeds !== undefined) row.seeds = seeds;
  const peers = asOptionalNumber(input.peers);
  if (peers !== undefined) row.peers = peers;
  const uploadDate = asOptionalNumber(input.uploadDate);
  if (uploadDate !== undefined) row.uploadDate = uploadDate;
  const uploadDateIso = asOptionalString(input.uploadDateIso, 100);
  if (uploadDateIso) row.uploadDateIso = uploadDateIso;
  const verified = asOptionalBoolean(input.verified);
  if (verified !== undefined) row.verified = verified;
  const url = asOptionalString(input.url, 4_000);
  if (url) row.url = url;
  const category = asOptionalString(input.category, 200);
  if (category) row.category = category;
  const platform = asOptionalString(input.platform, 200);
  if (platform) row.platform = platform;
  const directUrls = asStringArray(input.directUrls);
  if (directUrls) row.directUrls = directUrls;
  const provenance = asOptionalString(input.provenance, 500);
  if (provenance) row.provenance = provenance;
  const referer = asOptionalString(input.referer, 4_000);
  if (referer) row.referer = referer;
  const matchTitle = asOptionalString(input.matchTitle);
  if (matchTitle) row.matchTitle = matchTitle;
  const version = asOptionalString(input.version, 200);
  if (version) row.version = version;
  const region = asOptionalString(input.region, 100);
  if (region) row.region = region;
  const coverUrl = asOptionalString(input.coverUrl, 4_000);
  if (coverUrl) row.coverUrl = coverUrl;
  const description = asOptionalString(input.description, 40_000);
  if (description) row.description = description;
  const releaseGroup = asOptionalString(input.releaseGroup, 300);
  if (releaseGroup) row.releaseGroup = releaseGroup;
  const recommended = asOptionalBoolean(input.recommended);
  if (recommended !== undefined) row.recommended = recommended;

  if (Array.isArray(input.fileList)) {
    const fileList = input.fileList
      .filter(
        (entry): entry is { name?: unknown; size?: unknown } =>
          entry !== null && typeof entry === "object",
      )
      .map((entry) => ({
        name: asString(entry.name, 1_000),
        size: asOptionalNumber(entry.size) ?? 0,
      }))
      .filter((entry) => entry.name.length > 0);
    if (fileList.length > 0) row.fileList = fileList;
  }
  if (Array.isArray(input.checksums)) {
    const checksums = input.checksums
      .filter(
        (entry): entry is { algo?: unknown; value?: unknown } =>
          entry !== null && typeof entry === "object",
      )
      .map((entry) => ({
        algo: asString(entry.algo, 50),
        value: asString(entry.value, 300),
      }))
      .filter((entry) => entry.algo.length > 0 && entry.value.length > 0);
    if (checksums.length > 0) row.checksums = checksums;
  }

  return row;
}
