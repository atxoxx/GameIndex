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

  if (steamAppId && steamAppId > 0) {
    const pinned = await fetchIgdbGameBySteamAppid(steamAppId).catch((error) => {
      if (!providerUnavailable(error)) {
        warnOnce("IGDB appid lookup failed", error);
      } else {
        warnOnce("IGDB appid lookup unavailable", error);
      }
      return null;
    });
    if (pinned) {
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
export async function getIgdbGameById(id: number): Promise<MetadataResult | null> {
  const game = await fetchIgdbGameById(id);
  if (!game) return null;
  if (!game.timeToBeat) {
    const timeToBeat = await fetchTimeToBeat(game.title).catch(() => null);
    if (timeToBeat) game.timeToBeat = timeToBeat;
  }
  return game;
}
