/**
 * Metadata, artwork, prices, news and external scores.
 *
 * Workstream: `metadata`. See `STUBS_BY_AREA.md` → "metadata" and
 * `ARCHITECTURE.md`.
 *
 * Reference implementations (deleted from the tree, in git history):
 * `src-tauri/src/game_scraper/`, `steamgriddb.rs`, `hltb.rs`,
 * `game_scraper/reviews/`, `protondb.rs`, `deals.rs`, `news.rs`,
 * `db/news.rs`, `review_quotes.rs`, `media.rs`, `price.rs`, `map_sources.rs`.
 *
 * Every provider command degrades to a clear, actionable error when its key
 * is missing; the UI never receives invented data.
 */
import { registerCommand, type CommandArgs, type CommandHandler } from "../ipc";

import { artworkAssetUrl, downloadArtwork, downloadImageAsDataUrl, ensureArtworkThumbnails, storeArtworkFile } from "../features/metadata/artwork";
import { fetchGamepassCatalog, fetchGamePricesBatch, fetchGiveaways, fetchIsthereanydealDeals } from "../features/metadata/deals";
import { fetchIgdbPlatforms, fetchIgdbStoreGames, fetchSpotlightGames } from "../features/metadata/igdb";
import { fetchSteamGenresAndTags, fetchGameReviews, getSteamGameStats, getSteamPlayerCount, getSteamPlayerHistory } from "../features/metadata/steam";
import { fetchTimeToBeat } from "../features/metadata/hltb";
import {
  readMediaFile,
  saveScreenshot,
  searchLaunchboxImages,
} from "../features/metadata/media";
import { fetchGameMaps, searchMapGames } from "../features/metadata/maps";
import * as news from "../features/metadata/newsStore";
import { fetchProtonDbStatus } from "../features/metadata/protondb";
import { fetchExternalReviews, fetchMetacriticScore } from "../features/metadata/reviews";
import * as quotes from "../features/metadata/reviewQuotes";
import { getIgdbGameById, searchGameMetadata } from "../features/metadata/search";
import { sgdbGetAllAssets, sgdbGetAssets, sgdbGetAssetsBatch, sgdbSearchGames } from "../features/metadata/steamgriddb";
import {
  fetchUrlText,
  loadSourceCache,
  loadStoreCache,
  saveSourceCache,
  saveStoreCache,
} from "../features/metadata/stores";

