/**
 * MSI Afterburner hardware monitor (MAHM) shared memory.
 *
 * This is the source the Tauri build used for **CPU temperature**: RTSS (which
 * is installed alongside Afterburner) only publishes FPS, while Afterburner's
 * `MAHMSharedMemory` section carries CPU/GPU temperature, usage, clocks, power
 * and the frame rate. If neither Afterburner nor LibreHardwareMonitor runs,
 * CPU temperature has no user-mode source at all and stays `null`.
 *
 * Reading the section needs a memory-mapped view, which Node cannot create
 * without native code, so a persistent PowerShell/C# probe reads it once per
 * second and prints one JSON line. The probe only starts when
 * `MSIAfterburner.exe` is running and exits on its own after repeated failures.
 *
 * Layout reference: the MAHM SDK header (`MAHM_SHARED_MEMORY_HEADER`,
 * `MAHM_SHARED_MEMORY_ENTRY`) and the retired `mahm_reader.rs`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { capture, IS_WINDOWS, powershellArgs } from "./proc";

const SECTION_NAME = "MAHMSharedMemory";
const STALE_MS = 5_000;
const SPAWN_BACKOFF_MS = 10_000;
const SILENT_RESTART_MS = 20_000;
const PRESENCE_RETRY_MS = 20_000;
const PRESENCE_CHECK_MS = 60_000;

export interface MahmReadout {
  cpuTempC: number | null;
  cpuUsage: number | null;
  gpuTempC: number | null;
  gpuUsage: number | null;
  ramUsage: number | null;
  fps: number | null;
  vramUsedMb: number | null;
  gpuPowerW: number | null;
  cpuPowerW: number | null;
  gpuClockMhz: number | null;
  at: number;
}

const EMPTY: MahmReadout = {
  cpuTempC: null,
  cpuUsage: null,
  gpuTempC: null,
  gpuUsage: null,
  ramUsage: null,
  fps: null,
  vramUsedMb: null,
  gpuPowerW: null,
  cpuPowerW: null,
  gpuClockMhz: null,
  at: 0,
};

let latest: MahmReadout = { ...EMPTY };
let helper: ChildProcess | null = null;
let stopped = false;
let lastOutputAt = 0;
let lastSpawnAttemptAt = 0;
let lastExitAt = 0;
let presenceCheckAt = 0;
let presenceCheckInFlight = false;
let afterburnerSeen = false;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse one helper line (`M|{json}`); exported for harnesses. */
export function parseMahmLine(line: string, now = Date.now()): MahmReadout | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("M|")) return null;
  const payload = trimmed.slice(2);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      cpuTempC: num(parsed.cpuTemp),
      cpuUsage: num(parsed.cpuUsage),
      gpuTempC: num(parsed.gpuTemp),
      gpuUsage: num(parsed.gpuUsage),
      ramUsage: num(parsed.ramUsage),
      fps: num(parsed.fps),
      vramUsedMb: num(parsed.vramUsedMb),
      gpuPowerW: num(parsed.gpuPowerW),
      cpuPowerW: num(parsed.cpuPowerW),
      gpuClockMhz: num(parsed.gpuClockMhz),
      at: now,
    };
  } catch {
    return null;
  }
}

function onLine(line: string): void {
  const readout = parseMahmLine(line);
  if (!readout) return;
  latest = readout;
  lastOutputAt = Date.now();
}

