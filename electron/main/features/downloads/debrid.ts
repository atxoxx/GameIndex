/**
 * Debrid provider clients (AllDebrid, Real-Debrid, TorBox, Premiumize).
 *
 * Port of `src-tauri/src/downloads/debrid.rs`. Request shapes, endpoint
 * paths and the tolerant response parsing follow the Rust client because the
 * providers themselves are unchanged:
 *
 *  - AllDebrid: Bearer auth + POST form bodies, `/v4` & `/v4.1` endpoints.
 *  - TorBox: Bearer auth, `createtorrent` is multipart, `requestdl` needs the
 *    key as a `token` query parameter.
 *  - Real-Debrid: Bearer auth + form bodies.
 *  - Premiumize: `apikey` query parameter, tolerant transfer/folder shapes.
 */
import { DEFAULT_USER_AGENT } from "../../lib/http";
import { btihFromMagnet } from "./util";
import type {
  DebridFileEntry,
  DebridProvider,
  DebridResolvedFile,
  DebridStatus,
} from "./types";

const JSON_HEADERS = {
  accept: "application/json",
  "user-agent": DEFAULT_USER_AGENT,
};

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  timeoutMs?: number;
}

/** Provider label for user-facing errors, derived from the API host. */
function providerLabel(url: string): string {
  if (url.includes("alldebrid")) return "AllDebrid";
  if (url.includes("real-debrid")) return "Real-Debrid";
  if (url.includes("torbox")) return "TorBox";
  if (url.includes("premiumize")) return "Premiumize";
  return "The debrid provider";
}

/**
 * Turn an HTTP failure into something the Settings page can show. A rejected
 * key is by far the most common failure, and "HTTP 403 — {"error":"bad_token"}"
 * is not an answer a user can act on.
 */
function describeHttpFailure(status: number, body: string, url: string): string {
  const provider = providerLabel(url);
  const detail = body.trim().replace(/\s+/g, " ").slice(0, 160);
  const suffix = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key — check it in Settings → Downloads.${suffix}`;
  }
  if (status === 404) {
    return `${provider} does not recognise this resource (HTTP 404).${suffix}`;
  }
  if (status === 429) {
    return `${provider} is rate-limiting requests — wait a minute and try again.${suffix}`;
  }
  if (status >= 500) {
    return `${provider} is unavailable right now (HTTP ${status}) — try again later.${suffix}`;
  }
  return `${provider} request failed (HTTP ${status}).${suffix}`;
}

async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: { ...JSON_HEADERS, ...options.headers },
      body: options.body,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(describeHttpFailure(response.status, text, url));
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${providerLabel(url)} did not answer in time — check your connection and try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

function encodeQuery(params: Array<[string, string]>): string {
  return params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/**
 * Unix seconds from a provider expiry field, which may be a Unix timestamp,
 * an ISO-8601 date, or absent. Returns null when the provider does not say.
 */
function premiumExpiry(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.trunc(raw > 10_000_000_000 ? raw / 1000 : raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.trunc(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

// ─── AllDebrid ──────────────────────────────────────────────────────────────

interface AllDebridEnvelope<T> {
  status?: string;
  data?: T;
  error?: { message?: string; code?: string };
}

async function allDebridCall<T>(
  path: string,
  apikey: string,
  form?: Array<[string, string]>,
): Promise<T> {
  const body = form ? new URLSearchParams(form) : undefined;
  const envelope = await requestJson<AllDebridEnvelope<T>>(
    `https://api.alldebrid.com${path}`,
    {
      method: form ? "POST" : "GET",
      headers: { Authorization: `Bearer ${apikey.trim()}` },
      body,
    },
  );
  if (envelope.status !== "success") {
    const code = envelope.error?.code ?? "";
    const message = envelope.error?.message ?? "";
    if (code === "AUTH_BAD_APIKEY" || /invalid api ?key/i.test(message)) {
      throw new Error("AllDebrid rejected the API key — check it in Settings → Downloads.");
    }
    if (code === "AUTH_USER_BANNED") {
      throw new Error("This AllDebrid account is banned.");
    }
    if (code === "MAGNET_INVALID_URI") {
      throw new Error("AllDebrid could not read this magnet link.");
    }
    throw new Error(message || code || "Unknown AllDebrid error");
  }
  return envelope.data as T;
}

