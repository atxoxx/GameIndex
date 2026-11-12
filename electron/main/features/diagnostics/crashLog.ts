/**
 * Crash log + breadcrumb ring buffer.
 *
 * The Rust backend kept a rolling `gameindex.log` plus one file per frontend
 * crash. The Diagnostics tab reads both, so the shapes here match
 * `src/pages/settings/DiagnosticsTab.tsx` exactly.
 *
 * Everything is best-effort: a failure to write diagnostics must never throw
 * into a command handler that the UI calls on boot.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDir, userDataPath } from "../../lib/paths";

const LOG_NAME = "gameindex.log";
const REPORT_DIR = "reports";
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_REPORTS = 25;

export interface CrashReportInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface CrashLogStatus {
  dir: string;
  logPath: string;
  logSizeBytes: number;
  logModifiedAt: number;
  hasLog: boolean;
  reports: CrashReportInfo[];
}

export function crashDir(): string {
  return ensureDir(userDataPath("crashlog"));
}

function logPath(): string {
  return path.join(crashDir(), LOG_NAME);
}

function reportsDir(): string {
  return ensureDir(path.join(crashDir(), REPORT_DIR));
}

/** ISO timestamp with milliseconds, matching the Rust log lines. */
function stamp(): string {
  return new Date().toISOString();
}

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(logPath());
    if (stat.size <= MAX_LOG_BYTES) return;
    fs.renameSync(logPath(), `${logPath()}.1`);
  } catch {
    /* no log yet */
  }
}

export function appendLine(line: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(logPath(), `${line}\n`, "utf8");
  } catch (error) {
    console.error("[crashlog] append failed:", error);
  }
}

export function recordBreadcrumb(area: unknown, message: unknown): void {
  const tag = typeof area === "string" && area ? area : "app";
  appendLine(`[${stamp()}] [breadcrumb:${tag}] ${String(message ?? "")}`);
}

function safeReportName(value: unknown): string {
  const base = path.basename(String(value ?? ""));
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : `crash-${Date.now()}.txt`;
}

function pruneReports(): void {
  try {
    const files = fs
      .readdirSync(reportsDir())
      .filter((name) => name.endsWith(".txt"))
      .map((name) => {
        const full = path.join(reportsDir(), name);
        return { name, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const stale of files.slice(MAX_REPORTS)) {
      fs.rmSync(path.join(reportsDir(), stale.name), { force: true });
    }
  } catch {
    /* ignore */
  }
}

export interface CrashRecordInput {
  kind?: string;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  extra?: string | null;
  context?: string | null;
  [key: string]: unknown;
}

/** Persist one frontend crash report and return its file name. */
export function recordCrash(input: CrashRecordInput): string {
  const now = new Date();
  const name = `crash-${now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")}-${Math.random().toString(36).slice(2, 7)}.txt`;
  const lines = [
    "GameIndex crash report",
    `time: ${now.toISOString()}`,
    `kind: ${input.kind ?? "unknown"}`,
    `message: ${input.message}`,
    input.componentStack ? `componentStack:\n${input.componentStack}` : "",
    input.stack ? `stack:\n${input.stack}` : "",
    input.extra ? `extra:\n${input.extra}` : "",
    input.context ? `context:\n${input.context}` : "",
  ].filter(Boolean);
  try {
    fs.writeFileSync(path.join(reportsDir(), name), `${lines.join("\n")}\n`, "utf8");
    appendLine(`[${stamp()}] [crash:${input.kind ?? "unknown"}] ${input.message}`);
    pruneReports();
  } catch (error) {
    console.error("[crashlog] failed to write report:", error);
  }
  return name;
}

export function readCrashLog(name?: unknown): string {
  const file = typeof name === "string" && name.trim()
    ? path.join(reportsDir(), safeReportName(name))
    : logPath();
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function clearCrashLog(): void {
  try {
    fs.writeFileSync(logPath(), "", "utf8");
  } catch (error) {
    console.error("[crashlog] failed to clear log:", error);
  }
}

export function deleteCrashReport(name: unknown): boolean {
  const file = path.join(reportsDir(), safeReportName(name));
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function crashLogStatus(): CrashLogStatus {
  const log = logPath();
  let size = 0;
  let modified = 0;
  try {
    const stat = fs.statSync(log);
    size = stat.size;
    modified = stat.mtimeMs;
  } catch {
    /* no log */
  }

  const reports: CrashReportInfo[] = [];
  try {
    for (const name of fs.readdirSync(reportsDir())) {
      if (!name.endsWith(".txt")) continue;
      const full = path.join(reportsDir(), name);
      try {
        const stat = fs.statSync(full);
        reports.push({
          name,
          path: full,
          sizeBytes: stat.size,
          modifiedAt: stat.mtimeMs,
        });
      } catch {
        /* vanished mid-scan */
      }
    }
  } catch {
    /* no reports yet */
  }

  return {
    dir: crashDir(),
    logPath: log,
    logSizeBytes: size,
    logModifiedAt: modified,
    hasLog: size > 0,
    reports: reports.sort((a, b) => b.modifiedAt - a.modifiedAt),
  };
}