function str(args: CommandArgs, key: string): string | undefined {
  const value = args[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function num(args: CommandArgs, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function bool(args: CommandArgs, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function recordArg(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const metadataCommands: Record<string, CommandHandler> = {
  // ── IGDB ───────────────────────────────────────────────────────────
  search_game_metadata: (args) =>
    searchGameMetadata(
      str(args, "gameName") ?? "",
      num(args, "steamAppId") ?? null,
    ),
  get_igdb_game_by_id: (args) => getIgdbGameById(num(args, "id") ?? 0),
  get_igdb_platforms: () => fetchIgdbPlatforms(),

  // ── Steam store / community ────────────────────────────────────────
  get_steam_player_count: (args) => getSteamPlayerCount(num(args, "appId") ?? 0),
  get_steam_player_history: (args) =>
    getSteamPlayerHistory(num(args, "appId") ?? 0, num(args, "rangeDays") ?? 0),
  get_steam_game_stats: (args) => getSteamGameStats(num(args, "appId") ?? 0),
  get_steam_tags: (args) => fetchSteamGenresAndTags(num(args, "appId") ?? 0),
  fetch_game_reviews: (args) =>
    fetchGameReviews(str(args, "gameName") ?? "", num(args, "steamAppId") ?? null, {
      cursor: str(args, "cursor") ?? null,
      language: str(args, "language") ?? null,
      filterType: str(args, "filterType") ?? null,
      purchaseType: str(args, "purchaseType") ?? null,
      playtimeMinHours: num(args, "playtimeMinHours") ?? null,
      playtimeMaxHours: num(args, "playtimeMaxHours") ?? null,
      reviewType: str(args, "reviewType") ?? null,
      playtimeDevice: str(args, "playtimeDevice") ?? null,
      useHelpfulSystem: bool(args, "useHelpfulSystem") ?? null,
    }),
  fetch_external_reviews: (args) =>
    fetchExternalReviews(str(args, "gameName") ?? "", str(args, "source") ?? ""),
  fetch_metacritic_score: (args) => fetchMetacriticScore(str(args, "gameName") ?? ""),
  fetch_protondb_status: (args) => fetchProtonDbStatus(num(args, "appId") ?? 0),

  // ── HowLongToBeat ──────────────────────────────────────────────────
  fetch_hltb_stats: (args) =>
    fetchTimeToBeat(str(args, "gameName") ?? "", num(args, "hltbId") ?? null),

  // ── SteamGridDB artwork ────────────────────────────────────────────
  sgdb_get_assets: (args) =>
    sgdbGetAssets(num(args, "steamAppId") ?? null, str(args, "gameName") ?? null),
  sgdb_get_all_assets: (args) =>
    sgdbGetAllAssets(
      num(args, "steamAppId") ?? null,
      str(args, "gameName") ?? null,
      num(args, "sgdbGameId") ?? null,
    ),
  sgdb_get_assets_batch: (args) => {
    const ids = Array.isArray(args.steamAppIds)
      ? args.steamAppIds.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : [];
    return sgdbGetAssetsBatch(ids);
  },
  sgdb_search_games: (args) => sgdbSearchGames(str(args, "query") ?? ""),

  artwork_asset_url: (args) => artworkAssetUrl(str(args, "relativePath") ?? ""),
  ensure_artwork_thumbnails: () => ensureArtworkThumbnails(),
  download_image: (args) => downloadImageAsDataUrl(str(args, "url") ?? ""),
  download_artwork: (args) =>
    downloadArtwork(
      str(args, "gameId") ?? "",
      str(args, "slot") ?? "",
      str(args, "url") ?? "",
    ),
  store_artwork_file: (args) =>
    storeArtworkFile(
      str(args, "gameId") ?? "",
      str(args, "slot") ?? "",
      str(args, "filePath") ?? "",
    ),

  // ── Deals / prices / Game Pass ─────────────────────────────────────
  fetch_game_prices_batch: (args) => {
    const names = Array.isArray(args.gameNames)
      ? args.gameNames.map((value) => String(value))
      : [];
    return fetchGamePricesBatch(names);
  },
  fetch_isthereanydeal_deals: (args) => {
    const filters = recordArg(args.filters);
    return fetchIsthereanydealDeals({
      platform: typeof filters.platform === "string" ? filters.platform : null,
      minDiscount: typeof filters.minDiscount === "number" ? filters.minDiscount : null,
      store: typeof filters.store === "string" ? filters.store : null,
    });
  },
  fetch_giveaways: () => fetchGiveaways(),
  fetch_gamepass_catalog: (args) => {
    const filters = recordArg(args.filters);
    return fetchGamepassCatalog({
      region: typeof filters.region === "string" ? filters.region : null,
      categories: Array.isArray(filters.categories)
        ? filters.categories.map((value) => String(value))
        : null,
      platform: typeof filters.platform === "string" ? filters.platform : null,
    });
  },
  fetch_spotlight_games: (args) =>
    fetchSpotlightGames(str(args, "category") ?? "hot", num(args, "limit") ?? 15),

  // ── Maps ───────────────────────────────────────────────────────────
  fetch_game_maps: (args) => fetchGameMaps(str(args, "gameName") ?? ""),
  search_map_games: (args) =>
    searchMapGames(str(args, "query") ?? "", num(args, "limit") ?? 8),

  // ── Media ──────────────────────────────────────────────────────────
  read_media_file: (args) => readMediaFile(str(args, "filePath") ?? ""),
  save_screenshot: (args) =>
    saveScreenshot(str(args, "filePath") ?? null, str(args, "base64Data") ?? ""),
  search_launchbox_images: (args) => searchLaunchboxImages(str(args, "gameName") ?? ""),

  // ── News store ─────────────────────────────────────────────────────
  news_snapshot: () => news.newsSnapshot(),
  news_replace_feeds: (args) =>
    news.replaceFeeds(Array.isArray(args.feeds) ? (args.feeds as never) : []),
  news_ingest: (args) =>
    news.ingest(Array.isArray(args.payloads) ? (args.payloads as never) : []),
  news_article: (args) => news.readArticle(str(args, "link") ?? ""),
  news_set_read: (args) => {
    news.setRead(str(args, "link") ?? "", Boolean(args.read));
    return null;
  },
  news_mark_all_read: (args) => {
    news.markAllRead(Array.isArray(args.links) ? args.links.map((value) => String(value)) : []);
    return null;
  },
  news_toggle_saved: (args) => news.toggleSaved(recordArg(args.article) as never),
  news_add_history: (args) => {
    news.addHistory(recordArg(args.article) as never);
    return null;
  },
  news_clear_history: () => {
    news.clearHistory();
    return null;
  },
  news_remove_history: (args) => {
    news.removeHistory(str(args, "link") ?? "");
    return null;
  },
  news_set_pref: (args) => {
    news.setPref(str(args, "key") ?? "", str(args, "value") ?? "");
    return null;
  },
  news_clear_articles: () => {
    news.clearArticles();
    return null;
  },

  // ── Review quotes ──────────────────────────────────────────────────
  review_quote_list: (args) => quotes.reviewQuoteList(str(args, "gameId") ?? null),
  review_quote_save: (args) =>
    quotes.reviewQuoteSave(recordArg(args.quote) as never),
  review_quote_delete: (args) => quotes.reviewQuoteDelete(str(args, "id") ?? ""),

  // ── Opaque caches / feed fetch ─────────────────────────────────────
  fetch_url: (args) => fetchUrlText(str(args, "url") ?? ""),
  save_store_cache: (args) => {
    saveStoreCache(str(args, "data") ?? "");
    return null;
  },
  load_store_cache: () => loadStoreCache(),
  save_source_cache: (args) => {
    saveSourceCache(str(args, "data") ?? "");
    return null;
  },
  load_source_cache: () => loadSourceCache(),

  // ── Store catalogue / spotlight (stores workstream may own these) ──
  fetch_store_games: (args) =>
    fetchIgdbStoreGames({
      category: str(args, "category") ?? "all",
      offset: num(args, "offset") ?? 0,
      limit: num(args, "limit") ?? 24,
      genres: Array.isArray(args.genres) ? args.genres.map((value) => String(value)) : undefined,
      platforms: Array.isArray(args.platforms)
        ? args.platforms.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : undefined,
      yearMin: num(args, "yearMin") ?? null,
      yearMax: num(args, "yearMax") ?? null,
      ratingMin: num(args, "ratingMin") ?? null,
      sort: str(args, "sort") ?? null,
    }),
};

/**
 * Register without `override`, so a sibling workstream that already claimed a
 * shared name (`download_image`, store caches, `fetch_store_games`, …) keeps
 * its implementation. Registrars run before the stub layer, so unclaimed
 * names here still beat the rejecting stub.
 *
 * Missing API keys are a *configuration* state, not an error: those commands
 * resolve to an empty result and warn once per provider. Without this, every
 * page that asks for metadata on boot floods the console with stack traces.
 */
const warnedProviders = new Set<string>();

function notConfiguredMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return /is not configured/i.test(message) ? message : null;
}

function emptyFallback(name: string): unknown {
  if (
    /^(search_|sgdb_|news_)/.test(name) ||
    /_list$/.test(name) ||
    /^fetch_(game_reviews|external_reviews|giveaways|playtester_games|game_maps|available_runners|achievements|gamepass_catalog|spotlight_games)/.test(
      name,
    )
  ) {
    return [];
  }
  return null;
}

export function registerMetadataCommands(): void {
  for (const [name, handler] of Object.entries(metadataCommands)) {
    registerCommand(name, async (args, ctx) => {
      try {
        return await handler(args, ctx);
      } catch (error) {
        const message = notConfiguredMessage(error);
        if (!message) throw error;
        const provider = message.split(" is not configured")[0];
        if (!warnedProviders.has(provider)) {
          warnedProviders.add(provider);
          console.warn(`[metadata] ${message}`);
        }
        return emptyFallback(name);
      }
    });
  }
}
