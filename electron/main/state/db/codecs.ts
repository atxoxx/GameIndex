/**
 * Real-table codecs for the feature domains that map onto the retired Rust
 * schema (`src-tauri/src/db/schema_*.sql`, see `STORAGE.md`).
 *
 * Each codec replaces one document wholesale inside a transaction and rebuilds
 * the exact shape the feature module already reads (`GameAchievementData`,
 * `NewsSnapshot`, `ClipRow`, `ModRow`, …). Optional fields that the old JSON
 * store simply omitted are omitted again on load, because a `null` would show
 * up differently in the renderer.
 *
 * Domains with no clean table mapping keep the generic `documents` row and do
 * not appear here (see the mapping table in `STORAGE.md`).
 */
import type { SqliteDocumentCodec } from "../sqliteStore";
import {
  readDocumentJson,
  writeDocumentJson,
} from "./documents";
import { openDb, prepare, withTransaction } from "./sqlite";
import type { DbDomain } from "./schema";

type Row = Record<string, unknown>;

function all(domain: DbDomain, sql: string, ...params: unknown[]): Row[] {
  return prepare(domain, sql).all(...params) as Row[];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optionalNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function flag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function jsonValue<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Read a small side document (updatedAt markers) from the fallback table. */
function meta<T>(domain: DbDomain, name: string): T | null {
  return readDocumentJson<T>(domain, name);
}

/** `1`/`0` for a nullable boolean, `null` staying `null`. */
function nullableFlag(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return value === true ? 1 : 0;
}

// ── achievements.db ─────────────────────────────────────────────────────────

/** `achievements_cache` — one `GameAchievementData` payload per game id. */
export const achievementsCacheCodec: SqliteDocumentCodec = {
  load() {
    const games: Record<string, unknown> = {};
    for (const row of all("achievements", "SELECT game_id, payload_json FROM achievements_cache")) {
      const gameId = text(row.game_id);
      if (!gameId) continue;
      const payload = jsonValue<unknown>(row.payload_json, null);
      if (payload && typeof payload === "object") games[gameId] = payload;
    }
    return { version: 1, games };
  },
  save(_name, value) {
    const games = (value as { games?: Record<string, unknown> }).games ?? {};
    const db = openDb("achievements");
    withTransaction(db, () => {
      prepare("achievements", "DELETE FROM achievements_cache").run();
      const insert = prepare(
        "achievements",
        `INSERT INTO achievements_cache(game_id, steam_app_id, payload_json, last_synced, source, provider_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const [gameId, raw] of Object.entries(games)) {
        const data = (raw ?? {}) as Row;
        insert.run(
          gameId,
          Math.trunc(num(data.steamAppId)),
          JSON.stringify(raw),
          typeof data.lastSynced === "number" ? Math.trunc(data.lastSynced) : null,
          text(data.source, "steam"),
          optionalText(data.providerId) ?? null,
        );
      }
    });
  },
};

/** `achievement_links` — per (game, source) identity + manual unlocks. */
export const achievementLinksCodec: SqliteDocumentCodec = {
  load() {
    const links: Record<string, Record<string, unknown>> = {};
    for (const row of all("achievements", "SELECT * FROM achievement_links")) {
      const gameId = text(row.game_id);
      const source = text(row.source);
      if (!gameId || !source) continue;
      const link: Row = {
        gameId,
        source,
        providerId: optionalText(row.provider_id) ?? null,
        displayName: optionalText(row.display_name) ?? null,
        sourceUrl: optionalText(row.source_url) ?? null,
        manualUnlocks: jsonValue<Record<string, number> | null>(
          row.manual_unlocks_json,
          null,
        ),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
      };
      (links[gameId] ??= {})[source] = link;
    }
    return { version: 1, links };
  },
  save(_name, value) {
    const links =
      (value as { links?: Record<string, Record<string, unknown>> }).links ?? {};
    const db = openDb("achievements");
    withTransaction(db, () => {
      prepare("achievements", "DELETE FROM achievement_links").run();
      const insert = prepare(
        "achievements",
        `INSERT INTO achievement_links(game_id, source, provider_id, display_name, source_url, manual_unlocks_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [gameId, bySource] of Object.entries(links)) {
        for (const [source, raw] of Object.entries(bySource ?? {})) {
          const link = (raw ?? {}) as Row;
          insert.run(
            gameId,
            source,
            optionalText(link.providerId) ?? null,
            optionalText(link.displayName) ?? null,
            optionalText(link.sourceUrl) ?? null,
            link.manualUnlocks ? JSON.stringify(link.manualUnlocks) : null,
            Math.trunc(num(link.createdAt)),
            Math.trunc(num(link.updatedAt)),
          );
        }
      }
    });
  },
};

// ── news.db ─────────────────────────────────────────────────────────────────

/** `news_feeds` / `news_articles` / `news_read` / `news_saved` / `news_history` / `news_prefs`. */
export const newsCodec: SqliteDocumentCodec = {
  load() {
    const feeds = all(
      "news",
      "SELECT * FROM news_feeds ORDER BY position, rowid",
    ).map((row) => ({
      url: text(row.url),
      name: text(row.name),
      category: text(row.category, "general"),
      region: optionalText(row.region) ?? null,
      isDefault: flag(row.is_default),
      enabled: flag(row.enabled, true),
    }));

    const articles = all(
      "news",
      "SELECT * FROM news_articles ORDER BY rowid",
    ).map((row) => {
      const article: Row = {
        link: text(row.link),
        title: text(row.title),
        description: text(row.description),
        content: text(row.content),
        pubDate: text(row.pub_date),
        sourceName: text(row.source_name),
        sourceUrl: text(row.source_url),
        imageUrl: optionalText(row.image_url) ?? null,
        firstSeen: num(row.first_seen),
        fetchedAt: num(row.fetched_at),
      };
      return article;
    });

    const read = all("news", "SELECT link FROM news_read ORDER BY rowid").map((row) =>
      text(row.link),
    );

    const saved = all("news", "SELECT * FROM news_saved ORDER BY rowid").map((row) => ({
      link: text(row.link),
      title: text(row.title),
      description: text(row.description),
      sourceName: text(row.source_name),
      sourceUrl: text(row.source_url),
      pubDate: text(row.pub_date),
      imageUrl: optionalText(row.image_url) ?? null,
      savedAt: num(row.saved_at),
    }));

    const history = all("news", "SELECT * FROM news_history ORDER BY rowid").map((row) => ({
      link: text(row.link),
      title: text(row.title),
      description: text(row.description),
      sourceName: text(row.source_name),
      sourceUrl: text(row.source_url),
      pubDate: text(row.pub_date),
      imageUrl: optionalText(row.image_url) ?? null,
      readAt: num(row.read_at),
    }));

    const prefs: Record<string, string> = {};
    for (const row of all("news", "SELECT key, value FROM news_prefs")) {
      prefs[text(row.key)] = text(row.value);
    }

    const marker = meta<{ updatedAt?: string }>("news", "news-meta");
    return {
      version: 1,
      updatedAt: marker?.updatedAt ?? new Date().toISOString(),
      feeds,
      articles,
      read,
      saved,
      history,
      prefs,
    };
  },
  save(_name, value) {
    const doc = value as Row & {
      feeds?: Row[];
      articles?: Row[];
      read?: unknown[];
      saved?: Row[];
      history?: Row[];
      prefs?: Record<string, string>;
    };
    const db = openDb("news");
    withTransaction(db, () => {
      for (const table of [
        "news_feeds",
        "news_articles",
        "news_read",
        "news_saved",
        "news_history",
        "news_prefs",
      ]) {
        prepare("news", `DELETE FROM ${table}`).run();
      }

      const feed = prepare(
        "news",
        `INSERT INTO news_feeds(url, name, category, region, is_default, enabled, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      (doc.feeds ?? []).forEach((row, index) => {
        feed.run(
          text(row.url),
          text(row.name),
          text(row.category, "general"),
          optionalText(row.region) ?? null,
          flag(row.isDefault) ? 1 : 0,
          flag(row.enabled, true) ? 1 : 0,
          index,
        );
      });

      const article = prepare(
        "news",
        `INSERT INTO news_articles(link, title, description, content, pub_date, source_name, source_url, image_url, first_seen, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.articles ?? []) {
        article.run(
          text(row.link),
          text(row.title),
          text(row.description),
          text(row.content),
          text(row.pubDate),
          text(row.sourceName),
          text(row.sourceUrl),
          optionalText(row.imageUrl) ?? null,
          Math.trunc(num(row.firstSeen)),
          Math.trunc(num(row.fetchedAt ?? row.firstSeen)),
        );
      }

      const readInsert = prepare(
        "news",
        "INSERT OR IGNORE INTO news_read(link, read_at) VALUES (?, ?)",
      );
      const now = Math.floor(Date.now() / 1000);
      for (const link of doc.read ?? []) {
        if (typeof link === "string") readInsert.run(link, now);
      }

      const savedInsert = prepare(
        "news",
        `INSERT INTO news_saved(link, saved_at, title, source_name, pub_date, image_url, description, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.saved ?? []) {
        savedInsert.run(
          text(row.link),
          Math.trunc(num(row.savedAt)),
          text(row.title),
          text(row.sourceName),
          text(row.pubDate),
          optionalText(row.imageUrl) ?? null,
          text(row.description),
          text(row.sourceUrl),
        );
      }

      const historyInsert = prepare(
        "news",
        `INSERT INTO news_history(link, read_at, title, source_name, pub_date, image_url, description, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.history ?? []) {
        historyInsert.run(
          text(row.link),
          Math.trunc(num(row.readAt)),
          text(row.title),
          text(row.sourceName),
          text(row.pubDate),
          optionalText(row.imageUrl) ?? null,
          text(row.description),
          text(row.sourceUrl),
        );
      }

      const prefInsert = prepare(
        "news",
        "INSERT INTO news_prefs(key, value) VALUES (?, ?)",
      );
      for (const [key, entry] of Object.entries(doc.prefs ?? {})) {
        prefInsert.run(key, String(entry));
      }
    });
    writeDocumentJson("news", "news-meta", { updatedAt: doc.updatedAt });
  },
};

// ── plugins.db ──────────────────────────────────────────────────────────────

/** `plugins` — installed plugin rows; the full manifest stays JSON. */
export const pluginsCodec: SqliteDocumentCodec = {
  load() {
    const plugins = all(
      "plugins",
      "SELECT * FROM plugins ORDER BY imported_at, rowid",
    ).map((row) => {
      const manifest = jsonValue<unknown>(row.manifest_json, null);
      return {
        id: text(row.id),
        name: text(row.name),
        version: text(row.version),
        author: text(row.author),
        description: text(row.description),
        sourceUrl: text(row.source_url),
        platformCategory: text(row.platform_category),
        fileHash: text(row.file_hash),
        enabled: flag(row.enabled),
        importedAt: num(row.imported_at),
        lastError: optionalText(row.last_error) ?? null,
        manifest,
      };
    });
    const marker = meta<{ updatedAt?: string }>("plugins", "plugins-meta");
    return { version: 1, plugins, updatedAt: marker?.updatedAt };
  },
  save(_name, value) {
    const doc = value as { plugins?: Row[]; updatedAt?: string };
    const db = openDb("plugins");
    withTransaction(db, () => {
      prepare("plugins", "DELETE FROM plugins").run();
      const insert = prepare(
        "plugins",
        `INSERT INTO plugins(id, name, version, author, description, source_url, file_hash, file_path,
           enabled, imported_at, last_error, platform_category, manifest_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.plugins ?? []) {
        insert.run(
          text(row.id),
          text(row.name),
          text(row.version),
          text(row.author),
          text(row.description),
          text(row.sourceUrl),
          text(row.fileHash),
          "",
          flag(row.enabled) ? 1 : 0,
          Math.trunc(num(row.importedAt)),
          optionalText(row.lastError) ?? null,
          text(row.platformCategory),
          row.manifest ? JSON.stringify(row.manifest) : "",
        );
      }
    });
    writeDocumentJson("plugins", "plugins-meta", { updatedAt: doc.updatedAt });
  },
};

/** Per-plugin secret config values (`safeStorage` ciphertext, verbatim). */
export function readPluginConfigValues(pluginId: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of all(
    "plugins",
    "SELECT key, value FROM plugin_config WHERE plugin_id = ?",
    pluginId,
  )) {
    const key = text(row.key);
    if (key) values[key] = text(row.value);
  }
  return values;
}

/** Replace one plugin's config values atomically. */
export function writePluginConfigValues(
  pluginId: string,
  values: Record<string, string>,
): void {
  const db = openDb("plugins");
  withTransaction(db, () => {
    prepare("plugins", "DELETE FROM plugin_config WHERE plugin_id = ?").run(pluginId);
    const insert = prepare(
      "plugins",
      "INSERT INTO plugin_config(plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
    );
    const now = Date.now();
    for (const [key, entry] of Object.entries(values)) {
      insert.run(pluginId, key, entry, now);
    }
  });
}

/**
 * Merge values into a plugin's config without dropping keys already stored
 * (used by the one-time `plugins/<id>/config.json` migration).
 */
export function mergePluginConfigValues(
  pluginId: string,
  values: Record<string, string>,
): number {
  const insert = prepare(
    "plugins",
    "INSERT OR IGNORE INTO plugin_config(plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
  );
  const now = Date.now();
  let written = 0;
  for (const [key, entry] of Object.entries(values)) {
    written += insert.run(pluginId, key, entry, now).changes;
  }
  return written;
}

// ── clips.db ────────────────────────────────────────────────────────────────

/** `clips` + `reels` + ordered `reel_items`. */
export const clipsCodec: SqliteDocumentCodec = {
  load() {
    const clips = all("clips", "SELECT * FROM clips ORDER BY created_at DESC, rowid").map(
      (row) => {
        const clip: Row = {
          id: text(row.id),
          path: text(row.path),
          title: text(row.title),
          favorite: flag(row.favorite),
          createdAt: num(row.created_at),
          addedAt: num(row.added_at),
        };
        const gameId = optionalText(row.game_id);
        const gameName = optionalText(row.game_name);
        const kind = optionalText(row.kind);
        const durationMs = optionalNum(row.duration_ms);
        const sizeBytes = optionalNum(row.size_bytes);
        if (gameId) clip.gameId = gameId;
        if (gameName) clip.gameName = gameName;
        if (kind) clip.kind = kind;
        if (durationMs !== undefined) clip.durationMs = durationMs;
        if (sizeBytes !== undefined) clip.sizeBytes = sizeBytes;
        return clip;
      },
    );

    const items = all(
      "clips",
      "SELECT reel_id, clip_id FROM reel_items ORDER BY reel_id, position",
    );
    const byReel = new Map<string, string[]>();
    for (const row of items) {
      const reelId = text(row.reel_id);
      const list = byReel.get(reelId) ?? [];
      list.push(text(row.clip_id));
      byReel.set(reelId, list);
    }

    const reels = all(
      "clips",
      "SELECT * FROM reels ORDER BY updated_at DESC, rowid",
    ).map((row) => {
      const id = text(row.id);
      const reel: Row = {
        id,
        name: text(row.name),
        createdAt: num(row.created_at),
        updatedAt: num(row.updated_at),
        clipIds: byReel.get(id) ?? [],
      };
      const description = optionalText(row.description);
      if (description) reel.description = description;
      return reel;
    });

    return { version: 1, clips, reels };
  },
  save(_name, value) {
    const doc = value as { clips?: Row[]; reels?: Row[] };
    const db = openDb("clips");
    withTransaction(db, () => {
      prepare("clips", "DELETE FROM reel_items").run();
      prepare("clips", "DELETE FROM reels").run();
      prepare("clips", "DELETE FROM clips").run();

      const clipInsert = prepare(
        "clips",
        `INSERT INTO clips(id, path, game_id, game_name, title, kind, duration_ms, size_bytes, favorite, created_at, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.clips ?? []) {
        clipInsert.run(
          text(row.id),
          text(row.path),
          optionalText(row.gameId) ?? null,
          optionalText(row.gameName) ?? null,
          text(row.title),
          optionalText(row.kind) ?? null,
          optionalNum(row.durationMs) ?? null,
          optionalNum(row.sizeBytes) ?? null,
          flag(row.favorite) ? 1 : 0,
          Math.trunc(num(row.createdAt)),
          Math.trunc(num(row.addedAt)),
        );
      }

      const reelInsert = prepare(
        "clips",
        `INSERT INTO reels(id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const itemInsert = prepare(
        "clips",
        "INSERT INTO reel_items(reel_id, clip_id, position) VALUES (?, ?, ?)",
      );
      for (const row of doc.reels ?? []) {
        const reelId = text(row.id);
        reelInsert.run(
          reelId,
          text(row.name),
          optionalText(row.description) ?? null,
          Math.trunc(num(row.createdAt)),
          Math.trunc(num(row.updatedAt)),
        );
        const clipIds = Array.isArray(row.clipIds) ? row.clipIds : [];
        clipIds.forEach((clipId, position) => {
          if (typeof clipId === "string") itemInsert.run(reelId, clipId, position);
        });
      }
    });
  },
};

// ── mods.db ─────────────────────────────────────────────────────────────────

/** `mods` + `game_mod_settings` + `mod_profiles` + source links + remote installs. */
export const modsCodec: SqliteDocumentCodec = {
  load() {
    const mods = all("mods", "SELECT * FROM mods ORDER BY rowid").map((row) => {
      const mod: Row = {
        id: text(row.id),
        gameId: text(row.game_id),
        name: text(row.name),
        engine: text(row.engine),
        kind: text(row.kind),
        path: text(row.path),
        enabled: flag(row.enabled, true),
        loadOrder: num(row.load_order),
        updateAvailable: flag(row.update_available),
        detectedAt: num(row.detected_at),
        updatedAt: num(row.updated_at),
      };
      const optional: Array<[string, unknown]> = [
        ["version", row.version],
        ["author", row.author],
        ["sizeBytes", row.size_bytes],
        ["fileCount", row.file_count],
        ["md5", row.md5],
        ["nexusModId", row.nexus_mod_id],
        ["nexusDomain", row.nexus_domain],
        ["latestVersion", row.latest_version],
        ["notes", row.notes],
        ["source", row.source],
        ["sourceModId", row.source_mod_id],
        ["sourceFileId", row.source_file_id],
        ["remoteUrl", row.remote_url],
      ];
      for (const [key, raw] of optional) {
        if (typeof raw === "string" && raw.length > 0) mod[key] = raw;
        else if (typeof raw === "number" && Number.isFinite(raw)) mod[key] = raw;
      }
      return mod;
    });

    const settings: Record<string, Row> = {};
    for (const row of all("mods", "SELECT * FROM game_mod_settings")) {
      const gameId = text(row.game_id);
      if (!gameId) continue;
      const entry: Row = { gameId, updatedAt: num(row.updated_at) };
      for (const [key, column] of [
        ["modsRoot", "mods_root"],
        ["customRoot", "custom_root"],
        ["engine", "engine"],
        ["pluginsTxt", "plugins_txt"],
        ["nexusDomain", "nexus_domain"],
      ] as const) {
        const value = optionalText(row[column]);
        if (value) entry[key] = value;
      }
      settings[gameId] = entry;
    }

    const profiles = all("mods", "SELECT * FROM mod_profiles ORDER BY rowid").map(
      (row) => {
        const profile: Row = {
          id: text(row.id),
          gameId: text(row.game_id),
          name: text(row.name),
          modStates: jsonValue<Record<string, boolean>>(row.mod_states, {}),
          loadOrder: jsonValue<string[]>(row.load_order, []),
          createdAt: num(row.created_at),
          updatedAt: num(row.updated_at),
        };
        return profile;
      },
    );

    const sourceLinks = all(
      "mods",
      "SELECT * FROM mod_source_links ORDER BY rowid",
    ).map((row) => {
      const link: Row = {
        gameId: text(row.game_id),
        source: text(row.source),
        externalId: text(row.external_id),
        updatedAt: num(row.updated_at),
      };
      const displayName = optionalText(row.display_name);
      if (displayName) link.displayName = displayName;
      return link;
    });

    const remoteInstalls = all(
      "mods",
      "SELECT * FROM mod_remote_installs ORDER BY rowid",
    ).map((row) => {
      const entry: Row = {
        id: text(row.id),
        gameId: text(row.game_id),
        source: text(row.source),
        sourceModId: text(row.source_mod_id),
        name: text(row.name),
        installedAt: num(row.installed_at),
      };
      for (const [key, column] of [
        ["sourceFileId", "source_file_id"],
        ["author", "author"],
        ["version", "version"],
        ["remoteUrl", "remote_url"],
        ["installedPath", "installed_path"],
      ] as const) {
        const value = optionalText(row[column]);
        if (value) entry[key] = value;
      }
      return entry;
    });

    const marker = meta<{ updatedAt?: number }>("mods", "mods-meta");
    return {
      version: 1,
      mods,
      settings,
      profiles,
      sourceLinks,
      remoteInstalls,
      updatedAt: marker?.updatedAt ?? Math.floor(Date.now() / 1000),
    };
  },
  save(_name, value) {
    const doc = value as {
      mods?: Row[];
      settings?: Record<string, Row>;
      profiles?: Row[];
      sourceLinks?: Row[];
      remoteInstalls?: Row[];
      updatedAt?: number;
    };
    const db = openDb("mods");
    withTransaction(db, () => {
      for (const table of [
        "mods",
        "game_mod_settings",
        "mod_profiles",
        "mod_source_links",
        "mod_remote_installs",
      ]) {
        prepare("mods", `DELETE FROM ${table}`).run();
      }

      const modInsert = prepare(
        "mods",
        `INSERT INTO mods(id, game_id, name, version, author, engine, kind, path, enabled, load_order,
           size_bytes, file_count, md5, nexus_mod_id, nexus_domain, latest_version, update_available,
           notes, detected_at, updated_at, source, source_mod_id, source_file_id, remote_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.mods ?? []) {
        modInsert.run(
          text(row.id),
          text(row.gameId),
          text(row.name),
          optionalText(row.version) ?? null,
          optionalText(row.author) ?? null,
          text(row.engine),
          text(row.kind),
          text(row.path),
          flag(row.enabled, true) ? 1 : 0,
          Math.trunc(num(row.loadOrder)),
          optionalNum(row.sizeBytes) ?? null,
          optionalNum(row.fileCount) ?? null,
          optionalText(row.md5) ?? null,
          optionalNum(row.nexusModId) ?? null,
          optionalText(row.nexusDomain) ?? null,
          optionalText(row.latestVersion) ?? null,
          flag(row.updateAvailable) ? 1 : 0,
          optionalText(row.notes) ?? null,
          Math.trunc(num(row.detectedAt)),
          Math.trunc(num(row.updatedAt)),
          optionalText(row.source) ?? null,
          optionalText(row.sourceModId) ?? null,
          optionalText(row.sourceFileId) ?? null,
          optionalText(row.remoteUrl) ?? null,
        );
      }

      const settingsInsert = prepare(
        "mods",
        `INSERT INTO game_mod_settings(game_id, mods_root, custom_root, engine, plugins_txt, nexus_domain, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [gameId, row] of Object.entries(doc.settings ?? {})) {
        settingsInsert.run(
          gameId,
          optionalText(row.modsRoot) ?? null,
          optionalText(row.customRoot) ?? null,
          optionalText(row.engine) ?? null,
          optionalText(row.pluginsTxt) ?? null,
          optionalText(row.nexusDomain) ?? null,
          Math.trunc(num(row.updatedAt)),
        );
      }

      const profileInsert = prepare(
        "mods",
        `INSERT INTO mod_profiles(id, game_id, name, mod_states, load_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.profiles ?? []) {
        profileInsert.run(
          text(row.id),
          text(row.gameId),
          text(row.name),
          JSON.stringify(row.modStates ?? {}),
          JSON.stringify(Array.isArray(row.loadOrder) ? row.loadOrder : []),
          Math.trunc(num(row.createdAt)),
          Math.trunc(num(row.updatedAt)),
        );
      }

      const linkInsert = prepare(
        "mods",
        `INSERT INTO mod_source_links(game_id, source, external_id, display_name, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of doc.sourceLinks ?? []) {
        linkInsert.run(
          text(row.gameId),
          text(row.source),
          text(row.externalId),
          optionalText(row.displayName) ?? null,
          Math.trunc(num(row.updatedAt)),
        );
      }

      const installInsert = prepare(
        "mods",
        `INSERT INTO mod_remote_installs(id, game_id, source, source_mod_id, source_file_id, name,
           author, version, remote_url, installed_path, installed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.remoteInstalls ?? []) {
        installInsert.run(
          text(row.id),
          text(row.gameId),
          text(row.source),
          text(row.sourceModId),
          optionalText(row.sourceFileId) ?? null,
          text(row.name),
          optionalText(row.author) ?? null,
          optionalText(row.version) ?? null,
          optionalText(row.remoteUrl) ?? null,
          optionalText(row.installedPath) ?? null,
          Math.trunc(num(row.installedAt)),
        );
      }
    });
    writeDocumentJson("mods", "mods-meta", { updatedAt: doc.updatedAt });
  },
};

// ── emulators.db ────────────────────────────────────────────────────────────

/**
 * Columns mirrored from `EmulatorRow`. Everything else (the registry tolerates
 * unknown fields) round-trips through `extra_json`, including `autoScan`, whose
 * "present but false" state a 0/1 column cannot express.
 */
const EMULATOR_COLUMNS = [
  "id",
  "name",
  "platform",
  "executablePath",
  "argumentsTemplate",
  "romFolder",
  "notes",
  "iconUrl",
  "createdAt",
  "updatedAt",
  "biosFolder",
  "savesFolder",
] as const;

export const emulatorsCodec: SqliteDocumentCodec = {
  load() {
    const emulators = all("emulators", "SELECT * FROM emulators ORDER BY rowid").map((row) => {
      const extras = jsonValue<Row>(row.extra_json, {});
      const emulator: Row = { ...extras };
      delete emulator.extra_json;
      emulator.id = text(row.id);
      emulator.name = text(row.name);
      emulator.platform = text(row.platform, "Unknown");
      emulator.executablePath = text(row.executable_path);
      emulator.argumentsTemplate = text(row.arguments_template, "%ROM%");
      emulator.romFolder = text(row.rom_folder);
      emulator.createdAt = num(row.created_at);
      emulator.updatedAt = num(row.updated_at);
      for (const [key, column] of [
        ["notes", "notes"],
        ["iconUrl", "icon_url"],
        ["biosFolder", "bios_folder"],
        ["savesFolder", "saves_folder"],
      ] as const) {
        const value = optionalText(row[column]);
        if (value) emulator[key] = value;
        else delete emulator[key];
      }
      return emulator;
    });
    return { version: 1, emulators };
  },
  save(_name, value) {
    const doc = value as { emulators?: Row[] };
    const db = openDb("emulators");
    withTransaction(db, () => {
      prepare("emulators", "DELETE FROM emulators").run();
      const insert = prepare(
        "emulators",
        `INSERT INTO emulators(id, name, platform, executable_path, arguments_template, rom_folder,
           notes, icon_url, created_at, updated_at, bios_folder, saves_folder, auto_scan, extra_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.emulators ?? []) {
        const extras: Row = {};
        for (const [key, entry] of Object.entries(row)) {
          if (key === "extra_json") continue;
          if (!(EMULATOR_COLUMNS as readonly string[]).includes(key)) extras[key] = entry;
        }
        insert.run(
          text(row.id),
          text(row.name),
          text(row.platform, "Unknown"),
          text(row.executablePath),
          text(row.argumentsTemplate, "%ROM%"),
          text(row.romFolder),
          optionalText(row.notes) ?? null,
          optionalText(row.iconUrl) ?? null,
          Math.trunc(num(row.createdAt)),
          Math.trunc(num(row.updatedAt)),
          text(row.biosFolder),
          text(row.savesFolder),
          flag(row.autoScan) ? 1 : 0,
          Object.keys(extras).length > 0 ? JSON.stringify(extras) : null,
        );
      }
    });
  },
};

// ── sources.db ──────────────────────────────────────────────────────────────

/** `sources` + `sources_cache` (catalogue kept as one payload per source). */
export const sourcesCodec: SqliteDocumentCodec = {
  load() {
    const sources = all("sources", "SELECT * FROM sources ORDER BY rowid").map((row) => ({
      id: text(row.id),
      url: text(row.url),
      name: text(row.name),
      enabled: flag(row.enabled, true),
      lastFetched: optionalNum(row.last_fetched) ?? null,
      gameCount: num(row.game_count),
    }));

    const cache: Record<string, { fetchedAt: number; data: unknown }> = {};
    for (const row of all("sources", "SELECT * FROM sources_cache")) {
      const sourceId = text(row.source_id);
      if (!sourceId) continue;
      const data = jsonValue<unknown>(row.payload_json, null);
      if (!data) continue;
      cache[sourceId] = { fetchedAt: num(row.fetched_at), data };
    }

    return { version: 1, sources, cache };
  },
  save(_name, value) {
    const doc = value as {
      sources?: Row[];
      cache?: Record<string, { fetchedAt?: number; data?: unknown }>;
    };
    const db = openDb("sources");
    withTransaction(db, () => {
      const keep = new Set<string>();
      const sourceInsert = prepare(
        "sources",
        `INSERT INTO sources(id, url, name, enabled, last_fetched, game_count, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           url = excluded.url,
           name = excluded.name,
           enabled = excluded.enabled,
           last_fetched = excluded.last_fetched,
           game_count = excluded.game_count`,
      );
      for (const row of doc.sources ?? []) {
        const id = text(row.id);
        if (!id) continue;
        keep.add(id);
        sourceInsert.run(
          id,
          text(row.url),
          text(row.name),
          flag(row.enabled, true) ? 1 : 0,
          optionalNum(row.lastFetched) ?? null,
          num(row.gameCount),
          Math.floor(Date.now() / 1000),
        );
      }
      for (const row of all("sources", "SELECT id FROM sources")) {
        const id = text(row.id);
        if (!keep.has(id)) prepare("sources", "DELETE FROM sources WHERE id = ?").run(id);
      }

      const cacheKeep = new Set<string>();
      const cacheInsert = prepare(
        "sources",
        `INSERT INTO sources_cache(source_id, fetched_at, payload_json) VALUES (?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           payload_json = excluded.payload_json`,
      );
      for (const [sourceId, entry] of Object.entries(doc.cache ?? {})) {
        if (!entry || entry.data === undefined) continue;
        cacheKeep.add(sourceId);
        cacheInsert.run(
          sourceId,
          Math.trunc(num(entry.fetchedAt)),
          JSON.stringify(entry.data),
        );
      }
      for (const row of all("sources", "SELECT source_id FROM sources_cache")) {
        const id = text(row.source_id);
        if (!cacheKeep.has(id)) {
          prepare("sources", "DELETE FROM sources_cache WHERE source_id = ?").run(id);
        }
      }
    });
  },
};

// ── store_cache.db ──────────────────────────────────────────────────────────

/** `store_cache(category, page=0)` + `store_detail(slug)`. */
export const storeCacheCodec: SqliteDocumentCodec = {
  load() {
    const categories: Record<string, { data: unknown; fetchedAt: number }> = {};
    for (const row of all("store_cache", "SELECT * FROM store_cache WHERE page = 0")) {
      const key = text(row.category);
      if (!key) continue;
      const data = jsonValue<unknown[]>(row.payload_json, []);
      categories[key] = { data, fetchedAt: num(row.fetched_at) };
    }
    const detailCache: Record<string, { data: unknown; fetchedAt: number }> = {};
    for (const row of all("store_cache", "SELECT * FROM store_detail")) {
      const slug = text(row.slug);
      if (!slug) continue;
      const data = jsonValue<unknown>(row.payload_json, null);
      if (!data) continue;
      detailCache[slug] = { data, fetchedAt: num(row.fetched_at) };
    }
    return { categories, detailCache };
  },
  save(_name, value) {
    const doc = value as {
      categories?: Record<string, { data?: unknown; fetchedAt?: number }>;
      detailCache?: Record<string, { data?: unknown; fetchedAt?: number }>;
    };
    const db = openDb("store_cache");
    withTransaction(db, () => {
      prepare("store_cache", "DELETE FROM store_cache").run();
      prepare("store_cache", "DELETE FROM store_detail").run();

      const categoryInsert = prepare(
        "store_cache",
        `INSERT INTO store_cache(category, page, payload_json, fetched_at) VALUES (?, 0, ?, ?)`,
      );
      for (const [key, entry] of Object.entries(doc.categories ?? {})) {
        if (!entry || entry.data === undefined) continue;
        categoryInsert.run(key, JSON.stringify(entry.data), Math.trunc(num(entry.fetchedAt)));
      }

      const detailInsert = prepare(
        "store_cache",
        "INSERT INTO store_detail(slug, payload_json, fetched_at) VALUES (?, ?, ?)",
      );
      for (const [slug, entry] of Object.entries(doc.detailCache ?? {})) {
        if (!entry || entry.data === undefined) continue;
        detailInsert.run(slug, JSON.stringify(entry.data), Math.trunc(num(entry.fetchedAt)));
      }
    });
  },
};

// ── compatibility.db ────────────────────────────────────────────────────────

/**
 * `compatibility_settings` holds one row for the settings blob and one for the
 * custom-prefix list, so both survive a per-field crash independently.
 */
export const compatibilityCodec: SqliteDocumentCodec = {
  load() {
    let settings: unknown = {};
    let customPrefixes: string[] = [];
    let updatedAt = 0;
    for (const row of all("compatibility", "SELECT * FROM compatibility_settings")) {
      const id = text(row.id);
      updatedAt = Math.max(updatedAt, num(row.updated_at));
      if (id === "settings") settings = jsonValue<unknown>(row.settings_json, {});
      else if (id === "custom_prefixes") {
        customPrefixes = jsonValue<string[]>(row.settings_json, []);
      }
    }
    return { settings, customPrefixes, updatedAt };
  },
  save(_name, value) {
    const doc = value as {
      settings?: unknown;
      customPrefixes?: string[];
      updatedAt?: number;
    };
    const db = openDb("compatibility");
    withTransaction(db, () => {
      prepare("compatibility", "DELETE FROM compatibility_settings").run();
      const insert = prepare(
        "compatibility",
        "INSERT INTO compatibility_settings(id, settings_json, updated_at) VALUES (?, ?, ?)",
      );
      const at = Math.trunc(num(doc.updatedAt, Math.floor(Date.now() / 1000)));
      insert.run("settings", JSON.stringify(doc.settings ?? {}), at);
      insert.run(
        "custom_prefixes",
        JSON.stringify(Array.isArray(doc.customPrefixes) ? doc.customPrefixes : []),
        at,
      );
    });
  },
};

// ── downloads.db ────────────────────────────────────────────────────────────

/** `download_history` — append-only ledger behind `downloads-history.json`. */
export const downloadHistoryCodec: SqliteDocumentCodec = {
  load() {
    const rows = all("downloads", "SELECT * FROM download_history ORDER BY id").map(
      (row) => {
        const entry: Row = {
          id: num(row.id),
          downloadId: text(row.download_id),
          kind: text(row.kind),
          name: text(row.name),
          sourceName: text(row.source_name),
          savePath: text(row.save_path),
          downloaded: num(row.downloaded),
          totalSize: optionalNum(row.total_size) ?? null,
          status: text(row.status),
          debridCached: row.debrid_cached === null ? null : flag(row.debrid_cached),
          autoExtract: row.auto_extract === null ? null : flag(row.auto_extract),
          extracted: row.extracted === null ? null : flag(row.extracted),
          addedAt: num(row.added_at),
          completedAt: optionalNum(row.completed_at) ?? null,
          peakSpeed: num(row.peak_speed),
        };
        return entry;
      },
    );
    let nextId = 1;
    for (const row of rows) nextId = Math.max(nextId, num(row.id) + 1);
    return { version: 1, nextId, rows };
  },
  save(_name, value) {
    const doc = value as { rows?: Row[] };
    const db = openDb("downloads");
    withTransaction(db, () => {
      prepare("downloads", "DELETE FROM download_history").run();
      const insert = prepare(
        "downloads",
        `INSERT INTO download_history(id, download_id, kind, name, source_name, save_path,
           downloaded, total_size, status, debrid_cached, auto_extract, extracted, added_at,
           completed_at, peak_speed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of doc.rows ?? []) {
        insert.run(
          Math.trunc(num(row.id)),
          text(row.downloadId),
          text(row.kind),
          text(row.name),
          text(row.sourceName),
          text(row.savePath),
          Math.trunc(num(row.downloaded)),
          optionalNum(row.totalSize) ?? null,
          text(row.status),
          nullableFlag(row.debridCached),
          nullableFlag(row.autoExtract),
          nullableFlag(row.extracted),
          Math.trunc(num(row.addedAt)),
          optionalNum(row.completedAt) ?? null,
          Math.trunc(num(row.peakSpeed)),
        );
      }
    });
  },
};
