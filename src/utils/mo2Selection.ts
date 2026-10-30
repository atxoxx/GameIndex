// Pure helpers for picking a Mod Organizer 2 instance, profile and
// executable. Shared by the Mo2 hook (picker UI) and the launch path so both
// resolve the same selection from the same persisted preferences.

import type { Mo2Instance } from "../types/mo2";

export interface Mo2Selection {
  instance: Mo2Instance;
  profile: string;
  executable: string;
}

export interface SelectMo2InstanceOptions {
  /** Return the first instance even when it is unrelated to the game.
   *  Only for display; the launch path must never fall back this way. */
  allowUnrelatedFallback?: boolean;
}

export interface ResolveMo2SelectionOptions {
  instancePath?: string | null;
  profile?: string | null;
  executable?: string | null;
  gamePath?: string | null;
  allowUnrelatedFallback?: boolean;
}

const DEFAULT_PROFILE = "Default";

function normalize(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function fileName(value: string): string {
  const parts = value.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function looksLikePath(value: string): boolean {
  // A bare file name can be a custom-executable title in MO2, so only a
  // separated path is treated as a literal target.
  return /[/\\]/.test(value);
}

function relevanceOf(instance: Mo2Instance): number {
  return typeof instance.relevance === "number" ? instance.relevance : 0;
}

/** Pick the instance that should back this game: an explicit preferred path
 *  wins, then the most relevant detected instance. Unrelated instances are
 *  only returned when `allowUnrelatedFallback` is set. */
export function selectMo2Instance(
  instances: Mo2Instance[] | null | undefined,
  preferredPath?: string | null,
  opts: SelectMo2InstanceOptions = {},
): Mo2Instance | null {
  const list = instances ?? [];
  if (list.length === 0) return null;

  const wanted = normalize(preferredPath);
  if (wanted) {
    const matched = list.find((i) => normalize(i.instancePath) === wanted);
    if (matched) return matched;
  }

  const relevant = list.find((i) => relevanceOf(i) > 0);
  if (relevant) return relevant;

  return opts.allowUnrelatedFallback ? list[0] : null;
}

function resolveProfile(instance: Mo2Instance, requested?: string | null): string {
  const profiles = instance.profiles ?? [];
  const selected = instance.selectedProfile ?? "";
  const candidates: string[] = [];
  if (selected) candidates.push(selected);
  for (const p of profiles) {
    if (!candidates.some((c) => normalize(c) === normalize(p))) candidates.push(p);
  }

  const wanted = normalize(requested);
  if (wanted) {
    const matched = candidates.find((p) => normalize(p) === wanted);
    if (matched) return matched;
  }

  if (selected) return selected;
  if (profiles.length > 0) return profiles[0];
  return DEFAULT_PROFILE;
}

function resolveExecutable(
  instance: Mo2Instance,
  requested?: string | null,
  gamePath?: string | null,
): string {
  const executables = instance.customExecutables ?? [];
  const wanted = (requested ?? "").trim();

  if (wanted) {
    const wantedLower = normalize(wanted);
    const byTitle = executables.find((e) => normalize(e.title) === wantedLower);
    if (byTitle) return byTitle.title;
    const byPath = executables.find((e) => normalize(e.path) === wantedLower);
    if (byPath) return byPath.title;
    if (looksLikePath(wanted)) return wanted;
  }

  const wantedGame = normalize(gamePath);
  if (wantedGame) {
    const wantedGameFile = fileName(wantedGame);
    const byGamePath = executables.find((e) => {
      const exePath = normalize(e.path);
      return (
        exePath === wantedGame ||
        (wantedGameFile.length > 0 && exePath.endsWith(wantedGameFile)) ||
        (wantedGameFile.length > 0 && normalize(fileName(e.path)) === wantedGameFile)
      );
    });
    if (byGamePath) return byGamePath.title;
  }

  return executables[0]?.title ?? "";
}

/** Resolve instance + profile + executable for one game in a single step. */
export function resolveMo2Selection(
  instances: Mo2Instance[] | null | undefined,
  opts: ResolveMo2SelectionOptions,
): Mo2Selection | null {
  const instance = selectMo2Instance(instances, opts.instancePath, {
    allowUnrelatedFallback: opts.allowUnrelatedFallback,
  });
  if (!instance) return null;

  return {
    instance,
    profile: resolveProfile(instance, opts.profile),
    executable: resolveExecutable(instance, opts.executable, opts.gamePath),
  };
}

/** Merge instance lists, deduping by case-insensitive instance path and
 *  keeping the entry with the highest relevance. */
export function mergeMo2Instances(
  ...lists: Array<Mo2Instance[] | null | undefined>
): Mo2Instance[] {
  const byPath = new Map<string, Mo2Instance>();

  for (const list of lists) {
    for (const instance of list ?? []) {
      if (!instance) continue;
      const key = normalize(instance.instancePath) || `id:${instance.id ?? ""}`;
      const prev = byPath.get(key);
      if (!prev || relevanceOf(instance) > relevanceOf(prev)) {
        byPath.set(key, instance);
      }
    }
  }

  return [...byPath.values()].sort((a, b) => {
    const diff = relevanceOf(b) - relevanceOf(a);
    if (diff !== 0) return diff;
    return a.instancePath.localeCompare(b.instancePath);
  });
}
