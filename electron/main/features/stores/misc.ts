/**
 * Best-effort scanners for the remaining stores.
 *
 * Every one of these is local-only (no account): EA/Origin from the registry
 * (plus the Origin `LocalContent` XML folder when present), Battle.net from
 * the Blizzard registry hives with the Agent database as a fallback, itch.io
 * from `butler.db`, Xbox/Game Pass from the visible install folders, and the
 * Humble App from its `config.json`.
 *
 * All of them are deliberately conservative: an unknown schema or a denied
 * folder yields "no installs" rather than a guessed library.
 */
import fs from "node:fs";
import path from "node:path";
import { cleanRegistryPath, driveRoots, regEnumSubkeys, regQueryValues } from "./proc";
import { resolveExecutable } from "./exe";
import type { DetectedInstall, StoreScanResult } from "./types";

// ── EA / Origin ────────────────────────────────────────────────────────

const EA_GAME_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts\\EA Games",
  "HKLM\\SOFTWARE\\Electronic Arts\\EA Games",
  "HKCU\\SOFTWARE\\Electronic Arts\\EA Games",
] as const;

export async function scanEa(): Promise<StoreScanResult> {
  const installs: DetectedInstall[] = [];
  const probed: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const key of EA_GAME_KEYS) {
    const subkeys = await regEnumSubkeys(key);
    if (subkeys.length > 0) probed.push(key);
    for (const subkey of subkeys) {
      const values = await regQueryValues(`${key}\\${subkey}`);
      const rawDir =
        cleanRegistryPath(values["Install Dir"]) ||
        cleanRegistryPath(values.InstallLocation) ||
        cleanRegistryPath(values.InstallDir);
      if (!rawDir) continue;
      const installDir = rawDir.replace(/\//g, path.sep);
      let installed = false;
      try {
        installed = (await fs.promises.stat(installDir)).isDirectory();
      } catch {
        installed = false;
      }
      if (!installed) continue;
      const id = subkey.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      const name = cleanRegistryPath(values.DisplayName) || subkey;
      installs.push({
        store: "ea",
        storeId: subkey,
        name,
        installDir,
        exePath: await resolveExecutable(installDir, name),
        installed: true,
        extra: { eaKey: subkey },
      });
    }
  }

  // Origin also writes per-game XML under `%ProgramData%\Origin\LocalContent`.
  const localContent = path.join(
    process.env.ProgramData ?? process.env.PROGRAMDATA ?? "C:\\ProgramData",
    "Origin",
    "LocalContent",
  );
  if (fs.existsSync(localContent)) {
    probed.push(localContent);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(localContent, { withFileTypes: true });
    } catch (error) {
      errors.push(
        `ea: cannot read ${localContent} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name.toLowerCase())) continue;
      const dir = path.join(localContent, entry.name);
      const exe = await resolveExecutable(dir, entry.name);
      if (!exe) continue;
      seen.add(entry.name.toLowerCase());
      installs.push({
        store: "ea",
        storeId: entry.name,
        name: entry.name.replace(/[_-]+/g, " "),
        installDir: dir,
        exePath: exe,
        installed: true,
      });
    }
  }

  return {
    store: "ea",
    available: probed.length > 0,
    installs,
    probed,
    errors,
  };
}

// ── Battle.net ─────────────────────────────────────────────────────────

const BLIZZARD_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment",
  "HKLM\\SOFTWARE\\Blizzard Entertainment",
] as const;

/** Product codes the Blizzard registry uses, for a readable fallback name. */
const BLIZZARD_PRODUCT_NAMES: Record<string, string> = {
  wow: "World of Warcraft",
  wow_classic: "World of Warcraft Classic",
  wow_classic_era: "World of Warcraft Classic Era",
  d3: "Diablo III",
  d4: "Diablo IV",
  hero: "Heroes of the Storm",
  heroes: "Heroes of the Storm",
  s1: "StarCraft",
  s2: "StarCraft II",
  w3: "Warcraft III",
  hs: "Hearthstone",
  destiny2: "Destiny 2",
  cod: "Call of Duty",
  codmw: "Call of Duty: Modern Warfare",
  rtro: "Blizzard Arcade Collection",
  odin: "Call of Duty: Modern Warfare 2",
};

interface BnetRow {
  product: string;
  installPath: string;
  name?: string;
}

async function readBnetAgentDb(
  dbPath: string,
  errors: string[],
): Promise<BnetRow[]> {
  const out: BnetRow[] = [];
  let Database: typeof import("better-sqlite3");
  try {
    Database = (await import("better-sqlite3")).default;
  } catch {
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
        columns = db
          .prepare(`PRAGMA table_info("${table.name.replace(/"/g, '""')}")`)
          .all() as Array<{ name: string }>;
      } catch {
        continue;
      }
      const names = columns.map((column) => column.name);
      const pathColumn = names.find((name) => /^(install_?path|install_?dir|path)$/i.test(name));
      const productColumn = names.find((name) => /^(product_?code|productCode|uid|product)$/i.test(name));
      const nameColumn = names.find((name) => /^(name|display_?name|title)$/i.test(name));
      if (!pathColumn || !productColumn) continue;
      const nameSelect = nameColumn ? `"${nameColumn}"` : "NULL";
      try {
        const rows = db
          .prepare(
            `SELECT "${productColumn}" AS product, ${nameSelect} AS name, "${pathColumn}" AS install_path FROM "${table.name.replace(/"/g, '""')}"`,
          )
          .all() as Array<{ product: unknown; name: unknown; install_path: unknown }>;
        for (const row of rows) {
          const product = String(row.product ?? "").trim();
          const installPath = String(row.install_path ?? "").trim();
          if (!product || !installPath) continue;
          out.push({
            product,
            installPath,
            name: typeof row.name === "string" ? row.name : undefined,
          });
        }
      } catch {
        /* schema drift: skip this table */
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      errors.push(
        `battlenet: could not read ${path.basename(dbPath)} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }
  return out;
}

export async function scanBattlenet(): Promise<StoreScanResult> {
  const installs: DetectedInstall[] = [];
  const probed: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const key of BLIZZARD_KEYS) {
    const subkeys = await regEnumSubkeys(key);
    if (subkeys.length > 0) probed.push(key);
    for (const subkey of subkeys) {
      const values = await regQueryValues(`${key}\\${subkey}`);
      const installDir = cleanRegistryPath(values.InstallPath);
      if (!installDir) continue;
      let installed = false;
      try {
        installed = (await fs.promises.stat(installDir)).isDirectory();
      } catch {
        installed = false;
      }
      if (!installed) continue;
      const product = (values.Product ?? subkey).toLowerCase();
      if (seen.has(product)) continue;
      seen.add(product);
      const name = BLIZZARD_PRODUCT_NAMES[product] ?? subkey;
      installs.push({
        store: "battlenet",
        storeId: product,
        name,
        installDir,
        exePath: await resolveExecutable(installDir, name),
        installed: true,
        extra: { battlenetProduct: product },
      });
    }
  }

  if (installs.length === 0) {
    const candidates = [
      path.join(
        process.env.ProgramData ?? process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "Battle.net",
        "Agent",
        "Agent.db",
      ),
      path.join(
        process.env.APPDATA ?? process.env.AppData ?? "",
        "Battle.net",
        "Agent",
        "product.db",
      ),
    ];
    for (const dbPath of candidates) {
      if (!dbPath) continue;
      probed.push(dbPath);
      if (!fs.existsSync(dbPath)) continue;
      for (const row of await readBnetAgentDb(dbPath, errors)) {
        const installDir = row.installPath.replace(/\//g, path.sep);
        try {
          if (!(await fs.promises.stat(installDir)).isDirectory()) continue;
        } catch {
          continue;
        }
        const product = row.product.toLowerCase();
        if (seen.has(product)) continue;
        seen.add(product);
        const name = row.name || BLIZZARD_PRODUCT_NAMES[product] || row.product;
        installs.push({
          store: "battlenet",
          storeId: product,
          name,
          installDir,
          exePath: await resolveExecutable(installDir, name),
          installed: true,
        });
      }
    }
  }

  return {
    store: "battlenet",
    available: probed.length > 0,
    installs,
    probed,
    errors,
  };
}

// ── itch.io ────────────────────────────────────────────────────────────

function itchDbPath(): string {
  return path.join(
    process.env.APPDATA ?? process.env.AppData ?? "",
    "itch",
    "db",
    "butler.db",
  );
}

export async function scanItch(): Promise<StoreScanResult> {
  const dbPath = itchDbPath();
  const probed = [dbPath];
  const errors: string[] = [];
  const installs: DetectedInstall[] = [];
  if (!fs.existsSync(dbPath)) {
    return { store: "itch", available: false, installs, probed, errors };
  }

  let Database: typeof import("better-sqlite3");
  try {
    Database = (await import("better-sqlite3")).default;
  } catch (error) {
    errors.push(
      `itch: better-sqlite3 is unavailable (${error instanceof Error ? error.message : String(error)})`,
    );
    return { store: "itch", available: true, installs, probed, errors };
  }

  let db: import("better-sqlite3").Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // `caves` holds one installed copy: (id, game_id, path, ...). Join the
    // title from `games` when the schema allows it.
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    if (!tables.includes("caves")) {
      errors.push("itch: butler.db has no `caves` table (unsupported schema)");
      return { store: "itch", available: true, installs, probed, errors };
    }

    const hasGames = tables.includes("games");
    const sql = hasGames
      ? `SELECT caves.path AS path, caves.game_id AS game_id, games.title AS title
           FROM caves LEFT JOIN games ON games.id = caves.game_id`
      : `SELECT path, game_id, NULL AS title FROM caves`;
    const rows = db.prepare(sql).all() as Array<{
      path: unknown;
      game_id: unknown;
      title: unknown;
    }>;
    for (const row of rows) {
      const installDir = String(row.path ?? "").trim();
      if (!installDir) continue;
      let installed = false;
      try {
        installed = (await fs.promises.stat(installDir)).isDirectory();
      } catch {
        installed = false;
      }
      if (!installed) continue;
      const name =
        (typeof row.title === "string" && row.title.trim()) ||
        path.basename(installDir);
      installs.push({
        store: "itch",
        storeId: String(row.game_id ?? path.basename(installDir)),
        name,
        installDir,
        exePath: await resolveExecutable(installDir, name),
        installed: true,
      });
    }
  } catch (error) {
    errors.push(
      `itch: could not read butler.db (${
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

  return { store: "itch", available: true, installs, probed, errors };
}

// ── Xbox / Game Pass ───────────────────────────────────────────────────

/**
 * Xbox installs live in ACL-protected WindowsApps, but the Xbox app also
 * creates visible folders (`<drive>:\XboxGames`, `%ProgramFiles%\ModifiableWindowsApps`)
 * that carry a `MicrosoftGame.config`. Only those are read; guessing from
 * `%LOCALAPPDATA%\Packages` would surface app containers, not games.
 */
export async function scanXbox(): Promise<StoreScanResult> {
  const probed: string[] = [];
  const errors: string[] = [];
  const installs: DetectedInstall[] = [];
  const seen = new Set<string>();

  const roots: string[] = [];
  for (const drive of driveRoots()) roots.push(path.join(drive, "XboxGames"));
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  roots.push(path.join(programFiles, "ModifiableWindowsApps"));

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    probed.push(root);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (error) {
      errors.push(
        `xbox: cannot read ${root} (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDir = path.join(root, entry.name);
      const configPath = [
        path.join(packageDir, "MicrosoftGame.config"),
        path.join(packageDir, "Content", "MicrosoftGame.config"),
      ].find((candidate) => fs.existsSync(candidate));
      if (!configPath) continue;
      const key = entry.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let name = entry.name.replace(/_[0-9.]+_.*$/, "").replace(/[._]+/g, " ");
      let executable = "";
      try {
        const raw = await fs.promises.readFile(configPath, "utf8");
        const nameMatch = raw.match(/\bName\s*=\s*"([^"]+)"/i);
        if (nameMatch) name = nameMatch[1];
        const exeMatch = raw.match(/\bExecutable\s*=\s*"([^"]+)"/i);
        if (exeMatch) executable = exeMatch[1];
      } catch {
        /* keep the folder-derived name */
      }
      const installDir = path.dirname(configPath);
      installs.push({
        store: "xbox",
        storeId: entry.name,
        name,
        installDir,
        exePath: await resolveExecutable(installDir, name, executable || null),
        installed: true,
        extra: { packageDir },
      });
    }
  }

  return { store: "xbox", available: probed.length > 0, installs, probed, errors };
}

// ── Humble App ─────────────────────────────────────────────────────────

interface HumbleEntry {
  machineName?: string;
  gameName?: string;
  status?: string;
  filePath?: string;
  executablePath?: string;
  downloadFilePath?: string;
}

export async function scanHumble(): Promise<StoreScanResult> {
  const configPath = path.join(
    process.env.APPDATA ?? process.env.AppData ?? "",
    "Humble App",
    "config.json",
  );
  const probed = [configPath];
  const errors: string[] = [];
  const installs: DetectedInstall[] = [];
  if (!configPath || !fs.existsSync(configPath)) {
    return { store: "humble", available: false, installs, probed, errors };
  }

  let config: { gameCollection4?: HumbleEntry[] };
  try {
    config = JSON.parse(await fs.promises.readFile(configPath, "utf8")) as {
      gameCollection4?: HumbleEntry[];
    };
  } catch (error) {
    errors.push(
      `humble: unparseable config.json (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
    return { store: "humble", available: true, installs, probed, errors };
  }

  for (const entry of config.gameCollection4 ?? []) {
    if (entry.status !== "downloaded" && entry.status !== "installed") continue;
    const executablePath = entry.executablePath ?? "";
    const candidates = [
      entry.filePath ? path.join(entry.filePath, executablePath) : "",
      entry.downloadFilePath && entry.machineName
        ? path.join(entry.downloadFilePath, entry.machineName, executablePath)
        : "",
    ].filter(Boolean);
    const exe = candidates.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
    if (!exe) continue;
    const installDir = path.dirname(exe);
    const machineName = entry.machineName ?? path.basename(installDir);
    installs.push({
      store: "humble",
      storeId: machineName,
      name: entry.gameName?.trim() || machineName,
      installDir,
      exePath: exe,
      installed: true,
      extra: { humbleGameId: machineName },
    });
  }

  return { store: "humble", available: true, installs, probed, errors };
}
