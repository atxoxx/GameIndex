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
 * `httpGet`, `httpGetJson`, `httpGetXml`, `httpGetAll`, `httpRequest`,
 * `httpRequestJson`, `httpHead`, `httpGetBytes`, `httpGetTorrent`, `parseHtml`,
 * `sleep`, `console` and `definePlugin`.
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
import * as cheerio from "cheerio";

export const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_REQUESTS = 64;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PLUGIN_RESULTS = 500;
const HTTP_MAX_ATTEMPTS = 3;
const HTTP_RETRY_BACKOFF_MS = [500, 1000] as const;
const HTTP_TIMEOUT_MS = 15_000;
/**
 * Below this much wall clock there is no point starting (or retrying) a request:
 * the sandbox interrupt would fire mid-flight and the plugin would only see a
 * confusing cancellation instead of the real upstream answer.
 */
const HTTP_MIN_REQUEST_MS = 1_500;
/** Headroom kept before the sandbox's own interrupt deadline. */
const HTTP_DEADLINE_MARGIN_MS = 250;
/** A plugin can fan out to this many pages in one `httpGetAll` call. */
const MAX_PARALLEL_FETCHES = 24;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const MAX_REQUEST_HEADER_COUNT = 32;
const MAX_REQUEST_HEADER_BYTES = 8 * 1024;
/** Longest `sleep()` a plugin may request; the sandbox deadline caps it too. */
const MAX_SLEEP_MS = 2_000;
const MAX_CONSOLE_LINE = 2_000;
const MAX_FILE_LIST_ENTRIES = 2_000;
const MAX_DIRECT_URLS = 50;
const MAX_CHECKSUMS = 32;

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

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Refuse bodies bigger than this without buffering them. */
  maxBytes?: number;
}

export interface HttpResponseText {
  status: number;
  ok: boolean;
  url: string;
  text: string;
  /** Present when the transport can expose response headers (`httpHead`). */
  headers?: { get(name: string): string | null };
}

/** Minimal shape of `httpText` from `lib/http.ts`. */
export type HttpTextFn = (url: string, options: HttpRequestOptions) => Promise<HttpResponseText>;

/** Parse a `.torrent` (or magnet) into `httpGetTorrent`'s shape, as JSON. */
export type FetchTorrentFn = (
  url: string,
  options: HttpRequestOptions,
) => Promise<string | null>;

/** Fetch a binary body for `httpGetBytes`, base64-encoded. */
export type FetchBytesFn = (url: string, options: HttpRequestOptions) => Promise<string>;

export interface SandboxOptions {
  pluginId?: string;
  limits?: SandboxLimits;
  network?: SandboxNetworkPolicy;
  httpText?: HttpTextFn;
  /**
   * Torrent parsing lives in the host (it needs a full bencode/torrent
   * decoder), so `httpGetTorrent` is injected rather than reimplemented in
   * QuickJS. Returning null means "not a parseable torrent".
   */
  fetchTorrent?: FetchTorrentFn;
  /** Binary fetch for `httpGetBytes`; returns base64 (QuickJS has no bytes). */
  fetchBytes?: FetchBytesFn;
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

/** Tolerant read of the `httpRequest(url, options)` object. */
function readRequestOptions(value: unknown): {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  referer?: string;
} {
  const out: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    referer?: string;
  } = {};
  if (value === null || typeof value !== "object") return out;
  const raw = value as Record<string, unknown>;
  if (typeof raw.method === "string" && raw.method.trim()) out.method = raw.method.trim();
  if (typeof raw.referer === "string" && raw.referer) out.referer = raw.referer;
  if (typeof raw.body === "string") out.body = raw.body;
  if (raw.headers !== null && typeof raw.headers === "object") {
    const headers: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(raw.headers)) {
      if (typeof headerValue === "string") headers[name] = headerValue;
    }
    out.headers = headers;
  }
  return out;
}

/**
 * Normalize `httpGetAll(urlsOrRequests, referers?)` into ordered fetch targets:
 * plain URLs with an optional parallel `referers` array, or `{url, referer}`
 * objects. The batch is capped so one plugin cannot fan out unboundedly.
 */
function fetchTargets(
  list: unknown,
  referers: unknown,
): Array<{ url: string; referer?: string }> {
  const fallbackReferers = Array.isArray(referers) ? referers : [];
  const entries = Array.isArray(list) ? list : [];
  const out: Array<{ url: string; referer?: string }> = [];
  for (let index = 0; index < entries.length && out.length < MAX_PARALLEL_FETCHES; index += 1) {
    const entry = entries[index];
    if (typeof entry === "string") {
      if (!entry) continue;
      const referer =
        typeof fallbackReferers[index] === "string" ? (fallbackReferers[index] as string) : undefined;
      out.push(referer ? { url: entry, referer } : { url: entry });
      continue;
    }
    if (entry !== null && typeof entry === "object") {
      const value = entry as Record<string, unknown>;
      const url = typeof value.url === "string" ? value.url : "";
      if (!url) continue;
      const referer = typeof value.referer === "string" ? value.referer : undefined;
      out.push(referer ? { url, referer } : { url });
    }
  }
  return out;
}

