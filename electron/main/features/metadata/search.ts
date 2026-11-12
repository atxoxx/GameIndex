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

export function isNotConfigured(error: unknown): boolean {
  return /is not configured/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function searchGameMetadata(
  gameName: string,
  steamAppId?: number | null,
): Promise<MetadataResult[]> {
  const results: MetadataResult[] = [];
  let igdbPinned = false;

  if (steamAppId && steamAppId > 0) {
    const pinned = await fetchIgdbGameBySteamAppid(steamAppId).catch((error) => {
      if (!isNotConfigured(error)) {
        console.warn("[metadata] IGDB appid lookup failed:", error);
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
          if (!isNotConfigured(error)) {
            console.warn("[metadata] IGDB search failed:", error);
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
