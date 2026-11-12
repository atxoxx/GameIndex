/**
 * Tiny process helpers for the telemetry sources.
 *
 * Every probe here is an external Windows binary (`typeperf`, `tasklist`,
 * `powershell.exe`). They must never block the watcher: each call is
 * short-lived, bounded by a timeout, and the long-running RTSS helper is
 * spawned `unref`'d so it cannot keep the app alive on its own.
 */
import { spawn } from "node:child_process";
import path from "node:path";

export const IS_WINDOWS = process.platform === "win32";

/**
 * Where the compiled C# probes are cached.
 *
 * PowerShell's `Add-Type` compiles the probe on every launch (1–3 s). Writing
 * the assembly once and loading it with `Add-Type -Path` afterwards makes a
 * warm start ~100 ms. The file name carries a version so a probe change does
 * not load a stale assembly.
 */
export function probeDllPath(kind: "rtss" | "mahm"): string | undefined {
  const base = process.env.APPDATA ?? process.env.LOCALAPPDATA;
  if (!base) return undefined;
  return path.join(base, "GameIndex", "telemetry", `${kind}-probe-v2.dll`);
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError: string | null;
}

/**
 * Run a command, collect stdout/stderr and hard-kill it after `timeoutMs`.
 * Never throws: a missing binary or a timeout comes back as a result.
 */
export function capture(
  file: string,
  args: string[],
  timeoutMs: number,
  maxBytes = 8 * 1024 * 1024,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (code: number | null, spawnError: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve({ code, stdout, stderr, timedOut, spawnError });
    };

    const child = spawn(file, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < maxBytes) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish(null, null);
    }, Math.max(500, timeoutMs));
    timer.unref?.();

    child.on("error", (error) => finish(null, error.message));
    child.on("close", (code) => finish(code, null));
  });
}

/**
 * PowerShell argv for a self-contained script. UTF-16LE base64 keeps quotes,
 * `$` and newlines out of the Windows command line entirely, so no syntax can
 * be mangled by the shell.
 */
export function powershellArgs(script: string): string[] {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encoded,
  ];
}

/** Run a PowerShell script and return its stdout (empty string on failure). */
export async function runPowerShell(script: string, timeoutMs: number): Promise<CaptureResult> {
  if (!IS_WINDOWS) {
    return { code: null, stdout: "", stderr: "", timedOut: false, spawnError: "not windows" };
  }
  return capture("powershell.exe", powershellArgs(script), timeoutMs);
}
