import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  extractSteamAppIdFromWebsites,
  mergeTimeToBeat,
  type Game,
  type GameMetadataResult,
  type IgdbReview,
  type TimeToBeat,
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
    logoSourceUrl: discordAsset(images.logo),
  };
}

export function useEnrich(options: {
  gamesRef: React.MutableRefObject<Game[]>;
  updateGame: (id: string, updates: Partial<Game>) => void;
  loadGameDetail: (id: string) => Promise<Game | null>;
}) {
  const { gamesRef, updateGame, loadGameDetail } = options;

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
      // Enrichment writes heavy fields (screenshots, videos, reviews, …);
      // load the full record first so a summary base can't drop them.
      const full = await loadGameDetail(gameId);
      const current = full ?? gamesRef.current.find((g) => g.id === gameId);
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
        // HowLongToBeat might still know the game even when IGDB doesn't.
        // Re-read the record after all awaits so a user edit made while the
        // searches ran (e.g. custom artwork in the edit modal) is not rolled
        // back by this full-row persist.
        let latest = gamesRef.current.find((g) => g.id === gameId) ?? current;

        let hltb: TimeToBeat | null = null;
        if (!latest.timeToBeat?.hltb) {
          try {
            hltb = await invoke<TimeToBeat | null>("fetch_hltb_stats", { gameName, hltbId: null });
          } catch (err) {
            console.warn(`HLTB fetch failed for ${gameName}:`, err);
          }
        }
        latest = gamesRef.current.find((g) => g.id === gameId) ?? latest;
        const mergedGenres = deduplicateAndMergeTags(latest.genres, steamTags);
        const timeToBeat = mergeTimeToBeat(latest.timeToBeat, hltb);

        const noMatchPatch: Partial<Game> = {
          metadataSource: latest.metadataSource ?? NO_IGDB_MATCH_SOURCE,
          steamAppId: resolvedSteamAppId,
          ...(mergedGenres.length > 0 ? { genres: mergedGenres } : {}),
          ...(timeToBeat ? { timeToBeat } : {}),
        };
        updateGame(gameId, noMatchPatch);
        invoke("save_game", { game: { ...latest, ...noMatchPatch } }).catch((err) =>
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

      // Snapshot used to decide which slots still need artwork downloaded.
      const latestBeforeImages = gamesRef.current.find((g) => g.id === gameId) ?? current;

      const images = await fetchAllImages({
        // Never re-download a slot the user has already filled: enrichment
        // writes to the same `artwork/<gameId>/<slot>.<ext>` path, so it
        // would silently replace their picked file on disk.
        cover: isFrontendUsableImage(latestBeforeImages.coverArtUrl) ? null : pickImage("cover"),
        hero: isFrontendUsableImage(latestBeforeImages.bannerUrl) ? null : pickImage("hero"),
        banner: isFrontendUsableImage(latestBeforeImages.bannerUrl) ? null : pickImage("banner"),
        logo: isFrontendUsableImage(latestBeforeImages.logoUrl) ? null : pickImage("logo"),
      }, gameId);

      const setIfEmptyFrom = <K extends keyof Game>(
        base: Game,
        key: K,
        value: Game[K] | undefined
      ): Game[K] | undefined => {
        if (base[key] === undefined || base[key] === null) return value;
        return base[key];
      };

      let sgdbIconUrl: string | undefined;
      let sgdbLogoUrl: string | undefined;
      let sgdbLogoSourceUrl: string | undefined;
      if (resolvedSteamAppId || gameName) {
        try {
          const sgdb = await invoke<SgdbAssets | null>("sgdb_get_assets", {
            steamAppId: resolvedSteamAppId ?? null,
            gameName: gameName || undefined,
          });
          if (sgdb) {
            if (!images.logoUrl && sgdb.logoUrl) {
              sgdbLogoUrl = await downloadImageSafe(sgdb.logoUrl);
              sgdbLogoSourceUrl = discordAsset(sgdb.logoUrl);
            }
            if (!isFrontendUsableImage(current.iconUrl) && sgdb.iconUrl) {
              sgdbIconUrl = await downloadImageSafe(sgdb.iconUrl);
            }
          }
        } catch (err) {
          console.warn(`SteamGridDB fill failed for ${gameName}:`, err);
        }
      }

      // Re-read the record after every await above: the metadata search and
      // artwork downloads can take seconds, and the user may have edited this
      // game meanwhile (e.g. picked custom cover/icon/hero/logo in the edit
      // modal, which persists those slots instantly). Building the patch from
      // the stale `current` snapshot would write those slots straight back to
      // their pre-edit values. `latest` is the source of truth; enrichment
      // only fills fields that are still empty on it.
      const latest = gamesRef.current.find((g) => g.id === gameId) ?? current;
      const mergedGenres = deduplicateAndMergeTags(
        latest.genres,
        meta.genres,
        meta.themes,
        steamTags
      );

      const enrichPatch: Partial<Game> = {
        steamAppId: resolvedSteamAppId,
        description: setIfEmptyFrom(latest, "description", meta.description ?? undefined),
        developer: setIfEmptyFrom(latest, "developer", meta.developer ?? undefined),
        publisher: setIfEmptyFrom(latest, "publisher", meta.publisher ?? undefined),
        releaseDate: setIfEmptyFrom(latest, "releaseDate", meta.releaseDate ?? undefined),
        genres: mergedGenres.length > 0 ? mergedGenres : latest.genres,
        coverArtUrl: isFrontendUsableImage(latest.coverArtUrl)
          ? latest.coverArtUrl
          : (images.coverArtUrl ?? latest.coverArtUrl),
        coverSourceUrl: isFrontendUsableImage(latest.coverArtUrl)
          ? latest.coverSourceUrl
          : (images.coverSourceUrl ?? latest.coverSourceUrl),
        bannerUrl: isFrontendUsableImage(latest.bannerUrl)
          ? latest.bannerUrl
          : (images.bannerUrl ?? latest.bannerUrl),
        logoUrl: isFrontendUsableImage(latest.logoUrl)
          ? latest.logoUrl
          : (images.logoUrl ?? sgdbLogoUrl ?? latest.logoUrl),
        logoSourceUrl: isFrontendUsableImage(latest.logoUrl)
          ? latest.logoSourceUrl
          : (images.logoSourceUrl ?? sgdbLogoSourceUrl ?? latest.logoSourceUrl),
        iconUrl: isFrontendUsableImage(latest.iconUrl)
          ? latest.iconUrl
          : (sgdbIconUrl ?? latest.iconUrl),
        igdbRating: latest.igdbRating ?? meta.igdbRating ?? undefined,
        criticRating: latest.criticRating ?? meta.criticRating ?? undefined,
        themes: latest.themes ?? meta.themes ?? undefined,
        gameModes: latest.gameModes ?? meta.gameModes ?? undefined,
        playerPerspectives: latest.playerPerspectives ?? meta.playerPerspectives ?? undefined,
        screenshots: latest.screenshots ?? meta.screenshots ?? undefined,
        videos: latest.videos ?? meta.videos ?? undefined,
        websites: latest.websites ?? meta.websites ?? undefined,
        timeToBeat: mergeTimeToBeat(latest.timeToBeat, meta.timeToBeat),
        similarGames: latest.similarGames ?? meta.similarGames ?? undefined,
        releases: latest.releases ?? meta.releases ?? undefined,
        igdbReviews: latest.igdbReviews ?? meta.igdbReviews ?? undefined,
        collection: setIfEmptyFrom(latest, "collection", meta.collection ?? undefined),
        collectionId: setIfEmptyFrom(latest, "collectionId", meta.collectionId ?? undefined),
        franchise: setIfEmptyFrom(latest, "franchise", meta.franchise ?? undefined),
        igdbId: setIfEmptyFrom(latest, "igdbId", meta.igdbId ?? undefined),
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      };

      updateGame(gameId, enrichPatch);
      invoke("save_game", { game: { ...latest, ...enrichPatch } }).catch((err) =>
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
  }, [gamesRef, updateGame, loadGameDetail]);

  /** Refresh only the HowLongToBeat stats for a game (no IGDB
   *  metadata round-trip). Used by the game page to upgrade rows that
   *  still carry legacy IGDB time-to-beat values or none at all. */
  const fetchGameHltb = useCallback(
    async (gameId: string, gameName: string) => {
      const full = await loadGameDetail(gameId);
      const current = full ?? gamesRef.current.find((g) => g.id === gameId);
      if (!current) return;
      try {
        const fresh = await invoke<TimeToBeat | null>("fetch_hltb_stats", {
          gameName,
          hltbId: current.timeToBeat?.hltb?.gameId ?? null,
        });
        if (!fresh) return;
        // Re-read after the network round-trip, then persist only the
        // `timeToBeat` column. A full-row save from the pre-await snapshot
        // would roll back artwork the user changed while HLTB was loading.
        const latest = gamesRef.current.find((g) => g.id === gameId) ?? current;
        const timeToBeat = mergeTimeToBeat(latest.timeToBeat, fresh);
        if (!timeToBeat) return;
        updateGame(gameId, { timeToBeat });
        invoke("patch_game", { id: gameId, patch: { timeToBeat } }).catch((err) =>
          console.warn(`HLTB persist failed for ${gameName}:`, err)
        );
      } catch (err) {
        console.warn(`HLTB fetch failed for ${gameName}:`, err);
      }
    },
    [gamesRef, updateGame, loadGameDetail]
  );

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
        // Reviews are a heavy field: ensure the full record is resident so
        // the follow-up update is persisted as a full row, not a patch.
        await loadGameDetail(gameId);
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
    [updateGame, loadGameDetail]
  );

  return {
    enrichGameMetadata,
    enqueueEnrich,
    enqueueEnrichBatch,
    fetchGameHltb,
    fetchGameReviews,
    fetchAllImages,
    downloadImageSafe,
    isFrontendUsableImage,
    enrichAttemptsThisSession,
    MAX_ENRICH_ATTEMPTS,
  };
}

export { isFrontendUsableImage, fetchAllImages, downloadImageSafe, enrichAttemptsThisSession, MAX_ENRICH_ATTEMPTS };
