/**
 * Achievements cache + achievement-links persistence.
 *
 * Port of `src-tauri/src/db/achievements.rs` and
 * `src-tauri/src/db/achievement_links.rs` onto the dependency-free JSON stores
 * this build uses. The Rust build kept one row per game in SQLite; here the
 * whole map lives in two small documents under `userData`:
 *
 *   achievements.json        `{ version, games: { <gameId>: GameAchievementData } }`
 *   achievement-links.json   `{ version, links: { <gameId>: { <source>: AchievementLink } } }`
 *
 * Write rules are the Rust ones, because the renderer depends on them:
 *
 *  • a re-sync can never relock an achievement already cached for the same
 *    source (unlocks are unioned, earliest unlock time wins);
 *  • an empty re-sync over a non-empty row of the same source is skipped, so a
 *    transient Steam hiccup cannot wipe a good list;
 *  • switching a game's source (e.g. steam → manual) replaces the row instead
 *    of inheriting another provider's unlock flags.
 *
 * Links are separate from the cache: a game may hold several source identities
 * at once, and the `manual` link also carries the persisted manual-unlock map.
 */
import type {
  Achievement,
  AchievementLink,
  AchievementSource,
  GameAchievementData,
} from "../../../../src/types/game";
import { createJsonStore } from "../../state/jsonStore";
import { apiNameKey, clampPercent, normalizeLastSynced, nowSeconds } from "./util";

const SOURCES: readonly AchievementSource[] = ["steam", "retro", "manual", "gog", "epic"];

function isSource(value: unknown): value is AchievementSource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// ── Payload normalization ─────────────────────────────────────────────

function normalizeAchievement(raw: unknown): Achievement | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const apiName = str(row.apiName).trim();
  if (!apiName) return null;
  return {
    apiName,
    displayName: str(row.displayName),
    description: str(row.description),
    icon: str(row.icon),
    iconGray: str(row.iconGray),
    achieved: row.achieved === true,
    unlockTime: Math.max(0, Math.trunc(num(row.unlockTime))),
    percent: clampPercent(num(row.percent)),
  };
}

/** Recompute the counters from the row list (the renders trust these). */
function withCounts(data: GameAchievementData): GameAchievementData {
  const total = data.achievements.length;
  const unlocked = data.achievements.reduce((count, a) => count + (a.achieved ? 1 : 0), 0);
  return { ...data, total, unlocked, locked: total - unlocked };
}

export function normalizeGameData(
  raw: unknown,
  fallbackSource: AchievementSource = "steam",
): GameAchievementData | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const achievements: Achievement[] = [];
  if (Array.isArray(row.achievements)) {
    for (const entry of row.achievements) {
      const normalized = normalizeAchievement(entry);
      if (normalized) achievements.push(normalized);
    }
  }
  const lastSynced = normalizeLastSynced(num(row.lastSynced));
  return withCounts({
    steamAppId: Math.max(0, Math.trunc(num(row.steamAppId))),
    achievements,
    total: 0,
    unlocked: 0,
    locked: 0,
    lastSynced: lastSynced > 0 ? lastSynced : undefined,
    source: isSource(row.source) ? row.source : fallbackSource,
    providerId: optionalStr(row.providerId),
  });
}

function normalizeDocument(raw: unknown): AchievementsDocument {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const games: Record<string, GameAchievementData> = {};
  const source = doc.games;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [gameId, value] of Object.entries(source as Record<string, unknown>)) {
      const normalized = normalizeGameData(value);
      if (normalized) games[gameId] = normalized;
    }
  }
  return { version: 1, games };
}

export interface AchievementsDocument {
  version: number;
  games: Record<string, GameAchievementData>;
}

const cacheStore = createJsonStore<AchievementsDocument>(
  "achievements.json",
  () => ({ version: 1, games: {} }),
  normalizeDocument,
);

// ── Cache reads ───────────────────────────────────────────────────────

export function listCachedGames(): Record<string, GameAchievementData> {
  return cacheStore.read().games;
}

export function getCachedGame(gameId: string): GameAchievementData | null {
  return cacheStore.read().games[gameId] ?? null;
}

/**
 * Find the cached payload for a Steam appid (Steam rows only — retrospective
 * and manual payloads use the provider id, not `steamAppId`).
 */
export function findCachedBySteamAppId(
  steamAppId: number,
): { gameId: string; data: GameAchievementData } | null {
  if (!steamAppId || steamAppId <= 0) return null;
  for (const [gameId, data] of Object.entries(cacheStore.read().games)) {
    if (data.source === "steam" && data.steamAppId === steamAppId) {
      return { gameId, data };
    }
  }
  return null;
}

// ── Cache writes ──────────────────────────────────────────────────────

