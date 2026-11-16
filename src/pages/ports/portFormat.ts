import type { PortProject } from "../../types/port";

export type PortTone = "success" | "warning" | "info" | "accent" | "default";

/** Colour bucket for a wiki status value. */
export function statusTone(status: string): PortTone {
  const value = status.toLowerCase();
  if (value.includes("playable") || value.includes("released")) return "success";
  if (value.includes("develop") || value.includes("progress") || value.includes("%"))
    return "warning";
  if (value.includes("planned") || value.includes("announce")) return "info";
  if (value.includes("cancel") || value.includes("abandon")) return "default";
  return "default";
}

/** Colour bucket for the port's origin. */
export function originTone(origin: string): PortTone {
  const value = origin.toLowerCase();
  if (value.includes("recomp")) return "accent";
  if (value.includes("decomp") || value.includes("disassem")) return "info";
  if (value.includes("recreat") || value.includes("re-build") || value.includes("rebuild"))
    return "warning";
  return "default";
}

/** Sort rank for status: playable first, then work in progress, then planned. */
export function statusRank(status: string): number {
  const value = status.toLowerCase();
  if (value.includes("playable")) return 0;
  if (value.includes("progress")) return 1;
  if (value.includes("develop")) return 2;
  if (value.includes("pre-release")) return 3;
  if (value.includes("planned")) return 4;
  if (!value) return 6;
  return 5;
}

export function initials(value: string): string {
  const words = value
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const ACCENTS = [
  "var(--color-accent)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-success)",
  "var(--color-danger)",
  "var(--color-ingame)",
];

/** Deterministic accent token per platform, so sections feel colour-coded. */
export function platformAccent(platform: string): string {
  let hash = 0;
  for (let i = 0; i < platform.length; i += 1) {
    hash = (hash * 31 + platform.charCodeAt(i)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length];
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function firstRepoProject(project: PortProject) {
  return project.links.find((link) => link.kind !== "website") ?? project.links[0] ?? null;
}
