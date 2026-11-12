/**
 * Downloads commands — direct HTTP, debrid, torrents, scheduling, history and
 * the (empty) download search surface.
 *
 * Workstream: `downloads`. Reference: `git show HEAD:src-tauri/src/downloads/`
 * (`mod.rs` for the exact command signatures), `db/download_history.rs`.
 *
 * Handlers are thin: argument normalization lives here, all state and
 * lifecycle behaviour lives in `features/downloads/manager.ts`.
 */
import { BrowserWindow, dialog } from "electron";
import {
  getWindowLabel,
  registerCommands,
  type CommandHandler,
} from "../ipc";
import { debridProvider } from "../features/downloads/debrid";
import {
  getDownloadManager,
  type AddDebridOptions,
} from "../features/downloads/manager";
import {
  parseDownloadSearchRequest,
  searchDownloadSources,
  streamDownloadSearch,
} from "../features/downloads/searchHost";
import {
  normalizeDownloadSettings,
  normalizeSchedulerConfig,
} from "../features/downloads/state";
import type { PostAction } from "../features/downloads/types";

function text(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function optionalText(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : fallback;
}

function numeric(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function indexList(args: Record<string, unknown>, key: string): number[] | null {
  const value = args[key];
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const entry of value) {
    const n = typeof entry === "number" ? entry : Number(entry);
    if (Number.isFinite(n) && n >= 0) out.push(Math.floor(n));
  }
  return out;
}

function postActions(args: Record<string, unknown>, key = "postActions"): PostAction[] | undefined {
  const value = args[key];
  if (!Array.isArray(value)) return undefined;
  const out: PostAction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    out.push({
      id: typeof entry.id === "string" ? entry.id : `action-${out.length + 1}`,
      kind: entry.kind === "launchInstaller" ? "launchInstaller" : "openFolder",
      onSuccess: entry.onSuccess !== false,
      onFailure: entry.onFailure === true,
      path: typeof entry.path === "string" ? entry.path : null,
    });
  }
  return out;
}

/** `checksums` arrives as `[{algo, value}]` from a plugin result. */
function checksumList(
  args: Record<string, unknown>,
  key: string,
): Array<{ algo: string; value: string }> | null {
  const value = args[key];
  if (!Array.isArray(value)) return null;
  const out: Array<{ algo: string; value: string }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const algo = typeof entry.algo === "string" ? entry.algo.trim() : "";
    const digest = typeof entry.value === "string" ? entry.value.trim() : "";
    if (algo && digest) out.push({ algo, value: digest });
  }
  return out.length > 0 ? out : null;
}

function pickFolder(window: BrowserWindow | null): Promise<string | null> {
  const options = {
    title: "Select download folder",
    properties: ["openDirectory", "createDirectory"] as Array<
      "openDirectory" | "createDirectory"
    >,
  };
  const result = window
    ? dialog.showOpenDialog(window, options)
    : dialog.showOpenDialog(options);
  return result.then((picked) => (picked.canceled ? null : (picked.filePaths[0] ?? null)));
}

