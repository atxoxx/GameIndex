/**
 * Linux telemetry sources.
 *
 * The Windows build reads GPU counters through typeperf, temperatures from
 * LibreHardwareMonitor/Afterburner and FPS from RTSS. None of those exist on
 * Linux, so this module implements the equivalents:
 *
 *  • CPU temperature — `/sys/class/hwmon` (`k10temp`, `coretemp`, `zenpower`)
 *    with a `/sys/class/thermal` fallback.
 *  • AMD GPU usage/temp/clock — sysfs (`gpu_busy_percent`, DRM hwmon,
 *    `pp_dpm_sclk`). NVIDIA keeps using the existing cross-platform
 *    `nvidia-smi` source in `nvidia.ts`.
 *  • FPS (+ per-process GPU data) — MangoHud CSV logs. The compatibility
 *    launcher writes them to `MangoHud/GameIndex/<gameId>/`.
 *
 * Every read is synchronous and cheap (small sysfs reads / a throttled log
 * tail), because the session sampler and the overlay poll must never await.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MangohudReading {
  fps: number | null;
  gpuLoad: number | null;
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  cpuTempC: number | null;
  file: string;
  at: number;
}

export interface LinuxTelemetry {
  cpuTempC: number | null;
  gpuPercent: number | null;
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  gpuAdapters: string[];
  mangohud: MangohudReading | null;
}

const MANGOHUD_STALE_MS = 20_000;
const MANGOHUD_CACHE_MS = 900;
const HWMON_CACHE_MS = 60_000;

interface HwmonTempFile {
  file: string;
  label: string;
}

let hwmonFiles: HwmonTempFile[] | null = null;
let hwmonDetectedAt = 0;

interface AmdCard {
  devicePath: string;
  name: string;
}

let amdCards: AmdCard[] | null = null;
let amdCardsDetectedAt = 0;

let mangohudCache: {
  at: number;
  file: string;
  mtimeMs: number;
  size: number;
  reading: MangohudReading | null;
} | null = null;

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function listDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root)
      .map((name) => path.join(root, name))
      .filter((entry) => {
        try {
          // /sys/class/* entries are symlinks; follow them to the real dir.
          return fs.statSync(entry).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

/** Sanitize a game id for use as a directory name. */
export function safeGameFolder(gameId: string): string {
  return gameId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Directory the compatibility launcher writes this game's MangoHud CSV to. */
export function mangohudLogDir(gameId?: string): string {
  const dataHome =
    process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  const root = path.join(dataHome, "MangoHud", "GameIndex");
  return gameId ? path.join(root, safeGameFolder(gameId)) : root;
}

function mangohudRoot(): string {
  const dataHome =
    process.env.XDG_DATA_HOME?.trim() || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "MangoHud");
}

// ── CPU temperature ──────────────────────────────────────────────────

function hwmonName(dir: string): string {
  return (readText(path.join(dir, "name")) ?? "").toLowerCase();
}

function tempLabel(dir: string, inputFile: string): string {
  const base = path.basename(inputFile, "_input");
  return readText(path.join(dir, `${base}_label`)) ?? "";
}

function detectHwmonCpuFiles(): HwmonTempFile[] {
  const chips: string[] = [];
  for (const dir of listDirs("/sys/class/hwmon")) {
    const name = hwmonName(dir);
    if (
      name.includes("coretemp") ||
      name.includes("k10temp") ||
      name.includes("zenpower") ||
      name.includes("cpu_thermal") ||
      name.includes("soc_thermal")
    ) {
      chips.push(dir);
    }
  }

  const files: HwmonTempFile[] = [];
  for (const dir of chips) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^temp\d+_input$/.test(entry)) continue;
      const file = path.join(dir, entry);
      files.push({ file, label: tempLabel(dir, file) });
    }
  }

  // Fallback for boards that only expose thermal zones (ARM, some laptops).
  if (files.length === 0) {
    for (const dir of listDirs("/sys/class/thermal")) {
      const type = (readText(path.join(dir, "type")) ?? "").toLowerCase();
      if (!/x86_pkg_temp|cpu|soc_thermal/.test(type)) continue;
      const file = path.join(dir, "temp");
      if (fs.existsSync(file)) files.push({ file, label: type });
    }
  }

  return files;
}

function cpuTempFromHwmon(): number | null {
  const now = Date.now();
  if (hwmonFiles === null || now - hwmonDetectedAt > HWMON_CACHE_MS) {
    hwmonFiles = detectHwmonCpuFiles();
    hwmonDetectedAt = now;
  }
  if (hwmonFiles.length === 0) return null;

  const values: Array<{ value: number; label: string }> = [];
  for (const entry of hwmonFiles) {
    const raw = readText(entry.file);
    if (!raw) continue;
    const value = Number.parseFloat(raw) / 1000;
    if (Number.isFinite(value) && value > 1 && value < 150) {
      values.push({ value, label: entry.label });
    }
  }
  if (values.length === 0) {
    // Files disappeared (driver unloaded): force a re-detect next call.
    hwmonFiles = null;
    return null;
  }

  const preferred = values.find((entry) =>
    /^(Tctl|Tdie|Package id 0|CPU Package|Physical id 0)$/i.test(entry.label),
  );
  if (preferred) return Math.round(preferred.value * 10) / 10;
  return Math.round(Math.max(...values.map((entry) => entry.value)) * 10) / 10;
}

