/**
 * itch.io commands for the Deals page subtab and the itch.io game route.
 *
 * Thin layer: argument coercion only. Browsing/detail parsing lives in
 * `features/itch/browse.ts`, the player window in `features/itch/player.ts`.
 */
import { registerCommands, type CommandHandler } from "../ipc";
import {
  fetchItchGameDetail,
  fetchItchGames,
  fetchItchOwnedGames,
  resolveItchDownload,
} from "../features/itch/browse";
import { closeItchPlayer, openItchPlayer } from "../features/itch/player";

export const itchCommands: Record<string, CommandHandler> = {
  fetch_itch_games: (args) => fetchItchGames(args.filters),

  fetch_itch_game_detail: (args) => fetchItchGameDetail(args.url),

  fetch_itch_owned_games: (args) => fetchItchOwnedGames(args.page),

  resolve_itch_download: (args) => resolveItchDownload(args.url, args.uploadId),

  open_itch_player: (args) =>
    openItchPlayer({
      gameId: String(args.gameId ?? ""),
      title: String(args.title ?? "itch.io"),
      playUrl: typeof args.playUrl === "string" ? args.playUrl : null,
      pageUrl: String(args.pageUrl ?? ""),
    }),

  close_itch_player: (args) => closeItchPlayer(args.gameId),
};

export function registerItchCommands(): void {
  registerCommands(itchCommands, { override: true });
}
