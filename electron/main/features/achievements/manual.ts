/**
 * Manual achievement provider.
 *
 * Port of `src-tauri/src/manual_links.rs`. The user links a non-Steam library
 * row to a public Steam appid; Steam is only the *schema* source (display
 * names, icons, descriptions) and unlock state is entered by hand and persisted
 * in the game's `manual` achievement link.
 *
 * The manual link row carries the provider appid (`providerId`) and the
 * unlock map (`manualUnlocks`, api name → unix seconds). The cached payload is
 * tagged `source: "manual"` with `steamAppId: 0`, matching Rust.
 */
import type {
  Achievement,
  AchievementLink,
  GameAchievementData,
  ManualUnlock,
} from "../../../../src/types/game";
import { fetchSteamSchema } from "./steam";
import {
  deleteLink,
  getCachedGame,
  getLink,
  readManualUnlocks,
  updateManualUnlocks,
  upsertGame,
  upsertLink,
} from "./store";
import { apiNameKey, nowSeconds } from "./util";

const MANUAL_SOURCE = "manual";

// ── Schema parsing + payload building (pure) ──────────────────────────

interface SchemaAchievementRow {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  icon?: unknown;
  icongray?: unknown;
  hidden?: unknown;
}

function rowString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse a raw `GetSchemaForGame/v2` body into schema rows. Every row comes back
 * locked with no rarity — Steam's schema carries no unlock state, and manual
 * sources do not display rarity.
 */
export function parseSchemaResponse(json: string): Achievement[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Could not parse the Steam achievement schema: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const game = (parsed as { game?: { availableGameStats?: { achievements?: unknown } } } | null)
    ?.game;
  const rows = game?.availableGameStats?.achievements;
  if (!Array.isArray(rows)) return [];
  const out: Achievement[] = [];
  for (const entry of rows as SchemaAchievementRow[]) {
    const apiName = rowString(entry?.name);
    if (!apiName) continue;
    out.push({
      apiName,
      displayName: rowString(entry?.displayName),
      description:
        Number(entry?.hidden ?? 0) === 1
          ? "Hidden achievement"
          : rowString(entry?.description),
      icon: rowString(entry?.icon),
      iconGray: rowString(entry?.icongray),
      achieved: false,
      unlockTime: 0,
      percent: 0,
    });
  }
  return out;
}

/**
 * Overlay the persisted manual-unlock map onto a fetched schema and recompute
 * the counters. Matching uses the uppercased api name; the earliest known
 * unlock time wins.
 */
export function buildPayloadFromSchema(
  schema: Achievement[],
  unlocks: Record<string, number>,
): GameAchievementData {
  const normalized = new Map<string, number>();
  for (const [apiName, unlockTime] of Object.entries(unlocks)) {
    const time = Math.trunc(unlockTime);
    if (time > 0) normalized.set(apiNameKey(apiName), time);
  }

  const achievements = schema.map((achievement) => ({ ...achievement }));
  let unlocked = 0;
  for (const achievement of achievements) {
    const time = normalized.get(apiNameKey(achievement.apiName));
    if (time !== undefined && time > 0) {
      achievement.achieved = true;
      achievement.unlockTime =
        achievement.unlockTime === 0
          ? time
          : Math.min(achievement.unlockTime, time);
    }
    if (achievement.achieved) unlocked += 1;
  }

  // Unlocked first (newest unlock first), then locked by api name — manual
  // schemas carry no rarity, so name order is the only meaningful order.
  achievements.sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? -1 : 1;
    if (a.achieved) return b.unlockTime - a.unlockTime;
    return a.apiName.localeCompare(b.apiName);
  });

  return {
    steamAppId: 0,
    achievements,
    total: achievements.length,
    unlocked,
    locked: achievements.length - unlocked,
    lastSynced: nowSeconds(),
    source: MANUAL_SOURCE,
  };
}

// ── Link persistence ──────────────────────────────────────────────────

/**
 * Create or update the `manual` link for a game.
 *
 * Re-upserting the same appid preserves the persisted unlock map; re-linking to
 * a different appid starts fresh (api names from the old game are meaningless
 * on the new one).
 */
