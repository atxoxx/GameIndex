/**
 * Cross-source dedupe + merge.
 *
 * Matching order (the product decision):
 *   1. repository URL (`github.com/owner/repo`, host + path, case-insensitive)
 *   2. normalized game title + canonical platform, for rows without a repo
 *
 * Two different repos for the same game are different projects and stay
 * separate - that is exactly what the modal's project switcher is for.
 */
import {
  PORT_SOURCE_PRIORITY,
  PORT_SOURCES,
  type PortLink,
  type PortProject,
  type PortSourceProject,
  type PortSourceRef,
} from "../../../../../src/types/port";
import { canonicalPlatform, canonicalTarget, sortTargets, vendorForPlatform } from "./platforms";

const PRIORITY = new Map(PORT_SOURCE_PRIORITY.map((id, index) => [id, index]));

export function normalizeTitle(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** `github:owner/repo`, or null for non-repository links. */
export function repoKeyOf(link: PortLink): string | null {
  if (link.kind === "website") return null;
  try {
    const url = new URL(link.url);
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));
    if (segments.length < 2) return null;
    const owner = segments[0].toLowerCase();
    const repo = segments[1].replace(/\.git$/i, "").toLowerCase();
    if (!owner || !repo) return null;
    return `${link.kind}:${owner}/${repo}`;
  } catch {
    return null;
  }
}

export function repoKeyOfProject(project: PortSourceProject): string | null {
  for (const link of project.links) {
    const key = repoKeyOf(link);
    if (key) return key;
  }
  return null;
}

