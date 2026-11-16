import type { PortProject, PortSourceRef } from "../../types/port";
import { statusRank } from "./portFormat";

/**
 * One card per *game*, not per wiki row: several rows can describe different
 * ports of the same title (`Banjo-Kazooie` has BanjoRecomp and Lighthouse, for
 * instance), and the catalog reads better as a games list that opens onto a
 * project switcher.
 *
 * Grouping stays inside a platform: the wiki lists San Francisco Rush 2049
 * under Arcade *and* N64, and those sections must keep their own placement.
 */
export interface PortGameGroup {
  /** Stable key: platform + normalized title. */
  key: string;
  /** Display title, with a trailing project-disambiguation removed. */
  game: string;
  platform: string;
  projects: PortProject[];
  /** The project the card/modal opens on (first wiki row). */
  primary: PortProject;
  /** Best (most complete) status across the group's projects. */
  status: string;
  /** Shared origin, or `""` when the group mixes origins. */
  origin: string;
  languages: string;
  /** Union of supported targets across the group's projects. */
  platforms: string[];
  /** Highest source-provided star count in the group. */
  stars: number | null;
  /** Best community rating (0-5) in the group. */
  communityRating: number | null;
  /** Every catalog that lists at least one project of this game. */
  sources: PortSourceRef[];
}

/**
 * Strip a trailing parenthetical that disambiguates a port article, e.g.
 * `Banjo-Kazooie (Lighthouse)` -> `Banjo-Kazooie`. Four-digit years are real
 * title suffixes (`Perfect Dark (2000)` vs a future remake), so they stay.
 */
export function baseGameName(name: string): string {
  return name
    .replace(/\s*\((?![12]\d{3}\))[^()]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function portGameKey(project: PortProject): string {
  return `${project.platform.toLowerCase()}|${baseGameName(project.game).toLowerCase()}`;
}

function bestStatus(projects: PortProject[]): string {
  const withStatus = projects.filter((project) => project.status);
  if (withStatus.length === 0) return "";
  return [...withStatus].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status),
  )[0].status;
}

const TARGET_ORDER = ["Windows", "macOS", "Linux"];

/** Union of target labels with the card trio first. */
export function orderTargets(targets: string[]): string[] {
  return [...new Set(targets.filter(Boolean))].sort((a, b) => {
    const ai = TARGET_ORDER.indexOf(a);
    const bi = TARGET_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? TARGET_ORDER.length : ai) - (bi === -1 ? TARGET_ORDER.length : bi);
    }
    return a.localeCompare(b);
  });
}

function bestNumber(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value));
  return present.length === 0 ? null : Math.max(...present);
}

export function groupPorts(projects: PortProject[]): PortGameGroup[] {
  const groups = new Map<string, PortProject[]>();
  for (const project of projects) {
    const key = portGameKey(project);
    const bucket = groups.get(key);
    if (bucket) bucket.push(project);
    else groups.set(key, [project]);
  }

  const result: PortGameGroup[] = [];
  for (const [key, bucket] of groups) {
    const primary = bucket[0];
    const origins = [...new Set(bucket.map((project) => project.origin).filter(Boolean))];
    const sources = new Map<string, PortSourceRef>();
    for (const project of bucket) {
      for (const source of project.sources ?? []) {
        if (!sources.has(source.id)) sources.set(source.id, source);
      }
    }
    result.push({
      key,
      game: baseGameName(primary.game) || primary.game,
      platform: primary.platform,
      projects: bucket,
      primary,
      status: bestStatus(bucket),
      origin: origins.length === 1 ? origins[0] : "",
      languages: bucket.find((project) => project.languages)?.languages ?? "",
      platforms: orderTargets(bucket.flatMap((project) => project.platforms ?? [])),
      stars: bestNumber(bucket.map((project) => project.stars)),
      communityRating: bestNumber(bucket.map((project) => project.communityRating)),
      sources: [...sources.values()],
    });
  }
  return result;
}
