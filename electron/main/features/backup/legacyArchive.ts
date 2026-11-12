/**
 * Reader/restorer for the retired app's **raw (v2)** `.gibak` archives.
 *
 * `src-tauri/src/backup_raw.rs` wrote `manifest.json` plus newline-delimited
 * JSON records under `data/<table>.ndjson` (physical artwork/plugin assets
 * under `assets/…`). That was the writer every shipped Tauri build used for
 * "Create backup" and "Quick backup", so it is the format real user archives
 * have — the binary `domains/<name>.db` layout only survived in tests.
 *
 * Restores are row-level and schema-checked: every JSON key must resolve to a
 * live column of the target table, unknown items are reported as warnings, and
 * "replace" clears the affected tables first (matching the Rust behaviour).
 * Domains whose tables do not exist in this build are skipped, never guessed
 * into another table.
 */
import AdmZip from "adm-zip";
import fsp from "node:fs/promises";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { openDb, tableColumns, type DbDomain } from "../../state/db";

export const RAW_MAGIC = "gameindex-raw-backup";
export const RAW_VERSION = 2;

/** NDJSON entries the Rust raw writer produced for each domain. */
const RAW_FILES: Record<string, string[]> = {
  games: ["data/games.ndjson"],
  sessions: ["data/sessions.ndjson"],
  wishlist: ["data/wishlist.ndjson"],
  emulators: ["data/emulators.ndjson"],
  mods: [
    "data/mods.ndjson",
    "data/mod_profiles.ndjson",
    "data/mod_settings.ndjson",
    "data/mod_source_links.ndjson",
    "data/mod_remote_installs.ndjson",
  ],
  plugins: ["data/plugins.ndjson"],
  sources: ["data/sources.ndjson"],
  achievements: ["data/achievement_links.ndjson", "data/achievements_cache.ndjson"],
  download_history: ["data/download_history.ndjson"],
  kv: ["data/kv.ndjson"],
  compatibility: [
    "data/compatibility_settings.ndjson",
    "data/game_compatibility.ndjson",
    "data/compatibility_runners.ndjson",
  ],
  saves: ["data/save_locations.ndjson", "data/save_backups.ndjson"],
  shelves: ["data/shelves.ndjson"],
  news: ["data/news.ndjson"],
  store_cache: ["data/store_cache.ndjson"],
  game_notes: ["data/game_notes.ndjson"],
  clips: ["data/clips.ndjson"],
};

/** Archive entry → live table that receives those rows. */
const TARGETS: Record<string, { domain: DbDomain; table: string }> = {
  "data/games.ndjson": { domain: "games", table: "games" },
  "data/sessions.ndjson": { domain: "sessions", table: "sessions" },
  "data/game_notes.ndjson": { domain: "game_notes", table: "game_notes" },
  "data/wishlist.ndjson": { domain: "wishlist", table: "wishlist" },
  "data/shelves.ndjson": { domain: "shelves", table: "shelves" },
  "data/save_locations.ndjson": { domain: "saves", table: "save_locations" },
  "data/save_backups.ndjson": { domain: "saves", table: "save_backups" },
  "data/kv.ndjson": { domain: "kv", table: "kv_store" },
  "data/download_history.ndjson": { domain: "downloads", table: "download_history" },
  "data/plugins.ndjson": { domain: "plugins", table: "plugins" },
  "data/emulators.ndjson": { domain: "emulators", table: "emulators" },
  "data/mods.ndjson": { domain: "mods", table: "mods" },
  "data/mod_profiles.ndjson": { domain: "mods", table: "mod_profiles" },
  "data/mod_settings.ndjson": { domain: "mods", table: "game_mod_settings" },
  "data/mod_source_links.ndjson": { domain: "mods", table: "mod_source_links" },
  "data/mod_remote_installs.ndjson": { domain: "mods", table: "mod_remote_installs" },
  "data/sources.ndjson": { domain: "sources", table: "sources" },
  "data/achievement_links.ndjson": { domain: "achievements", table: "achievement_links" },
  "data/achievements_cache.ndjson": { domain: "achievements", table: "achievements_cache" },
  "data/compatibility_settings.ndjson": {
    domain: "compatibility",
    table: "compatibility_settings",
  },
  "data/game_compatibility.ndjson": { domain: "compatibility", table: "game_compatibility" },
  "data/compatibility_runners.ndjson": {
    domain: "compatibility",
    table: "compatibility_runners",
  },
  "data/news.ndjson": { domain: "news", table: "news_cache" },
  "data/store_cache.ndjson": { domain: "store_cache", table: "store_cache" },
};

