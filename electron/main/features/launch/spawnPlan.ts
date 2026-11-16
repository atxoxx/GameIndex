import path from "node:path";

import { splitLaunchArgs } from "./scripts";

const IS_WINDOWS = process.platform === "win32";

export interface SpawnPlan {
  file: string;
  args: string[];
  verbatim: boolean;
}

function quoteForVerbatim(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

/** Build the argv for `spawn` (scripts are routed through their interpreter). */
export function buildSpawnArgs(exePath: string): { file: string; args: string[] } {
  if (IS_WINDOWS) {
    const ext = path.extname(exePath).toLowerCase();
    if (ext === ".bat" || ext === ".cmd") {
      return { file: "cmd.exe", args: ["/C", quoteForVerbatim(exePath)] };
    }
    if (ext === ".ps1") {
      return {
        file: "powershell.exe",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", quoteForVerbatim(exePath)],
      };
    }
  }
  return { file: exePath, args: [] };
}

/**
 * Resolve how to spawn an executable.
 *
 * libuv builds a verbatim Windows command line without quoting the application
 * path, so an exe under a folder with a space (`...\beaming data\...`) splits
 * there and the tail leaks into the child's argv. That breaks launchers which
 * parse their arguments (BeamNG.Earth's `earthd` exits 2 on the stray token).
 * Verbatim is only safe when the application path has no whitespace; otherwise
 * split the arguments ourselves and let Node quote every token.
 */
export function buildSpawnPlan(
  exePath: string,
  launchArguments: string | null,
): SpawnPlan {
  const { file, args } = buildSpawnArgs(exePath);
  const verbatim = IS_WINDOWS && !/\s/.test(file);
  const spawnArgs = [...args];
  if (launchArguments) {
    if (IS_WINDOWS && verbatim) {
      // A raw argument string, exactly like Rust's `raw_arg`: the OS parses it.
      spawnArgs.push(launchArguments);
    } else {
      spawnArgs.push(...splitLaunchArgs(launchArguments));
    }
  }
  return { file, args: spawnArgs, verbatim };
}
