/**
 * Pure helpers shared by the downloads engine (scheduler, naming, magnets).
 *
 * Everything here is side-effect free so it can be exercised without a
 * running Electron app. The scheduler logic is a direct port of
 * `src-tauri/src/downloads/scheduler.rs`; the naming helpers mirror the Rust
 * `manager.rs` sanitizers.
 */
import path from "node:path";
import type {
  BandwidthRule,
  DownloadRecord,
  SchedulerConfig,
} from "./types";

/** Unix seconds. */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Parse an `HH:MM` (24h) string into minutes since midnight. */
export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Is `nowMin` inside `[start, end)` on `weekday` (0 = Monday)?
 *
 * `days[weekday]` gates the *opening* day, so a window wrapping past
 * midnight stays open on the following morning. `start == end` is all day.
 * Unparseable times fail closed.
 */
export function inWindow(
  start: string,
  end: string,
  days: readonly boolean[],
  nowMin: number,
  weekday: number,
): boolean {
  const day = ((weekday % 7) + 7) % 7;
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (s === null || e === null) return false;
  if (s === e) return Boolean(days[day]);
  if (s < e) return Boolean(days[day]) && nowMin >= s && nowMin < e;
  if (nowMin >= s) return Boolean(days[day]);
  if (nowMin < e) return Boolean(days[((day + 6) % 7)]);
  return false;
}

/** Whether the scheduler permits a start right now (Rust `config_allows_start`). */
export function configAllowsStart(
  config: SchedulerConfig,
  scheduledStartAt: number | undefined,
  now: number,
  nowMin: number,
  weekday: number,
): boolean {
  if (!config.enabled) return true;
  if (scheduledStartAt !== undefined && scheduledStartAt > now) return false;
  if (
    config.windowEnabled &&
    !inWindow(config.windowStart, config.windowEnd, config.days, nowMin, weekday)
  ) {
    return false;
  }
  return true;
}

/** First bandwidth rule whose day + time matches now. */
export function activeBandwidthRule(
  config: SchedulerConfig,
  nowMin: number,
  weekday: number,
): BandwidthRule | null {
  for (const rule of config.bandwidthRules) {
    if (inWindow(rule.start, rule.end, rule.days, nowMin, weekday)) return rule;
  }
  return null;
}

/** Local minutes-since-midnight + Monday-based weekday. */
export function localTimeParts(at: Date = new Date()): { nowMin: number; weekday: number } {
  return {
    nowMin: at.getHours() * 60 + at.getMinutes(),
    weekday: (at.getDay() + 6) % 7,
  };
}

/**
 * Strip characters illegal in a Windows/POSIX file name. A bare `.`/`..`
 * (or all dots) is replaced rather than resolving to a parent directory.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|\0]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return "download";
  return cleaned;
}

/**
 * Sanitise a torrent-relative path, keeping `/` separators so nested files
 * recreate their folders. Empty/`.`/`..` components are neutralised to
 * prevent traversal.
 */
export function sanitizeRelPath(input: string): string {
  const parts: string[] = [];
  for (const component of input.replace(/\\/g, "/").split("/")) {
    const cleaned = component
      .replace(/[:*?"<>|\0]/g, "_")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "_")
      .trim();
    if (!cleaned) continue;
    if (cleaned === "." || cleaned === ".." || /^\.+$/.test(cleaned)) {
      parts.push("_");
    } else {
      parts.push(cleaned);
    }
  }
  if (parts.length === 0) return "download";
  return parts.join("/");
}

/** Append `_2`, `_3`, … until the name is unique inside `used`. */
export function uniquify(name: string, used: Set<string>): string {
  let candidate = name;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${name}_${n}`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Best-effort filename from a download URL (decoded last path segment). */
export function filenameFromUrl(url: string): string {
  const fallback = "download";
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").filter(Boolean).pop();
    if (!raw) return fallback;
    const decoded = decodeURIComponent(raw);
    return decoded.includes(".") && decoded.length <= 255 ? sanitizeFilename(decoded) : fallback;
  } catch {
    return fallback;
  }
}

/** Normalize a user/renderer-supplied path and resolve `..` segments. */
export function normalizePath(input: string): string {
  return path.normalize(input.trim());
}

/**
 * 40-hex BTIH from a magnet URI. Base32 hashes and percent-encoded values
 * fall through to the torrent parser (matches the Rust helper).
 */
export function btihFromMagnet(uri: string): string | null {
  if (!uri.startsWith("magnet:?")) return null;
  for (const pair of uri.slice("magnet:?".length).split("&")) {
    if (!pair.startsWith("xt=")) continue;
    const value = decodeURIComponent(pair.slice(3)).toLowerCase();
    if (value.startsWith("urn:btih:")) {
      const hash = value.slice("urn:btih:".length);
      if (/^[0-9a-f]{40}$/.test(hash)) return hash;
    }
  }
  return null;
}

/**
 * Frontend id from an infohash — same formula as the Rust engine: the first
 * 8 bytes as a big-endian u64 with the sign bit cleared, `dl_<n>`.
 */
export function frontendIdFromBtihHex(hash: string): string | null {
  const trimmed = hash.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(trimmed)) return null;
  const first = BigInt(`0x${trimmed.slice(0, 16)}`);
  const numeric = first & 0x7fffffffffffffffn;
  return `dl_${numeric.toString()}`;
}

/** True when the URI points at a local `.torrent` file. */
export function localTorrentPath(uri: string): string | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(trimmed.slice("file://".length));
    } catch {
      return trimmed.slice("file://".length);
    }
  }
  if (
    (trimmed.endsWith(".torrent") || trimmed.includes(".torrent?")) &&
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://") &&
    !trimmed.startsWith("magnet:")
  ) {
    return trimmed;
  }
  return null;
}

/** True when a record is counted against the scheduler concurrency cap. */
export function isActiveRecord(record: DownloadRecord): boolean {
  return (
    record.status.kind === "downloading" || record.status.kind === "fetchingMetadata"
  );
}

/** Finishing order used by every snapshot: completed at the bottom. */
export function compareDownloads(a: DownloadRecord, b: DownloadRecord): number {
  const aDone = a.status.kind === "completed";
  const bDone = b.status.kind === "completed";
  if (aDone === bDone) return b.addedAt - a.addedAt;
  return aDone ? 1 : -1;
}

/** Keep a relative path strictly inside `root` (defence in depth). */
export function safeJoin(root: string, relative: string): string {
  const cleaned = sanitizeRelPath(relative);
  const target = path.resolve(root, cleaned);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(base + path.sep)) {
    return path.join(base, "download");
  }
  return target;
}

/** Byte/second limit from a kbps setting; 0 = unlimited. */
export function kbpsToBps(kbps: number | null | undefined): number {
  if (typeof kbps !== "number" || !Number.isFinite(kbps) || kbps <= 0) return 0;
  return Math.round(kbps * 1024);
}