function linkKey(link: PortLink): string {
  const repo = repoKeyOf(link);
  if (repo) return repo;
  try {
    const url = new URL(link.url);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return link.url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

function uniqueLinks(entries: PortSourceProject[]): PortLink[] {
  const out: PortLink[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const link of entry.links) {
      if (!/^https?:\/\//i.test(link.url)) continue;
      const key = linkKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

function uniqueSources(entries: PortSourceProject[]): PortSourceRef[] {
  const seen = new Set<string>();
  const out: PortSourceRef[] = [];
  for (const entry of entries) {
    if (seen.has(entry.source)) continue;
    seen.add(entry.source);
    out.push({
      id: entry.source,
      name: PORT_SOURCES[entry.source].name,
      url: entry.sourceUrl,
    });
  }
  return out;
}

function meaningful(value: string): boolean {
  const normal = value.trim().toLowerCase();
  return Boolean(normal) && normal !== "unknown" && normal !== "not declared" && normal !== "-";
}

function firstMeaningful(
  entries: PortSourceProject[],
  pick: (entry: PortSourceProject) => string,
): string {
  for (const entry of entries) {
    const value = pick(entry).trim();
    if (meaningful(value)) return value;
  }
  return "";
}

function bestStars(entries: PortSourceProject[]): number | null {
  let best: number | null = null;
  for (const entry of entries) {
    if (entry.stars == null || !Number.isFinite(entry.stars)) continue;
    if (best == null || entry.stars > best) best = entry.stars;
  }
  return best;
}

function bestRating(entries: PortSourceProject[]): number | null {
  for (const entry of entries) {
    if (entry.communityRating == null || !Number.isFinite(entry.communityRating)) continue;
    return Math.round(entry.communityRating * 10) / 10;
  }
  return null;
}

function bestRealRating(entries: PortSourceProject[]): number | null {
  for (const entry of entries) {
    if (entry.realRating != null && Number.isFinite(entry.realRating)) return entry.realRating;
  }
  return null;
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

interface Cluster {
  repo: string | null;
  titleKey: string;
  entries: PortSourceProject[];
}

/** Merge per-source rows into the catalog's one-row-per-project list. */
export function mergePortSources(sourceRows: PortSourceProject[]): PortProject[] {
  const ordered = sourceRows
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const pa = PRIORITY.get(a.entry.source) ?? 99;
      const pb = PRIORITY.get(b.entry.source) ?? 99;
      return pa - pb || a.index - b.index;
    })
    .map((item) => item.entry);

  const clusters: Cluster[] = [];
  const byRepo = new Map<string, Cluster>();
  const byTitle = new Map<string, Cluster[]>();

  // A repo used for one game can merge across title spelling differences
  // ("Morrowind" vs "The Elder Scrolls III: Morrowind"). A repo used for many
  // games (CPS-2 Recomp, engines) must keep one cluster per game title.
  const titlesByRepo = new Map<string, Set<string>>();
  for (const entry of ordered) {
    const repo = repoKeyOfProject(entry);
    if (!repo) continue;
    const titles = titlesByRepo.get(repo) ?? new Set<string>();
    titles.add(normalizeTitle(entry.game));
    titlesByRepo.set(repo, titles);
  }

  for (const entry of ordered) {
    const repo = repoKeyOfProject(entry);
    const titleKey = `${normalizeTitle(entry.game)}|${canonicalPlatform(entry.platform).toLowerCase()}`;
    const singleGameRepo = repo ? (titlesByRepo.get(repo)?.size ?? 0) === 1 : false;
    const repoTitleKey = repo
      ? singleGameRepo
        ? repo
        : `${repo}|${normalizeTitle(entry.game)}`
      : null;
    const titleClusters = byTitle.get(titleKey) ?? [];

    if (repo && repoTitleKey) {
      const known = byRepo.get(repoTitleKey);
      if (known) {
        known.entries.push(entry);
        continue;
      }
      // A repo-less announcement from a higher-priority source may already
      // describe this exact project.
      const orphan = titleClusters.find((cluster) => cluster.repo === null);
      if (orphan) {
        orphan.entries.push(entry);
        orphan.repo = repo;
        byRepo.set(repoTitleKey, orphan);
        continue;
      }
      const cluster: Cluster = { repo, titleKey, entries: [entry] };
      clusters.push(cluster);
      byRepo.set(repoTitleKey, cluster);
      titleClusters.push(cluster);
      byTitle.set(titleKey, titleClusters);
      continue;
    }

    const candidate = titleClusters[0];
    if (candidate) {
      candidate.entries.push(entry);
      continue;
    }
    const cluster: Cluster = { repo: null, titleKey, entries: [entry] };
    clusters.push(cluster);
    titleClusters.push(cluster);
    byTitle.set(titleKey, titleClusters);
  }

  const usedIds = new Map<string, number>();
  const merged: PortProject[] = [];

  for (const cluster of clusters) {
    const entries = [...cluster.entries].sort((a, b) => {
      const pa = PRIORITY.get(a.source) ?? 99;
      const pb = PRIORITY.get(b.source) ?? 99;
      return pa - pb;
    });
    const primary = entries[0];
    if (!primary) continue;

    const platform =
      canonicalPlatform(primary.platform) ||
      canonicalPlatform(entries.find((entry) => entry.platform)?.platform ?? "");
    const game = primary.game.trim() || entries.find((entry) => entry.game.trim())?.game || "";
    if (!game) continue;

    const baseId = slug(
      cluster.repo
        ? `${cluster.repo.replace(/^[a-z]+:/, "")}-${game}`
        : `${game}-${platform}-${primary.portName}`,
    );
    const count = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, count + 1);

    const targets = sortTargets(
      entries
        .flatMap((entry) => entry.targets)
        .map((target) => canonicalTarget(target))
        .filter((target): target is string => Boolean(target)),
    );

    merged.push({
      id: count === 0 ? baseId : `${baseId}-${count + 1}`,
      game,
      platform,
      portName: primary.portName || entries.find((entry) => entry.portName)?.portName || "",
      origin: firstMeaningful(entries, (entry) => entry.origin),
      status: firstMeaningful(entries, (entry) => entry.status),
      languages: firstMeaningful(entries, (entry) => entry.languages),
      notes: primary.notes || entries.find((entry) => entry.notes)?.notes || "",
      links: uniqueLinks(entries),
      stars: bestStars(entries),
      platforms: targets,
      targets: entries.flatMap((entry) => entry.targets),
      imageUrl: entries.find((entry) => entry.imageUrl)?.imageUrl ?? null,
      communityRating: bestRating(entries),
      realRating: bestRealRating(entries),
      group: primary.group || vendorForPlatform(platform),
      sources: uniqueSources(entries),
      source: primary.source,
      sourceUrl: primary.sourceUrl,
      wikiUrl: entries.find((entry) => entry.wikiUrl)?.wikiUrl,
    });
  }

  return merged;
}
