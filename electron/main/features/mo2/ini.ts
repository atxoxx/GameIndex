/**
 * Minimal INI reader for Mod Organizer 2 files.
 *
 * Ported from `src-tauri/src/mods/mo2.rs` (`clean_ini_val`, `parse_ini`,
 * `ini_setting`, `ini_path_setting`). MO2 writes Qt `QSettings` values, so a
 * value may be wrapped in `@ByteArray(...)` / `@Variant(...)`, quoted, or carry
 * doubled backslashes. Keys keep their case (MO2's custom-executable keys are
 * `1\title`, `1\binary`, …).
 *
 * Section lookup falls back to `[General]` because pre-2.x instances (and
 * hand-written files) keep path settings there instead of `[Settings]`.
 */
import fs from "node:fs";
import path from "node:path";

export type IniMap = Record<string, Record<string, string>>;

/** Strip Qt wrapper types, surrounding quotes and doubled backslashes. */
export function cleanIniValue(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("@ByteArray(") && value.endsWith(")") && value.length >= 12) {
    value = value.slice(11, value.length - 1).trim();
  } else if (value.startsWith("@Variant(") && value.endsWith(")") && value.length >= 10) {
    value = value.slice(9, value.length - 1).trim();
  }
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, value.length - 1);
  }
  return value.replace(/\\\\/g, "\\");
}

/** Parse an INI document into `section -> key -> value`. */
export function parseIni(content: string): IniMap {
  const map: IniMap = {};
  let section = "General";

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, line.length - 1).trim();
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = cleanIniValue(line.slice(eq + 1).trim());
    const bucket = (map[section] ??= {});
    bucket[key] = value;
  }

  return map;
}

/** Read a setting from `[Settings]`, then `[General]`, trying keys in order. */
export function iniSetting(ini: IniMap, keys: string[]): string | null {
  for (const section of ["Settings", "General"]) {
    const values = ini[section];
    if (!values) continue;
    for (const key of keys) {
      const raw = values[key];
      if (raw === undefined) continue;
      const value = raw.trim();
      if (value) return value;
    }
  }
  return null;
}

/** Same as `iniSetting`, with stray quotes trimmed (path values). */
export function iniPathSetting(ini: IniMap, keys: string[]): string {
  const value = iniSetting(ini, keys);
  return value ? value.trim().replace(/^"+|"+$/g, "").trim() : "";
}

export function readIniFile(file: string): IniMap | null {
  try {
    return parseIni(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write with a `<name>.gameindex-backup` copy first, then an atomic rename. */
export function writeTextWithBackup(file: string, content: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.gameindex-backup`);
    } catch {
      /* a failed backup must not block the edit, matching the Rust writer */
    }
  }
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw error;
  }
}
