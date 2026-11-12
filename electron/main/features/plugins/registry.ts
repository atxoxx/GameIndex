/**
 * On-disk plugin storage.
 *
 * Layout under `app.getPath("userData")`:
 *
 * ```
 * <sqlite> plugins.db              ← index (`plugins` table) + secrets (`plugin_config`)
 * plugins/<id>/manifest.json       ← validated descriptor (no secrets)
 * plugins/<id>/plugin.js           ← the source that is evaluated
 * ```
 *
 * The document adapter and the config adapter are injected so this module stays
 * free of Electron and can be exercised outside the app. Directories are
 * created through a temp folder + rename, so a half-written plugin never
 * appears installed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertValidPluginId,
  declaredConfigKeys,
  normalizePlatformCategory,
  toStoredManifest,
  type PluginManifest,
} from "./manifest";
import type { PluginDocument, PluginRecord } from "./types";

export const PLUGIN_SOURCE_FILE = "plugin.js";
export const PLUGIN_MANIFEST_FILE = "manifest.json";
export const PLUGIN_CONFIG_FILE = "config.json";

const SECRET_PREFIX = "enc:v1:";

/** Minimal document store, matching `state/jsonStore.ts`. */
export interface PluginDocumentStore {
  read(): PluginDocument;
  write(value: PluginDocument): PluginDocument;
}

/** Optional OS-backed encryption (Electron `safeStorage` in production). */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(cipherText: string): string;
}

/**
 * Optional per-plugin config persistence. The Electron wiring stores the
 * values in `plugins.db` (`plugin_config`); without an adapter the registry
 * falls back to `plugins/<id>/config.json` for harnesses and tests.
 */
export interface PluginConfigStore {
  read(pluginId: string): Record<string, string>;
  write(pluginId: string, values: Record<string, string>): void;
}

export interface PluginRegistryOptions {
  /** `userData/plugins`. */
  baseDir: string;
  document: PluginDocumentStore;
  cipher?: SecretCipher | null;
  configStore?: PluginConfigStore;
  now?: () => number;
  logger?: (...args: unknown[]) => void;
}

interface StoredConfig {
  version: 1;
  values: Record<string, string>;
}