function allDebridMagnets(value: unknown): Record<string, unknown>[] {
  const data = asRecord(value);
  return asArray(data.magnets).map(asRecord);
}

function collectAllDebridFiles(payload: unknown, out: DebridResolvedFile[]): void {
  const pushNodes = (nodes: unknown[], parent: string): void => {
    for (const raw of nodes) {
      const node = asRecord(raw);
      const name = asString(node.n) || asString(node.name);
      const full = parent
        ? name
          ? `${parent}/${name}`
          : parent
        : name;
      const link = asString(node.l) || asString(node.link) || asString(node.downloadUrl);
      if (link) {
        out.push({
          name: full,
          size: asNumber(node.s ?? node.size),
          link,
        });
      }
      const children = node.e ?? node.entries;
      if (Array.isArray(children)) pushNodes(children, full);
    }
  };

  const payloadObj = asRecord(payload);
  const magnets = payloadObj.magnets;
  if (magnets) {
    for (const magnetRaw of asArray(magnets)) {
      const magnet = asRecord(magnetRaw);
      const files = magnet.files;
      if (Array.isArray(files)) pushNodes(files, "");
    }
    return;
  }
  if (Array.isArray(payloadObj.files)) {
    pushNodes(payloadObj.files, "");
    return;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const files = asRecord(item).files;
      if (Array.isArray(files)) pushNodes(files, "");
    }
  }
}

