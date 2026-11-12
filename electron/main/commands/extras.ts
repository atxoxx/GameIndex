/**
 * Store-page and metadata extras: CrackWatch, playtester feeds, Steam page
 * features, recommended config, collections and relations, text-file helpers,
 * the download resolver, and overlay game detection.
 *
 * Workstream: `extras`. Reference: `git show 1b4a698b:src-tauri/src/`
 * (`crackwatch.rs`, `deals.rs`, `game_scraper/steam_about.rs`,
 * `game_scraper/relations.rs`, `downloads/browser_resolver.rs`,
 * `overlay_detect.rs`, `media.rs` for the text-file helpers).
 */
import { shell } from "electron";

import { registerCommands, type CommandHandler } from "../ipc";
import {
  fetchCrackwatchStatus,
  fetchCrackwatchStatusBatch,
} from "../features/extras/crackwatch";
import {
  fetchPlaytesterGameDetail,
  fetchPlaytesterGames,
} from "../features/extras/playtester";
import {
  getAboutBundle,
  getRecommendedConfig,
  getSteamPageFeatures,
} from "../features/extras/steamPage";
import { getCollectionGames, getGameRelations } from "../features/extras/igdbRelations";
import { readTextFile, saveTextFile } from "../features/extras/textFiles";
import { openDownloadResolver } from "../features/extras/resolver";
import { overlayDetectGame } from "../features/extras/overlayDetect";

function text(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export const extrasCommands: Record<string, CommandHandler> = {
  // ── CrackWatch ───────────────────────────────────────────────────────
  fetch_crackwatch_status: (args) =>
    fetchCrackwatchStatus(args.gameName, args.appId),

  fetch_crackwatch_status_batch: (args) =>
    fetchCrackwatchStatusBatch(args.gameNames),

  // ── Playtester deals feed ────────────────────────────────────────────
  fetch_playtester_games: (args) => fetchPlaytesterGames(args.offset, args.limit),

  fetch_playtester_game_detail: (args) => fetchPlaytesterGameDetail(args.slug),

  // ── Steam store extras ───────────────────────────────────────────────
  get_steam_page_features: (args) => getSteamPageFeatures(args.steamAppId, args.lang),

  get_about_bundle: (args) => getAboutBundle(args.steamAppId, args.gameName),

  get_recommended_config: (args) => getRecommendedConfig(args.steamAppId),

  get_collection_games: (args) => getCollectionGames(args.collectionId, args.limit),

  get_game_relations: (args) => getGameRelations(args.igdbId),

  // ── External links ───────────────────────────────────────────────────
  open_deal_url: async (args) => {
    const raw = text(args, "url").trim();
    if (!raw) throw new Error("Cannot open an empty URL.");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(`Invalid URL: ${raw}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Refusing to open URL with disallowed scheme: ${raw}`);
    }
    await shell.openExternal(raw);
    return null;
  },

  // ── Text import / export ─────────────────────────────────────────────
  read_text_file: (args) => readTextFile(text(args, "filePath")),

  save_text_file: (args) => saveTextFile(text(args, "filePath"), text(args, "contents")),

  // ── Download resolver ────────────────────────────────────────────────
  open_download_resolver: (args) =>
    openDownloadResolver({
      url: args.url,
      gameName: args.gameName,
      gameId: args.gameId,
      savePath: args.savePath,
      autoExtract: args.autoExtract,
      sourceName: args.sourceName,
    }),

  // ── Overlay current-game probe ───────────────────────────────────────
  overlay_detect_game: () => overlayDetectGame(),
};

export function registerExtrasCommands(): void {
  registerCommands(extrasCommands, { override: true });
}
