/**
 * FPS from RivaTuner Statistics Server's shared memory.
 *
 * Node cannot map `RTSSSharedMemoryV2` directly, so one long-lived PowerShell
 * helper (C# `MemoryMappedFile` P/Invoke-free API) reads the section once per
 * second and prints one line per hooked application:
 *
 *   A|<pid>|<exe name>|<min>/<avg>/<max>      (FPS triplet, empty = no stats)
 *   T|<unix ms>|<app count>                   (one per tick, ends the batch)
 *
 * The helper is only started when `RTSS.exe` is actually running, is restarted
 * when it dies, and is killed on quit. Without RTSS — or when the game is not
 * hooked yet — FPS stays `null`; a zero is never fabricated.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { capture, IS_WINDOWS, powershellArgs } from "./proc";

const SECTION_NAME = "RTSSSharedMemoryV2";
const RTSS_STALE_MS = 5_000;
const HELPER_SILENT_RESTART_MS = 15_000;
const SPAWN_BACKOFF_MS = 10_000;
const PRESENCE_CHECK_MS = 20_000;
const PRESENCE_RETRY_MS = 30_000;

export interface RtssLookup {
  fps: number;
  min: number | null;
  max: number | null;
  /** Application name RTSS reports (usually the full exe path). */
  app: string;
  /** Base-name form of `app`, used for exe-name matching. */
  name: string;
  pid: number;
}

export interface RtssEntry extends RtssLookup {
  at: number;
}

function exeNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function toNumber(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1000) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Incremental parser for the helper's stdout. Exported so the harness can feed
 * synthetic/captured batches without launching a process.
 */
export function createRtssParser(): {
  push: (chunk: string, now?: number) => void;
  lookup: (exePath: string, pid: number, now?: number) => RtssLookup | null;
  entries: () => RtssEntry[];
  lastTickAt: () => number;
} {
  let buffer = "";
  let batch: RtssEntry[] = [];
  const byPid = new Map<number, RtssEntry>();
  let lastTick = 0;

  const commit = (now: number): void => {
    byPid.clear();
    for (const entry of batch) byPid.set(entry.pid, { ...entry, at: now });
    batch = [];
    lastTick = now;
  };

  const push = (chunk: string, now = Date.now()): void => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (line.startsWith("A|")) {
        const parts = line.split("|");
        const pid = Number.parseInt(parts[1] ?? "", 10);
        const name = (parts[2] ?? "").trim();
        if (!Number.isFinite(pid) || pid <= 0 || !name) continue;
        const triplet = (parts[3] ?? "").split("/");
        const min = triplet.length === 3 ? toNumber(triplet[0]) : null;
        const avg = triplet.length === 3 ? toNumber(triplet[1]) : null;
        const max = triplet.length === 3 ? toNumber(triplet[2]) : null;
        if (avg === null) {
          // The app is hooked but its stat window is not ready yet. Keep the
          // entry so a previous stale value cannot be replayed for it.
          batch.push({ pid, name, fps: Number.NaN, min: null, max: null, app: name, at: now });
          continue;
        }
        batch.push({ pid, name, fps: avg, min, max, app: name, at: now });
      } else if (line.startsWith("T|")) {
        commit(now);
      }
    }
  };

  const lookup = (exePath: string, pid: number, now = Date.now()): RtssLookup | null => {
    const fresh = (entry: RtssEntry | undefined): entry is RtssEntry =>
      !!entry && now - entry.at <= RTSS_STALE_MS && Number.isFinite(entry.fps) && entry.fps > 0;

    const direct = pid > 0 ? byPid.get(pid) : undefined;
    if (fresh(direct)) return direct;

    const wanted = exeNameOf(exePath);
    if (!wanted) return null;
    for (const entry of byPid.values()) {
      if (!fresh(entry)) continue;
      const name = exeNameOf(entry.name);
      if (name === wanted || entry.name.toLowerCase() === wanted) return entry;
    }
    return null;
  };

  return {
    push,
    lookup,
    entries: () => [...byPid.values()].filter((entry) => Number.isFinite(entry.fps)),
    lastTickAt: () => lastTick,
  };
}