/** `parseHtml` extraction: selector → `{text, html, attrs}` rows. */
export function selectHtml(
  html: string,
  selector: string,
  limit: number,
): Array<{ text: string; html: string; attrs: Record<string, string> }> {
  const $ = cheerio.load(html);
  const rows: Array<{ text: string; html: string; attrs: Record<string, string> }> = [];
  $(selector)
    .slice(0, limit)
    .each((_index, element) => {
      const node = $(element);
      const attrs: Record<string, string> = { ...(node.attr() ?? {}) };
      rows.push({ text: node.text().trim(), html: node.html() ?? "", attrs });
    });
  return rows;
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
  // One deadline for the whole sandbox: the interrupt handler stops runaway
  // script, and the HTTP layer below refuses requests that could not finish
  // inside what is left of it.
  const deadline = Date.now() + limits.timeoutMs;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const timeLeft = (): number => deadline - Date.now();

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

  /**
   * Validate a request, apply the host's rate limit and charge the request
   * budget. Returns the normalized request to execute.
   */
  const prepareRequest = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string; referer?: string },
  ): Promise<{ method: string; headers: Record<string, string>; body?: string }> => {
    checkEgress(url);
    if (!options.httpText) {
      throw new Error("httpGet: no HTTP transport is configured");
    }

    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      throw new Error(`httpRequest: unsupported method ${method}`);
    }

    const headers: Record<string, string> = {};
    const given = init.headers ?? {};
    const names = Object.keys(given);
    if (names.length > MAX_REQUEST_HEADER_COUNT) {
      throw new Error(`httpRequest: too many headers (max ${MAX_REQUEST_HEADER_COUNT})`);
    }
    let headerBytes = 0;
    for (const name of names) {
      const value = given[name];
      if (typeof value !== "string") {
        throw new Error(`httpRequest: header ${name} must be a string`);
      }
      if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
        throw new Error("httpRequest: header contains CR or LF");
      }
      headerBytes += name.length + value.length;
      headers[name] = value;
    }
    if (headerBytes > MAX_REQUEST_HEADER_BYTES) {
      throw new Error("httpRequest: headers are too large");
    }
    if (init.referer) {
      if (/[\r\n]/.test(init.referer)) {
        throw new Error("httpGet: referer contains CR or LF");
      }
      headers.referer = init.referer;
    }

    const body = init.body;
    if (body !== undefined) {
      if (method !== "POST") {
        throw new Error("httpRequest: only POST requests may carry a body");
      }
      if (typeof body !== "string") throw new Error("httpRequest: body must be a string");
      if (body.length > MAX_REQUEST_BODY_BYTES) {
        throw new Error(`httpRequest: request body too large (max ${MAX_REQUEST_BODY_BYTES} bytes)`);
      }
    }

    const host = hostOf(url) ?? "";
    const wait = reserveHostSlot(host, network.rateLimitMs ?? 0);
    if (wait > 0) {
      if (wait + HTTP_MIN_REQUEST_MS + HTTP_DEADLINE_MARGIN_MS > timeLeft()) {
        throw new Error(
          `httpGet: ${host} is rate limited (${Math.round(wait / 1000)}s) and the search budget is nearly spent`,
        );
      }
      await sleep(wait);
    }

    state.requests += 1;
    if (state.requests > limits.maxRequests) {
      throw new Error(
        `httpGet: request budget exhausted (${limits.maxRequests} requests per search)`,
      );
    }

    return { method, headers, body };
  };

  /** Execute a prepared request, retrying only idempotent methods. */
  const executeRequest = async (
    url: string,
    request: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<HttpResponseText> => {
    const retryable = request.method === "GET" || request.method === "HEAD";
    let lastError = "";
    let attempts = 0;
    for (let attempt = 0; attempt < HTTP_MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        const backoff = HTTP_RETRY_BACKOFF_MS[attempt - 1] ?? 1000;
        // A retry only makes sense when the request itself still fits.
        if (backoff + HTTP_MIN_REQUEST_MS + HTTP_DEADLINE_MARGIN_MS > timeLeft()) {
          lastError = lastError || "search budget exhausted";
          break;
        }
        await sleep(backoff);
      }
      const budget = timeLeft() - HTTP_DEADLINE_MARGIN_MS;
      if (budget < HTTP_MIN_REQUEST_MS) {
        lastError = lastError || "search budget exhausted";
        break;
      }
      // Never let a single request outlive the sandbox that is waiting on it.
      const timeoutMs = Math.min(HTTP_TIMEOUT_MS, budget);
      attempts += 1;
      let response: HttpResponseText;
      try {
        response = await options.httpText!(url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          timeoutMs,
          signal: controller.signal,
          maxBytes: limits.maxResponseBytes,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new Error("httpGet: search cancelled");
        lastError = errorMessage(error);
        if (!retryable) break;
        continue;
      }
      if (response.ok) {
        if (response.text.length > limits.maxResponseBytes) {
          throw new Error(
            `httpGet: ${url} response too large (${response.text.length} > ${limits.maxResponseBytes} bytes)`,
          );
        }
        return response;
      }
      if (response.status >= 500 && retryable) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      // 4xx and other deterministic failures never retry.
      throw new Error(`httpGet: ${url} -> HTTP ${response.status}`);
    }
    throw new Error(
      `httpGet: ${url} failed${
        attempts > 0 ? ` after ${attempts} attempt${attempts === 1 ? "" : "s"}` : ""
      }: ${lastError || "search budget exhausted"}`,
    );
  };

  const fetchText = async (url: string, referer?: string): Promise<string> => {
    const request = await prepareRequest(url, { referer });
    const response = await executeRequest(url, request);
    return response.text;
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

  // `httpRequest`: GET/HEAD/POST with optional headers and a JSON body. The
  // host validates the method, header bytes and body size before the request.
  const httpRequestFn = context.newAsyncifiedFunction(
    "__httpRequest",
    guardAsync("httpRequest", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpRequest(url)");
      const optionsHandle = args[1];
      let options: { method?: string; headers?: Record<string, string>; body?: string; referer?: string } = {};
      if (optionsHandle && context.typeof(optionsHandle) === "object") {
        options = readRequestOptions(context.dump(optionsHandle));
      }
      const request = await prepareRequest(url, options);
      const response = await executeRequest(url, request);
      return context.newString(response.text);
    }),
  );
  context.setProp(context.global, "__httpRequest", httpRequestFn);
  httpRequestFn.dispose();

  // `httpGetAll`: parallel fetches that keep their order; a failed page is "".
  const httpGetAllFn = context.newAsyncifiedFunction(
    "httpGetAll",
    guardAsync("httpGetAll", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const targets = fetchTargets(context.dump(args[0]), context.dump(args[1]));
      const texts = await Promise.all(
        targets.map(async (target) => {
          try {
            const request = await prepareRequest(target.url, { referer: target.referer });
            const response = await executeRequest(target.url, request);
            return response.text;
          } catch {
            // One dead page never fails the batch.
            return "";
          }
        }),
      );
      const array = context.newArray();
      texts.forEach((text, index) => {
        const handle = context.newString(text);
        context.setProp(array, index, handle);
        handle.dispose();
      });
      return array;
    }),
  );
  context.setProp(context.global, "__httpGetAll", httpGetAllFn);
  httpGetAllFn.dispose();

  // `httpHead`: status + response headers without a body. The JSON round-trip
  // keeps object construction out of the host.
  const httpHeadFn = context.newAsyncifiedFunction(
    "__httpHead",
    guardAsync("httpHead", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpHead(url)");
      const referer = optionalStringArg(context, args[1]);
      const request = await prepareRequest(url, { method: "HEAD", referer });
      const response = await executeRequest(url, request);
      const header = (name: string) => response.headers?.get(name) ?? null;
      return context.newString(
        JSON.stringify({
          status: response.status,
          finalUrl: response.url,
          contentType: header("content-type"),
          contentLength: header("content-length"),
        }),
      );
    }),
  );
  context.setProp(context.global, "__httpHead", httpHeadFn);
  httpHeadFn.dispose();

  // `httpGetBytes`: binary body as base64 (QuickJS strings are UTF-16 text).
  const httpGetBytesFn = context.newAsyncifiedFunction(
    "__httpGetBytes",
    guardAsync("httpGetBytes", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpGetBytes(url)");
      const referer = optionalStringArg(context, args[1]);
      checkEgress(url);
      if (!options.fetchBytes) throw new Error("httpGetBytes: no binary transport is configured");
      const host = hostOf(url) ?? "";
      const wait = reserveHostSlot(host, network.rateLimitMs ?? 0);
      if (wait > 0) await sleep(wait);
      state.requests += 1;
      if (state.requests > limits.maxRequests) {
        throw new Error(
          `httpGetBytes: request budget exhausted (${limits.maxRequests} requests per search)`,
        );
      }
      const budget = timeLeft() - HTTP_DEADLINE_MARGIN_MS;
      if (budget < HTTP_MIN_REQUEST_MS) throw new Error("httpGetBytes: search budget exhausted");
      const headers: Record<string, string> = {};
      if (referer) headers.referer = referer;
      const base64 = await options.fetchBytes(url, {
        headers,
        timeoutMs: Math.min(HTTP_TIMEOUT_MS, budget),
        signal: controller.signal,
        maxBytes: limits.maxResponseBytes,
      });
      return context.newString(base64);
    }),
  );
  context.setProp(context.global, "__httpGetBytes", httpGetBytesFn);
  httpGetBytesFn.dispose();

  // `httpGetTorrent`: fetch + parse a .torrent (or magnet) in the host and
  // return `{name, totalSize, infohash, files}` — the shape the file-selection
  // UI expects.
  const httpGetTorrentFn = context.newAsyncifiedFunction(
    "__httpGetTorrent",
    guardAsync("httpGetTorrent", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const url = readStringArg(context, args[0], "httpGetTorrent(url)");
      const referer = optionalStringArg(context, args[1]);
      if (!options.fetchTorrent) {
        throw new Error("httpGetTorrent: no torrent transport is configured");
      }
      // A magnet needs no network, so it bypasses egress/rate limiting.
      if (!/^magnet:/i.test(url)) {
        checkEgress(url);
        const host = hostOf(url) ?? "";
        const wait = reserveHostSlot(host, network.rateLimitMs ?? 0);
        if (wait > 0) await sleep(wait);
        state.requests += 1;
        if (state.requests > limits.maxRequests) {
          throw new Error(
            `httpGetTorrent: request budget exhausted (${limits.maxRequests} requests per search)`,
          );
        }
      }
      const budget = timeLeft() - HTTP_DEADLINE_MARGIN_MS;
      if (budget < HTTP_MIN_REQUEST_MS && !/^magnet:/i.test(url)) {
        throw new Error("httpGetTorrent: search budget exhausted");
      }
      const headers: Record<string, string> = {};
      if (referer) {
        if (/[\r\n]/.test(referer)) throw new Error("httpGetTorrent: referer contains CR or LF");
        headers.referer = referer;
      }
      const json = await options.fetchTorrent(url, {
        headers,
        timeoutMs: Math.min(HTTP_TIMEOUT_MS, Math.max(HTTP_MIN_REQUEST_MS, budget)),
        signal: controller.signal,
      });
      return context.newString(json ?? "null");
    }),
  );
  context.setProp(context.global, "__httpGetTorrent", httpGetTorrentFn);
  httpGetTorrentFn.dispose();

  // `parseHtml`: CSS-selector extraction in the host (cheerio), so plugins can
  // stop hand-rolling regexes over scraped pages.
  const parseHtmlFn = context.newAsyncifiedFunction(
    "__parseHtml",
    guardAsync("parseHtml", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const html = readStringArg(context, args[0], "parseHtml(html)");
      const selector = readStringArg(context, args[1], "parseHtml(selector)");
      const limitRaw = Number(context.dump(args[2]));
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 100;
      return context.newString(JSON.stringify(selectHtml(html, selector, limit)));
    }),
  );
  context.setProp(context.global, "__parseHtml", parseHtmlFn);
  parseHtmlFn.dispose();

  // `sleep`: yields inside the sandbox while respecting its own deadline.
  const sleepFn = context.newAsyncifiedFunction(
    "sleep",
    guardAsync("sleep", async (...args: QuickJSHandle[]): Promise<QuickJSHandle> => {
      const requested = Number(context.dump(args[0]));
      const ms = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_SLEEP_MS, requested)) : 0;
      const allowed = Math.min(ms, Math.max(0, timeLeft() - HTTP_DEADLINE_MARGIN_MS));
      if (allowed > 0) await sleep(allowed);
      return context.undefined;
    }),
  );
  context.setProp(context.global, "sleep", sleepFn);
  sleepFn.dispose();

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
    globalThis.httpRequest = function (url, options) {
      return __httpRequest(url, options);
    };
    globalThis.httpRequestJson = function (url, options) {
      return JSON.parse(httpRequest(url, options));
    };
    globalThis.httpGetAll = function (urls, referers) {
      return __httpGetAll(urls, referers);
    };
    globalThis.httpHead = function (url, referer) {
      return JSON.parse(__httpHead(url, referer));
    };
    globalThis.httpGetBytes = function (url, referer) {
      return __httpGetBytes(url, referer);
    };
    globalThis.httpGetTorrent = function (url, referer) {
      return JSON.parse(__httpGetTorrent(url, referer));
    };
    globalThis.parseHtml = function (html, selector, limit) {
      return JSON.parse(__parseHtml(html, selector, limit));
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

function asStringArray(value: unknown, limit = Number.POSITIVE_INFINITY): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .slice(0, limit)
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
  const directUrls = asStringArray(input.directUrls, MAX_DIRECT_URLS);
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
      .slice(0, MAX_FILE_LIST_ENTRIES)
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
      .slice(0, MAX_CHECKSUMS)
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