/** PowerShell program: one JSON line per second while Afterburner runs. */
export function buildMahmHelperScript(sectionName = SECTION_NAME): string {
  const section = sectionName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const csharp = `
using System;
using System.Globalization;
using System.IO.MemoryMappedFiles;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class GameIndexMahmProbe
{
    private const string SectionName = "${section}";

    public static void Run()
    {
        int failures = 0;
        while (true)
        {
            MemoryMappedFile mmf = null;
            MemoryMappedViewAccessor view = null;
            try
            {
                mmf = MemoryMappedFile.OpenExisting(SectionName, MemoryMappedFileRights.Read);
                view = mmf.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            }
            catch
            {
                failures++;
                Thread.Sleep(2000);
                if (failures >= 30) return;
                continue;
            }

            try
            {
                string output = Read(view);
                if (output != null)
                {
                    Console.WriteLine(output);
                    Console.Out.Flush();
                    failures = 0;
                }
            }
            catch
            {
                failures++;
            }
            finally
            {
                if (view != null) view.Dispose();
                if (mmf != null) mmf.Dispose();
            }
            Thread.Sleep(1000);
            if (failures >= 30) return;
        }
    }

    private static string ReadStr(MemoryMappedViewAccessor view, long offset, int length)
    {
        byte[] buffer = new byte[length];
        view.ReadArray(offset, buffer, 0, length);
        int end = Array.IndexOf(buffer, (byte)0);
        if (end < 0) end = length;
        return Encoding.UTF8.GetString(buffer, 0, end).Trim();
    }

    private static string Read(MemoryMappedViewAccessor view)
    {
        uint signature = view.ReadUInt32(0);
        if (signature != 0x4D41484Du) return null;

        uint headerSize = view.ReadUInt32(8);
        uint entryCount = view.ReadUInt32(12);
        uint entrySize = view.ReadUInt32(16);
        if (headerSize == 0 || headerSize > 0x1000u) return null;
        if (entrySize < 0x100u || entrySize > 0x2000u) return null;
        if (entryCount == 0 || entryCount > 4096u) return null;

        long dataOffset = entrySize >= 640u ? 1300 : 544;
        float? cpuTemp = null, cpuUsage = null, gpuTemp = null, gpuUsage = null;
        float? ramUsage = null, fps = null, vramUsed = null, gpuPower = null;
        float? cpuPower = null, gpuClock = null;

        for (uint i = 0; i < entryCount; i++)
        {
            long entry = (long)headerSize + (long)i * (long)entrySize;
            if (entry + dataOffset + 4 > view.Capacity) break;
            string name = ReadStr(view, entry, 260);
            if (name.Length == 0) continue;
            string units = ReadStr(view, entry + 260, 260);
            float data = view.ReadSingle(entry + dataOffset);
            if (float.IsNaN(data) || float.IsInfinity(data) || data < 0f) continue;
            string n = name.ToLowerInvariant();
            string u = units.ToLowerInvariant();

            if (n == "cpu usage" || n == "cpu load")
            {
                if (cpuUsage == null) cpuUsage = data;
            }
            else if (n == "cpu temperature" || n == "cpu temp" || n == "cpu1 temperature")
            {
                if (cpuTemp == null) cpuTemp = data;
            }
            else if (Regex.IsMatch(n, @"^gpu\\s*\\d*\\s*(usage|load)$"))
            {
                if (gpuUsage == null) gpuUsage = data;
            }
            else if (Regex.IsMatch(n, @"^gpu\\s*\\d*\\s*(temperature|temp)$"))
            {
                if (gpuTemp == null) gpuTemp = data;
            }
            else if (n == "ram usage")
            {
                if (ramUsage == null && (u == "%" || u.Length == 0)) ramUsage = data;
            }
            else if (n == "framerate" || n == "fps")
            {
                if (fps == null && data > 0f && data <= 500f) fps = data;
            }
            else if (Regex.IsMatch(n, @"^gpu\\s*\\d*\\s*(memory usage|vram usage)$"))
            {
                if (vramUsed == null && data > 0f && data <= 1048576f) vramUsed = data;
            }
            else if (Regex.IsMatch(n, @"^gpu\\s*\\d*\\s*power$") && u.Contains("w"))
            {
                if (gpuPower == null && data > 0f && data <= 2000f) gpuPower = data;
            }
            else if ((n == "cpu power" || n == "cpu package power") && u.Contains("w"))
            {
                if (cpuPower == null && data > 0f && data <= 2000f) cpuPower = data;
            }
            else if (Regex.IsMatch(n, @"^gpu\\s*\\d*\\s*(core clock|clock)$") && u.Contains("mhz"))
            {
                if (gpuClock == null && data > 0f && data <= 20000f) gpuClock = data;
            }
        }

        StringBuilder sb = new StringBuilder();
        sb.Append("M|{");
        AppendNum(sb, "cpuTemp", cpuTemp);
        AppendNum(sb, "cpuUsage", cpuUsage);
        AppendNum(sb, "gpuTemp", gpuTemp);
        AppendNum(sb, "gpuUsage", gpuUsage);
        AppendNum(sb, "ramUsage", ramUsage);
        AppendNum(sb, "fps", fps);
        AppendNum(sb, "vramUsedMb", vramUsed);
        AppendNum(sb, "gpuPowerW", gpuPower);
        AppendNum(sb, "cpuPowerW", cpuPower);
        AppendNum(sb, "gpuClockMhz", gpuClock);
        sb.Append("}");
        return sb.ToString().Replace(",}", "}");
    }

    private static void AppendNum(StringBuilder sb, string key, float? value)
    {
        sb.Append('"').Append(key).Append("\\":");
        if (value == null) sb.Append("null");
        else sb.Append(((float)value).ToString("0.##", CultureInfo.InvariantCulture));
        sb.Append(',');
    }
}
`;
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    csharp.trim(),
    "'@",
    "[GameIndexMahmProbe]::Run()",
  ].join("\n");
}