export function sha256Hex(source: string | Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Defensive read for `plugins.json`: a manually edited or partially migrated
 * document degrades to the rows that still look like records instead of
 * crashing Settings → Plugins.
 */
export function normalizePluginDocument(value: PluginDocument): PluginDocument {
  const plugins: PluginRecord[] = [];
  const seen = new Set<string>();
  const rows = Array.isArray(value?.plugins) ? value.plugins : [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    let id: string;
    try {
      id = assertValidPluginId((row as PluginRecord).id);
    } catch {
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const manifest =
      row.manifest && typeof row.manifest === "object"
        ? toStoredManifest(row.manifest as PluginManifest)
        : null;
    if (manifest) manifest.id = id;
    plugins.push({
      id,
      name: typeof row.name === "string" ? row.name : id,
      version: typeof row.version === "string" ? row.version : "",
      author: typeof row.author === "string" ? row.author : "",
      description: typeof row.description === "string" ? row.description : "",
      sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : "",
      platformCategory: normalizePlatformCategory(row.platformCategory),
      fileHash: typeof row.fileHash === "string" ? row.fileHash : "",
      enabled: row.enabled !== false,
      importedAt:
        typeof row.importedAt === "number" && Number.isFinite(row.importedAt)
          ? row.importedAt
          : 0,
      lastError: typeof row.lastError === "string" ? row.lastError : null,
      manifest: manifest ?? {
        id,
        name: typeof row.name === "string" ? row.name : id,
        version: "",
        author: "",
        description: "",
        sourceUrl: "",
        platformCategory: "pc",
        allowedHosts: [],
        rateLimitMs: 0,
        capabilities: [],
        config: [],
      },
    });
  }
  return {
    version: 1,
    plugins,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

export function emptyPluginDocument(): PluginDocument {
  return { version: 1, plugins: [] };
}

export class PluginRegistry {
  private readonly baseDir: string;
  private readonly document: PluginDocumentStore;
  private readonly cipher: SecretCipher | null;
  private readonly configStore: PluginConfigStore | null;
  private readonly now: () => number;
  private readonly logger: (...args: unknown[]) => void;

  constructor(options: PluginRegistryOptions) {
    this.baseDir = options.baseDir;
    this.document = options.document;
    this.cipher = options.cipher ?? null;
    this.configStore = options.configStore ?? null;
    this.now = options.now ?? unixNow;
    this.logger = options.logger ?? ((...args) => console.warn(...args));
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /** Absolute plugin root. */
  pluginsDir(): string {
    return this.baseDir;
  }

  /**
   * Resolve `plugins/<id>` and prove the result is still inside the plugin
   * root. `assertValidPluginId` already blocks separators, but the containment
   * check keeps a future id format from becoming a traversal bug.
   */
  pluginDir(id: string): string {
    const safeId = assertValidPluginId(id);
    const dir = path.resolve(this.baseDir, safeId);
    const root = path.resolve(this.baseDir);
    if (dir !== root && !dir.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Plugin path escapes the plugins directory: ${id}`);
    }
    return dir;
  }

  sourcePath(id: string): string {
    return path.join(this.pluginDir(id), PLUGIN_SOURCE_FILE);
  }

  manifestPath(id: string): string {
    return path.join(this.pluginDir(id), PLUGIN_MANIFEST_FILE);
  }

  configPath(id: string): string {
    return path.join(this.pluginDir(id), PLUGIN_CONFIG_FILE);
  }

  list(): PluginRecord[] {
    return this.document
      .read()
      .plugins.map((row) => deepClone(row));
  }

  get(id: string): PluginRecord | null {
    const safeId = assertValidPluginId(id);
    const row = this.document.read().plugins.find((entry) => entry.id === safeId);
    return row ? deepClone(row) : null;
  }

  /** Install a record's files atomically, then append it to the index. */
  install(record: PluginRecord, source: string): PluginRecord {
    const id = assertValidPluginId(record.id);
    if (this.document.read().plugins.some((entry) => entry.id === id)) {
      throw new Error("Plugin already installed");
    }
    const dir = this.pluginDir(id);
    if (fs.existsSync(dir)) {
      throw new Error(
        `A folder already exists for plugin "${id}": ${dir}. Remove that folder, then install again.`,
      );
    }

    const temp = path.join(
      this.baseDir,
      `.install-${id}-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    );
    fs.mkdirSync(temp, { recursive: false });
    try {
      fs.writeFileSync(path.join(temp, PLUGIN_SOURCE_FILE), source, "utf8");
      fs.writeFileSync(
        path.join(temp, PLUGIN_MANIFEST_FILE),
        JSON.stringify(toStoredManifest(record.manifest), null, 2),
        "utf8",
      );
      fs.renameSync(temp, dir);
    } catch (error) {
      try {
        fs.rmSync(temp, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      throw new Error(
        `write plugin ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      this.mutate((doc) => {
        doc.plugins.push(deepClone(record));
      });
    } catch (error) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      throw error;
    }
    return deepClone(record);
  }

  remove(id: string): boolean {
    const safeId = assertValidPluginId(id);
    const exists = this.document.read().plugins.some((entry) => entry.id === safeId);
    if (!exists) return false;
    this.mutate((doc) => {
      doc.plugins = doc.plugins.filter((entry) => entry.id !== safeId);
    });
    try {
      fs.rmSync(this.pluginDir(safeId), { recursive: true, force: true });
    } catch (error) {
      this.logger(`[plugins] could not remove ${safeId}:`, error);
    }
    return true;
  }

  patch(id: string, patch: Partial<PluginRecord>): PluginRecord {
    const safeId = assertValidPluginId(id);
    let updated: PluginRecord | null = null;
    this.mutate((doc) => {
      const row = doc.plugins.find((entry) => entry.id === safeId);
      if (!row) throw new Error(`Plugin not found: ${safeId}`);
      Object.assign(row, patch, { id: safeId });
      updated = deepClone(row);
    });
    if (!updated) throw new Error(`Plugin not found: ${safeId}`);
    return updated;
  }

  /** Persist a refreshed manifest (new fields appear on upgrade). */
  writeManifest(id: string, manifest: PluginManifest): void {
    const file = this.manifestPath(id);
    const stored = toStoredManifest(manifest);
    try {
      this.writeFileAtomic(file, JSON.stringify(stored, null, 2));
    } catch (error) {
      this.logger(`[plugins] could not refresh manifest for ${id}:`, error);
    }
  }

  readSource(id: string): string {
    const file = this.sourcePath(id);
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new Error(`Plugin file is missing: ${file}`);
      }
      throw new Error(
        `read plugin file ${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Per-plugin config ───────────────────────────────────────────────────

  setConfig(id: string, key: string, value: string): void {
    const declared = declaredConfigKeys(this.get(id)?.manifest ?? null);
    if (!declared.includes(key)) {
      throw new Error(`Plugin ${id} does not declare a config key ${JSON.stringify(key)}`);
    }
    const config = this.readConfigDocument(id);
    config.values[key] = this.encryptValue(value);
    this.writeConfigDocument(id, config);
  }

  clearConfig(id: string, key: string): void {
    const declared = declaredConfigKeys(this.get(id)?.manifest ?? null);
    if (!declared.includes(key)) {
      throw new Error(`Plugin ${id} does not declare a config key ${JSON.stringify(key)}`);
    }
    const config = this.readConfigDocument(id);
    if (key in config.values) {
      delete config.values[key];
      this.writeConfigDocument(id, config);
    }
  }

  /** Declared key → whether a non-empty value is stored. Never returns values. */
  configStatus(id: string): Record<string, boolean> {
    const keys = declaredConfigKeys(this.get(id)?.manifest ?? null);
    const config = this.readConfigDocument(id);
    const status: Record<string, boolean> = {};
    for (const key of keys) {
      const stored = config.values[key];
      status[key] = typeof stored === "string" && stored.length > 0;
    }
    return status;
  }

  /** Decrypted values for the keys the manifest declares (for `search`). */
  configValues(id: string): Record<string, string> {
    const keys = declaredConfigKeys(this.get(id)?.manifest ?? null);
    const config = this.readConfigDocument(id);
    const out: Record<string, string> = {};
    for (const key of keys) {
      const stored = config.values[key];
      if (typeof stored !== "string" || stored.length === 0) continue;
      const value = this.decryptValue(stored);
      if (value !== null) out[key] = value;
    }
    return out;
  }

  private encryptValue(value: string): string {
    if (!this.cipher) return value;
    try {
      return `${SECRET_PREFIX}${this.cipher.encrypt(value)}`;
    } catch (error) {
      throw new Error(
        `Could not encrypt the plugin config value: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private decryptValue(stored: string): string | null {
    if (!stored.startsWith(SECRET_PREFIX)) return stored;
    if (!this.cipher) {
      this.logger("[plugins] config value is encrypted but no cipher is available");
      return null;
    }
    try {
      return this.cipher.decrypt(stored.slice(SECRET_PREFIX.length));
    } catch (error) {
      this.logger("[plugins] could not decrypt a plugin config value:", error);
      return null;
    }
  }

  private readConfigDocument(id: string): StoredConfig {
    if (this.configStore) {
      try {
        return { version: 1, values: { ...this.configStore.read(id) } };
      } catch (error) {
        this.logger(`[plugins] ignoring unreadable config for ${id}:`, error);
        return { version: 1, values: {} };
      }
    }
    const file = this.configPath(id);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredConfig>;
      const values: Record<string, string> = {};
      if (parsed && typeof parsed.values === "object" && parsed.values !== null) {
        for (const [key, value] of Object.entries(parsed.values)) {
          if (typeof value === "string") values[key] = value;
        }
      }
      return { version: 1, values };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, values: {} };
      }
      this.logger(`[plugins] ignoring unreadable config for ${id}:`, error);
      return { version: 1, values: {} };
    }
  }

  private writeConfigDocument(id: string, config: StoredConfig): void {
    if (this.configStore) {
      try {
        this.configStore.write(id, config.values);
      } catch (error) {
        throw new Error(
          `write plugin config for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return;
    }
    try {
      this.writeFileAtomic(this.configPath(id), JSON.stringify(config, null, 2));
    } catch (error) {
      throw new Error(
        `write plugin config ${this.configPath(id)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private writeFileAtomic(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, content, "utf8");
      fs.renameSync(temp, file);
    } catch (error) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        /* best effort */
      }
      throw error;
    }
  }

  private mutate(mutate: (doc: PluginDocument) => void): void {
    const doc = this.document.read();
    mutate(doc);
    doc.version = 1;
    doc.updatedAt = new Date().toISOString();
    this.document.write(doc);
  }

  /** Timestamp helper shared with the runtime. */
  nowSeconds(): number {
    return this.now();
  }
}