// ── AMD GPU (sysfs) ──────────────────────────────────────────────────

function ueventValue(uevent: string, key: string): string {
  const prefix = `${key}=`;
  const line = uevent.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}

function detectAmdCards(): AmdCard[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/sys/class/drm");
  } catch {
    return [];
  }
  const cards: AmdCard[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!/^card\d+$/.test(entry)) continue;
    const cardPath = path.join("/sys/class/drm", entry);
    const devicePath = path.join(cardPath, "device");
    if (!fs.existsSync(devicePath)) continue;
    const uevent = readText(path.join(devicePath, "uevent")) ?? "";
    const driver = ueventValue(uevent, "DRIVER").toLowerCase();
    if (driver !== "amdgpu" && driver !== "radeon") continue;
    const slot = ueventValue(uevent, "PCI_SLOT_NAME") || entry;
    // One card per PCI slot (multi-head cards expose one DRM node each).
    if (seen.has(slot)) continue;
    seen.add(slot);
    cards.push({ devicePath, name: slot });
  }
  return cards;
}

function amdCardsCached(): AmdCard[] {
  const now = Date.now();
  if (amdCards === null || now - amdCardsDetectedAt > HWMON_CACHE_MS) {
    amdCards = detectAmdCards();
    amdCardsDetectedAt = now;
  }
  return amdCards;
}

function readNumber(file: string): number | null {
  const raw = readText(file);
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function amdCardTempC(card: AmdCard): number | null {
  for (const hwmon of listDirs(path.join(card.devicePath, "hwmon"))) {
    const value = readNumber(path.join(hwmon, "temp1_input"));
    if (value !== null && value > 0) return Math.round(value / 100) / 10;
  }
  return null;
}

function amdCardClockMhz(card: AmdCard): number | null {
  const raw = readText(path.join(card.devicePath, "pp_dpm_sclk"));
  if (!raw) return null;
  const active = raw
    .split(/\r?\n/)
    .find((line) => line.includes("*"));
  const match = /(\d+(?:\.\d+)?)\s*Mhz/i.exec(active ?? raw);
  return match ? Math.round(Number.parseFloat(match[1])) : null;
}

function amdGpuReading(): { percent: number | null; tempC: number | null; clockMhz: number | null } {
  const cards = amdCardsCached();
  if (cards.length === 0) return { percent: null, tempC: null, clockMhz: null };

  let best: { percent: number; tempC: number | null; clockMhz: number | null } | null = null;
  for (const card of cards) {
    const busy = readNumber(path.join(card.devicePath, "gpu_busy_percent"));
    const percent = busy !== null && busy >= 0 ? Math.min(100, Math.max(0, busy)) : 0;
    const tempC = amdCardTempC(card);
    const clockMhz = amdCardClockMhz(card);
    if (!best || percent > best.percent) best = { percent, tempC, clockMhz };
  }
  return best ?? { percent: null, tempC: null, clockMhz: null };
}

// ── MangoHud CSV ─────────────────────────────────────────────────────

interface CsvReading {
  fps: number | null;
  gpuLoad: number | null;
  gpuTempC: number | null;
  gpuClockMhz: number | null;
  cpuTempC: number | null;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse a MangoHud CSV from its header + tail.
 *
 * The first lines are metadata (`os,cpu,gpu,...`); the real header starts with
 * `fps,frametime,...`. Data rows are matched by column name, so optional
 * columns (`gpu_temp`, `cpu_temp`, …) can be absent.
 */
export function parseMangohudCsv(head: string, tail: string): CsvReading | null {
  const lines = head.split(/\r?\n/);
  let header: string[] | null = null;
  for (const line of lines) {
    const fields = line.split(",").map((field) => field.trim().toLowerCase());
    if (fields[0] === "fps" && fields.includes("frametime")) {
      header = fields;
    }
  }
  if (!header) return null;
  const index = (name: string): number => header!.indexOf(name);
  const fpsIndex = index("fps");
  if (fpsIndex < 0) return null;

  const rows = tail.split(/\r?\n/);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const fields = rows[i].split(",");
    if (fields.length < header.length) continue;
    const fps = toNumber(fields[fpsIndex]);
    if (fps === null || fps <= 0 || fps > 1000) continue;
    const gpuLoad = index("gpu_load") >= 0 ? toNumber(fields[index("gpu_load")]) : null;
    const gpuTemp = index("gpu_temp") >= 0 ? toNumber(fields[index("gpu_temp")]) : null;
    const cpuTemp = index("cpu_temp") >= 0 ? toNumber(fields[index("cpu_temp")]) : null;
    const gpuClock =
      index("gpu_core_clock") >= 0 ? toNumber(fields[index("gpu_core_clock")]) : null;
    return {
      fps: Math.round(fps * 10) / 10,
      gpuLoad:
        gpuLoad !== null && gpuLoad >= 0 ? Math.min(100, Math.max(0, gpuLoad)) : null,
      gpuTempC: gpuTemp !== null && gpuTemp > 0 ? gpuTemp : null,
      cpuTempC: cpuTemp !== null && cpuTemp > 0 ? cpuTemp : null,
      gpuClockMhz: gpuClock !== null && gpuClock > 0 ? Math.round(gpuClock) : null,
    };
  }
  return null;
}

function readFileHeadTail(file: string, size: number): { head: string; tail: string } | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const headLength = Math.min(size, 16 * 1024);
    const tailLength = Math.min(size, 128 * 1024);
    const headBuffer = Buffer.alloc(headLength);
    const tailBuffer = Buffer.alloc(tailLength);
    fs.readSync(fd, headBuffer, 0, headLength, 0);
    fs.readSync(fd, tailBuffer, 0, tailLength, Math.max(0, size - tailLength));
    return { head: headBuffer.toString("utf8"), tail: tailBuffer.toString("utf8") };
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function csvCandidates(dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!lower.endsWith(".csv") || lower.includes("summary")) continue;
      out.push(path.join(dir, entry));
    }
  }
  return out;
}