export interface UpsertOptions {
  /** Defaults to the payload's own `source`, else "steam". */
  source?: AchievementSource;
  providerId?: string | null;
  steamAppId?: number;
  /** Unix ms; defaults to the payload's `lastSynced`. */
  lastSynced?: number;
}

/** Previously-achieved lookup: uppercased api name → unlock seconds. */
function achievedMap(data: GameAchievementData | null): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of data?.achievements ?? []) {
    if (a.achieved) map.set(apiNameKey(a.apiName), a.unlockTime);
  }
  return map;
}

/**
 * Apply the never-relock union to `incoming` (mutating its rows) and return the
 * merged payload. Returns `null` when the write must be skipped.
 */
function mergePayload(
  existing: GameAchievementData | null,
  incoming: GameAchievementData,
  source: AchievementSource,
): GameAchievementData | null {
  if (!existing || existing.source !== source) {
    return withCounts({ ...incoming, source });
  }

  if (incoming.achievements.length === 0 && existing.achievements.length > 0) {
    return null;
  }

  const previous = achievedMap(existing);
  if (previous.size === 0) return withCounts({ ...incoming, source });

  for (const achievement of incoming.achievements) {
    const previousTime = previous.get(apiNameKey(achievement.apiName));
    if (previousTime === undefined) continue;
    achievement.achieved = true;
    // Preserve the earliest known unlock time.
    if (achievement.unlockTime === 0) achievement.unlockTime = previousTime;
    else if (previousTime > 0) achievement.unlockTime = Math.min(achievement.unlockTime, previousTime);
  }
  return withCounts({ ...incoming, source });
}

/** Persist one game's payload, applying the shared write rules. */
export function upsertGame(
  gameId: string,
  payload: GameAchievementData,
  options: UpsertOptions = {},
): GameAchievementData {
  const existing = getCachedGame(gameId);
  const source = options.source ?? payload.source ?? existing?.source ?? "steam";
  const steamAppId =
    options.steamAppId !== undefined ? options.steamAppId : payload.steamAppId;
  const providerId =
    options.providerId !== undefined ? options.providerId : payload.providerId ?? null;
  const lastSyncedValue =
    options.lastSynced !== undefined ? options.lastSynced : payload.lastSynced ?? 0;
  const lastSynced = normalizeLastSynced(lastSyncedValue);

  const incoming = withCounts({
    ...payload,
    achievements: payload.achievements.map((achievement) => ({ ...achievement })),
    steamAppId: Math.max(0, Math.trunc(steamAppId || 0)),
    source,
    providerId: providerId ?? undefined,
    lastSynced: lastSynced > 0 ? lastSynced : payload.lastSynced,
  });

  const merged = mergePayload(existing, incoming, source);
  if (!merged) return existing as GameAchievementData;

  cacheStore.update((doc) => {
    doc.version = 1;
    doc.games[gameId] = merged;
    return doc;
  });
  return merged;
}

/** `save_achievement`: the renderer ships the payload as a JSON string. */
export function saveGamePayload(gameId: string, json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Could not parse the achievement payload for "${gameId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const data = normalizeGameData(parsed);
  if (!data) throw new Error(`The achievement payload for "${gameId}" is not an object.`);
  upsertGame(gameId, data, {
    source: data.source ?? "steam",
    providerId: data.providerId ?? null,
    steamAppId: data.steamAppId,
    lastSynced: data.lastSynced ?? 0,
  });
}

/**
 * `save_achievements_cache`: the whole `{ games: { … } }` blob.
 * An empty map clears the cache — the frontend's `clearCache()` ships exactly
 * `{"games":{}}`, and a no-op there would resurrect every deleted row.
 */
export function replaceCacheFromPayload(json: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Could not parse the achievements cache: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const games = (parsed as { games?: unknown } | null)?.games;
  if (!games || typeof games !== "object" || Array.isArray(games)) {
    throw new Error('The achievements cache payload needs a "games" object.');
  }
  const entries = Object.entries(games as Record<string, unknown>);
  if (entries.length === 0) {
    clearCache();
    return;
  }

  cacheStore.update((doc) => {
    doc.version = 1;
    for (const [gameId, value] of entries) {
      const incoming = normalizeGameData(value);
      if (!incoming) continue;
      const source = incoming.source ?? "steam";
      const merged = mergePayload(doc.games[gameId] ?? null, incoming, source);
      if (merged) doc.games[gameId] = merged;
    }
    return doc;
  });
}

/** `load_achievements_cache`: the same shape the renderer expects. */
export function cachePayload(): { games: Record<string, GameAchievementData> } {
  const doc = cacheStore.read();
  const games: Record<string, GameAchievementData> = {};
  for (const [gameId, data] of Object.entries(doc.games)) games[gameId] = data;
  return { games };
}

export function deleteCachedGame(gameId: string): void {
  const doc = cacheStore.read();
  if (!(gameId in doc.games)) return;
  cacheStore.update((current) => {
    delete current.games[gameId];
    return current;
  });
}