/**
 * The PowerShell program that maps RTSS shared memory and prints one batch per
 * second. `sectionName` is injectable so the harness can point it at a
 * synthetic mapping; production always uses the default.
 */
export function buildRtssHelperScript(sectionName = SECTION_NAME): string {
  const section = sectionName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const csharp = `
using System;
using System.Globalization;
using System.IO.MemoryMappedFiles;
using System.Text;
using System.Threading;

public static class GameIndexRtssProbe
{
    private const string SectionName = "${section}";

    public static void Run()
    {
        MemoryMappedFile mmf = null;
        MemoryMappedViewAccessor view = null;
        int failures = 0;
        while (true)
        {
            if (view == null)
            {
                try
                {
                    mmf = MemoryMappedFile.OpenExisting(SectionName, MemoryMappedFileRights.Read);
                    view = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
                    failures = 0;
                }
                catch
                {
                    failures++;
                    mmf = null;
                    view = null;
                    if (failures >= 30) return;
                    Thread.Sleep(1000);
                    continue;
                }
            }

            string output = null;
            try
            {
                output = Read(view);
            }
            catch
            {
                output = null;
                view = null;
                mmf = null;
                failures++;
                if (failures >= 30) return;
            }
            if (output != null)
            {
                Console.WriteLine(output);
                Console.Out.Flush();
            }
            Thread.Sleep(1000);
        }
    }

    private static string Read(MemoryMappedViewAccessor view)
    {
        uint signature = view.ReadUInt32(0);
        // RTSS stores 'RTSS' as the integer 0x52545353. Some builds/readers
        // expose the byte-swapped form; accept both instead of going silent.
        if (signature != 0x52545353u && signature != 0x53535452u) return null;

        uint appArrOffset = view.ReadUInt32(8);
        uint appArrSize = view.ReadUInt32(12);
        uint appEntrySize = view.ReadUInt32(16);
        if (appArrOffset == 0 || appArrOffset > 0x40000u) return null;
        if (appEntrySize < 0x100u || appEntrySize > 0x800u) return null;
        if (appArrSize == 0 || appArrSize > 0x400000u) return null;

        long maxEntries = appArrSize / appEntrySize;
        if (maxEntries > 256) maxEntries = 256;

        StringBuilder builder = new StringBuilder();
        int entries = 0;
        for (long i = 0; i < maxEntries; i++)
        {
            long entry = (long)appArrOffset + i * (long)appEntrySize;
            uint pid;
            try { pid = view.ReadUInt32(entry); } catch { break; }
            if (pid == 0) continue;

            byte[] nameBytes = new byte[260];
            try { view.ReadArray(entry + 4, nameBytes, 0, 260); } catch { break; }
            int length = Array.IndexOf(nameBytes, (byte)0);
            if (length < 0) length = 260;
            string name = Encoding.UTF8.GetString(nameBytes, 0, length).Replace('|', '/').Trim();
            if (name.Length == 0) continue;

            string fps = "";
            uint min;
            uint avg;
            uint max;
            if (ReadStat(view, entry, 0x1BC, out min, out avg, out max)
                || ReadStat(view, entry, 0x1C0, out min, out avg, out max)
                || ReadStat(view, entry, 0x1E0, out min, out avg, out max))
            {
                fps = (min / 100.0).ToString("F2", CultureInfo.InvariantCulture) + "/"
                    + (avg / 100.0).ToString("F2", CultureInfo.InvariantCulture) + "/"
                    + (max / 100.0).ToString("F2", CultureInfo.InvariantCulture);
            }
            builder.Append("A|").Append(pid).Append('|').Append(name).Append('|').Append(fps).Append('\\n');
            entries++;
        }
        builder.Append("T|").Append(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()).Append('|').Append(entries);
        return builder.ToString();
    }

    private static bool ReadStat(MemoryMappedViewAccessor view, long entry, long offset, out uint min, out uint avg, out uint max)
    {
        min = 0;
        avg = 0;
        max = 0;
        try
        {
            min = view.ReadUInt32(entry + offset);
            avg = view.ReadUInt32(entry + offset + 4);
            max = view.ReadUInt32(entry + offset + 8);
        }
        catch
        {
            return false;
        }
        double mn = min / 100.0;
        double av = avg / 100.0;
        double mx = max / 100.0;
        return mn > 0 && av > 0 && mx > 0
            && mn <= 500 && av <= 500 && mx <= 500
            && mn <= av && av <= mx;
    }
}
`;

  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -TypeDefinition @'",
    csharp.trim(),
    "'@",
    "[GameIndexRtssProbe]::Run()",
  ].join("\n");
}