/** Row-key aliases where the live column is not just a snake_case rename. */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  kv_store: { key: "k", value: "v", updatedat: "updated_at" },
};

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toSqlValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

interface RowMapping {
  /** Row keys, in insertion order. */
  keys: string[];
  /** Matching live columns. */
  columns: string[];
}

function mapRow(
  row: Record<string, unknown>,
  columns: Set<string>,
  table: string,
): RowMapping | null {
  const aliases = KEY_ALIASES[table] ?? {};
  const byNormalized = new Map<string, string>();
  for (const column of columns) byNormalized.set(normalize(column), column);

  const keys: string[] = [];
  const mapped: string[] = [];
  const used = new Set<string>();
  for (const key of Object.keys(row)) {
    const normalized = normalize(key);
    const alias = aliases[normalized];
    const column =
      (alias && columns.has(alias) ? alias : undefined) ??
      byNormalized.get(normalized) ??
      byNormalized.get(`${normalized}json`);
    if (!column || used.has(column)) continue;
    if (!columns.has(column)) continue;
    keys.push(key);
    mapped.push(column);
    used.add(column);
  }
  return keys.length > 0 ? { keys, columns: mapped } : null;
}

/** Parse an NDJSON payload, skipping blank/invalid lines. */
export function parseNdjson(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* a corrupt line is skipped, matching the Rust per-row tolerance */
    }
  }
  return rows;
}

/** Parse a `domains/<name>.json` payload (NDJSON or a JSON array). */
function parseJsonEntry(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      );
    } catch {
      return [];
    }
  }
  return parseNdjson(trimmed);
}

/** Archive entries that carry raw records for one domain. */
export function rawEntryNames(zip: AdmZip, domain: string): string[] {
  const names = new Set<string>(RAW_FILES[domain] ?? []);
  names.add(`data/${domain}.ndjson`);
  names.add(`domains/${domain}.json`);
  return [...names].filter((name) => {
    const entry = zip.getEntry(name);
    return Boolean(entry && !entry.isDirectory);
  });
}

export function hasRawEntries(zip: AdmZip, domain: string): boolean {
  return rawEntryNames(zip, domain).length > 0;
}

export interface RawVerifyResult {
  valid: boolean;
  records: number;
  error: string | null;
}

/**
 * Validate a raw domain. A domain the writer chose but had no data for (for
 * example `news` in the Rust build) has no entry and count 0 — that is valid,
 * not corruption.
 */
export function verifyRawDomain(
  zip: AdmZip,
  domain: string,
  expectedCount: number,
): RawVerifyResult {
  const entries = rawEntryNames(zip, domain);
  if (entries.length === 0) {
    return expectedCount === 0
      ? { valid: true, records: 0, error: null }
      : {
          valid: false,
          records: 0,
          error: `Missing ${domain} records in archive`,
        };
  }

  let records = 0;
  for (const name of entries) {
    const entry = zip.getEntry(name);
    if (!entry) continue;
    const text = entry.getData().toString("utf8");
    const trimmed = text.trim();
    const rows = name.endsWith(".json") ? parseJsonEntry(text) : parseNdjson(text);
    if (name.endsWith(".json") && trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed)) {
          return { valid: false, records, error: `Invalid JSON in ${name}` };
        }
      } catch {
        return { valid: false, records, error: `Invalid JSON in ${name}` };
      }
    } else {
      const meaningful = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
      if (rows.length !== meaningful) {
        return { valid: false, records, error: `Invalid JSON lines in ${name}` };
      }
    }
    records += rows.length;
  }
  return { valid: true, records, error: null };
}

