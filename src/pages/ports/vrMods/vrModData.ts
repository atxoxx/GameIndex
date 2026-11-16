/**
 * Pure normalization / dedup helpers for the VR mods catalog.
 *
 * Shared by the build-time generator (Node runs this file directly) and the
 * renderer, so a link that is deduped in the snapshot is deduped the same way
 * when the catalog is grouped again after filtering.
 *
 * Import specifiers use explicit `.ts` extensions so Node's TypeScript type
 * stripping can execute this module; Vite/esbuild resolve them fine too.
 */
import type {
  VrLinkKind,
  VrModEntry,
  VrModGameGroup,
  VrModKind,
  VrModLink,
  VrSourceRef,
} from "../../../types/vrMod.ts";

/** RSC payloads serialize missing fields as the literal string "$undefined". */
export function cleanText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "$undefined" || trimmed === "undefined" ? "" : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Remove the "(UEVR conversion)" / "(PC VR)" style suffixes from a title. */
export function cleanGameTitle(name: string): string {
  return name
    .replace(/\s*\([^)]*(?:uevr|conversion|vr mod|flat.?to.?vr|pc vr|quest)[^)]*\)\s*$/gi, "")
    .replace(/\s+(?:uevr\s+)?(?:vr\s+)?(?:mod|port|conversion)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable grouping key: two spellings of the same game land on one card. */
export function normalizeGameKey(name: string): string {
  return cleanGameTitle(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectLinkKind(url: string): VrLinkKind {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "website";
  }
  if (host === "github.com" || host === "gist.github.com") return "github";
  if (host === "gitlab.com") return "gitlab";
  if (host.endsWith("patreon.com")) return "patreon";
  if (host.endsWith("docs.google.com") || host.endsWith("google.com")) return "sheet";
  return "website";
}

/**
 * Normalize a repository URL to `github:owner/repo`.
 * Handles blob/tree/releases paths, `.git` suffixes and trailing slashes, so
 * every link to the same project collapses into one dropdown entry.
 */
export function repoKeyOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com" && host !== "gitlab.com") return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  let owner = segments[0];
  let repo = segments[1].replace(/\.git$/i, "");
  if (host === "gitlab.com" && segments.includes("-")) {
    const marker = segments.indexOf("-");
    owner = segments.slice(0, marker).join("/");
    repo = segments[marker + 2] ?? repo;
  }
  if (!owner || !repo) return null;
  return `${host === "github.com" ? "github" : "gitlab"}:${owner}/${repo}`.toLowerCase();
}

export function makeLink(label: string, url: string): VrModLink {
  return { label: label || url, url, kind: detectLinkKind(url), repoKey: repoKeyOf(url) };
}

/** Dedupe by repository key first, otherwise by exact URL. */
export function dedupeLinks(links: VrModLink[]): VrModLink[] {
  const seen = new Set<string>();
  const result: VrModLink[] = [];
  for (const link of links) {
    if (!link.url) continue;
    const key = link.repoKey ? `repo:${link.repoKey}` : `url:${link.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

/** Classify the source's own `kind` label into one of our card buckets. */
export function classifyKind(raw: string, name: string): VrModKind {
  const value = `${raw} ${name}`.toLowerCase();
  if (value.includes("uevr")) return "uevr";
  if (value.includes("conversion")) return "conversion";
  if (value.includes("mod") || value.includes("port") || value.includes("framework")) {
    return "dedicated";
  }
  return "unknown";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueSources(values: VrSourceRef[]): VrSourceRef[] {
  const seen = new Set<string>();
  return values.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

function newestDate(values: (string | null)[]): string | null {
  const dates = values.filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** Group entries into one card per game, merging links and metadata. */
export function groupVrMods(entries: VrModEntry[]): VrModGameGroup[] {
  const buckets = new Map<string, VrModEntry[]>();
  for (const entry of entries) {
    const key = entry.gameKey || normalizeGameKey(entry.gameTitle);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }

  const groups: VrModGameGroup[] = [];
  for (const [key, bucket] of buckets) {
    const sorted = [...bucket].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    const primary = sorted[0];
    groups.push({
      key,
      title: cleanGameTitle(primary.gameTitle) || primary.gameTitle,
      entries: sorted,
      githubLinks: dedupeLinks(
        sorted.flatMap((entry) =>
          entry.links.filter((link) => link.kind === "github" || link.kind === "gitlab"),
        ),
      ),
      image: sorted.find((entry) => entry.image)?.image ?? null,
      date: newestDate(sorted.map((entry) => entry.date)),
      kinds: uniqueStrings(sorted.map((entry) => entry.kind)) as VrModKind[],
      platforms: uniqueStrings(sorted.flatMap((entry) => entry.platforms)),
      sources: uniqueSources(sorted.flatMap((entry) => entry.sources)),
      author: sorted.find((entry) => entry.author)?.author ?? null,
    });
  }
  return groups;
}