// ── Helper lifecycle ────────────────────────────────────────────────────────

const parser = createRtssParser();

let helper: ChildProcess | null = null;
let helperSpawnedAt = 0;
let lastOutputAt = 0;
let lastSpawnAttemptAt = 0;
let lastExitAt = 0;
let presenceCheckAt = 0;
let presenceCheckInFlight = false;
let rtssSeen = false;
let stopped = true;

function killHelper(): void {
  const child = helper;
  helper = null;
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  lastExitAt = Date.now();
}

function spawnHelper(): void {
  if (helper) return;
  const script = buildRtssHelperScript();
  let child: ChildProcess;
  try {
    child = spawn("powershell.exe", powershellArgs(script), {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    lastExitAt = Date.now();
    return;
  }
  helper = child;
  helperSpawnedAt = Date.now();
  lastOutputAt = helperSpawnedAt;
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    lastOutputAt = Date.now();
    parser.push(chunk);
  });
  child.on("error", () => {
    if (helper === child) helper = null;
    lastExitAt = Date.now();
  });
  child.on("close", () => {
    if (helper === child) helper = null;
    lastExitAt = Date.now();
  });
  // Never let the probe keep the app (or a harness) alive on its own.
  child.unref();
}

async function checkRtssProcess(now: number): Promise<void> {
  if (presenceCheckInFlight) return;
  if (now - presenceCheckAt < (rtssSeen ? PRESENCE_CHECK_MS : PRESENCE_RETRY_MS)) return;
  presenceCheckAt = now;
  presenceCheckInFlight = true;
  try {
    const result = await capture(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq RTSS.exe", "/FO", "CSV", "/NH"],
      8_000,
    );
    rtssSeen = /rtss\.exe/i.test(result.stdout);
  } catch {
    rtssSeen = false;
  } finally {
    presenceCheckInFlight = false;
  }
  if (rtssSeen && !helper && !stopped) spawnHelper();
}

/**
 * Ensure the FPS source is running. Cheap to call every sample: the presence
 * check is throttled and the spawn is one-shot.
 */
export function ensureRtssHelper(now = Date.now()): void {
  if (!IS_WINDOWS || stopped) return;
  if (helper) {
    if (now - lastOutputAt > HELPER_SILENT_RESTART_MS) {
      // Hung helper (RTSS restarted, mapping invalid): kill and let the next
      // tick respawn it after the backoff.
      killHelper();
    }
    return;
  }
  if (now - lastSpawnAttemptAt < SPAWN_BACKOFF_MS) return;
  if (now - lastExitAt < HELPER_SILENT_RESTART_MS) return;
  lastSpawnAttemptAt = now;
  void checkRtssProcess(now);
}

/** Called when a session attaches. */
export function startRtssHelper(): void {
  stopped = false;
  ensureRtssHelper();
}

/** Called on app quit — the helper must not outlive the app. */
export function stopRtssHelper(): void {
  stopped = true;
  parser.push("T|0|0\n");
  killHelper();
}

/** Latest FPS for a game process, or null when RTSS has no fresh reading. */
export function lookupRtssFps(
  exePath: string,
  pid: number,
  now = Date.now(),
): RtssLookup | null {
  return parser.lookup(exePath, pid, now);
}

export function rtssDiagnostics(): {
  helperRunning: boolean;
  helperPid: number | null;
  helperSpawnedAt: number;
  rtssProcessSeen: boolean;
  lastOutputAt: number;
  apps: RtssEntry[];
} {
  return {
    helperRunning: helper !== null,
    helperPid: helper?.pid ?? null,
    helperSpawnedAt,
    rtssProcessSeen: rtssSeen,
    lastOutputAt,
    apps: parser.entries(),
  };
}