const ALLDEBRID: DebridProvider = {
  id: "alldebrid",

  async testKey(apikey) {
    const data = asRecord(await allDebridCall<unknown>("/v4/user", apikey));
    const user = asRecord(data.user);
    const premium = asBool(user.isPremium ?? user.is_premium);
    const until = asNumber(user.premiumUntil ?? user.premium_until);
    return {
      username: asString(user.username, "AllDebrid user"),
      premiumUntil: premium && until > 0 ? until : null,
    };
  },

  async uploadMagnet(apikey, magnet) {
    const data = await allDebridCall<unknown>("/v4/magnet/upload", apikey, [
      ["magnets[]", magnet.trim()],
    ]);
    const first = allDebridMagnets(data)[0];
    if (!first) throw new Error("No magnet entry returned by AllDebrid");
    const error = asRecord(first.error);
    const errorMessage = asString(error.message);
    if (errorMessage) throw new Error(errorMessage);
    const id = first.id;
    if (id === undefined || id === null) {
      throw new Error("No magnet id returned by AllDebrid");
    }
    return { id: String(id), cached: asBool(first.ready) };
  },

  async getStatus(apikey, id) {
    const data = await allDebridCall<unknown>("/v4.1/magnet/status", apikey, [["id", id]]);
    const magnet = allDebridMagnets(data)[0];
    if (!magnet) throw new Error("Magnet not found in AllDebrid status response");
    const statusCode = asNumber(magnet.statusCode ?? magnet.status_code);
    const status: DebridStatus["status"] =
      statusCode === 4 ? "ready" : statusCode >= 0 && statusCode <= 3 ? "downloading" : "error";
    const size = asNumber(magnet.size);
    const downloaded = asNumber(magnet.downloaded);

    let files: DebridResolvedFile[] = [];
    if (status === "ready") {
      try {
        const fileData = await allDebridCall<unknown>("/v4/magnet/files", apikey, [
          ["id[]", id],
        ]);
        collectAllDebridFiles(fileData, files);
      } catch {
        files = [];
      }
      if (files.length === 0) {
        files = asArray(magnet.links)
          .map(asRecord)
          .map((link) => ({ name: "", size: 0, link: asString(link.link) }))
          .filter((file) => file.link.length > 0);
      }
    }

    const filename = asString(magnet.filename);
    const description = asString(magnet.statusCodeDescription ?? magnet.status_code_description);
    return {
      id,
      progress: size > 0 ? (downloaded / size) * 100 : 0,
      status,
      files,
      name: filename && filename !== "noname" ? filename : null,
      magnetSize: size > 0 ? size : null,
      errorMessage:
        status === "error"
          ? description || `AllDebrid error code ${statusCode}`
          : null,
    };
  },

  async unrestrictLink(apikey, url) {
    const data = asRecord(
      await allDebridCall<unknown>("/v4/link/unlock", apikey, [["link", url.trim()]]),
    );
    const direct = asString(data.link);
    if (direct) return direct;

    // Delayed unlock: poll `/v4/link/delayed` until the link is generated.
    const delayedRaw = data.delayed;
    const delayedId =
      typeof delayedRaw === "number"
        ? String(delayedRaw)
        : typeof delayedRaw === "string" && delayedRaw.trim()
          ? delayedRaw.trim()
          : null;
    if (!delayedId) throw new Error("AllDebrid returned an empty direct download link");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const polled = asRecord(
        await allDebridCall<unknown>("/v4/link/delayed", apikey, [["id", delayedId]]),
      );
      const link = asString(polled.link);
      if (link) return link;
    }
    throw new Error("AllDebrid link generation timed out");
  },

  async checkCache(apikey, magnet) {
    const upload = await ALLDEBRID.uploadMagnet(apikey, magnet);
    const cleaned = await ALLDEBRID.deleteTransfer!(apikey, upload.id).then(
      () => true,
      (error) => {
        const lower = String(error).toLowerCase();
        return lower.includes("invalid") || lower.includes("not found");
      },
    );
    return { cached: upload.cached, probeId: cleaned ? null : upload.id };
  },

  async listMagnetFiles(apikey, magnet) {
    const upload = await ALLDEBRID.uploadMagnet(apikey, magnet);
    const deadline = Date.now() + 120_000;
    let files: DebridResolvedFile[] = [];
    let name: string | null = null;
    let totalSize = 0;
    let first = true;
    while (Date.now() < deadline && files.length === 0) {
      if (!first) await new Promise((resolve) => setTimeout(resolve, 2_000));
      first = false;
      try {
        const payload = await allDebridCall<unknown>("/v4/magnet/files", apikey, [
          ["id[]", upload.id],
        ]);
        collectAllDebridFiles(payload, files);
      } catch {
        files = [];
      }
      if (files.length > 0) {
        try {
          const status = await ALLDEBRID.getStatus(apikey, upload.id);
          name = status.name;
          totalSize = status.magnetSize ?? 0;
        } catch {
          /* name/size are optional */
        }
      }
    }
    const cleaned = await ALLDEBRID.deleteTransfer!(apikey, upload.id).then(
      () => true,
      () => false,
    );
    if (files.length === 0) {
      throw new Error(
        "AllDebrid could not list the files of this magnet — it may be dead or its metadata is unavailable.",
      );
    }
    return {
      files: files.map<DebridFileEntry>((file) => ({ name: file.name, size: file.size })),
      name,
      totalSize,
      probeId: cleaned ? null : upload.id,
    };
  },

  async deleteTransfer(apikey, id) {
    await allDebridCall<unknown>("/v4/magnet/delete", apikey, [["id", id]]);
  },
};

// ─── TorBox ─────────────────────────────────────────────────────────────────

interface TorBoxEnvelope<T> {
  success?: boolean;
  error?: string | null;
  detail?: string | null;
  data?: T;
}

function torBoxError(body: TorBoxEnvelope<unknown>, fallback: string): Error {
  const detail = asString(body.detail);
  const code = asString(body.error);
  if (
    /token|auth|api.?key/i.test(code) ||
    /invalid.*(token|key)|(token|key).*(invalid|expired)/i.test(detail)
  ) {
    return new Error(
      `TorBox rejected the API key — check it in Settings → Downloads.${code ? ` (${code})` : ""}`,
    );
  }
  if (detail && code) return new Error(`${detail} [${code}]`);
  if (detail) return new Error(detail);
  if (code) return new Error(`${fallback} [${code}]`);
  return new Error(fallback);
}

async function torBoxJson<T>(
  path: string,
  apikey: string,
  init: { method?: string; query?: Array<[string, string]>; form?: FormData } = {},
): Promise<T> {
  const query = init.query ? `?${encodeQuery(init.query)}` : "";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apikey.trim()}`,
    accept: "application/json",
  };
  if (!init.form) headers["user-agent"] = DEFAULT_USER_AGENT;
  const envelope = await requestJson<TorBoxEnvelope<T>>(
    `https://api.torbox.app/v1/api${path}${query}`,
    {
      method: init.method ?? "GET",
      headers,
      body: init.form,
      timeoutMs: 60_000,
    },
  );
  if (!envelope.success) throw torBoxError(envelope, "TorBox request failed");
  return envelope.data as T;
}

