/**
 * Valve KeyValues (`VDF`) parsing.
 *
 * Steam writes three files this workstream reads:
 *   • `steamapps/libraryfolders.vdf` — every library root.
 *   • `steamapps/appmanifest_<appid>.acf` — per-app install state.
 *   • `config/localconfig.vdf` — family sharing / owned app tickets.
 *
 * The Rust build used hand-rolled `split('"')` walks. A real tokenizer is
 * barely more code and correctly handles escaped quotes, braces inside values
 * and the nested `"apps" { … }` blocks the flat parser quietly ignored.
 */

export type VdfValue = string | VdfObject;
export interface VdfObject {
  [key: string]: VdfValue;
}

interface Token {
  kind: "string" | "open" | "close";
  value: string;
}

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const length = raw.length;

  while (i < length) {
    const ch = raw[i];

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    // `//` line comments (Steam writes them in localconfig.vdf).
    if (ch === "/" && raw[i + 1] === "/") {
      while (i < length && raw[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "{") {
      tokens.push({ kind: "open", value: "{" });
      i += 1;
      continue;
    }
    if (ch === "}") {
      tokens.push({ kind: "close", value: "}" });
      i += 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      let value = "";
      while (i < length) {
        const c = raw[i];
        if (c === "\\" && i + 1 < length) {
          const next = raw[i + 1];
          // Steam stores Windows paths as `C:\\Games`; collapse to `C:\Games`.
          value += next === "\\" || next === '"' ? next : `\\${next}`;
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }

    // Unquoted token (some third-party writers omit quotes for numbers).
    let value = "";
    while (
      i < length &&
      !/[\s{}"]/.test(raw[i]) &&
      !(raw[i] === "/" && raw[i + 1] === "/")
    ) {
      value += raw[i];
      i += 1;
    }
    if (value) tokens.push({ kind: "string", value });
  }

  return tokens;
}

/** Parse a whole VDF document. Never throws: malformed input yields `{}`. */
export function parseVdf(raw: string): VdfObject {
  if (!raw) return {};
  const tokens = tokenize(raw.replace(/^\uFEFF/, ""));
  let cursor = 0;

  const parseBlock = (): VdfObject => {
    const out: VdfObject = {};
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.kind === "close") {
        cursor += 1;
        return out;
      }
      if (token.kind === "open") {
        // Stray `{` — skip the whole block so one bad write cannot poison the
        // rest of the document.
        cursor += 1;
        parseBlock();
        continue;
      }
      const key = token.value;
      cursor += 1;
      const next = tokens[cursor];
      if (!next) break;
      if (next.kind === "open") {
        cursor += 1;
        out[key] = parseBlock();
      } else if (next.kind === "string") {
        out[key] = next.value;
        cursor += 1;
      } else {
        out[key] = "";
      }
    }
    return out;
  };

  // The outer document is usually `"AppState" { … }` — parseBlock handles it
  // as a nested object, so the result keeps that top-level key.
  return parseBlock();
}

/** Case-insensitive object lookup (VDF keys differ across Steam versions). */
export function vdfChild(
  node: VdfObject | VdfValue | undefined,
  key: string,
): VdfValue | undefined {
  if (!node || typeof node === "string") return undefined;
  if (key in node) return node[key];
  const lower = key.toLowerCase();
  for (const [candidate, value] of Object.entries(node)) {
    if (candidate.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function vdfObject(
  node: VdfObject | VdfValue | undefined,
  key?: string,
): VdfObject | null {
  const value = key === undefined ? node : vdfChild(node, key);
  if (!value || typeof value === "string") return null;
  return value;
}

export function vdfString(
  node: VdfObject | VdfValue | undefined,
  key: string,
): string | null {
  const value = vdfChild(node, key);
  if (typeof value !== "string") return null;
  return value;
}

export function vdfNumber(
  node: VdfObject | VdfValue | undefined,
  key: string,
): number | null {
  const raw = vdfString(node, key);
  if (raw === null) return null;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

// ── Steam-specific shapes ──────────────────────────────────────────────

export interface SteamLibraryFolder {
  path: string;
  label: string;
  /** appid → bytes on disk, as Steam records in `libraryfolders.vdf`. */
  apps: Record<number, number>;
}

/**
 * Parse `libraryfolders.vdf`. Handles:
 *   • the modern nested shape (`"0" { "path" "D:\\SteamLibrary" … }`)
 *   • the legacy flat shape (`"1" "D:\\SteamLibrary"`)
 *   • the pre-2021 `"LibraryFolders" { "TimeNextStatsReport" … }` wrapper
 */
export function parseLibraryFolders(raw: string): SteamLibraryFolder[] {
  const document = parseVdf(raw);
  const root =
    vdfObject(document, "libraryfolders") ??
    vdfObject(document, "LibraryFolders") ??
    document;

  const folders: SteamLibraryFolder[] = [];
  const seen = new Set<string>();

  const push = (value: unknown, appsNode: VdfObject | null): void => {
    if (typeof value !== "string") return;
    const path = value.trim();
    if (!isAbsolutePath(path)) return;
    const key = path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const apps: Record<number, number> = {};
    if (appsNode) {
      for (const [appid, size] of Object.entries(appsNode)) {
        const id = Number(appid);
        const bytes = Number(size);
        if (Number.isFinite(id) && Number.isFinite(bytes)) apps[id] = bytes;
      }
    }
    folders.push({ path, label: "", apps });
  };

  for (const [key, value] of Object.entries(root)) {
    if (typeof value === "string") {
      // Legacy: every numeric key maps straight to a path.
      if (/^\d+$/.test(key)) push(value, null);
      continue;
    }
    const path = vdfString(value, "path");
    if (path) {
      push(path, vdfObject(value, "apps"));
      const added = folders[folders.length - 1];
      if (added) added.label = vdfString(value, "label") ?? "";
    }
  }

  return folders;
}

function isAbsolutePath(value: string): boolean {
  if (!value) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith("\\\\")) return true;
  return value.startsWith("/");
}

export interface SteamAppManifest {
  appId: number;
  name: string;
  installDir: string;
  stateFlags: number | null;
  buildId: string | null;
  lastOwner: string | null;
  installedDlcs: number[];
  /** `SizeOnDisk` (bytes), present on modern manifests. */
  sizeOnDisk: number | null;
  bytesToDownload: number | null;
  bytesDownloaded: number | null;
  bytesToStage: number | null;
  bytesStaged: number | null;
  /** `StateFlags & 4` when present; a manifest without the flag is installed. */
  fullyInstalled: boolean;
}

export function parseAppManifest(
  raw: string,
  fallbackAppId: number,
): SteamAppManifest | null {
  const document = parseVdf(raw);
  const state =
    vdfObject(document, "AppState") ??
    vdfObject(document, "appstate") ??
    document;

  const installDir = vdfString(state, "installdir");
  if (!installDir) return null;

  const rawAppId = vdfNumber(state, "appid");
  const installedDlcs: number[] = [];
  const dlcNode = vdfObject(state, "InstalledDepots") ?? vdfObject(state, "installeddepots");
  if (dlcNode) {
    for (const key of Object.keys(dlcNode)) {
      const id = Number(key);
      if (Number.isFinite(id)) installedDlcs.push(id);
    }
  }
  const dlcList = vdfString(state, "dlcappid");
  if (dlcList) {
    for (const part of dlcList.split(",")) {
      const id = Number(part.trim());
      if (Number.isFinite(id)) installedDlcs.push(id);
    }
  }

  const stateFlags = vdfNumber(state, "StateFlags");

  return {
    appId: rawAppId !== null ? Math.trunc(rawAppId) : fallbackAppId,
    name: vdfString(state, "name") ?? "",
    installDir,
    stateFlags,
    buildId: vdfString(state, "buildid"),
    lastOwner: vdfString(state, "LastOwner"),
    installedDlcs: [...new Set(installedDlcs)],
    sizeOnDisk: vdfNumber(state, "SizeOnDisk"),
    bytesToDownload: vdfNumber(state, "BytesToDownload"),
    bytesDownloaded: vdfNumber(state, "BytesDownloaded"),
    bytesToStage: vdfNumber(state, "BytesToStage"),
    bytesStaged: vdfNumber(state, "BytesStaged"),
    fullyInstalled: stateFlags === null ? true : (stateFlags & 4) !== 0,
  };
}

/**
 * `StateFlags` bits used by the transfer watcher.
 * 4 = StateFullyInstalled, 512 = StateUpdatePaused.
 */
export const STEAM_FLAG_FULLY_INSTALLED = 4;
export const STEAM_FLAG_UPDATE_PAUSED = 512;