function newestMangohudLog(gameId?: string): { file: string; mtimeMs: number; size: number } | null {
  const dirs: string[] = [];
  if (gameId) dirs.push(mangohudLogDir(gameId));
  dirs.push(mangohudRoot());
  // MangoHud's default output folder is the current directory. Games launched
  // outside GameIndex often leave their log in $HOME.
  dirs.push(os.homedir());

  let best: { file: string; mtimeMs: number; size: number } | null = null;
  for (const file of csvCandidates(dirs)) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size < 32) continue;
    if (Date.now() - stat.mtimeMs > MANGOHUD_STALE_MS) continue;
    if (!best || stat.mtimeMs > best.mtimeMs) {
      best = { file, mtimeMs: stat.mtimeMs, size: stat.size };
    }
  }
  return best;
}

function readMangohud(gameId?: string): MangohudReading | null {
  const now = Date.now();
  if (mangohudCache && now - mangohudCache.at < MANGOHUD_CACHE_MS) {
    return mangohudCache.reading;
  }

  const candidate = newestMangohudLog(gameId);
  if (!candidate) {
    mangohudCache = { at: now, file: "", mtimeMs: 0, size: 0, reading: null };
    return null;
  }
  if (
    mangohudCache &&
    mangohudCache.file === candidate.file &&
    mangohudCache.mtimeMs === candidate.mtimeMs &&
    mangohudCache.size === candidate.size
  ) {
    mangohudCache.at = now;
    return mangohudCache.reading;
  }

  const buffers = readFileHeadTail(candidate.file, candidate.size);
  const parsed = buffers ? parseMangohudCsv(buffers.head, buffers.tail) : null;
  const reading: MangohudReading | null = parsed
    ? {
        ...parsed,
        file: candidate.file,
        at: now,
      }
    : null;
  mangohudCache = {
    at: now,
    file: candidate.file,
    mtimeMs: candidate.mtimeMs,
    size: candidate.size,
    reading,
  };
  return reading;
}

// ── Public API ───────────────────────────────────────────────────────

/** Synchronous Linux sample; `gameId` scopes the MangoHud log lookup. */
export function sampleLinux(gameId?: string): LinuxTelemetry {
  const amd = amdGpuReading();
  const mangohud = readMangohud(gameId);
  return {
    cpuTempC: cpuTempFromHwmon() ?? mangohud?.cpuTempC ?? null,
    gpuPercent: mangohud?.gpuLoad ?? amd.percent,
    gpuTempC: mangohud?.gpuTempC ?? amd.tempC,
    gpuClockMhz: mangohud?.gpuClockMhz ?? amd.clockMhz,
    gpuAdapters: amdCardsCached().map((card) => card.name),
    mangohud,
  };
}

export function linuxDiagnostics(): {
  hwmonFiles: string[];
  amdCards: string[];
  mangohud: { file: string; at: number } | null;
} {
  const now = Date.now();
  if (hwmonFiles === null || now - hwmonDetectedAt > HWMON_CACHE_MS) {
    hwmonFiles = detectHwmonCpuFiles();
    hwmonDetectedAt = now;
  }
  const cards = amdCardsCached();
  return {
    hwmonFiles: (hwmonFiles ?? []).map((entry) => entry.file),
    amdCards: cards.map((card) => card.name),
    mangohud: mangohudCache?.reading
      ? { file: mangohudCache.reading.file, at: mangohudCache.reading.at }
      : null,
  };
}

/** Test-only: clear all cached file/directory lookups. */
export function resetLinuxTelemetryCache(): void {
  hwmonFiles = null;
  hwmonDetectedAt = 0;
  amdCards = null;
  amdCardsDetectedAt = 0;
  mangohudCache = null;
}
