import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  extractSteamAppIdFromWebsites,
  type Game,
  type GameMetadataResult,
  type IgdbReview,
} from "../../types/game";
import type { SgdbAssets } from "../../types/steamgriddb";
import { isUsableImageUrl, toWebviewAssetUrl } from "../../utils/artworkUrl";
import { deduplicateAndMergeTags } from "../../utils/genreTags";

export const NO_IGDB_MATCH_SOURCE = "Steam (no IGDB match)";

const MAX_ENRICH_ATTEMPTS = 2;
const enrichAttemptsThisSession = new Map<string, number>();

/** Check if a game could benefit from background metadata enrichment. */
export function gameNeedsEnrichment(game: Game): boolean {
  // If it's a Steam game and missing genres, always enrich so Steam genres appear
  const isSteamGame = !!game.steamAppId || game.platform === "Steam" || game.id.startsWith("steam-");
  if (isSteamGame && (!game.genres || game.genres.length === 0)) {
    return true;
  }

  if (game.metadataSource === NO_IGDB_MATCH_SOURCE) {
    // If it has a steamAppId but no genres, we can still fetch Steam tags once
    if (game.steamAppId && (!game.genres || game.genres.length === 0)) {
      return true;
    }
    return false;
  }
  // Missing basic metadata or relations or genres
  if (!game.description || game.description.trim().length === 0) return true;
  if (!game.genres || game.genres.length < 2) return true;
  if (!game.similarGames && !game.collection && !game.franchise) return true;
  return false;
}

/**
 * True iff `u` is an image the webview can render (base64 data URL or a
 * Tauri asset-protocol URL) — i.e. artwork we successfully downloaded to
 * disk. Used by the unpoison block in `enrichGameMetadata` to decide
 * whether a retry is necessary when cover art eventually fails to load.
 *
 * Note: raw `file://` URLs (the pre-asset-protocol format) are NOT
 * usable — the webview refuses to load them — so a legacy row carrying
 * one is treated as empty and replaced on the next enrichment.
 */
const isFrontendUsableImage = isUsableImageUrl;

/** Discord's large/small image must be a public https URL; data: URIs are skipped. */
function discordAsset(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  return /^https:\/\//i.test(normalized) ? normalized : undefined;
}

/** Download a single image to base64, falling back to the remote URL. */
async function downloadImageSafe(url: string | undefined | null): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const dataUrl: string | null = await invoke("download_image", { url });
    return dataUrl ?? url;
  } catch {
    return url;
  }
}

async function downloadArtworkSafe(gameId: string, slot: string, url: string | undefined | null): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const relative = await invoke<string | null>("download_artwork", { gameId, slot, url });
    if (!relative) return url;
    // `artwork_asset_url` returns a `file://` URL, which the webview
    // refuses to load; convert it to the asset protocol first.
    const assetUrl = await invoke<string>("artwork_asset_url", { relativePath: relative });
    return toWebviewAssetUrl(assetUrl);
  } catch {
    return downloadImageSafe(url);
  }
}

/** Batch-download images from a metadata result: cover, hero, banner, logo. */
async function fetchAllImages(images: { icon?: string | null; cover?: string | null; hero?: string | null; banner?: string | null; logo?: string | null }, gameId?: string) {
  const downloader = gameId
    ? (slot: string, url: string | null | undefined) => downloadArtworkSafe(gameId, slot, url)
    : (_slot: string, url: string | null | undefined) => downloadImageSafe(url);
  const [coverUrl, heroUrl, bannerUrl, logoUrl] = await Promise.all([
    downloader("cover", images.cover),
    downloader("hero", images.hero),
    downloader("banner", images.banner),
    downloader("logo", images.logo),
  ]);
  return {
    coverArtUrl: coverUrl ?? undefined,
    coverSourceUrl: discordAsset(images.cover),
    bannerUrl: heroUrl ?? bannerUrl ?? undefined,
    logoUrl: logoUrl ?? undefined,
  };
}

