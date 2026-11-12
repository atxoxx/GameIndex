/**
 * Pre-launch / post-exit scripts and companion apps.
 *
 * Ported from `src-tauri/src/launcher.rs` (`run_script_blocking`,
 * `program_command`, `spawn_companion`, `split_launch_args`), but *awaited* on
 * the Node event loop instead of blocking a thread: Windows' `CreateProcess`
 * cannot execute `.bat`/`.ps1` directly, so those are routed through their
 * interpreter exactly like the Rust helper did.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CompanionApp } from "./types";

const IS_WINDOWS = process.platform === "win32";

/**
 * Split a launch-argument string the way a POSIX shell would: quotes group
 * words and a backslash escapes the next character. Falls back to plain
 * whitespace splitting when the string is malformed (an unbalanced quote can
 * never block a launch).
 */
export function splitLaunchArgs(args: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < args.length) {
        current += args[i + 1];
        i += 1;
      } else {
        current += ch;
      }
      hasToken = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === "\\" && i + 1 < args.length) {
      current += args[i + 1];
      i += 1;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        out.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote !== null) {
    // Unbalanced quote: the shell would reject it, so use the dumb fallback.
    return args.trim() ? args.trim().split(/\s+/) : [];
  }
  if (hasToken) out.push(current);
  return out;
}

/** A `ChildProcess` description that can actually execute `target`. */
export function programCommand(target: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    const ext = path.extname(target).toLowerCase();
    if (ext === ".bat" || ext === ".cmd") {
      return { file: "cmd.exe", args: ["/C", target] };
    }
    if (ext === ".ps1") {
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", target],
      };
    }
  }
  return { file: target, args: [] };
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}

/** Run a script to completion. `admin` elevates via PowerShell `RunAs`. */
export async function runScriptBlocking(script: string, admin: boolean): Promise<void> {
  if (!script.trim()) return;

  if (admin && IS_WINDOWS) {
    const escaped = script.replace(/'/g, "''");
    const command =
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
      `Start-Process -FilePath '${escaped}' -Verb RunAs -Wait -WindowStyle Hidden`;
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true,
      stdio: "ignore",
    });
    let code: number | null;
    try {
      code = await waitForExit(child);
    } catch (error) {
      throw new Error(
        `Failed to run elevated script ${script}: ${describeError(error)}`,
      );
    }
    if (code !== 0) {
      throw new Error(`Elevated script ${script} exited with status ${code ?? "?"}`);
    }
    return;
  }

  if (admin) {
    throw new Error("Running a script as administrator is only supported on Windows");
  }

  if (!fs.existsSync(script)) {
    throw new Error(`Failed to run script ${script}: the file does not exist`);
  }

  const { file, args } = programCommand(script);
  const child = spawn(file, args, {
    windowsHide: true,
    stdio: "ignore",
    windowsVerbatimArguments: false,
  });
  let code: number | null;
  try {
    code = await waitForExit(child);
  } catch (error) {
    throw new Error(`Failed to run script ${script}: ${describeError(error)}`);
  }
  if (code !== 0) {
    throw new Error(`Script ${script} exited with status ${code ?? "?"}`);
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Launch a companion executable fire-and-forget (delayed when configured).
 * Not tracked by the watcher, mirroring `spawn_companion`.
 */
export function spawnCompanion(app: CompanionApp): void {
  const target = app.path?.trim();
  if (!target) return;
  const delay = Number.isFinite(app.delayMs) ? Math.max(0, app.delayMs) : 0;

  const launch = () => {
    try {
      if (app.runAsAdmin && IS_WINDOWS) {
        const escaped = target.replace(/'/g, "''");
        let command =
          `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ` +
          `Start-Process -FilePath '${escaped}' -Verb RunAs -WindowStyle Hidden`;
        if (app.arguments && app.arguments.trim()) {
          command += ` -ArgumentList '${app.arguments.replace(/'/g, "''")}'`;
        }
        const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
          windowsHide: true,
          stdio: "ignore",
          detached: true,
        });
        child.on("error", (error) => {
          console.error(`[launch] companion ${target} failed:`, error);
        });
        child.unref();
        return;
      }

      const { file, args } = programCommand(target);
      const extraArgs = app.arguments?.trim() ? splitLaunchArgs(app.arguments) : [];
      const child = spawn(file, [...args, ...extraArgs], {
        windowsHide: true,
        stdio: "ignore",
        detached: true,
      });
      child.on("error", (error) => {
        console.error(`[launch] companion ${target} failed:`, error);
      });
      child.unref();
    } catch (error) {
      console.error(`[launch] companion ${target} failed:`, error);
    }
  };

  if (delay === 0) {
    launch();
    return;
  }
  const timer = setTimeout(launch, delay);
  timer.unref?.();
}