export function upsertManualLink(
  gameId: string,
  appid: number,
  name?: string | null,
): AchievementLink {
  if (!Number.isFinite(appid) || appid <= 0) {
    throw new Error("A valid Steam AppID is required to link a manual game.");
  }
  const appidText = String(Math.trunc(appid));
  const existing = getLink(gameId, MANUAL_SOURCE);
  const keepUnlocks = existing?.providerId === appidText ? existing?.manualUnlocks ?? null : null;

  return upsertLink({
    gameId,
    source: MANUAL_SOURCE,
    providerId: appidText,
    displayName: name ?? existing?.displayName ?? null,
    sourceUrl: `https://steamcommunity.com/stats/${appidText}/achievements`,
    manualUnlocks: keepUnlocks,
  });
}

export function removeManualLink(gameId: string): void {
  deleteLink(gameId, MANUAL_SOURCE);
}

export function manualLinkAppid(gameId: string): number {
  const providerId = getLink(gameId, MANUAL_SOURCE)?.providerId ?? null;
  const parsed = providerId ? Number(providerId) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `No manual achievement link for game "${gameId}" — link it to a Steam app first.`,
    );
  }
  return Math.trunc(parsed);
}

// ── Payload persistence + sync ────────────────────────────────────────

function persistManualPayload(
  gameId: string,
  appid: number,
  schema: Achievement[],
  unlocks: Record<string, number>,
): GameAchievementData {
  const providerId = String(Math.trunc(appid));
  const data = buildPayloadFromSchema(schema, unlocks);
  data.providerId = providerId;
  return upsertGame(gameId, data, {
    source: MANUAL_SOURCE,
    providerId,
    steamAppId: 0,
    lastSynced: data.lastSynced,
  });
}

async function rebuildManualPayload(
  gameId: string,
  appid: number,
  unlocks: Record<string, number>,
): Promise<GameAchievementData> {
  const schema = await fetchSteamSchema(appid, "english");
  if (schema.length === 0) {
    throw new Error(`Steam returned no achievements for appid ${appid}.`);
  }
  return persistManualPayload(gameId, appid, schema, unlocks);
}

/** `manual_save_unlocks`: persist the editor state, then rebuild the payload. */
export async function saveManualUnlocks(
  gameId: string,
  unlocks: ManualUnlock[],
): Promise<GameAchievementData> {
  const appid = manualLinkAppid(gameId);
  const incoming: Record<string, number> = {};
  for (const unlock of unlocks) {
    const apiName = typeof unlock?.apiName === "string" ? unlock.apiName : "";
    const time = Math.trunc(Number(unlock?.unlockTime ?? 0));
    if (apiName && Number.isFinite(time) && time > 0) incoming[apiName] = time;
  }
  const merged = updateManualUnlocks(gameId, MANUAL_SOURCE, incoming);
  return rebuildManualPayload(gameId, appid, merged);
}

/**
 * `manual_sync`: refresh the schema and re-apply the stored unlocks. A failed
 * or empty refresh keeps the existing cached payload when it is itself manual.
 */
export async function syncManual(gameId: string): Promise<GameAchievementData> {
  const appid = manualLinkAppid(gameId);
  const unlocks = readManualUnlocks(gameId, MANUAL_SOURCE);

  try {
    const schema = await fetchSteamSchema(appid, "english");
    if (schema.length > 0) {
      return persistManualPayload(gameId, appid, schema, unlocks);
    }
  } catch (error) {
    console.warn(
      `[achievements] manual schema refresh failed for appid ${appid}:`,
      error instanceof Error ? error.message : error,
    );
  }

  const existing = getCachedGame(gameId);
  if (!existing) {
    throw new Error(
      `No cached achievements for game "${gameId}" and the Steam schema refresh failed.`,
    );
  }
  if (existing.source !== MANUAL_SOURCE) {
    throw new Error(
      `Cached achievements for game "${gameId}" are not from the manual source ` +
        `(source="${existing.source ?? "steam"}") — refusing to serve them as manual data.`,
    );
  }
  return existing;
}

/** `manual_fetch_schema`: public Steam schema, no unlock state. */
export async function fetchManualSchema(appid: number): Promise<Achievement[]> {
  return fetchSteamSchema(appid, "english");
}
