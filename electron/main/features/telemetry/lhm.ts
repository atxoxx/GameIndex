/**
 * LibreHardwareMonitor / OpenHardwareMonitor sensor bridge.
 *
 * LHM's web server exposes its whole sensor tree as JSON on
 * `http://localhost:8085/data.json`. When the app is not running there is
 * nothing to read, so temperatures/clocks stay `null` — never estimated, and
 * no admin prompt, no WMI namespace registration.
 *
 * The tree is only read while a game session is live and refreshed on a short
 * cadence; a failed probe backs off for `LHM_RETRY_MS` so a closed port costs
 * one 800 ms timeout per half minute instead of one per sample.
 */

const LHM_URL = "http://localhost:8085/data.json";
const LHM_TIMEOUT_MS = 800;
const LHM_REFRESH_MS = 2_000;
const LHM_RETRY_MS = 30_000;
/** A cached sensor read older than this is treated as "LHM stopped". */
const LHM_STALE_MS = 15_000;

export interface HardwareSensors {
  cpuTempC: number | null;
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  /** Unix ms of the successful read. */
  at: number;
}

interface LhmNode {
  Text?: unknown;
  Value?: unknown;
  Children?: unknown;
}

function nodeText(node: LhmNode): string {
  return typeof node.Text === "string" ? node.Text : "";
}

function nodeChildren(node: LhmNode): LhmNode[] {
  if (!Array.isArray(node.Children)) return [];
  return node.Children.filter(
    (child): child is LhmNode => !!child && typeof child === "object",
  );
}

/** First number in an LHM value string (`"45.0 °C"` → 45). */
export function parseSensorNumber(value: string): number | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(value);
  if (!match) return null;
  const number = Number(match[0].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

interface SensorHit {
  text: string;
  value: number;
  unit: "temp" | "clock" | "other";
  inGpu: boolean;
  inCpu: boolean;
}

function unitOf(value: string): SensorHit["unit"] {
  if (value.includes("°C") || value.includes("° C") || /(^|\s)C(\s|$)/.test(value)) {
    return "temp";
  }
  if (/mhz|ghz/i.test(value)) return "clock";
  return "other";
}

function collectSensors(node: LhmNode, ancestors: string[], out: SensorHit[]): void {
  const text = nodeText(node);
  const inGpu = ancestors.some((ancestor) =>
    /(^|\b)gpu\b|nvidia|geforce|radeon|graphics|intel arc/i.test(ancestor),
  );
  const inCpu = ancestors.some((ancestor) =>
    /(^|\b)cpu\b|ryzen|threadripper|core i\d|processor/i.test(ancestor),
  );
  if (typeof node.Value === "string" && text) {
    const value = parseSensorNumber(node.Value);
    if (value !== null) out.push({ text, value, unit: unitOf(node.Value), inGpu, inCpu });
  }
  const next = text ? [...ancestors, text] : ancestors;
  for (const child of nodeChildren(node)) collectSensors(child, next, out);
}

function pickTemp(hits: SensorHit[]): number | null {
  const candidates = hits.filter((hit) => hit.unit === "temp");
  const preferred = [
    /gpu core(?!.clock)/i,
    /gpu hot ?spot/i,
    /gpu temperature/i,
    /gpu/i,
  ];
  for (const pattern of preferred) {
    const hit = candidates.find((entry) => pattern.test(entry.text));
    if (hit && hit.value > -10 && hit.value < 150) return Math.round(hit.value * 10) / 10;
  }
  const fallback = candidates.find((hit) => hit.value > -10 && hit.value < 150);
  return fallback ? Math.round(fallback.value * 10) / 10 : null;
}

function pickCpuTemp(hits: SensorHit[]): number | null {
  const candidates = hits.filter((hit) => hit.unit === "temp");
  const preferred = [/package/i, /tctl|tdie/i, /cpu \(tctl\/tdie\)/i, /core/i];
  for (const pattern of preferred) {
    const hit = candidates.find((entry) => pattern.test(entry.text));
    if (hit && hit.value > -10 && hit.value < 150) return Math.round(hit.value * 10) / 10;
  }
  const fallback = candidates.find((hit) => hit.value > -10 && hit.value < 150);
  return fallback ? Math.round(fallback.value * 10) / 10 : null;
}

function pickGpuClock(hits: SensorHit[]): number | null {
  const candidates = hits.filter(
    (hit) => hit.unit === "clock" && !/mem|memory|vram/i.test(hit.text),
  );
  const hit =
    candidates.find((entry) => /gpu core clock|core clock|gpu clock/i.test(entry.text)) ??
    candidates[0];
  if (!hit || hit.value < 30 || hit.value > 6000) return null;
  return Math.round(hit.value);
}

/** Pure parser for LHM's `data.json`, exported for tests/harness. */
export function parseLhmData(data: unknown, at = Date.now()): HardwareSensors | null {
  if (!data || typeof data !== "object") return null;
  const hits: SensorHit[] = [];
  collectSensors(data as LhmNode, [], hits);
  if (hits.length === 0) return null;
  const gpuHits = hits.filter((hit) => hit.inGpu);
  const cpuHits = hits.filter((hit) => hit.inCpu);
  return {
    cpuTempC: pickCpuTemp(cpuHits),
    gpuTempC: pickTemp(gpuHits),
    gpuClockMhz: pickGpuClock(gpuHits),
    at,
  };
}

let cached: HardwareSensors | null = null;
let lastAttemptAt = 0;
let fetching = false;
let lastFailureAt = 0;

async function fetchSensors(): Promise<HardwareSensors | null> {
  try {
    const response = await fetch(LHM_URL, {
      signal: AbortSignal.timeout(LHM_TIMEOUT_MS),
    });
    if (!response.ok) {
      lastFailureAt = Date.now();
      return null;
    }
    const parsed = parseLhmData(await response.json());
    if (parsed) cached = parsed;
    return parsed;
  } catch {
    lastFailureAt = Date.now();
    return null;
  }
}

/** One blocking probe (harness/reporting); returns null when LHM is closed. */
export async function sampleHardwareSensorsNow(): Promise<HardwareSensors | null> {
  const parsed = await fetchSensors();
  return parsed ?? peekLhm();
}

/** Kick a background refresh when the cache is stale. */
export function pumpLhm(now = Date.now()): void {
  if (fetching) return;
  if (cached && now - cached.at < LHM_REFRESH_MS) return;
  if (!cached && now - lastFailureAt < LHM_RETRY_MS) return;
  if (now - lastAttemptAt < LHM_REFRESH_MS) return;
  lastAttemptAt = now;
  fetching = true;
  void fetchSensors().finally(() => {
    fetching = false;
  });
}

/** Last successful LHM reading, or null when LHM is closed/stale. */
export function peekLhm(): HardwareSensors | null {
  if (!cached) return null;
  if (Date.now() - cached.at > LHM_STALE_MS) return null;
  return cached;
}

export function lhmDiagnostics(): { running: boolean; sensors: HardwareSensors | null } {
  return { running: cached !== null, sensors: cached };
}