export function clearCache(): void {
  cacheStore.write({ version: 1, games: {} });
}

// ── Achievement links ─────────────────────────────────────────────────

interface LinksDocument {
  version: number;
  links: Record<string, Record<string, AchievementLink>>;
}

function normalizeManualUnlocks(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const time = Math.trunc(num(value));
    if (key && time > 0) out[key] = time;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeLink(raw: unknown): AchievementLink | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const gameId = str(row.gameId);
  const source = isSource(row.source) ? row.source : null;
  if (!gameId || !source) return null;
  return {
    gameId,
    source,
    providerId: optionalStr(row.providerId) ?? null,
    displayName: optionalStr(row.displayName) ?? null,
    sourceUrl: optionalStr(row.sourceUrl) ?? null,
    manualUnlocks: normalizeManualUnlocks(row.manualUnlocks) ?? null,
    createdAt: Math.max(0, Math.trunc(num(row.createdAt))),
    updatedAt: Math.max(0, Math.trunc(num(row.updatedAt))),
  };
}

function normalizeLinksDocument(raw: unknown): LinksDocument {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const links: Record<string, Record<string, AchievementLink>> = {};
  const source = doc.links;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [gameId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const bySource: Record<string, AchievementLink> = {};
      for (const link of Object.values(value as Record<string, unknown>)) {
        const normalized = normalizeLink(link);
        if (normalized && normalized.gameId === gameId) bySource[normalized.source] = normalized;
      }
      if (Object.keys(bySource).length > 0) links[gameId] = bySource;
    }
  }
  return { version: 1, links };
}

const linksStore = createJsonStore<LinksDocument>(
  "achievement-links.json",
  () => ({ version: 1, links: {} }),
  normalizeLinksDocument,
);

/** `achievement_links_list`: `{ <gameId>: AchievementLink[] }`. */
export function listAllLinks(): Record<string, AchievementLink[]> {
  const out: Record<string, AchievementLink[]> = {};
  for (const [gameId, bySource] of Object.entries(linksStore.read().links)) {
    out[gameId] = Object.values(bySource).sort((a, b) => a.source.localeCompare(b.source));
  }
  return out;
}

export function getLinksForGame(gameId: string): AchievementLink[] {
  return Object.values(linksStore.read().links[gameId] ?? {}).sort((a, b) =>
    a.source.localeCompare(b.source),
  );
}

export function getLink(gameId: string, source: AchievementSource): AchievementLink | null {
  return linksStore.read().links[gameId]?.[source] ?? null;
}

/**
 * Upsert one link. `createdAt` is only set on insert (preserved on conflict);
 * `updatedAt` is always refreshed, mirroring the SQL `ON CONFLICT` clause.
 */
export function upsertLink(input: AchievementLink): AchievementLink {
  const existing = getLink(input.gameId, input.source);
  const now = nowSeconds();
  const link: AchievementLink = {
    gameId: input.gameId,
    source: input.source,
    providerId: input.providerId ?? null,
    displayName: input.displayName ?? null,
    sourceUrl: input.sourceUrl ?? null,
    manualUnlocks: input.manualUnlocks ?? null,
    createdAt: existing?.createdAt && existing.createdAt > 0 ? existing.createdAt : now,
    updatedAt: now,
  };
  linksStore.update((doc) => {
    doc.version = 1;
    const bySource = doc.links[link.gameId] ?? {};
    bySource[link.source] = link;
    doc.links[link.gameId] = bySource;
    return doc;
  });
  return link;
}

export function deleteLink(gameId: string, source: AchievementSource): void {
  const doc = linksStore.read();
  if (!doc.links[gameId]?.[source]) return;
  linksStore.update((current) => {
    const bySource = current.links[gameId];
    if (bySource) {
      delete bySource[source];
      if (Object.keys(bySource).length === 0) delete current.links[gameId];
    }
    return current;
  });
}

export function readManualUnlocks(
  gameId: string,
  source: AchievementSource,
): Record<string, number> {
  return getLink(gameId, source)?.manualUnlocks ?? {};
}

/**
 * Merge a fresh manual-unlock map into the persisted one. The union never
 * removes an already-unlocked achievement; a later save's value for an
 * existing key wins.
 */
export function updateManualUnlocks(
  gameId: string,
  source: AchievementSource,
  unlocks: Record<string, number>,
): Record<string, number> {
  const existing = getLink(gameId, source);
  const merged: Record<string, number> = { ...(existing?.manualUnlocks ?? {}) };
  for (const [apiName, unlockTime] of Object.entries(unlocks)) {
    const time = Math.trunc(unlockTime);
    if (apiName && time > 0) merged[apiName] = time;
  }
  if (existing) {
    upsertLink({ ...existing, manualUnlocks: merged });
  }
  return merged;
}
