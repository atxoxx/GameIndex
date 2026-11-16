/**
 * Community VR mods: flat-to-VR mods, UEVR conversions and dedicated ports.
 *
 * The catalog is generated ahead of time by `scripts/build-vr-mods-catalog.mts`
 * from vrportnews.com and pcvrcentral.com, then bundled with the renderer. The
 * renderer groups entries by game and dedupes repository links; GitHub metadata
 * and READMEs are fetched lazily by the main process when a modal is opened.
 */

export type VrSourceId = "vrportnews" | "pcvrcentral";

export type VrModKind = "dedicated" | "uevr" | "conversion" | "unknown";

export type VrLinkKind = "github" | "gitlab" | "website" | "patreon" | "sheet";

export interface VrSourceRef {
  id: VrSourceId;
  name: string;
  /** Page for this entry on that source. */
  url: string;
}

export interface VrModLink {
  label: string;
  url: string;
  kind: VrLinkKind;
  /** Normalized `host:owner/repo`, or null for non-repository links. */
  repoKey: string | null;
}

export interface VrModEntry {
  /** Stable id: source + source-native id/slug. */
  id: string;
  /** Normalized game name; entries sharing it form one card. */
  gameKey: string;
  gameTitle: string;
  modName: string;
  /** One-line summary shown in the modal's Overview tab. */
  description: string;
  /** Longer install / compatibility details, when the source supplies them. */
  details: string;
  /** Deduped links for this entry. */
  links: VrModLink[];
  image: string | null;
  /** ISO date when known. */
  date: string | null;
  kind: VrModKind;
  platforms: string[];
  sources: VrSourceRef[];
  author: string | null;
  compatibility: string | null;
}

export interface VrModGameGroup {
  /** Same value as the entries' gameKey. */
  key: string;
  title: string;
  entries: VrModEntry[];
  /** Deduped GitHub/GitLab links across every entry; drives the modal dropdown. */
  githubLinks: VrModLink[];
  image: string | null;
  date: string | null;
  kinds: VrModKind[];
  platforms: string[];
  sources: VrSourceRef[];
  author: string | null;
}

export interface VrSourceSummary {
  id: VrSourceId;
  name: string;
  url: string;
  count: number;
  ok: boolean;
  error?: string;
}

export interface VrModsCatalog {
  source: string;
  /** Epoch ms when the snapshot was generated. */
  generatedAt: number;
  stale: boolean;
  entries: VrModEntry[];
  /** Optional pre-grouped view; the renderer regroups from `entries` so a
   * filtered result can drop entries without re-reading the snapshot. */
  groups?: VrModGameGroup[];
  sources: VrSourceSummary[];
}

export interface VrRepoMeta {
  host: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
  description: string | null;
  stars: number | null;
  language: string | null;
  updatedAt: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  openIssues: number | null;
}

export interface VrReadme {
  markdown: string;
  sourceUrl: string;
  repo: VrRepoMeta | null;
  error?: string;
}

export const VR_SOURCES: Record<VrSourceId, { name: string; url: string }> = {
  vrportnews: { name: "VR Port News", url: "https://vrportnews.com" },
  pcvrcentral: { name: "PCVR Central", url: "https://pcvrcentral.com/mods" },
};

export const VR_SOURCE_PRIORITY: VrSourceId[] = ["vrportnews", "pcvrcentral"];
