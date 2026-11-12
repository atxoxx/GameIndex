/**
 * OS process enumeration and termination for the game watcher.
 *
 * Windows-first, mirroring `src-tauri/src/game_watcher/process.rs` +
 * `game_watcher/force_close.rs`:
 *
 *  • The fast snapshot reads `tasklist /FO CSV /NH` (image name, PID, working
 *    set). It is the cheapest way to answer "which PIDs exist" and drives
 *    liveness checks and basename candidate selection.
 *  • Full paths / parent PIDs come from one `Get-CimInstance Win32_Process`
 *    call. It is only issued when a session is pending, a tracked process went
 *    missing, or a basename candidate needs identifying — never on an idle
 *    poll.
 *  • Killing verifies the PID's executable before terminating it, so a PID
 *    recycled by the OS between poll and click can never kill a foreign
 *    process.
 *
 * Linux/macOS degrade to `ps`, which gives names + parent PIDs but not paths;
 * matching then falls back to image names. Windows is the verified target.
 */
import { execFile } from "node:child_process";
import { baseNameLower, isInsideDir, normalizePathLower, trimPathSeparators } from "./paths";
import type { ProcessInfo } from "./types";

const IS_WINDOWS = process.platform === "win32";

/** Never treat these as a launched game (mirrors the Rust ignorable list). */
const IGNORABLE_SYSTEM_EXES = new Set([
  "svchost.exe",
  "conhost.exe",
  "runtimebroker.exe",
  "dllhost.exe",
  "dwm.exe",
  "csrss.exe",
  "smss.exe",
  "lsass.exe",
  "services.exe",
  "wininit.exe",
  "winlogon.exe",
  "spoolsv.exe",
  "fontdrvhost.exe",
  "sihost.exe",
  "taskhostw.exe",
  "ctfmon.exe",
  "audiodg.exe",
  "smartscreen.exe",
  "securityhealthservice.exe",
  "securityhealthsystray.exe",
  "searchhost.exe",
  "searchindexer.exe",
  "searchfilterhost.exe",
  "searchprotocolhost.exe",
  "wmiprvse.exe",
  "backgroundtaskhost.exe",
  "applicationframehost.exe",
  "shellexperiencehost.exe",
  "startmenuexperiencehost.exe",
  "textinputhost.exe",
  "explorer.exe",
  "msedgewebview2.exe",
  "gameindex.exe",
  "electron.exe",
  "dashost.exe",
  "wudfhost.exe",
  "aggregatorhost.exe",
  "compattelrunner.exe",
  "sppsvc.exe",
  "system",
  "registry",
  "memory compression",
]);

/**
 * Executable-name fragments that are never the game itself (redistributables,
 * launchers, crash handlers, bundled helpers). Mirrors `SKIP_KEYWORDS` in
 * `game_watcher/resolve.rs`.
 */
export const SKIP_KEYWORDS: readonly string[] = [
  "redist",
  "vcredist",
  "dotnet",
  "dxsetup",
  "directx",
  "ue4prereq",
  "ue4-prereq",
  "ue5prereq",
  "ue5-prereq",
  "physx",
  "openal",
  "launcher",
  "patcher",
  "updater",
  "bootstrapper",
  "crash",
  "crashpad",
  "crashreport",
  "crashhandler",
  "errorreport",
  "bugreport",
  "debug",
  "unin",
  "unins",
  "uninstall",
  "unwise",
  "setup",
  "install",
  "register",
  "helper",
  "autorun",
  "plugin",
  "manual",
  "readme",
  "7za",
  "config",
  "configuration",
  "settings",
  "steamclient",
  "steamerror",
  "unitycrashhandler",
  "unitycrashhandler64",
  "videoplayer",
  "ue4_game",
  "ue5_game",
  "gamingservices",
  "gamingservice",
  "eadesktop",
  "origin",
  "ubisoftconnect",
  "upc",
  "epicgameslauncher",
  "galaxyclient",
  "wallpaper",
];

/** True when an executable name is known to be something other than a game. */
export function isSkipName(name: string): boolean {
  const lower = name.toLowerCase();
  return SKIP_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/** True when the image name is a Windows system host that is never a game. */
export function isIgnorableSystemExe(name: string): boolean {
  return IGNORABLE_SYSTEM_EXES.has(name.toLowerCase());
}

function runCommand(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout ?? ""));
      },
    );
  });
}

