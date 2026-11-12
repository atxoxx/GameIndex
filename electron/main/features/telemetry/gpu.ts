/**
 * GPU utilisation from the Windows performance counters.
 *
 * `\GPU Engine(*)\Utilization Percentage` is the same data Task Manager shows.
 * Each instance is one engine of one adapter for one process:
 *
 *   \GPU Engine(pid_1234_luid_0x00000000_0x00019C51_phys_0_eng_0_engtype_3D)\Utilization Percentage
 *
 * Reading it with `typeperf -sc 1` costs a child process (~0.3–1.5 s), so the
 * value is refreshed on a background cadence and every consumer reads the
 * cached snapshot. The counter path is discovered once and cached; a failed
 * run marks the source unavailable instead of retrying on every sample.
 *
 * Aggregation: per adapter, values are summed inside each engine class
 * (`3D`, `Copy`, `VideoDecode`, …) and the busiest class wins; the reported
 * percentage is the busiest adapter. Summing every engine of an adapter would
 * double-count copy/3D work and routinely exceed 100 %, so it is not used.
 */
import { capture, IS_WINDOWS } from "./proc";

const DEFAULT_COUNTER = "\\GPU Engine(*)\\Utilization Percentage";
const REFRESH_INTERVAL_MS = 3_500;
const TYPEPERF_TIMEOUT_MS = 12_000;
const DISCOVERY_RETRY_MS = 5 * 60_000;
const ADAPTER_RETRY_MS = 5 * 60_000;
/** A cached reading older than this is treated as "no reading". */
const GPU_STALE_MS = 15_000;

export interface GpuReading {
  /** 0–100, busiest adapter; 0 when the counters exist but everything idles. */
  percent: number;
  /** adapter key → percent, `luid_hi:phys`. */
  byAdapter: Record<string, number>;
  instanceCount: number;
  /** Unix ms when typeperf produced this reading. */
  at: number;
}

interface ParsedGpu {
  byAdapter: Record<string, number>;
  instanceCount: number;
}

/** Split one CSV line, honouring the double quotes typeperf emits. */
function splitCsv(line: string): string[] {
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

function parsePercent(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

const INSTANCE_RE =
  /luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_(\d+)_eng_(\d+)_engtype_([^)\\]*)/i;

/**
 * Parse `typeperf "\GPU Engine(*)\Utilization Percentage" -sc 1` output.
 * Pure so the harness can feed it captured or synthetic text.
 */
export function parseTypeperfGpu(stdout: string): ParsedGpu | null {
  const lines = stdout.split(/\r?\n/);
  let header: string[] | null = null;
  let data: string[] | null = null;

  for (const line of lines) {
    if (!line.includes('"')) continue;
    if (line.includes("PDH-CSV")) {
      header = splitCsv(line);
      continue;
    }
    const fields = splitCsv(line);
    // Data rows start with a quoted timestamp, then one value per counter.
    if (fields.length >= 2 && /^\s*\d/.test(fields[0] ?? "")) {
      data = fields;
    }
  }
  if (!header || !data) return null;

  const sums = new Map<string, Map<string, number>>();
  let instanceCount = 0;

  for (let i = 1; i < header.length && i < data.length; i += 1) {
    const value = parsePercent(data[i]);
    if (value === null) continue;
    const instance = /GPU Engine\(([^)]*)\)/i.exec(header[i] ?? "");
    if (!instance) continue;
    const parsed = INSTANCE_RE.exec(instance[1]);
    if (!parsed) continue;
    const adapterKey = `${parsed[2].toLowerCase()}:${parsed[3]}`;
    const engineClass = parsed[5].trim().toLowerCase() || "other";
    let perEngine = sums.get(adapterKey);
    if (!perEngine) {
      perEngine = new Map();
      sums.set(adapterKey, perEngine);
    }
    perEngine.set(engineClass, (perEngine.get(engineClass) ?? 0) + value);
    instanceCount += 1;
  }

  if (instanceCount === 0) return null;

  const byAdapter: Record<string, number> = {};
  let percent = 0;
  for (const [adapterKey, perEngine] of sums) {
    let busiest = 0;
    for (const value of perEngine.values()) busiest = Math.max(busiest, value);
    byAdapter[adapterKey] = Math.round(Math.min(100, busiest) * 10) / 10;
    percent = Math.max(percent, byAdapter[adapterKey]);
  }

  return { byAdapter, instanceCount };
}

/** Build a wildcard counter path from one discovered concrete instance path. */
export function wildcardCounterPath(concrete: string): string | null {
  const match = /^(.*?)\(([^)]*luid_[^)]*)\)(.*)$/i.exec(concrete);
  if (!match) return null;
  const suffix = match[3] || "";
  if (!suffix) return null;
  return `${match[1]}(*)${suffix}`;
}

let counterPath: string | null = null;
let counterPathTriedAt = 0;
let counterPathFailed = false;
let refreshing = false;
let lastAttemptAt = 0;
let last: GpuReading | null = null;

