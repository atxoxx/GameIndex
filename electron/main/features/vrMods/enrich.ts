/**
 * GitHub/GitLab enrichment for the VR mods catalog.
 *
 * The ports feature already implements exactly what we need: raw README files
 * (no rate limit) plus cached repository metadata from the GitHub REST API.
 * Reusing it keeps one credential path, one on-disk cache and one in-flight
 * request map, so a repo shared by a port and a VR mod is fetched only once.
 * The returned shapes are structurally identical to the VR-specific types.
 */
import { fetchPortReadme, fetchPortRepoMeta } from "../ports/readme";
import type { VrReadme, VrRepoMeta } from "../../../../src/types/vrMod";

export function fetchVrRepoMeta(rawUrl: string): Promise<VrRepoMeta | null> {
  return fetchPortRepoMeta(rawUrl) as Promise<VrRepoMeta | null>;
}

export function fetchVrReadme(rawUrl: string): Promise<VrReadme> {
  return fetchPortReadme(rawUrl) as Promise<VrReadme>;
}