/** One CSV line (tasklist quotes every field and doubles inner quotes). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** `"12 345 Ko"` / `"12,345 K"` / `"N/A"` → bytes. The suffix is localised. */
function parseWorkingSet(field: string | undefined): number {
  if (!field) return 0;
  const digits = field.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const kib = Number.parseInt(digits, 10);
  return Number.isFinite(kib) ? kib * 1024 : 0;
}

function isWindowsPathLike(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * Fast process snapshot: PIDs + image names (+ working set on Windows).
 * `exePath` is empty — call `resolveProcessDetails` for the PIDs that matter.
 */
export async function listProcessBase(): Promise<ProcessInfo[]> {
  if (!IS_WINDOWS) return listProcessBasePosix();
  try {
    const stdout = await runCommand("tasklist", ["/FO", "CSV", "/NH"], 15_000);
    const processes: ProcessInfo[] = [];
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const fields = parseCsvLine(line);
      if (fields.length < 2) continue;
      const name = fields[0] ?? "";
      const pid = Number.parseInt(fields[1] ?? "", 10);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      if (!name || isIgnorableSystemExe(name)) continue;
      processes.push({
        pid,
        ppid: 0,
        name,
        exePath: "",
        workingSetBytes: parseWorkingSet(fields[4]),
      });
    }
    return processes;
  } catch (error) {
    console.error("[launch] tasklist failed:", error);
    return [];
  }
}

async function listProcessBasePosix(): Promise<ProcessInfo[]> {
  try {
    const stdout = await runCommand("ps", ["-A", "-o", "pid=,ppid=,rss=,comm="], 15_000);
    const processes: ProcessInfo[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!match) continue;
      const pid = Number.parseInt(match[1], 10);
      const ppid = Number.parseInt(match[2], 10);
      const rssKib = Number.parseInt(match[3], 10);
      const command = match[4].trim();
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const name = baseNameLower(command) || command;
      if (isIgnorableSystemExe(name)) continue;
      processes.push({
        pid,
        ppid: Number.isFinite(ppid) ? ppid : 0,
        name,
        exePath: isWindowsPathLike(command) ? command : "",
        workingSetBytes: Number.isFinite(rssKib) ? rssKib * 1024 : 0,
      });
    }
    return processes;
  } catch (error) {
    console.error("[launch] ps failed:", error);
    return [];
  }
}

interface ProcessDetail {
  pid: number;
  ppid: number;
  exePath: string;
}

function parsePowerShellJson(stdout: string): ProcessDetail[] {
  const text = stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const details: ProcessDetail[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const value = row as Record<string, unknown>;
      const pid = Number(value.ProcessId ?? 0);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      details.push({
        pid,
        ppid: Number(value.ParentProcessId ?? 0) || 0,
        exePath: typeof value.ExecutablePath === "string" ? value.ExecutablePath : "",
      });
    }
    return details;
  } catch {
    return [];
  }
}

const PS_PREFIX =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ";

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Resolve full executable paths + parent PIDs for the given PIDs.
 * Unknown/dead PIDs are simply absent from the result.
 */
export async function resolveProcessDetails(pids: number[]): Promise<Map<number, ProcessDetail>> {
  const unique = [...new Set(pids.filter((pid) => Number.isFinite(pid) && pid > 0))];
  const details = new Map<number, ProcessDetail>();
  if (unique.length === 0) return details;
  if (!IS_WINDOWS) return details;

  for (const group of chunk(unique, 40)) {
    const filter = group.map((pid) => `ProcessId=${pid}`).join(" or ");
    const script =
      PS_PREFIX +
      `Get-CimInstance Win32_Process -Filter '${filter}' | ` +
      "Select-Object ProcessId,ParentProcessId,ExecutablePath | ConvertTo-Json -Compress";
    try {
      const stdout = await runCommand(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        25_000,
      );
      for (const detail of parsePowerShellJson(stdout)) details.set(detail.pid, detail);
    } catch (error) {
      console.error("[launch] process path lookup failed:", error);
    }
  }
  return details;
}

/**
 * Full snapshot with paths + parent PIDs. One WMI query (≈0.5 s), used only
 * while a session is pending or has just lost its process, so the ongoing
 * poll can search the install tree for a hand-off.
 */
