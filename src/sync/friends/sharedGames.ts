/**
 * Library -> shared per-game stats.
 *
 * The friends page already derives the same three fields for its own compare /
 * achievement-race view (`selfSharedGames` in `useFriendsSocial` and
 * `useFriendsPageController`). The sync engine needs the identical mapping so a
 * peer's Compare surface and our own local one can never disagree about what a
 * game's playtime is.
 *
 * Kept out of the engine and the adapter so neither has to know about `Game`,
 * and out of `friendsStorage` so importing it never pulls nostr-tools.
 */

import { parsePlayTime, type Game } from "../../types/game";
import type { SharedGameStatInput } from "./engine";

/** Maps the library onto the wire shape the adapter's `setSharedGames` expects. */
export function toSharedGameInputs(games: Game[]): SharedGameStatInput[] {
  return games.map((game) => ({
    id: game.id,
    name: game.name,
    playTimeMin: parsePlayTime(game.playTime ?? ""),
  }));
}
