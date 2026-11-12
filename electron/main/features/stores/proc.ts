/**
 * Process + registry helpers for local store detection.
 *
 * The Rust build used the `winreg` crate. The Electron build deliberately
 * avoids a native dependency and shells out to `reg.exe`, which ships with
 * Windows and needs no build step. Everything is async, time-boxed and
 * failure-tolerant: a missing key, a locked hive or a slow `reg.exe` must
 * never reject a scan.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a console program without a shell, bounded by `timeoutMs`. */
export function runCommand(
  file: string,
  args: string[],
  timeoutMs = 8_000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = execFile(
        file,
        args,
        {
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
          encoding: "utf8",
          timeout: timeoutMs,
        },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === "number"
              ? Number((error as unknown as { code: number }).code)
              : error
                ? 1
                : 0;
          finish({
            code,
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            timedOut:
              !!error &&
              (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true,
          });
        },
      );
    } catch (error) {
      finish({
        code: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      });
      return;
    }

    // `execFile`'s timeout kills the process, but the callback can lag on a
    // wedged child; resolve independently so a scan can never hang.
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ code: -1, stdout: "", stderr: "timeout", timedOut: true });
    }, timeoutMs + 500);
    timer.unref?.();
  });
}

export const isWindows = process.platform === "win32";

function regExe(): string {
  return "reg.exe";
}

const HIVE_ALIASES: Record<string, string> = {
  HKLM: "HKEY_LOCAL_MACHINE",
  HKCU: "HKEY_CURRENT_USER",
  HKU: "HKEY_USERS",
  HKCR: "HKEY_CLASSES_ROOT",
};

/** Canonicalise a hive prefix + split a key into path segments. */
function registrySegments(key: string): string[] {
  const cleaned = key.replace(/[\\/]+$/, "");
  const [hiveRaw, ...rest] = cleaned.split(/[\\/]+/);
  const hive = HIVE_ALIASES[hiveRaw.toUpperCase()] ?? hiveRaw.toUpperCase();
  return [hive, ...rest.map((part) => part.toLowerCase())];
}

/**
 * Enumerate immediate subkeys of a registry key.
 * Returns `[]` when the key does not exist (the normal "store not installed"
 * case) instead of throwing.
 */
export async function regEnumSubkeys(key: string): Promise<string[]> {
  if (!isWindows) return [];
  const result = await runCommand(regExe(), ["query", key]);
  if (result.code !== 0) return [];
  const expected = registrySegments(key);
  const out: string[] = [];
  for (const rawLine of result.stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/^HKEY_/i.test(line)) continue;
    const segments = registrySegments(line);
    // A subkey is exactly one segment deeper than the key we asked for.
    if (segments.length !== expected.length + 1) continue;
    let matches = true;
    for (let index = 0; index < expected.length; index += 1) {
      if (segments[index] !== expected[index]) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const name = line.split(/[\\/]+/).pop() ?? "";
    if (name) out.push(name);
  }
  return out;
}

/**
 * Read every value of a registry key. Registry value kinds are flattened to
 * strings (`REG_DWORD` becomes its decimal form) because every consumer here
 * only needs paths, names and numbers-as-text.
 */
export async function regQueryValues(
  key: string,
): Promise<Record<string, string>> {
  if (!isWindows) return {};
  const result = await runCommand(regExe(), ["query", key]);
  if (result.code !== 0) return {};
  return parseRegValues(result.stdout);
}

/** Parse `reg query <key>` output into a name→value map. */
export function parseRegValues(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    if (!rawLine.startsWith("    ")) continue;
    const match = rawLine.match(/^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}([\s\S]*)$/);
    if (!match) continue;
    const name = match[1].trim();
    const kind = match[2];
    let value = match[3].trim();
    if (kind === "REG_DWORD") {
      const hex = value.startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
      if (Number.isFinite(hex)) value = String(hex);
    }
    values[name] = value;
  }
  return values;
}

/** Windows uninstall hives every store writes client/game entries to. */
export const UNINSTALL_HIVES = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
] as const;

export interface UninstallEntry {
  /** Registry subkey name (a GUID or product code for most installers). */
  subkey: string;
  values: Record<string, string>;
}

/**
 * Read every uninstall entry once. Store scanners share the result instead of
 * each spawning `reg.exe` per hive.
 */
export async function readUninstallEntries(): Promise<UninstallEntry[]> {
  const out: UninstallEntry[] = [];
  for (const hive of UNINSTALL_HIVES) {
    const subkeys = await regEnumSubkeys(hive);
    for (const subkey of subkeys) {
      const values = await regQueryValues(`${hive}\\${subkey}`);
      if (Object.keys(values).length > 0) out.push({ subkey, values });
    }
  }
  return out;
}

/** Trim surrounding quotes and expand `%VARS%` in a registry path. */
export function cleanRegistryPath(value: string | undefined): string {
  if (!value) return "";
  let trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    trimmed = end > 0 ? trimmed.slice(1, end) : trimmed.slice(1);
  }
  return expandEnv(trimmed);
}

/** Expand `%NAME%` references against `process.env` (case-insensitive). */
export function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const exact = process.env[name];
    if (exact !== undefined) return exact;
    const key = Object.keys(process.env).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    return key ? (process.env[key] ?? whole) : whole;
  });
}

/** `C:\Program Files (x86)` without relying on the env var's parentheses. */
export function programFilesX86(): string {
  if (process.env["ProgramFiles(x86)"]) return process.env["ProgramFiles(x86)"] as string;
  return "C:\\Program Files (x86)";
}

/** All fixed drive roots, used only for known store folders (never a walk). */
export function driveRoots(): string[] {
  const roots: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(root)) roots.push(root);
    } catch {
      /* unreadable drive letter */
    }
  }
  return roots;
}