function numericId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function torBoxFiles(rawFiles: unknown): DebridResolvedFile[] {
  const out: DebridResolvedFile[] = [];
  for (const raw of asArray(rawFiles)) {
    const file = asRecord(raw);
    const fileId = numericId(file.id);
    if (fileId === null) continue;
    const name =
      asString(file.name) || asString(file.short_name) || `file-${fileId}`;
    out.push({
      name,
      size: Math.max(0, asNumber(file.size)),
      link: "",
      fileId,
    });
  }
  return out;
}

const TORBOX: DebridProvider = {
  id: "torbox",

  async testKey(apikey) {
    const data = asRecord(await torBoxJson<unknown>("/user/me", apikey));
    const premium =
      asBool(data.is_premium) || asBool(data.is_subscribed) || asNumber(data.plan) > 0;
    return {
      username: asString(data.email, "TorBox user"),
      premiumUntil: premium ? premiumExpiry(data.premium_until ?? data.premium_expires_at) : null,
    };
  },

  async uploadMagnet(apikey, magnet) {
    const form = new FormData();
    form.set("magnet", magnet);
    const data = await torBoxJson<Record<string, unknown>>(
      "/torrents/createtorrent",
      apikey,
      { method: "POST", form },
    );
    const id = numericId(data.torrent_id);
    if (id === null) throw new Error("No torrent ID returned by TorBox");
    // TorBox reports cache hits only in prose: "Found Cached Torrent…".
    const detailText = asString(data.magnet ?? data.detail);
    return {
      id: String(id),
      cached: /cached/i.test(detailText) || asBool(data.cached),
    };
  },

  async getStatus(apikey, id) {
    const list = asArray(await torBoxJson<unknown>("/torrents/mylist", apikey, {
      query: [["bypass", "true"]],
    }));
    const numeric = numericId(id);
    const item = list.map(asRecord).find((row) => numericId(row.id) === numeric);
    if (!item) throw new Error("Torrent not found on TorBox");
    const finished = asBool(item.download_finished);
    const present = asBool(item.download_present);
    const status: DebridStatus["status"] =
      finished && present ? "ready" : asBool(item.active) ? "downloading" : "queued";
    const files = status === "ready" ? torBoxFiles(item.files) : [];
    const size = asNumber(item.size);
    return {
      id,
      progress: asNumber(item.progress) * 100,
      status,
      files,
      name: asString(item.name) || null,
      magnetSize: size > 0 ? size : null,
      errorMessage: null,
    };
  },

  async unrestrictLink(apikey, url) {
    const created = await torBoxJson<Record<string, unknown>>(
      "/webdl/createwebdownload",
      apikey,
      { method: "POST", form: jsonForm({ link: url }) },
    );
    const webId = asString(
      created.webdownload_id ?? created.webdl_id ?? created.id,
    );
    if (!webId) throw new Error("No webdownload_id returned from TorBox");

    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const list = asArray(
        await torBoxJson<unknown>("/webdl/mylist", apikey, {
          query: [["bypass", "true"]],
        }),
      );
      const entry = list
        .map(asRecord)
        .find((row) => String(row.id) === webId);
      if (!entry) continue;
      const error = asString(entry.error);
      if (error) throw new Error(`TorBox web download failed: ${error}`);
      ready = asBool(entry.download_finished) && asBool(entry.download_present);
    }
    if (!ready) throw new Error("TorBox web download timed out (60s)");

    const link = await torBoxJson<unknown>("/webdl/requestdl", apikey, {
      query: [["web_id", webId]],
    });
    const direct = asString(link);
    if (!direct) throw new Error("No direct link returned by TorBox");
    return direct;
  },

  async checkCache(apikey, magnet) {
    const btih = btihFromMagnet(magnet);
    if (!btih) throw new Error("Could not read a 40-hex infohash from this magnet");
    const data = await torBoxJson<unknown>("/torrents/checkcached", apikey, {
      query: [
        ["hash", btih],
        ["list_files", "false"],
      ],
    });
    const record = asRecord(data);
    let cached = false;
    if (typeof data === "boolean") cached = data;
    else if (Object.keys(record).length > 0) {
      cached = Object.keys(record).some((key) => key.toLowerCase() === btih);
    }
    return { cached, probeId: null };
  },

  async listMagnetFiles(apikey, magnet) {
    const btih = btihFromMagnet(magnet);
    if (!btih) throw new Error("Could not read a 40-hex infohash from this magnet");
    const data = asRecord(
      await torBoxJson<unknown>("/torrents/torrentinfo", apikey, {
        query: [["hash", btih]],
      }),
    );
    const files = asArray(data.files).map<DebridFileEntry>((raw) => {
      const file = asRecord(raw);
      return {
        name: asString(file.name) || asString(file.short_name),
        size: Math.max(0, asNumber(file.size)),
      };
    });
    if (files.length === 0) {
      throw new Error(
        "TorBox could not list the files of this magnet — it may be dead or its metadata is unavailable.",
      );
    }
    return {
      files,
      name: asString(data.name) || null,
      totalSize: asNumber(data.size),
      probeId: null,
    };
  },

  async refreshFileLink(apikey, file, transferId) {
    if (file.fileId === undefined || file.fileId === null) return null;
    const torrentId = numericId(transferId);
    if (torrentId === null) return null;
    const link = await torBoxJson<unknown>("/torrents/requestdl", apikey, {
      query: [
        ["token", apikey.trim()],
        ["torrent_id", String(torrentId)],
        ["file_id", String(file.fileId)],
      ],
    });
    const direct = asString(link);
    return direct || null;
  },
};