async function discoverCounterPath(): Promise<string | null> {
  const filtered = await capture("typeperf", ["-qx", "GPU Engine"], 20_000);
  const filteredMatch = pickWildcard(filtered.stdout);
  if (filteredMatch) return filteredMatch;
  // A localised install may not match the English object name; the full
  // counter list is large but this runs at most once per process.
  const full = await capture("typeperf", ["-qx"], 25_000, 32 * 1024 * 1024);
  return pickWildcard(full.stdout);
}

/** First GPU-engine wildcard in a `typeperf -qx` listing. */
function pickWildcard(stdout: string): string | null {
  let fallback: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("\\")) continue;
    const wildcard = wildcardCounterPath(text);
    if (!wildcard) continue;
    if (/GPU Engine\(/i.test(text)) return wildcard;
    // Any counter whose instance carries a LUID and engine type is the same
    // GPU engine set, whatever the localised object is called.
    if (!fallback && /engtype_/i.test(text)) fallback = wildcard;
  }
  return fallback;
}

/** One blocking counter read (call from the background pump only). */
export async function sampleGpuCountersNow(): Promise<GpuReading | null> {
  if (!IS_WINDOWS) return null;
  const path = counterPath ?? DEFAULT_COUNTER;
  const result = await capture(
    "typeperf",
    [path, "-sc", "1"],
    TYPEPERF_TIMEOUT_MS,
    16 * 1024 * 1024,
  );
  let parsed = parseTypeperfGpu(result.stdout);
  if (!parsed && (result.code !== 0 || result.timedOut)) {
    // The default English path can be missing on a localised install. Discover
    // the real path once and retry immediately; cache whatever we learn.
    if (!counterPathFailed || Date.now() - counterPathTriedAt > DISCOVERY_RETRY_MS) {
      counterPathTriedAt = Date.now();
      counterPath = await discoverCounterPath();
      counterPathFailed = counterPath === null;
      if (counterPath) {
        const retry = await capture(
          "typeperf",
          [counterPath, "-sc", "1"],
          TYPEPERF_TIMEOUT_MS,
          16 * 1024 * 1024,
        );
        parsed = parseTypeperfGpu(retry.stdout);
      }
    }
  }
  if (!parsed) return null;
  counterPathFailed = false;
  const reading: GpuReading = {
    percent: Math.round(Math.max(...Object.values(parsed.byAdapter), 0) * 10) / 10,
    byAdapter: parsed.byAdapter,
    instanceCount: parsed.instanceCount,
    at: Date.now(),
  };
  last = reading;
  return reading;
}

/**
 * Kick a background refresh when the cached reading is stale. Returns the
 * cached value immediately; the child is fire-and-forget with a timeout.
 */
export function pumpGpuCounters(now = Date.now()): void {
  if (!IS_WINDOWS || refreshing) return;
  // No usable counter on this machine: do not respawn typeperf on every
  // sample; retry discovery at the slow cadence instead.
  if (counterPathFailed && now - counterPathTriedAt < DISCOVERY_RETRY_MS) return;
  if (last && now - last.at < REFRESH_INTERVAL_MS) return;
  if (now - lastAttemptAt < REFRESH_INTERVAL_MS) return;
  lastAttemptAt = now;
  refreshing = true;
  void sampleGpuCountersNow()
    .catch(() => null)
    .finally(() => {
      refreshing = false;
    });
}

/** Latest GPU percentage, or null when the cached reading is stale/absent. */
export function getCachedGpu(): { percent: number | null; reading: GpuReading | null } {
  if (!last) return { percent: null, reading: null };
  const fresh = Date.now() - last.at <= GPU_STALE_MS;
  return { percent: fresh ? last.percent : null, reading: last };
}

// ── Adapter names (one Win32_VideoController query per process) ──────────────

let adapterNames: string[] | null = null;
let adapterAttemptAt = 0;
let adapterDetecting = false;

const ADAPTER_SCRIPT =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress";

async function detectAdapters(): Promise<string[]> {
  const result = await capture(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      ADAPTER_SCRIPT,
    ],
    20_000,
  );
  const text = result.stdout.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const names: string[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const name = (row as { Name?: unknown }).Name;
      if (typeof name === "string" && name.trim() && !names.includes(name.trim())) {
        names.push(name.trim());
      }
    }
    return names;
  } catch {
    return [];
  }
}

/** Blocking adapter detection (harness/reporting); cached for the process. */
export async function sampleGpuAdaptersNow(): Promise<string[]> {
  if (!IS_WINDOWS) return [];
  const names = await detectAdapters();
  if (names.length > 0) adapterNames = names;
  return getGpuAdapterNames();
}

/** Kick adapter detection once; names are cached for the process lifetime. */
export function pumpGpuAdapters(now = Date.now()): void {
  if (!IS_WINDOWS || adapterNames || adapterDetecting) return;
  if (now - adapterAttemptAt < ADAPTER_RETRY_MS) return;
  adapterAttemptAt = now;
  adapterDetecting = true;
  void detectAdapters().finally(() => {
    adapterDetecting = false;
  });
}

export function getGpuAdapterNames(): string[] {
  return adapterNames ? [...adapterNames] : [];
}

export function gpuDiagnostics(): {
  counterPath: string | null;
  reading: GpuReading | null;
  adapters: string[];
} {
  return {
    counterPath,
    reading: last,
    adapters: getGpuAdapterNames(),
  };
}