function killHelper(): void {
  if (!helper) return;
  try {
    helper.kill();
  } catch {
    /* already gone */
  }
  helper = null;
}

function spawnHelper(): void {
  if (helper || stopped) return;
  const child = spawn("powershell.exe", powershellArgs(buildMahmHelperScript()), {
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  helper = child;
  // Grace window: the watchdog must not kill a helper that is still compiling
  // its C# probe (1-3 s) before it has produced its first line.
  lastOutputAt = Date.now();
  child.stderr?.setEncoding("utf8");
  let stderr = "";
  child.stderr?.on("data", (chunk: string) => {
    if (stderr.length > 4096) return;
    stderr += chunk;
    if (stderr.length >= 4096) {
      console.error("[mahm] helper stderr:", stderr.slice(0, 2000));
    }
  });
  child.stdout?.setEncoding("utf8");
  let buffer = "";
  child.stdout?.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 64 * 1024) buffer = buffer.slice(-32 * 1024);
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      onLine(line);
      index = buffer.indexOf("\n");
    }
  });
  child.on("error", (error) => {
    console.error("[mahm] helper spawn failed:", error.message);
    if (helper === child) helper = null;
    lastExitAt = Date.now();
  });
  child.on("close", (code) => {
    if (helper === child) helper = null;
    lastExitAt = Date.now();
    if (code !== 0 && stderr) {
      console.error("[mahm] helper exited:", code, stderr.slice(0, 1200));
    }
  });
  child.unref();
}

async function checkAfterburner(now: number): Promise<void> {
  if (presenceCheckInFlight) return;
  if (now - presenceCheckAt < (afterburnerSeen ? PRESENCE_CHECK_MS : PRESENCE_RETRY_MS)) return;
  presenceCheckAt = now;
  presenceCheckInFlight = true;
  try {
    const result = await capture(
      "tasklist.exe",
      ["/FI", "IMAGENAME eq MSIAfterburner.exe", "/FO", "CSV", "/NH"],
      8_000,
    );
    afterburnerSeen = /msiafterburner\.exe/i.test(result.stdout);
  } catch {
    afterburnerSeen = false;
  } finally {
    presenceCheckInFlight = false;
  }
  if (afterburnerSeen && !helper && !stopped) spawnHelper();
}

export function ensureMahmHelper(now = Date.now()): void {
  if (!IS_WINDOWS || stopped) return;
  if (helper) {
    if (now - lastOutputAt > SILENT_RESTART_MS) killHelper();
    return;
  }
  if (now - lastSpawnAttemptAt < SPAWN_BACKOFF_MS) return;
  if (now - lastExitAt < SILENT_RESTART_MS) return;
  lastSpawnAttemptAt = now;
  void checkAfterburner(now);
}

export function startMahmHelper(): void {
  stopped = false;
  ensureMahmHelper();
}

export function stopMahmHelper(): void {
  stopped = true;
  killHelper();
}

/** Latest MAHM reading; stale (or never seen) values read as `null`. */
export function peekMahm(now = Date.now()): MahmReadout {
  if (latest.at === 0 || now - latest.at > STALE_MS) {
    return { ...EMPTY, at: latest.at };
  }
  return latest;
}

export function mahmDiagnostics(): {
  helperRunning: boolean;
  helperPid: number | null;
  afterburnerSeen: boolean;
  lastOutputAt: number;
  readout: MahmReadout;
} {
  return {
    helperRunning: helper !== null,
    helperPid: helper?.pid ?? null,
    afterburnerSeen,
    lastOutputAt,
    readout: peekMahm(),
  };
}