function jsonForm(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

// ─── Real-Debrid ────────────────────────────────────────────────────────────

async function realDebridRequest<T>(
  path: string,
  apikey: string,
  init: { method?: string; form?: Array<[string, string]> } = {},
): Promise<T> {
  const body = init.form ? new URLSearchParams(init.form) : undefined;
  return requestJson<T>(`https://api.real-debrid.com/rest/1.0${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${apikey.trim()}` },
    body,
  });
}

const REALDEBRID: DebridProvider = {
  id: "realdebrid",

  async testKey(apikey) {
    const user = asRecord(await realDebridRequest<unknown>("/user", apikey));
    const premium = asNumber(user.premium) > 0 || Boolean(user.expiration);
    return {
      username: asString(user.username, "Real-Debrid user"),
      premiumUntil: premium ? premiumExpiry(user.expiration) : null,
    };
  },

  async uploadMagnet(apikey, magnet) {
    const added = asRecord(
      await realDebridRequest<unknown>("/torrents/addMagnet", apikey, {
        method: "POST",
        form: [["magnet", magnet]],
      }),
    );
    const id = asString(added.id);
    if (!id) throw new Error("No torrent id returned by Real-Debrid");
    try {
      await realDebridRequest<unknown>(`/torrents/selectFiles/${id}`, apikey, {
        method: "POST",
        form: [["files", "all"]],
      });
    } catch {
      // The selection can race metadata; status polling reports the rest.
    }
    return { id, cached: false };
  },

  async getStatus(apikey, id) {
    const info = asRecord(await realDebridRequest<unknown>(`/torrents/info/${id}`, apikey));
    const rawStatus = asString(info.status);
    const status: DebridStatus["status"] =
      rawStatus === "downloaded"
        ? "ready"
        : ["downloading", "compressing", "uploading"].includes(rawStatus)
          ? "downloading"
          : ["queued", "waiting_files_selection", "magnet_conversion"].includes(rawStatus)
            ? "queued"
            : "error";
    const links = asArray(info.links).map((link) => asString(link));
    const files = asArray(info.files).map(asRecord);
    const selected = files.filter((file) => asNumber(file.selected) !== 0);
    const resolved: DebridResolvedFile[] =
      status === "ready"
        ? links.map((link, index) => {
            const meta = selected[index];
            return {
              name: asString(meta?.path).replace(/^\//, ""),
              size: asNumber(meta?.bytes),
              link,
            };
          })
        : [];
    return {
      id,
      progress: asNumber(info.progress),
      status,
      files: resolved,
      name: asString(info.filename) || null,
      magnetSize: asNumber(info.bytes) > 0 ? asNumber(info.bytes) : null,
      errorMessage: status === "error" ? `Real-Debrid status: ${rawStatus}` : null,
    };
  },

  async unrestrictLink(apikey, url) {
    const body = asRecord(
      await realDebridRequest<unknown>("/unrestrict/link", apikey, {
        method: "POST",
        form: [["link", url]],
      }),
    );
    const direct = asString(body.download) || asString(body.link);
    if (!direct) throw new Error("No direct download link returned by Real-Debrid");
    return direct;
  },

  async checkCache() {
    throw new Error("Cache check is not supported for this debrid provider");
  },

  async listMagnetFiles() {
    throw new Error("File listing over debrid is not supported for this provider");
  },

  async refreshFileLink(apikey, file) {
    if (!file.link) return null;
    return REALDEBRID.unrestrictLink(apikey, file.link);
  },
};

// ─── Premiumize ─────────────────────────────────────────────────────────────

interface PremiumizeEnvelope<T> {
  status?: string;
  message?: string;
  data?: T;
}

async function premiumizeRequest<T>(
  path: string,
  apikey: string,
  params: Array<[string, string]>,
  method = "GET",
): Promise<T> {
  const query = encodeQuery([["apikey", apikey.trim()], ...params]);
  const url =
    method === "GET"
      ? `https://www.premiumize.me/api${path}?${query}`
      : `https://www.premiumize.me/api${path}`;
  const body = method === "GET" ? undefined : new URLSearchParams(query);
  const envelope = await requestJson<PremiumizeEnvelope<T>>(url, {
    method,
    body,
    timeoutMs: 60_000,
  });
  if (envelope.status && envelope.status !== "success") {
    throw new Error(envelope.message || "Premiumize request failed");
  }
  return (envelope.data ?? (envelope as unknown)) as T;
}

function premiumizeFileEntries(rawContent: unknown): DebridResolvedFile[] {
  const out: DebridResolvedFile[] = [];
  for (const raw of asArray(rawContent)) {
    const item = asRecord(raw);
    const type = asString(item.type, "file");
    if (type === "folder") continue;
    out.push({
      name: asString(item.name) || asString(item.path),
      size: asNumber(item.size),
      link: asString(item.link) || asString(item.stream_link),
      fileId: numericId(item.id),
    });
  }
  return out;
}

const PREMIUMIZE: DebridProvider = {
  id: "premiumize",

  async testKey(apikey) {
    const info = asRecord(
      await premiumizeRequest<unknown>("/account/info", apikey, []),
    );
    const premiumUntil = asNumber(info.premium_until);
    return {
      username: asString(info.customer_id, "Premiumize user"),
      premiumUntil: premiumUntil > 0 ? premiumUntil : null,
    };
  },

  async uploadMagnet(apikey, magnet) {
    const created = asRecord(
      await premiumizeRequest<unknown>("/transfer/create", apikey, [["src", magnet]], "POST"),
    );
    const id = asString(created.id);
    if (!id) throw new Error("No transfer id returned by Premiumize");
    let cached = false;
    try {
      const check = await PREMIUMIZE.checkCache(apikey, magnet);
      cached = check.cached;
    } catch {
      /* cache status is advisory */
    }
    return { id, cached };
  },

  async getStatus(apikey, id) {
    const list = asRecord(await premiumizeRequest<unknown>("/transfer/list", apikey, []));
    const transfers = asArray(list.transfers).map(asRecord);
    const item = transfers.find((row) => asString(row.id) === id);
    if (!item) throw new Error("Transfer not found on Premiumize");
    const rawStatus = asString(item.status);
    const status: DebridStatus["status"] =
      rawStatus === "finished" || rawStatus === "seeding"
        ? "ready"
        : rawStatus === "error" || rawStatus === "deleted"
          ? "error"
          : rawStatus === "running"
            ? "downloading"
            : "queued";
    let files: DebridResolvedFile[] = [];
    if (status === "ready") {
      const folderId = item.folder_id ?? item.file_id;
      if (folderId !== undefined && folderId !== null) {
        try {
          const folder = asRecord(
            await premiumizeRequest<unknown>("/folder/list", apikey, [
              ["id", String(folderId)],
            ]),
          );
          files = premiumizeFileEntries(folder.content);
        } catch {
          files = [];
        }
      }
      if (files.length === 0) {
        const link = asString(item.link) || asString(item.src);
        if (link) files = [{ name: asString(item.name) || "premiumize_download", size: asNumber(item.size), link }];
      }
    }
    return {
      id,
      progress: asNumber(item.progress) * 100,
      status,
      files,
      name: asString(item.name) || null,
      magnetSize: asNumber(item.size) > 0 ? asNumber(item.size) : null,
      errorMessage: status === "error" ? asString(item.message) || "Premiumize transfer error" : null,
    };
  },

  async unrestrictLink(apikey, url) {
    const data = await premiumizeRequest<unknown>("/transfer/directdl", apikey, [
      ["src", url],
    ]);
    const entries = premiumizeFileEntries(asRecord(data).content);
    const link = entries[0]?.link ?? asString(asRecord(data).link);
    if (!link) throw new Error("No direct download link returned by Premiumize");
    return link;
  },

  async checkCache(apikey, magnet) {
    const data = asRecord(
      await premiumizeRequest<unknown>("/cache/check", apikey, [["items[]", magnet]]),
    );
    const response = data.response;
    if (typeof response === "boolean") return { cached: response, probeId: null };
    if (Array.isArray(response)) {
      return { cached: response.some((entry) => entry === true), probeId: null };
    }
    const record = asRecord(response);
    const btih = btihFromMagnet(magnet);
    const cached = btih ? asBool(record[btih]) : Object.values(record).some(asBool);
    return { cached, probeId: null };
  },

  async listMagnetFiles(apikey, magnet) {
    // Premiumize has no swarm-free listing endpoint: create the transfer,
    // wait for its file tree, then remove the probe transfer again.
    const upload = await PREMIUMIZE.uploadMagnet(apikey, magnet);
    const deadline = Date.now() + 120_000;
    let files: DebridFileEntry[] = [];
    let name: string | null = null;
    let total = 0;
    while (Date.now() < deadline && files.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const status = await PREMIUMIZE.getStatus(apikey, upload.id);
      name = status.name;
      total = status.magnetSize ?? total;
      files = status.files.map((file) => ({ name: file.name, size: file.size }));
    }
    await premiumizeRequest<unknown>("/transfer/delete", apikey, [["id", upload.id]], "POST").catch(
      () => undefined,
    );
    if (files.length === 0) {
      throw new Error(
        "Premiumize could not list the files of this magnet — it may be dead or its metadata is unavailable.",
      );
    }
    return { files, name, totalSize: total, probeId: null };
  },

  async refreshFileLink(apikey, file, transferId) {
    if (file.link) return file.link;
    const status = await PREMIUMIZE.getStatus(apikey, transferId);
    const match = status.files.find((entry) => entry.name === file.name);
    return match?.link || null;
  },
};

const PROVIDERS: Record<string, DebridProvider> = {
  alldebrid: ALLDEBRID,
  realdebrid: REALDEBRID,
  torbox: TORBOX,
  premiumize: PREMIUMIZE,
};

export function debridProvider(id: string): DebridProvider {
  const provider = PROVIDERS[id.trim().toLowerCase()];
  if (!provider) throw new Error("Unsupported debrid provider");
  return provider;
}

export function supportedDebridProviders(): string[] {
  return Object.keys(PROVIDERS);
}

/**
 * Resolve a provider-listed file into a direct, downloadable URL:
 *  - AllDebrid / Real-Debrid links need an unlock call.
 *  - TorBox mints per-file links from ids.
 *  - Premiumize folder links are already direct; otherwise re-list.
 */
export async function resolveFileUrl(
  provider: DebridProvider,
  apikey: string,
  transferId: string,
  file: DebridResolvedFile,
): Promise<string> {
  if (provider.id === "torbox" && file.fileId !== undefined && file.fileId !== null) {
    const link = await provider.refreshFileLink?.(apikey, file, transferId);
    if (link) return link;
    throw new Error("TorBox did not return a download link for this file");
  }
  if (file.link && (provider.id === "alldebrid" || provider.id === "realdebrid")) {
    return provider.unrestrictLink(apikey, file.link);
  }
  if (file.link) return file.link;
  const refreshed = await provider.refreshFileLink?.(apikey, file, transferId);
  if (refreshed) return refreshed;
  throw new Error("No download link is available for this file");
}
