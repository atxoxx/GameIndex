import type { PortProject } from "../../types/port";
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
    result.push({
      key,
      game: baseGameName(primary.game) || primary.game,
      platform: primary.platform,
      projects: bucket,
      primary,
      status: bestStatus(bucket),
      origin: origins.length === 1 ? origins[0] : "",
      languages: bucket.find((project) => project.languages)?.languages ?? "",
    });
  }
  return result;
}