export const downloadCommands: Record<string, CommandHandler> = {
  // ── Direct HTTP ─────────────────────────────────────────────────────
  direct_download_start: async (args) => {
    const manager = getDownloadManager();
    return manager.createDirect({
      id: text(args, "id"),
      url: text(args, "url"),
      savePath: text(args, "savePath"),
      gameId: optionalText(args, "gameId"),
      gamePoster: optionalText(args, "gamePoster"),
      sourceName: text(args, "sourceName"),
      autoExtract: flag(args, "autoExtract"),
      uris: indexOrStringList(args, "uris"),
      referer: optionalText(args, "referer"),
      extraHeaders: args.extraHeaders,
      checksums: checksumList(args, "checksums"),
      postActions: postActions(args),
    });
  },

  direct_download_update_url: async (args) => {
    const manager = getDownloadManager();
    await manager.updateDirectUrl(text(args, "id"), text(args, "newUrl"));
    return null;
  },

  // ── Debrid ──────────────────────────────────────────────────────────
  debrid_download_start: async (args) => {
    const manager = getDownloadManager();
    const options: AddDebridOptions = {
      id: text(args, "id"),
      magnet: text(args, "magnet"),
      savePath: text(args, "savePath"),
      gameId: optionalText(args, "gameId"),
      gamePoster: optionalText(args, "gamePoster"),
      sourceName: text(args, "sourceName"),
      provider: text(args, "provider"),
      apikey: text(args, "apikey"),
      autoExtract: flag(args, "autoExtract"),
      onlyFiles: indexList(args, "onlyFiles"),
      postActions: postActions(args),
    };
    return manager.createDebrid(options);
  },

  debrid_unrestrict_link: async (args) => {
    const provider = debridProvider(text(args, "provider"));
    return provider.unrestrictLink(text(args, "apikey"), text(args, "url"));
  },

  test_debrid_key: async (args) => {
    const provider = debridProvider(text(args, "provider"));
    const info = await provider.testKey(text(args, "apikey"));
    // The Settings page declares `premium_until` (snake_case); send both
    // spellings so the Tauri-era call site keeps reading what it expects.
    return { ...info, premium_until: info.premiumUntil };
  },

  debrid_check_cache: async (args) => {
    const manager = getDownloadManager();
    return manager.checkDebridCache(
      text(args, "provider"),
      text(args, "apikey"),
      text(args, "magnet"),
    );
  },

  debrid_list_files: async (args) => {
    const manager = getDownloadManager();
    return manager.listDebridFiles(
      text(args, "provider"),
      text(args, "apikey"),
      text(args, "magnet"),
    );
  },

  debrid_cleanup_probes: async (args) => {
    const manager = getDownloadManager();
    return manager.cleanupProbes(text(args, "provider"), text(args, "apikey"));
  },

  debrid_update_only_files: async (args) => {
    const manager = getDownloadManager();
    await manager.updateOnlyFiles(
      text(args, "id"),
      indexList(args, "onlyFiles") ?? [],
      "debrid",
    );
    return null;
  },

  download_set_debrid_config: (args) => {
    const manager = getDownloadManager();
    manager.setDebridConfig(text(args, "provider"), text(args, "apikey"));
    return null;
  },

  download_get_debrid_key: () => getDownloadManager().getDebridKey(),

  download_set_debrid_key: (args) => {
    const manager = getDownloadManager();
    manager.setDebridKey(optionalText(args, "apikey"));
    return null;
  },

  // ── Torrents ────────────────────────────────────────────────────────
  torrent_add: async (args) => {
    const manager = getDownloadManager();
    return manager.createTorrent({
      magnetUri: text(args, "magnetUri"),
      savePath: text(args, "savePath"),
      gameId: optionalText(args, "gameId"),
      gamePoster: optionalText(args, "gamePoster"),
      sourceName: text(args, "sourceName"),
      autoExtract: flag(args, "autoExtract"),
      listOnly: flag(args, "listOnly"),
      referer: optionalText(args, "referer"),
      postActions: postActions(args),
    });
  },

  torrent_get_all: () => getDownloadManager().list(),

  torrent_list_files: async (args) => {
    const manager = getDownloadManager();
    const files = await manager.listTorrentFiles(
      text(args, "uri"),
      optionalText(args, "referer"),
    );
    return files.map((file) => ({
      name: file.name,
      size: file.size,
      downloaded: 0,
      progress: 0,
      selected: true,
    }));
  },

  torrent_pause: async (args) => {
    await getDownloadManager().pause(text(args, "id"));
    return null;
  },

  torrent_resume: async (args) => {
    await getDownloadManager().resume(text(args, "id"));
    return null;
  },

  torrent_remove: async (args) => {
    await getDownloadManager().remove(text(args, "id"), flag(args, "deleteFiles"));
    return null;
  },

  torrent_pause_all: () => getDownloadManager().pauseAll(),

  torrent_resume_all: () => getDownloadManager().resumeAll(),

  torrent_update_only_files: async (args) => {
    await getDownloadManager().updateOnlyFiles(
      text(args, "id"),
      indexList(args, "onlyFiles") ?? [],
      "torrent",
    );
    return null;
  },

  torrent_start_selected: async (args) => {
    await getDownloadManager().startSelected(
      text(args, "id"),
      indexList(args, "onlyFiles") ?? [],
      flag(args, "autoExtract"),
      postActions(args),
    );
    return null;
  },

  torrent_select_save_path: (_args, ctx) => pickFolder(ctx.window),

  torrent_open_folder: async (args) => {
    await getDownloadManager().openFolder(text(args, "id"));
    return null;
  },

  torrent_set_speed_limits: (args) => {
    const manager = getDownloadManager();
    manager.setSpeedLimits({
      downloadKbps: numeric(args, "downloadLimitKbps"),
      uploadKbps: numeric(args, "uploadLimitKbps"),
      disableUpload: flag(args, "disableUpload"),
    });
    return null;
  },

  download_torrent_detail: (args) =>
    getDownloadManager().torrentDetail(text(args, "id")),

  download_get_transport: () => getDownloadManager().getTransport(),

  download_set_transport: (args) => {
    getDownloadManager().setTransport(flag(args, "utp"));
    return null;
  },

  // ── Lifecycle / queue / scheduling ─────────────────────────────────
  download_retry: async (args) => {
    await getDownloadManager().retry(text(args, "id"));
    return null;
  },

  download_retry_all: () => getDownloadManager().retryAll(),

  download_set_priority: async (args) => {
    await getDownloadManager().setPriority(text(args, "id"), numeric(args, "priority") ?? 0);
    return null;
  },

  download_set_schedule: async (args) => {
    const startAt = numeric(args, "startAt");
    await getDownloadManager().setSchedule(text(args, "id"), startAt);
    return null;
  },

  download_set_seed_config: (args) => {
    getDownloadManager().setSeedConfig(flag(args, "seedAfterComplete"));
    return null;
  },

  download_set_seed_limits: (args) => {
    getDownloadManager().setSeedLimits(
      numeric(args, "ratio") ?? 0,
      numeric(args, "minutes") ?? 0,
    );
    return null;
  },

  download_set_seeding: async (args) => {
    await getDownloadManager().setSeeding(text(args, "id"), flag(args, "seed"));
    return null;
  },

  scheduler_get_config: () => getDownloadManager().getScheduler(),

  scheduler_set_config: (args) => {
    getDownloadManager().setScheduler(normalizeSchedulerConfig(args.config));
    return null;
  },

  download_get_settings: () => getDownloadManager().getSettings(),

  download_set_settings: (args) => {
    const settings = normalizeDownloadSettings(args.settings);
    return getDownloadManager().setSettings(settings);
  },

  // ── History ─────────────────────────────────────────────────────────
  download_history_get: () => getDownloadManager().history(),

  download_history_clear: () => getDownloadManager().clearHistory(),

  // ── Download search (custom sources + every enabled plugin) ─────────
  //
  // Ported from `src-tauri/src/plugins/mod.rs` (`search_downloads` and
  // `search_downloads_stream`). The renderer calls the streaming variant from
  // the download modal and the plain one from the update checker; both merge
  // the cached custom-source index with every enabled plugin.
  search_downloads: (args) => searchDownloadSources(parseDownloadSearchRequest(args)),

  search_downloads_stream: (args) => {
    // The renderer subscribes to `search-downloads-progress` with a searchId
    // it generates; frames are emitted per source and the run always ends with
    // an `isDone` frame, so the modal never spins. Passing `cancel: true` with
    // the same searchId aborts a running search instead of starting a new one.
    return streamDownloadSearch(parseDownloadSearchRequest(args));
  },

  close_download_resolver: (args) => {
    const sessionId = text(args, "sessionId");
    if (!sessionId) return null;
    const label = `download-resolver:${sessionId}`;
    for (const window of BrowserWindow.getAllWindows()) {
      if (getWindowLabel(window) === label && !window.isDestroyed()) window.close();
    }
    return null;
  },
};

/** `uris` arrives as `string[]` from the renderer; tolerant of `null`. */
function indexOrStringList(args: Record<string, unknown>, key: string): string[] | null {
  const value = args[key];
  if (!Array.isArray(value)) return null;
  const out = value.filter((entry): entry is string => typeof entry === "string");
  return out.length > 0 ? out : null;
}

export function registerDownloadCommands(): void {
  registerCommands(downloadCommands, { override: true });
}
