/**
 * Unified metadata search used by library enrichment.
 *
 * Ported from `game_scraper/metadata.rs`. Steam-synced titles are pinned by
 * appid through IGDB's `external_games` bridge, so same-name collisions
 * cannot select the wrong game; HowLongToBeat is attached to the best IGDB
 * candidate (or the first result) as the last step.
 */
import {
  fetchIgdbGameById,
  fetchIgdbGameBySteamAppid,
  searchIgdb,
  type MetadataResult,
} from "./igdb";
import { fetchSteamGenresAndTags, fetchSteamGameByAppId, searchSteam } from "./steam";
import { fetchTimeToBeat } from "./hltb";
import { titleMatchesGame } from "./text";

const warned = new Set<string>();

/** Provider outages (missing key, auth, cooldown, network) are expected states. */
function providerUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /is not configured|authentication failed|cooling down|fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|HTTP 5\d\d|rate.?limit|timed out/i.test(
    message,
  );
}

/** Log each distinct provider failure once per session, not once per game. */
function warnOnce(label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${label}|${message.slice(0, 80)}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[metadata] ${label}:`, error);
}

export async function searchGameMetadata(
  gameName: string,
  steamAppId?: number | null,
): Promise<MetadataResult[]> {
  const results: MetadataResult[] = [];
  let igdbPinned = false;
  let appIdRejected = false;
  let rejectedPin: MetadataResult | null = null;

  if (steamAppId && steamAppId > 0) {
    const pinned = await fetchIgdbGameBySteamAppid(steamAppId).catch((error) => {
      if (!providerUnavailable(error)) {
        warnOnce("IGDB appid lookup failed", error);
      } else {
        warnOnce("IGDB appid lookup unavailable", error);
      }
      return null;
    });
    if (pinned && !titleMatchesGame(gameName, pinned.title)) {
      // A persisted appid can be stale or wrong (legacy fuzzy Steam lookups
      // matched `Star Citizen` to `Citizen Sleeper 2`, for example). The appid
      // would otherwise pin every refresh to that wrong game. Ignore it and
      // resolve by title instead; the caller clears the stored appid when the
      // returned results carry `steamAppIdMismatch`.
      appIdRejected = true;
      rejectedPin = pinned;
      warnOnce(
        "IGDB appid ignored",
        new Error(`${gameName} -> appid ${steamAppId} is ${pinned.title}`),
      );
    } else if (pinned) {
      const steamTags = await fetchSteamGenresAndTags(steamAppId);
      if (steamTags.length) {
        const merged = [...pinned.genres];
        const seen = new Set(merged.map((genre) => genre.toLowerCase()));
        for (const tag of steamTags) {
          if (!seen.has(tag.toLowerCase())) {
            seen.add(tag.toLowerCase());
            merged.push(tag);
          }
        }
        pinned.genres = merged;
      }
      results.push(pinned);
      igdbPinned = true;
    } else {
      const steam = await fetchSteamGameByAppId(steamAppId);
      if (steam) {
        results.push(steam);
        igdbPinned = true;
      }
    }
  }

  // Steam and IGDB in parallel; LaunchBox metadata is not ported (its image
  // gallery still is, via `search_launchbox_images`).
  const [steamResult, igdbResults] = await Promise.all([
    searchSteam(gameName).catch((error) => {
      console.warn("[metadata] Steam search failed:", error);
      return null;
    }),
    igdbPinned
      ? Promise.resolve<MetadataResult[]>([])
      : searchIgdb(gameName).catch((error) => {
          if (!providerUnavailable(error)) {
            warnOnce("IGDB search failed", error);
          } else {
            warnOnce("IGDB search unavailable", error);
          }
          return [];
        }),
  ]);
  if (steamResult) results.push(steamResult);
  if (appIdRejected && igdbResults.length === 0 && rejectedPin) {
    // The appid title did not resemble the query, but a title search found
    // nothing either. Keep the pinned row rather than losing metadata for an
    // abbreviation or a heavily localized name.
    results.push(rejectedPin);
    appIdRejected = false;
  }
  if (appIdRejected) {
    for (const result of igdbResults) result.steamAppIdMismatch = true;
  }
  results.push(...igdbResults);

  if (results.length > 0) {
    const index = Math.max(
      0,
      results.findIndex((result) => result.sourceName === "IGDB"),
    );
    if (!results[index].timeToBeat) {
      const timeToBeat = await fetchTimeToBeat(results[index].title).catch(() => null);
      if (timeToBeat) results[index].timeToBeat = timeToBeat;
    }
  }

  return results;
}

/** `get_igdb_game_by_id` with the HowLongToBeat attachment the UI expects. */
export async function getIgdbGameById(
  id: number,
  gameName?: string | null,
): Promise<MetadataResult | null> {
  const game = await fetchIgdbGameById(id);
  if (!game) return null;
  // A stale stored id must not keep pinning a row to the wrong game. Without
  // a name (programmatic callers), the id remains authoritative.
  if (gameName && gameName.trim() && !titleMatchesGame(gameName, game.title)) {
    warnOnce("IGDB id ignored", new Error(`${gameName} -> id ${id} is ${game.title}`));
    return null;
  }
  if (!game.timeToBeat) {
    const timeToBeat = await fetchTimeToBeat(game.title).catch(() => null);
    if (timeToBeat) game.timeToBeat = timeToBeat;
  }
  return game;
}
