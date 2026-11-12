/**
 * Long-lived HTTP helpers for the backend ports.
 *
 * Every network call the old Rust backend made went through `reqwest` with a
 * shared user agent, cookie jar, gzip and a timeout. This module is the Node
 * equivalent (global `fetch` + `undici` under Electron's hood), so ports read
 * the same way:
 *
 *   const html = await httpText(url, { cookies: "steam" });
 *   const data = await httpJson<SteamAppDetails>(url);
 *
 * Rules:
 *  - Always pass a `timeoutMs` for scraped endpoints; never hang a command.
 *  - Use `retries` only for idempotent GETs.
 *  - Streaming downloads use `downloadToFile`, not `httpBuffer`, so large files
 *    never sit in memory.
 *  - Cookies are per-jar (named), persisted in-process only. Store logins that
 *    need to survive restarts must be persisted by the caller.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 GameIndex/2.4";

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
}

export class CookieJar {
  private cookies = new Map<string, Cookie>();

  private key(cookie: Cookie): string {
    return `${cookie.domain ?? ""}|${cookie.path ?? "/"}|${cookie.name}`;
  }

  store(response: Response, requestUrl: string): void {
    const header = response.headers.get("set-cookie");
    if (!header) return;
    let host = "";
    try {
      host = new URL(requestUrl).hostname;
    } catch {
      return;
    }
    // Multiple cookies arrive folded into one header with `, name=value` pairs.
    for (const part of header.split(/,(?=[^;]+?=)/g)) {
      const [pair, ...attributes] = part.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const cookie: Cookie = {
        name: pair.slice(0, index).trim(),
        value: pair.slice(index + 1).trim(),
        domain: host,
        path: "/",
      };
      for (const attribute of attributes) {
        const [rawKey, rawValue] = attribute.split("=");
        const attr = rawKey.trim().toLowerCase();
        if (attr === "domain") cookie.domain = rawValue?.trim() ?? host;
        else if (attr === "path") cookie.path = rawValue?.trim() ?? "/";
        else if (attr === "expires") {
          const time = Date.parse(rawValue ?? "");
          if (!Number.isNaN(time)) cookie.expires = time;
        } else if (attr === "max-age") {
          const seconds = Number(rawValue);
          if (Number.isFinite(seconds)) cookie.expires = Date.now() + seconds * 1000;
        }
      }
      if (cookie.expires !== undefined && cookie.expires < Date.now()) {
        this.cookies.delete(this.key(cookie));
      } else {
        this.cookies.set(this.key(cookie), cookie);
      }
    }
  }

  header(requestUrl: string): string {
    let host = "";
    try {
      host = new URL(requestUrl).hostname;
    } catch {
      return "";
    }
    const pairs: string[] = [];
    for (const cookie of this.cookies.values()) {
      const domain = cookie.domain ?? "";
      const matches = domain.startsWith(".") ? host.endsWith(domain) : host === domain;
      if (!matches) continue;
      if (cookie.expires !== undefined && cookie.expires < Date.now()) continue;
      pairs.push(`${cookie.name}=${cookie.value}`);
    }
    return pairs.join("; ");
  }

  clear(): void {
    this.cookies.clear();
  }
}

const jars = new Map<string, CookieJar>();

export function getCookieJar(name = "default"): CookieJar {
  let jar = jars.get(name);
  if (!jar) {
    jar = new CookieJar();
    jars.set(name, jar);
  }
  return jar;
}

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | URLSearchParams;
  timeoutMs?: number;
  retries?: number;
  /** Named cookie jar, e.g. "steam" or "epic". */
  cookies?: string;
  /** Redirect policy; defaults to following. */
  redirect?: RequestRedirect;
  signal?: AbortSignal;
}

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(url: string, options: HttpOptions = {}): Promise<Response> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 20_000,
    retries = 0,
    cookies,
    redirect = "follow",
    signal,
  } = options;

  const jar = cookies ? getCookieJar(cookies) : null;
  let attempt = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const requestHeaders: Record<string, string> = {
      "user-agent": DEFAULT_USER_AGENT,
      "accept-language": "en-US,en;q=0.9",
      ...headers,
    };
    const cookieHeader = jar?.header(url);
    if (cookieHeader) requestHeaders.cookie = cookieHeader;

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body as BodyInit | undefined,
        redirect,
        signal: controller.signal,
      });
      if (jar) jar.store(response, url);

      if (RETRY_STATUS.has(response.status) && attempt < retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(5_000, 400 * 2 ** attempt);
        attempt += 1;
        await sleep(delay);
        continue;
      }
      return response;
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await sleep(Math.min(5_000, 400 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

export interface TextResponse {
  status: number;
  ok: boolean;
  url: string;
  text: string;
  headers: Headers;
}

export async function httpText(url: string, options: HttpOptions = {}): Promise<TextResponse> {
  const response = await request(url, options);
  return {
    status: response.status,
    ok: response.ok,
    url: response.url,
    text: await response.text(),
    headers: response.headers,
  };
}

/** GET + JSON parse. Throws with the status and a short body excerpt on failure. */
export async function httpJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await request(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
}

export async function httpBuffer(url: string, options: HttpOptions = {}): Promise<Buffer> {
  const response = await request(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export interface DownloadResult {
  path: string;
  bytes: number;
  contentType: string | null;
}

/**
 * Stream a URL to disk with an optional progress callback. Writes to
 * `<dest>.part` first so a cancelled download never leaves a torn file at the
 * final path.
 */
export async function downloadToFile(
  url: string,
  destination: string,
  options: HttpOptions & { onProgress?: (bytes: number, total: number | null) => void } = {},
): Promise<DownloadResult> {
  const response = await request(url, options);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : null;
  const temp = `${destination}.part`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  let bytes = 0;
  const out = fs.createWriteStream(temp);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      options.onProgress?.(bytes, Number.isFinite(total) ? total : null);
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      }
    }
  } catch (error) {
    out.destroy();
    fs.rmSync(temp, { force: true });
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    out.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });
  fs.renameSync(temp, destination);

  return { path: destination, bytes, contentType: response.headers.get("content-type") };
}

/** Convenience for form posts (`application/x-www-form-urlencoded`). */
export function formBody(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}
