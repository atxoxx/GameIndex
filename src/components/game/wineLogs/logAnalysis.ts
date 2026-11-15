/**
 * Pure helpers behind the Wine/Proton log viewer.
 *
 * Nothing here imports React, Tauri or i18n so every rule (line
 * classification, filtering, match counting, highlight segmentation and
 * relative timestamps) can be unit-tested in isolation. Labels live in the
 * components; this module only returns data.
 */

/** Visual category of a single log line. */
export type Severity = "info" | "warning" | "error" | "system" | "header";

/** Rails offer a strict subset: headers only show in the unfiltered view. */
export type SeverityFilter = "all" | "error" | "warning" | "system";

/** A line that survived filtering, carrying its original raw index. */
export interface LogRow {
  /** 0-based index in the raw split log (used for titles / jump offsets). */
  index: number;
  text: string;
  severity: Severity;
}

export interface SeverityCounts {
  all: number;
  error: number;
  warning: number;
  system: number;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Relative age of the log file, kept structured so callers can translate it. */
export type RelativeTime =
  | { unit: "now"; value: 0 }
  | { unit: "minute" | "hour" | "day"; value: number };

export const SEVERITY_FILTERS: ReadonlyArray<{
  id: SeverityFilter;
  labelKey: string;
}> = [
  { id: "all", labelKey: "wineLogs.filterAll" },
  { id: "error", labelKey: "wineLogs.filterErrors" },
  { id: "warning", labelKey: "wineLogs.filterWarnings" },
  { id: "system", labelKey: "wineLogs.filterSystem" },
];

const ERROR_MARKERS = ["err:", "error:", "fatal", "segfault", "crash"];
const WARNING_MARKERS = ["warn:", "warning:", "fixme:"];
// `vulkan` already covers `winevulkan`, but both are listed so the intent is
// obvious when someone extends the list.
const SYSTEM_MARKERS = ["dxvk", "vkd3d", "gamescope", "mangohud", "d3d", "vulkan"];
const HEADER_MARKERS = ["gameindex compatibility"];

/** Split a log file into lines, tolerating CRLF and a trailing newline. */
export function splitLogLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Classify one line. Order matters: a section header wins over everything
 * (`=== Errors ===` must stay a header), errors win over warnings, and
 * driver/pipeline chatter is only classified after Wine's own severities so a
 * `fixme:d3d:` line stays a warning.
 */
export function classifyLine(line: string): Severity {
  const trimmed = line.trimStart();
  const lower = trimmed.toLowerCase();
  if (trimmed.startsWith("===") || HEADER_MARKERS.some((m) => lower.includes(m))) {
    return "header";
  }
  if (ERROR_MARKERS.some((m) => lower.includes(m))) return "error";
  if (WARNING_MARKERS.some((m) => lower.includes(m))) return "warning";
  if (SYSTEM_MARKERS.some((m) => lower.includes(m))) return "system";
  return "info";
}

/** Counts over every non-empty line, independent of the active query. */
export function countSeverities(lines: readonly string[]): SeverityCounts {
  const counts: SeverityCounts = { all: 0, error: 0, warning: 0, system: 0 };
  for (const line of lines) {
    if (line.trim() === "") continue;
    counts.all += 1;
    const severity = classifyLine(line);
    if (severity === "error") counts.error += 1;
    else if (severity === "warning") counts.warning += 1;
    else if (severity === "system") counts.system += 1;
  }
  return counts;
}

/**
 * Apply the severity rail + search query. Blank lines never render, and the
 * returned `index` is the raw line number so jump/copy/title stay correct
 * even while filters are active.
 */
export function filterLines(
  lines: readonly string[],
  filter: SeverityFilter,
  query: string
): LogRow[] {
  const needle = query.trim().toLowerCase();
  const rows: LogRow[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    if (text.trim() === "") continue;
    const severity = classifyLine(text);
    if (filter !== "all" && severity !== filter) continue;
    if (needle && !text.toLowerCase().includes(needle)) continue;
    rows.push({ index, text, severity });
  }
  return rows;
}

/** Total occurrences (not lines) of `query`, case-insensitively. */
export function countMatches(lines: readonly string[], query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  let total = 0;
  for (const line of lines) {
    const haystack = line.toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      total += 1;
      from = at + needle.length;
    }
  }
  return total;
}

/**
 * Row position (inside the visible array) that owns the Nth occurrence, so
 * prev/next navigation can highlight and scroll to the right line.
 */
export function rowForMatch(
  lines: readonly string[],
  query: string,
  occurrence: number
): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle || occurrence < 0) return null;
  let seen = 0;
  for (let row = 0; row < lines.length; row++) {
    const haystack = lines[row].toLowerCase();
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      if (seen === occurrence) return row;
      seen += 1;
      from = at + needle.length;
    }
  }
  return null;
}

/** Split a line into plain / matched segments for `<mark>` rendering. */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle) return text ? [{ text, match: false }] : [];
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (;;) {
    const at = lowerText.indexOf(lowerNeedle, cursor);
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Human byte size for a log file.
 *
 * `formatSize()` is tuned for library installs and renders anything below
 * ~50 MB as "0.0 GB", which is useless for a 400 KB Wine log.
 */
export function formatLogSize(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (value < 1024) return `${Math.round(value)} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/** Group digits with spaces: 1248 -> "1 248". Locale-independent. */
export function formatCount(value: number): string {
  return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Coarse relative age; minute granularity is enough for a live log tail. */
export function formatRelativeTime(then: number, now: number): RelativeTime {
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (!Number.isFinite(diff) || diff < minute) return { unit: "now", value: 0 };
  if (diff < hour) return { unit: "minute", value: Math.floor(diff / minute) };
  if (diff < day) return { unit: "hour", value: Math.floor(diff / hour) };
  return { unit: "day", value: Math.floor(diff / day) };
}

/** i18n key + vars for a `RelativeTime` value. */
export function relativeTimeLabel(
  relative: RelativeTime
): { key: string; vars?: { count: number } } {
  switch (relative.unit) {
    case "minute":
      return { key: "wineLogs.timeMinutes", vars: { count: relative.value } };
    case "hour":
      return { key: "wineLogs.timeHours", vars: { count: relative.value } };
    case "day":
      return { key: "wineLogs.timeDays", vars: { count: relative.value } };
    default:
      return { key: "wineLogs.timeNow" };
  }
}