export async function listProcessesDetailed(): Promise<ProcessInfo[]> {
  if (!IS_WINDOWS) return listProcessBase();
  const script =
    PS_PREFIX +
    "Get-CimInstance Win32_Process | " +
    "Select-Object ProcessId,ParentProcessId,ExecutablePath,Name,WorkingSetSize | " +
    "ConvertTo-Json -Compress";
  try {
    const stdout = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      30_000,
    );
    const text = stdout.trim();
    if (!text) return [];
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const processes: ProcessInfo[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const value = row as Record<string, unknown>;
      const pid = Number(value.ProcessId ?? 0);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const name = typeof value.Name === "string" ? value.Name : "";
      if (!name || isIgnorableSystemExe(name)) continue;
      processes.push({
        pid,
        ppid: Number(value.ParentProcessId ?? 0) || 0,
        name,
        exePath: typeof value.ExecutablePath === "string" ? value.ExecutablePath : "",
        workingSetBytes: Number(value.WorkingSetSize ?? 0) || 0,
      });
    }
    return processes;
  } catch (error) {
    console.error("[launch] detailed process snapshot failed:", error);
    return [];
  }
}

/** `true` when the PID's current image name matches `expectedExe`'s name. */
export function processNameMatches(process: ProcessInfo, expectedExe: string): boolean {
  const expectedName = baseNameLower(expectedExe);
  if (!expectedName) return true;
  return process.name.toLowerCase() === expectedName;
}

/**
 * PID-recycling guard: the PID must still resolve to the tracked executable.
 * Compares the full path when the OS reports it, otherwise the image name.
 */
export async function pidMatchesExe(pid: number, expectedExe: string): Promise<boolean> {
  if (pid <= 0) return false;
  const expectedNorm = normalizePathLower(expectedExe);
  const details = await resolveProcessDetails([pid]);
  const detail = details.get(pid);
  if (detail?.exePath) {
    return expectedNorm !== "" && normalizePathLower(detail.exePath) === expectedNorm;
  }
  const snapshot = await listProcessBase();
  const process = snapshot.find((entry) => entry.pid === pid);
  if (!process) return false;
  return processNameMatches(process, expectedExe);
}

async function killPidWindows(pid: number): Promise<boolean> {
  try {
    await runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"], 15_000);
    return true;
  } catch (error) {
    console.error(`[launch] taskkill ${pid} failed:`, error);
    return false;
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Terminate one PID (and, on Windows, its children). */
export async function killProcessTree(pid: number): Promise<boolean> {
  if (pid <= 0) return false;
  if (IS_WINDOWS) return killPidWindows(pid);
  if (!signalPid(pid, "SIGTERM")) return false;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  signalPid(pid, "SIGKILL");
  return true;
}

/**
 * Terminate every running process that is the tracked executable, additionally
 * confined to the install tree when one is known.
 *
 * Used for pending launches (no PID — Steam/Uplay hand-off) and as a backstop
 * after the tracked PID died. Only processes whose *path* we could verify are
 * killed; an unverifiable candidate is left alone (mirrors the Rust
 * `kill_matching_processes` safety rail).
 */
export async function killMatchingProcesses(
  expectedExe: string,
  installDir: string | null,
): Promise<boolean> {
  const expectedName = baseNameLower(expectedExe);
  const dirNorm = installDir ? trimPathSeparators(normalizePathLower(installDir)) : "";
  if (!expectedName && !dirNorm) return false;

  const base = await listProcessBase();
  const candidates = base.filter((entry) => {
    if (isSkipName(entry.name)) return false;
    if (expectedName) return entry.name.toLowerCase() === expectedName;
    return true;
  });
  if (candidates.length === 0) return false;

  const details = await resolveProcessDetails(candidates.map((entry) => entry.pid));
  let killed = false;
  for (const candidate of candidates) {
    const path = details.get(candidate.pid)?.exePath ?? "";
    if (!path) continue;
    const pathNorm = normalizePathLower(path);
    const pathName = baseNameLower(path);
    if (expectedName && pathName !== expectedName) continue;
    if (dirNorm && !isInsideDir(pathNorm, dirNorm)) continue;
    if (await killProcessTree(candidate.pid)) killed = true;
  }
  return killed;
}

/** Read-only `(pid, exe path)` snapshot for the overlay's current-game probe. */
export async function snapshotProcesses(): Promise<Array<{ pid: number; exePath: string }>> {
  return (await listProcessBase()).map((entry) => ({ pid: entry.pid, exePath: entry.exePath }));
}