/** Every live table a raw domain can write to (including absent entries). */
function targetsForDomain(domain: string): { domain: DbDomain; table: string }[] {
  const names = new Set<string>([...(RAW_FILES[domain] ?? []), `data/${domain}.ndjson`]);
  const out: { domain: DbDomain; table: string }[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const target = TARGETS[name];
    if (!target) continue;
    const key = `${target.domain}.${target.table}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

/**
 * Restore one raw domain's rows. Returns the number of records applied.
 * `replace` clears every table the domain owns once before inserting (the Rust
 * writer's replace semantics), even when one of its NDJSON entries is absent.
 */
export function restoreRawDomain(
  zip: AdmZip,
  domain: string,
  mode: string,
  warnings: string[],
): number {
  const entries = rawEntryNames(zip, domain);
  if (entries.length === 0) return 0;

  const plans: { name: string; target: { domain: DbDomain; table: string } }[] = [];
  for (const name of entries) {
    const target = TARGETS[name] ?? TARGETS[`data/${path.posix.basename(name, ".json")}.ndjson`];
    if (!target) {
      warnings.push(`${domain}: ${name} has no matching table in this build`);
      continue;
    }
    plans.push({ name, target });
  }

  const replace = mode !== "merge";
  let restored = 0;
  const cleared = new Set<string>();

  if (replace) {
    for (const target of targetsForDomain(domain)) {
      const key = `${target.domain}.${target.table}`;
      if (cleared.has(key)) continue;
      try {
        const db = openDb(target.domain);
        db.exec(`DELETE FROM ${quoteIdent(target.table)}`);
        cleared.add(key);
      } catch (error) {
        warnings.push(
          `${domain}.${target.table}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (plans.length === 0) return 0;

  for (const plan of plans) {
    const entry = zip.getEntry(plan.name);
    if (!entry) continue;
    const text = entry.getData().toString("utf8");
    const rows = plan.name.endsWith(".json") ? parseJsonEntry(text) : parseNdjson(text);
    if (rows.length === 0) continue;

    try {
      const db = openDb(plan.target.domain);
      const columns = tableColumns(db, plan.target.table);
      if (columns.size === 0) {
        warnings.push(`${domain}: table ${plan.target.table} does not exist in this build`);
        continue;
      }
      // Union the keys of the first rows so optional fields on later rows are
      // not dropped merely because the first row omitted them.
      const sample: Record<string, unknown> = {};
      for (const row of rows.slice(0, 50)) {
        for (const key of Object.keys(row)) {
          if (!(key in sample)) sample[key] = row[key];
        }
      }
      const mapping = mapRow(sample, columns, plan.target.table);
      if (!mapping) {
        warnings.push(`${domain}: ${plan.name} rows do not match ${plan.target.table}`);
        continue;
      }
      const sql =
        `INSERT OR REPLACE INTO ${quoteIdent(plan.target.table)} ` +
        `(${mapping.columns.map(quoteIdent).join(", ")}) ` +
        `VALUES (${mapping.columns.map(() => "?").join(", ")})`;
      const statement = db.prepare(sql);
      const run = db.transaction(() => {
        let applied = 0;
        for (const row of rows) {
          try {
            statement.run(...mapping.keys.map((key) => toSqlValue(row[key])));
            applied += 1;
          } catch {
            /* constraint failure on one row must not abort the domain */
          }
        }
        return applied;
      });
      const applied = run();
      if (applied === 0) {
        warnings.push(
          `${domain}: no rows from ${plan.name} could be applied to ${plan.target.table}`,
        );
      }
      restored += applied;
    } catch (error) {
      warnings.push(
        `${domain}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return restored;
}

/**
 * Unpack physical artwork the raw archive bundled (`assets/artwork/…`).
 * Files are confined to `<userData>/artwork` (zip-slip guard).
 */
export async function restoreLegacyArtwork(
  zip: AdmZip,
  warnings: string[],
): Promise<number> {
  const root = path.resolve(userDataPath("artwork"));
  let restored = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.startsWith("assets/artwork/")) continue;
    const relative = entry.entryName.slice("assets/artwork/".length).replace(/\\/g, "/");
    const segments = relative.split("/");
    if (
      !relative ||
      relative.startsWith("/") ||
      /^[a-zA-Z]:/.test(relative) ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      continue;
    }
    const destination = path.resolve(root, ...segments);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) continue;
    try {
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, entry.getData());
      restored += 1;
    } catch (error) {
      warnings.push(
        `${relative}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return restored;
}

/** True when an archive entry name is a raw plugin asset we deliberately skip. */
export function isLegacyPluginAsset(name: string): boolean {
  return name.startsWith("assets/plugins/");
}
