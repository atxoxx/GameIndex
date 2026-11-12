/**
 * GOG local-install detection.
 *
 * Port of `src-tauri/src/gog/installed.rs`, plus the Galaxy database path the
 * mission calls for. Two independent sources:
 *
 *   1. **Registry (authoritative on Windows).** Standalone GOG installers
 *      write `HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<productId>` with
 *      `gameName`, `path`, `exe` and a `DLC` list. Galaxy itself also writes
 *      an uninstall entry (`Publisher=GOG.com`), which is the fallback when
 *      the GOG.com key is absent.
 *   2. **Galaxy 2.0 SQLite** (`galaxy-2.0.db`). Opened read-only with
 *      `better-sqlite3`; the schema is version-dependent, so the reader
 *      introspects `sqlite_master` and only consumes tables that expose both
 *      an id/title pair and an install-path column. Any failure is a soft
 *      "no data", never an error that breaks the scan.
 *
 * DLC products are filtered out: a GOG DLC row shares the base game's install
 * directory and only differs by product id, so importing them would create
 * duplicate library entries.
 */
import fs from "node:fs";
import path from "node:path";
import { cleanRegistryPath, regEnumSubkeys, regQueryValues } from "./proc";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

const GOG_GAME_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games",
  "HKLM\\SOFTWARE\\GOG.com\\Games",
  "HKCU\\Software\\GOG.com\\Games",
] as const;

export function galaxyDbCandidates(): string[] {
  const local = process.env.LOCALAPPDATA ?? process.env.LocalAppData ?? "";
  const programData = process.env.ProgramData ?? process.env.PROGRAMDATA ?? "";
  const candidates: string[] = [];
  if (local) {
    candidates.push(
      path.join(local, "GOG.com", "Galaxy", "storage", "galaxy-2.0.db"),
      path.join(local, "GOG.com", "Galaxy", "galaxy-2.0.db"),
    );
  }
  if (programData) {
    candidates.push(
      path.join(programData, "GOG.com", "Galaxy", "storage", "galaxy-2.0.db"),
    );
  }
  return candidates;
}

/** Standard GOG install roots walked when the registry has nothing. */
function gogInstallRoots(): string[] {
  const roots = [
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "GOG Galaxy", "Games"),
    "C:\\GOG Games",
    "D:\\GOG Games",
    "C:\\Games\\GOG",
    "D:\\Games\\GOG",
  ];
  return roots.filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
}

interface GogEntry {
  gameId: string;
  name: string;
  installDir: string;
  exe: string;
  dlcIds: string[];
}

async function readRegistryGames(): Promise<{
  entries: GogEntry[];
  probed: string[];
  errors: string[];
}> {
  const entries: GogEntry[] = [];
  const probed: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const key of GOG_GAME_KEYS) {
    const subkeys = await regEnumSubkeys(key);
    if (subkeys.length > 0) probed.push(key);
    for (const subkey of subkeys) {
      if (!/^\d+$/.test(subkey)) continue;
      const values = await regQueryValues(`${key}\\${subkey}`);
      if (Object.keys(values).length === 0) continue;
      const gameId = (values.gameID || values.productID || subkey).trim();
      if (!gameId || seen.has(gameId)) continue;
      const installDir = cleanRegistryPath(values.path);
      const exe = cleanRegistryPath(values.exe);
      const dlcIds = (values.DLC ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d+$/.test(id));
      seen.add(gameId);
      entries.push({
        gameId,
        name: (values.gameName || path.basename(installDir || "") || `GOG ${gameId}`).trim(),
        installDir,
        exe,
        dlcIds,
      });
    }
  }

  // Fallback: uninstall entries published by GOG.com.
  if (entries.length === 0) {
    for (const hive of [
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ]) {
      const subkeys = await regEnumSubkeys(hive);
      for (const subkey of subkeys) {
        const match = subkey.match(/^(\d+)_is1$/);
        if (!match) continue;
        if (seen.has(match[1])) continue;
        const values = await regQueryValues(`${hive}\\${subkey}`);
        if (!values.Publisher || values.Publisher.trim().toLowerCase() !== "gog.com") {
          continue;
        }
        const installDir = cleanRegistryPath(values.InstallLocation);
        if (!installDir) continue;
        seen.add(match[1]);
        entries.push({
          gameId: match[1],
          name: (values.DisplayName || path.basename(installDir)).trim(),
          installDir,
          exe: cleanRegistryPath(values.DisplayIcon),
          dlcIds: [],
        });
      }
    }
  }

  return { entries, probed, errors };
}

interface SqliteRow {
  [column: string]: unknown;
}

/**
 * Best-effort read of `galaxy-2.0.db`. The Galaxy schema has changed repeatedly
 * (Products / LibraryReleases / InstalledProducts), so instead of hard-coding
 * one version the reader looks for a table that carries a path-like column and
 * uses whatever id/title columns it also has.
 */