export function useEnrich(options: {
  gamesRef: React.MutableRefObject<Game[]>;
  updateGame: (id: string, updates: Partial<Game>) => void;
}) {
  const { gamesRef, updateGame } = options;

  // Background auto-enrichment queue
  const queueRef = useRef<{ id: string; name: string; steamAppId?: number }[]>([]);
  const queuedIdsRef = useRef<Set<string>>(new Set());
  const isProcessingRef = useRef<boolean>(false);

  /** On-demand & background metadata enrichment.
   *  Fetches IGDB metadata, extracts Steam user tags, deduplicates genres/tags,
   *  and updates game relations.
   */
  const enrichGameMetadata = useCallback(async (gameId: string, gameName: string, steamAppId?: number) => {
    // Drop from queue if currently pending so it's not processed twice
    queuedIdsRef.current.delete(gameId);
    queueRef.current = queueRef.current.filter((q) => q.id !== gameId);

    const previousAttempts = enrichAttemptsThisSession.get(gameId) ?? 0;
    if (previousAttempts >= MAX_ENRICH_ATTEMPTS) return;
    enrichAttemptsThisSession.set(gameId, previousAttempts + 1);

    try {
      const current = gamesRef.current.find((g) => g.id === gameId);
      if (!current) return;

      let resolvedSteamAppId =
        steamAppId ??
        current.steamAppId ??
        (current.id.startsWith("steam-")
          ? parseInt(current.id.replace("steam-", ""), 10) || undefined
          : undefined) ??
        extractSteamAppIdFromWebsites(current.websites) ??
        undefined;

      const results: GameMetadataResult[] = [];
      if (current.igdbId != null) {
        try {
          const byId = await invoke<GameMetadataResult | null>("get_igdb_game_by_id", {
            id: current.igdbId,
          });
          if (byId) results.push({ ...byId, sourceName: "IGDB" });
        } catch (e) {
          console.warn(`IGDB by-id fetch failed for ${gameName}:`, e);
        }
      }
      if (results.length === 0) {
        const searched = await invoke<GameMetadataResult[]>("search_game_metadata", {
          gameName,
          skipLaunchbox: !!resolvedSteamAppId,
          steamAppId: resolvedSteamAppId,
        });
        results.push(...searched);
      }

      if (results.length === 0) {
        // No IGDB match. If we have a Steam App ID, still fetch Steam community user tags
        let steamTags: string[] = [];
        if (resolvedSteamAppId) {
          try {
            steamTags = await invoke<string[]>("get_steam_tags", { appId: resolvedSteamAppId });
          } catch (err) {
            console.warn(`Steam tags fetch failed for ${gameName} (${resolvedSteamAppId}):`, err);
          }
        }
        const mergedGenres = deduplicateAndMergeTags(current.genres, steamTags);

        const noMatchPatch: Partial<Game> = {
          metadataSource: current.metadataSource ?? NO_IGDB_MATCH_SOURCE,
          steamAppId: resolvedSteamAppId,
          ...(mergedGenres.length > 0 ? { genres: mergedGenres } : {}),
        };
        updateGame(gameId, noMatchPatch);
        invoke("save_game", { game: { ...current, ...noMatchPatch } }).catch((err) =>
          console.warn(`Immediate persist (no-match) failed for ${gameName}:`, err)
        );
        enrichAttemptsThisSession.delete(gameId);
        return;
      }

      // Prefer IGDB for its richer metadata
      const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];

      // Update resolvedSteamAppId from meta websites if not known yet
      if (!resolvedSteamAppId) {
        const websitesForSteamId =
          meta.websites ??
          results.find((r) => r.websites && r.websites.length > 0)?.websites;
        resolvedSteamAppId = extractSteamAppIdFromWebsites(websitesForSteamId) ?? undefined;
      }

      // Fetch Steam user tags if we have a steamAppId
      let steamTags: string[] = [];
      if (resolvedSteamAppId) {
        try {
          steamTags = await invoke<string[]>("get_steam_tags", { appId: resolvedSteamAppId });
        } catch (err) {
          console.warn(`Steam tags fetch failed for ${gameName} (${resolvedSteamAppId}):`, err);
        }
      }

      // Deduplicate and merge tags/genres from all sources
      const mergedGenres = deduplicateAndMergeTags(
        current.genres,
        meta.genres,
        meta.themes,
        steamTags
      );

      const pickImage = (key: "cover" | "hero" | "banner" | "logo"): string | null => {
        if (resolvedSteamAppId && (key === "hero" || key === "banner")) {
          const steam = results.find((r) => r.sourceName === "Steam");
          if (steam?.images[key]) return steam.images[key];
        }
        if (key === "cover") {
          const igdb = results.find((r) => r.sourceName === "IGDB");
          if (igdb?.images.cover) return igdb.images.cover;
          const steam = results.find((r) => r.sourceName === "Steam");
          return steam?.images.cover ?? null;
        }
        if (key === "logo") {
          const igdb = results.find((r) => r.sourceName === "IGDB");
          return igdb?.images.logo ?? null;
        }
        if (meta.images[key]) return meta.images[key];
        for (const r of results) {
          if (r.images[key]) return r.images[key];
        }
        return null;
      };

      const images = await fetchAllImages({
        cover: pickImage("cover"),
        hero: pickImage("hero"),
        banner: pickImage("banner"),
        logo: pickImage("logo"),
      }, gameId);

      const setIfEmpty = <K extends keyof Game>(key: K, value: Game[K] | undefined): Game[K] | undefined => {
        if (current[key] === undefined || current[key] === null) return value;
        return current[key];
      };

      let sgdbIconUrl: string | undefined;
      let sgdbLogoUrl: string | undefined;
      if (resolvedSteamAppId || gameName) {
        try {
          const sgdb = await invoke<SgdbAssets | null>("sgdb_get_assets", {
            steamAppId: resolvedSteamAppId ?? null,
            gameName: gameName || undefined,
          });
          if (sgdb) {
            if (!images.logoUrl && sgdb.logoUrl) {
              sgdbLogoUrl = await downloadImageSafe(sgdb.logoUrl);
            }
            if (!isFrontendUsableImage(current.iconUrl) && sgdb.iconUrl) {
              sgdbIconUrl = await downloadImageSafe(sgdb.iconUrl);
            }
          }
        } catch (err) {
          console.warn(`SteamGridDB fill failed for ${gameName}:`, err);
        }
      }

      const enrichPatch: Partial<Game> = {
        steamAppId: resolvedSteamAppId,
        description: setIfEmpty("description", meta.description ?? undefined),
        developer: setIfEmpty("developer", meta.developer ?? undefined),
        publisher: setIfEmpty("publisher", meta.publisher ?? undefined),
        releaseDate: setIfEmpty("releaseDate", meta.releaseDate ?? undefined),
        genres: mergedGenres.length > 0 ? mergedGenres : current.genres,
        coverArtUrl: isFrontendUsableImage(current.coverArtUrl)
          ? current.coverArtUrl
          : (images.coverArtUrl ?? current.coverArtUrl),
        coverSourceUrl: isFrontendUsableImage(current.coverArtUrl)
          ? current.coverSourceUrl
          : (images.coverSourceUrl ?? current.coverSourceUrl),
        bannerUrl: isFrontendUsableImage(current.bannerUrl)
          ? current.bannerUrl
          : (images.bannerUrl ?? current.bannerUrl),
        logoUrl: isFrontendUsableImage(current.logoUrl)
          ? current.logoUrl
          : (images.logoUrl ?? sgdbLogoUrl ?? current.logoUrl),
        iconUrl: isFrontendUsableImage(current.iconUrl)
          ? current.iconUrl
          : (sgdbIconUrl ?? current.iconUrl),
        igdbRating: current.igdbRating ?? meta.igdbRating ?? undefined,
        criticRating: current.criticRating ?? meta.criticRating ?? undefined,
        themes: current.themes ?? meta.themes ?? undefined,
        gameModes: current.gameModes ?? meta.gameModes ?? undefined,
        playerPerspectives: current.playerPerspectives ?? meta.playerPerspectives ?? undefined,
        screenshots: current.screenshots ?? meta.screenshots ?? undefined,
        videos: current.videos ?? meta.videos ?? undefined,
        websites: current.websites ?? meta.websites ?? undefined,
        timeToBeat: current.timeToBeat ?? meta.timeToBeat ?? undefined,
        similarGames: current.similarGames ?? meta.similarGames ?? undefined,
        releases: current.releases ?? meta.releases ?? undefined,
        igdbReviews: current.igdbReviews ?? meta.igdbReviews ?? undefined,
        collection: setIfEmpty("collection", meta.collection ?? undefined),
        collectionId: setIfEmpty("collectionId", meta.collectionId ?? undefined),
        franchise: setIfEmpty("franchise", meta.franchise ?? undefined),
        igdbId: setIfEmpty("igdbId", meta.igdbId ?? undefined),
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      };

      updateGame(gameId, enrichPatch);
      invoke("save_game", { game: { ...current, ...enrichPatch } }).catch((err) =>
        console.warn(`Immediate persist failed for ${gameName}:`, err)
      );

      if (
        isFrontendUsableImage(images.coverArtUrl) ||
        isFrontendUsableImage(images.bannerUrl) ||
        isFrontendUsableImage(images.logoUrl) ||
        isFrontendUsableImage(sgdbIconUrl) ||
        isFrontendUsableImage(sgdbLogoUrl) ||
        !!current.coverArtUrl
      ) {
        enrichAttemptsThisSession.delete(gameId);
      }
      console.log(`Enriched ${gameName} via ${meta.sourceName}`);
    } catch (err) {
      console.error("enrichGameMetadata failed:", err);
      enrichAttemptsThisSession.delete(gameId);
    }
  }, [gamesRef, updateGame]);

  /** Sequential queue processor with 350ms pacing between requests. */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current.shift();
        if (!item) break;
        queuedIdsRef.current.delete(item.id);

        const current = gamesRef.current.find((g) => g.id === item.id);
        if (current && (enrichAttemptsThisSession.get(item.id) ?? 0) < MAX_ENRICH_ATTEMPTS) {
          try {
            await enrichGameMetadata(item.id, item.name, item.steamAppId);
          } catch (err) {
            console.warn(`Queue enrich failed for ${item.name}:`, err);
          }
          // Pacing to respect rate limits and keep app completely fluid
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [enrichGameMetadata, gamesRef]);

  /** Enqueue a single game for background enrichment. */
  const enqueueEnrich = useCallback(
    (game: { id: string; name: string; steamAppId?: number }, highPriority = false) => {
      if ((enrichAttemptsThisSession.get(game.id) ?? 0) >= MAX_ENRICH_ATTEMPTS) return;
      if (queuedIdsRef.current.has(game.id)) {
        if (highPriority) {
          queueRef.current = queueRef.current.filter((q) => q.id !== game.id);
          queueRef.current.unshift(game);
        }
        return;
      }
      queuedIdsRef.current.add(game.id);
      if (highPriority) {
        queueRef.current.unshift(game);
      } else {
        queueRef.current.push(game);
      }
      void processQueue();
    },
    [processQueue]
  );

  /** Enqueue a batch of games for background enrichment. */
  const enqueueEnrichBatch = useCallback(
    (games: { id: string; name: string; steamAppId?: number }[]) => {
      let addedAny = false;
      for (const game of games) {
        if ((enrichAttemptsThisSession.get(game.id) ?? 0) >= MAX_ENRICH_ATTEMPTS) continue;
        if (queuedIdsRef.current.has(game.id)) continue;
        queuedIdsRef.current.add(game.id);
        queueRef.current.push(game);
        addedAny = true;
      }
      if (addedAny) {
        void processQueue();
      }
    },
    [processQueue]
  );

  /** Fetch reviews for a game from the best available source (Steam first,
   *  IGDB fallback) and persist them on the game record. Safe to call any
   *  time — does not block the UI and never wipes existing reviews on empty
   *  results. */
  const fetchGameReviews = useCallback(
    async (gameId: string, gameName: string, steamAppId?: number) => {
      try {
        const result = await invoke<{ reviews: IgdbReview[]; source: string; error?: string }>(
          "fetch_game_reviews",
          { gameName, steamAppId }
        );
        if (result.reviews.length > 0) {
          updateGame(gameId, { igdbReviews: result.reviews });
        }
      } catch (err) {
        console.error(`Fetch reviews failed for ${gameName}:`, err);
      }
    },
    [updateGame]
  );

  return {
    enrichGameMetadata,
    enqueueEnrich,
    enqueueEnrichBatch,
    fetchGameReviews,
    fetchAllImages,
    downloadImageSafe,
    isFrontendUsableImage,
    enrichAttemptsThisSession,
    MAX_ENRICH_ATTEMPTS,
  };
}

export { isFrontendUsableImage, fetchAllImages, downloadImageSafe, enrichAttemptsThisSession, MAX_ENRICH_ATTEMPTS };
