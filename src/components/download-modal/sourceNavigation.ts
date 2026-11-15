import type { DisplayMatch } from "./types";

/** Reserved rail id for the "every source" entry. */
export const ALL_SOURCES_ENTRY_ID = "all";
/** Reserved rail id for the single grouped plugin entry. */
export const PLUGIN_ENTRY_ID = "plugin";

export type SourceNavProvider = "all" | "source" | "plugin";

/** One item in the source rail: the aggregate entry, a built-in source,
 *  or the single bucket that groups every plugin result. */
export interface SourceNavEntry {
  id: string;
  label: string;
  count: number;
  provider: SourceNavProvider;
  /** Reserved for callers that need to dim a source that is configured
   *  but currently yields no usable rows. Omitted when unknown. */
  available?: boolean;
}

/** One source (or the plugin bucket) with its matches, for a future
 *  grouped results view. Match order inside a group is preserved. */
export interface SourceMatchGroup {
  id: string;
  label: string;
  provider: "source" | "plugin";
  matches: DisplayMatch[];
}

/** Labels for the grouped view. `sources` may override the display label
 *  of individual built-in sources, keyed by their rail id. */
export interface SourceGroupLabels {
  plugin: string;
  sources?: Record<string, string>;
}

/** Stable identity of a built-in source. Falls back to the display name
 *  for results that came in without a `sourceId`. */
function builtInId(match: DisplayMatch): string {
  return (match.sourceId || "").trim() || (match.sourceName || "").trim();
}

function builtInLabel(match: DisplayMatch, id: string): string {
  return (match.sourceName || "").trim() || id;
}

function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Build the source-rail entries from the raw search matches.
 *
 * Order is fixed: the aggregate entry first, built-in sources next
 * (alphabetical by label), and one grouped plugin entry last when at
 * least one plugin result exists. Plugin results are never listed
 * individually — they always collapse into that single entry.
 */
export function buildSourceNavEntries(
  matches: DisplayMatch[],
  allLabel: string,
  pluginLabel: string,
): SourceNavEntry[] {
  const builtIns = new Map<string, { label: string; count: number }>();
  let pluginCount = 0;

  for (const match of matches) {
    if (match.provider === "plugin") {
      pluginCount += 1;
      continue;
    }
    const id = builtInId(match);
    if (!id) continue;
    const existing = builtIns.get(id);
    if (existing) {
      existing.count += 1;
    } else {
      builtIns.set(id, { label: builtInLabel(match, id), count: 1 });
    }
  }

  const entries: SourceNavEntry[] = [
    {
      id: ALL_SOURCES_ENTRY_ID,
      label: allLabel,
      count: matches.length,
      provider: "all",
    },
  ];

  const sourceEntries = Array.from(builtIns, ([id, info]) => ({
    id,
    label: info.label,
    count: info.count,
    provider: "source" as const,
  })).sort((a, b) => compareLabels(a.label, b.label) || a.id.localeCompare(b.id));

  entries.push(...sourceEntries);

  if (pluginCount > 0) {
    entries.push({
      id: PLUGIN_ENTRY_ID,
      label: pluginLabel,
      count: pluginCount,
      provider: "plugin",
    });
  }

  return entries;
}

/**
 * Predicate used by the results filter: does this match belong to the
 * rail entry `entryId`? Handles the aggregate entry, the plugin bucket,
 * the legacy "source"/"sources" aliases, and individual built-in
 * sources by id or (case-insensitively) by display name.
 */
export function sourceEntryMatches(match: DisplayMatch, entryId: string): boolean {
  const id = (entryId || "").trim();
  if (!id || id === ALL_SOURCES_ENTRY_ID) return true;

  if (id === PLUGIN_ENTRY_ID || id === "plugins") {
    return match.provider === "plugin";
  }
  if (id === "source" || id === "sources") {
    return match.provider !== "plugin";
  }

  if (match.provider === "plugin") {
    return (
      match.pluginId === id ||
      match.sourceId === id ||
      match.sourceName.toLowerCase() === id.toLowerCase()
    );
  }

  return (
    match.sourceId === id ||
    match.sourceName.toLowerCase() === id.toLowerCase()
  );
}

/**
 * Group matches by source for a grouped results view. Built-in groups
 * are ordered alphabetically by label, the plugin bucket always comes
 * last, and each group keeps the incoming match order.
 */
export function groupMatchesBySource(
  matches: DisplayMatch[],
  labels: SourceGroupLabels,
): SourceMatchGroup[] {
  const groups = new Map<string, SourceMatchGroup>();

  for (const match of matches) {
    if (match.provider === "plugin") {
      let group = groups.get(PLUGIN_ENTRY_ID);
      if (!group) {
        group = {
          id: PLUGIN_ENTRY_ID,
          label: labels.plugin,
          provider: "plugin",
          matches: [],
        };
        groups.set(PLUGIN_ENTRY_ID, group);
      }
      group.matches.push(match);
      continue;
    }

    const id = builtInId(match);
    if (!id) continue;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: labels.sources?.[id] ?? builtInLabel(match, id),
        provider: "source",
        matches: [],
      };
      groups.set(id, group);
    }
    group.matches.push(match);
  }

  const pluginGroup = groups.get(PLUGIN_ENTRY_ID);
  const sourceGroups = Array.from(groups.values())
    .filter((group) => group.provider === "source")
    .sort(
      (a, b) => compareLabels(a.label, b.label) || a.id.localeCompare(b.id),
    );

  return pluginGroup ? [...sourceGroups, pluginGroup] : sourceGroups;
}

/**
 * Compact identity mark for a source label: initials of the first two
 * words, or the first two characters of a single-word label.
 * Unicode-aware so CJK/Cyrillic labels still produce a sensible mark.
 */
export function sourceInitials(label: string): string {
  const words = (label || "")
    .trim()
    .split(/[\s\-_.:·/|\\]+/u)
    .filter(Boolean);

  if (words.length === 0) return "?";
  if (words.length === 1) {
    return Array.from(words[0]).slice(0, 2).join("").toLocaleUpperCase();
  }

  const first = Array.from(words[0])[0] ?? "";
  const second = Array.from(words[1])[0] ?? "";
  return `${first}${second}`.toLocaleUpperCase();
}