async function readGalaxyDb(
  dbPath: string,
  errors: string[],
): Promise<GogEntry[]> {
  const out: GogEntry[] = [];
  let Database: typeof import("better-sqlite3");
  try {
    Database = (await import("better-sqlite3")).default;
  } catch (error) {
    errors.push(
      `gog: better-sqlite3 is unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
    return out;
  }

  let db: import("better-sqlite3").Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    for (const table of tables) {
      let columns: Array<{ name: string }>;
      try {
        columns = db.prepare(`PRAGMA table_info("${table.name.replace(/"/g, '""')}")`).all() as Array<{
          name: string;
        }>;
      } catch {
        continue;
      }
      const names = columns.map((column) => column.name);
      const lower = names.map((name) => name.toLowerCase());
      const pathColumn = names.find((name) => /^(install_?path|install_?dir|path)$/i.test(name));
      const titleColumn = names.find((name) => /^(title|name|product_title)$/i.test(name));
      const idColumn =
        names.find((name) => /^(product_?id|productId|id|game_?id)$/i.test(name)) ??
        (lower.includes("productid") ? names[lower.indexOf("productid")] : undefined);
      if (!pathColumn || !idColumn) continue;

      const titleSelect = titleColumn ? `"${titleColumn}"` : "NULL";
      const sql = `SELECT "${idColumn}" AS id, ${titleSelect} AS title, "${pathColumn}" AS install_path FROM "${table.name.replace(/"/g, '""')}"`;
      let rows: SqliteRow[];
      try {
        rows = db.prepare(sql).all() as SqliteRow[];
      } catch {
        continue;
      }

      for (const row of rows) {
        const id = String(row.id ?? "").trim();
        const installPath = String(row.install_path ?? "").trim();
        if (!/^\d+$/.test(id) || !installPath) continue;
        if (out.some((entry) => entry.gameId === id)) continue;
        out.push({
          gameId: id,
          name: String(row.title ?? "").trim() || path.basename(installPath),
          installDir: installPath,
          exe: "",
          dlcIds: [],
        });
      }
    }
  } catch (error) {
    errors.push(
      `gog: could not read ${path.basename(dbPath)} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }
  return out;
}

async function readDiskRoots(): Promise<GogEntry[]> {
  const out: GogEntry[] = [];
  for (const root of gogInstallRoots()) {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const installDir = path.join(root, entry.name);
      const infoPath = path.join(installDir, `goggame-${entry.name}.info`);
      if (!fs.existsSync(infoPath)) continue;
      let name = entry.name;
      try {
        const info = JSON.parse(await fs.promises.readFile(infoPath, "utf8")) as {
          name?: string;
          gameId?: string;
          rootGameId?: string;
        };
        if (info.rootGameId && info.rootGameId !== entry.name) continue; // DLC
        name = info.name ?? name;
      } catch {
        /* unparseable info: keep the folder name */
      }
      out.push({ gameId: entry.name, name, installDir, exe: "", dlcIds: [] });
    }
  }
  return out;
}

export async function scanGog(): Promise<StoreScanResult> {
  const probed: string[] = [];
  const errors: string[] = [];
  const registry = await readRegistryGames();
  probed.push(...registry.probed);
  errors.push(...registry.errors);
  let entries = registry.entries;

  // Galaxy DB only fills gaps: the registry is canonical on Windows.
  for (const dbPath of galaxyDbCandidates()) {
    probed.push(dbPath);
    if (!fs.existsSync(dbPath)) continue;
    const dbEntries = await readGalaxyDb(dbPath, errors);
    for (const entry of dbEntries) {
      if (!entries.some((existing) => existing.gameId === entry.gameId)) {
        entries.push(entry);
      }
    }
  }

  if (entries.length === 0) {
    const diskEntries = await readDiskRoots();
    for (const entry of diskEntries) {
      probed.push(entry.installDir);
      entries.push(entry);
    }
  }

  // Drop DLC products (they are listed by their parent's `DLC` value).
  const dlcIds = new Set(entries.flatMap((entry) => entry.dlcIds));
  entries = entries.filter((entry) => !dlcIds.has(entry.gameId));

  // Collapse rows sharing one install directory (base + "Enhanced Edition").
  const byDir = new Map<string, GogEntry>();
  for (const entry of entries) {
    const key = (entry.installDir || entry.gameId).toLowerCase();
    if (!byDir.has(key)) byDir.set(key, entry);
  }

  const installs: DetectedInstall[] = [];
  for (const entry of byDir.values()) {
    let installed = false;
    if (entry.installDir) {
      try {
        installed = (await fs.promises.stat(entry.installDir)).isDirectory();
      } catch {
        installed = false;
      }
    }
    if (!installed) continue;
    installs.push({
      store: "gog",
      storeId: entry.gameId,
      name: entry.name,
      installDir: entry.installDir,
      exePath: await resolveExecutable(entry.installDir, entry.name, entry.exe),
      installed: true,
      extra: { gogGameId: entry.gameId },
    });
  }

  return {
    store: "gog",
    available: probed.length > 0,
    installs,
    probed,
    errors,
  };
}

/** Owned GOG catalogue from the Galaxy DB, used by the (auth-less) sync. */
export async function gogOwnedFromGalaxyDb(): Promise<
  Array<{ gameId: string; title: string }>
> {
  const errors: string[] = [];
  for (const dbPath of galaxyDbCandidates()) {
    if (!fs.existsSync(dbPath)) continue;
    const entries = await readGalaxyDb(dbPath, errors);
    if (entries.length > 0) {
      return entries.map((entry) => ({ gameId: entry.gameId, title: entry.name }));
    }
  }
  return [];
}
