import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  extractSteamAppIdFromWebsites,
  type Game,
  type GameMetadataResult,
  type IgdbReview,
} from "../../types/game";
import type { SgdbAssets } from "../../types/steamgriddb";
import { isUsableImageUrl, toWebviewAssetUrl } from "../../utils/artworkUrl";

export const NO_IGDB_MATCH_SOURCE = "Steam (no IGDB match)";

const MAX_ENRICH_ATTEMPTS = 2;
const enrichAttemptsThisSession = new Map<string, number>();

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

  /** On-demand IGDB metadata enrichment. Called by GamePage on mount when
   *  the game lacks a description (or when the user clicks Fetch Metadata
   *  in the edit panel). Replaces the old `addGame`/`addGames` auto-fetch
   *  fan-out which was wasteful for 500+ game libraries.
   *
   *  SUCCESS/FAILURE SEMANTICS:
   *  * Single IGDB `game` call + (when matches found) one `game_time_to_beats`
   *    call. Rust `igdb_acquire()` enforces 250 ms spacing between IGDB calls.
   *  * Never throws — silently skips games IGDB doesn't recognise.
   *  * Never overwrites a non-empty Game field with an empty IGDB result.
   */
  const enrichGameMetadata = useCallback(async (gameId: string, gameName: string, steamAppId?: number) => {
    // Dedupe + retry cap (see MAX_ENRICH_ATTEMPTS comment above). Both
    // the LibraryPage observer and the GamePage on-mount effect settle
    // on this single counter, so multiple fires for the same gameId in
    // a single session collapse into one round-trip (when Rust
    // succeeds) or at most `MAX_ENRICH_ATTEMPTS` round-trips (when
    // Rust keeps failing — the cap protects against an infinite
    // Rust-call loop on permanently broken upstream URLs).
    const previousAttempts = enrichAttemptsThisSession.get(gameId) ?? 0;
    if (previousAttempts >= MAX_ENRICH_ATTEMPTS) return;
    enrichAttemptsThisSession.set(gameId, previousAttempts + 1);

    try {
      // Find the current game record to merge intelligently (don't
      // overwrite non-empty existing fields with empty IGDB results).
      const current = gamesRef.current.find((g) => g.id === gameId);
      if (!current) return;

      // PRECISE BY-ID REFETCH: a game that carries a persisted IGDB id
      // (from a previous enrichment, or a sentinel game whose id later
      // became known) can be fetched exactly by id — this beats a fuzzy
      // name search and also un-gates games permanently marked
      // NO_IGDB_MATCH_SOURCE by a failed NAME lookup. Falls back to the
      // legacy name-based search when the id fetch returns null / errors.
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
          skipLaunchbox: !!steamAppId,
          steamAppId,
        });
        results.push(...searched);
      }
      if (results.length === 0) {
        // No IGDB match. Mark the game as a Steam-sourced record so a
        // subsequent visit doesn't try to enrich it again — the GamePage
        // effect uses this sentinel via metadataSource.
        const noMatchPatch = {
          metadataSource: current.metadataSource ?? NO_IGDB_MATCH_SOURCE,
        };
        updateGame(gameId, noMatchPatch);
        // Persist the sentinel immediately so a reboot doesn't re-run the
        // (failed) enrichment for this game on every scroll.
        invoke("save_game", { game: { ...current, ...noMatchPatch } }).catch((err) =>
          console.warn(`Immediate persist (no-match) failed for ${gameName}:`, err)
        );
        // DEFINITIVE FAILURE: the search returned nothing rather than
        // timing out or 404-ing. Drop the attempt counter so a future
        // MANUAL user-initiated retry (e.g. clearing the coverArtUrl in
        // the GamePage edit modal) gets a fresh budget instead of
        // inheriting a burned slot. Future AUTO-fetches are gated by
        // the metadataSource sentinel above, so they won't fire
        // regardless of the counter.
        enrichAttemptsThisSession.delete(gameId);
        return;
      }
      // Prefer IGDB for its richer metadata (timeToBeat, criticRating, themes,
      // screenshots, videos, etc.) — Steam and LaunchBox only provide basics.
      const meta = results.find((r) => r.sourceName === "IGDB") ?? results[0];

      // IMAGE-LEVEL FALLBACK across sources: many older / modded /
      // niche titles (e.g. ARMA 2 Private Military Company, Arma Gold,
      // mods without IGDB entries) have NO IGDB artwork — but a perfectly
      // valid Steam library_600x900.jpg. Without this cross-source image
      // fallback those games would render as the placeholder text card
      // forever, since the IGDB-only `meta` selection above drops the
      // Steam image URLs on the floor. Textual metadata still prizes IGDB
      // above other sources. The poster (cover) is restricted to Steam or
      // IGDB only below; hero/banner may still fall back to LaunchBox.
      // For Steam-identified games the Steam CDN hero/banner is preferred
      // over IGDB artwork.
      const pickImage = (key: "cover" | "hero" | "banner" | "logo"): string | null => {
        // Steam-identified games get the Steam CDN hero/banner by default;
        // IGDB artwork remains the default for everything else.
        if (steamAppId && (key === "hero" || key === "banner")) {
          const steam = results.find((r) => r.sourceName === "Steam");
          if (steam?.images[key]) return steam.images[key];
        }
        // The poster (cover) comes from Steam or IGDB only — LaunchBox box
        // art is never used as the library poster.
        if (key === "cover") {
          const igdb = results.find((r) => r.sourceName === "IGDB");
          if (igdb?.images.cover) return igdb.images.cover;
          const steam = results.find((r) => r.sourceName === "Steam");
          return steam?.images.cover ?? null;
        }
        // The logo comes from IGDB only; the SteamGridDB fallback is
        // applied after the metadata download below.
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
      // Merge with sentinel "only set if currently empty" for textual fields
      // so a user-edited description isn't clobbered by an IGDB re-fetch.
      const setIfEmpty = <K extends keyof Game>(key: K, value: Game[K] | undefined): Game[K] | undefined => {
        // Treat only null/undefined as "unset". An empty string (e.g. user
        // explicitly clearing the description) is preserved and not overwritten
        // by an IGDB value on subsequent visits.
        if (current[key] === undefined || current[key] === null) return value;
        return current[key];
      };
      // Steam identity for manually added games (local exe / batch):
      // IGDB's `websites` list usually contains the Steam store URL.
      // Extract the appid and PERSIST it on the game row so reviews,
      // ProtonDB, achievements and deep links all
      // work without a name-based Steam search. Scan every source's
      // websites (not just the preferred `meta`) — LaunchBox results
      // carry no websites but a sibling IGDB result might.
      const websitesForSteamId =
        current.websites ??
        meta.websites ??
        results.find((r) => r.websites && r.websites.length > 0)?.websites;
      const resolvedSteamAppId =
        current.steamAppId ??
        extractSteamAppIdFromWebsites(websitesForSteamId) ??
        undefined;
      // SteamGridDB fills: the logo comes from IGDB first with community
      // art as a fallback, and the sidebar icon is pulled from community
      // art whenever the game has none (result is cached 7 days backend-
      // side, so repeat enrichments resolve from SQLite).
      let sgdbIconUrl: string | undefined;
      let sgdbLogoUrl: string | undefined;
      if (resolvedSteamAppId) {
        try {
          const sgdb = await invoke<SgdbAssets | null>("sgdb_get_assets", {
            steamAppId: resolvedSteamAppId,
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
        genres: current.genres && current.genres.length > 0 ? current.genres : (meta.genres.length > 0 ? meta.genres : undefined),
        // USER-SET MEDIA WINS: an image the user picked in the edit modal is
        // always a base64 data URL. Never replace it with metadata art — only
        // fill empty slots (and keep remote https URLs that may be orphans,
        // since they were never user-selected). This guarantees a saved
        // icon/cover/hero/logo persists across re-enrichment.
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
        collectionId: setIfEmpty("collectionId", meta.collectionId ?? undefined),
        igdbId: setIfEmpty("igdbId", meta.igdbId ?? undefined),
        metadataSource: meta.sourceName,
        metadataUrl: meta.sourceUrl,
      };
      updateGame(gameId, enrichPatch);
      // Persist THIS game immediately (single-row upsert). The lazy
      // library-scroll enrichment can fetch dozens of covers in a burst;
      // relying only on the debounced full-library `save_games` meant a
      // cover fetched moments before the app closed never hit disk — hence
      // the "goes back to placeholder until re-enrich" on next boot. A
      // targeted write here guarantees durability without a whole-library
      // rewrite per card.
      invoke("save_game", { game: { ...current, ...enrichPatch } }).catch((err) =>
        console.warn(`Immediate persist failed for ${gameName}:`, err)
      );
      // Defensive REWARD: when an attempt produced a usable image OR
      // the game already had a working cover from a previous fetch,
      // reset the attempt counter so a future user-initiated clear +
      // re-fire (via the LibraryPage observer being re-armed by an
      // onError-clear, or the user manually editing coverArtUrl to
      // undefined) gets a FRESH attempt budget. Otherwise leave the
      // count alone — the counter we incremented at the top of this
      // function records the attempt just made, and the top-of-function
      // guard will start rejecting after MAX_ENRICH_ATTEMPTS is reached.
      //
      // A frontend-usable cover is a base64 data URL downloaded via
      // Rust. `downloadImageSafe()` falls back to returning the original
      // REMOTE URL on Rust failure, which is technically a truthy string
      // but not a working image — when the browser then 404s on it and
      // the Steam-CDN onError chain on the library card exhausts every
      // fallback and clears `coverArtUrl`, the LibraryPage observer
      // re-arms but our cap protects against an infinite Rust-call loop.
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

      // Background review load happens lazily via ReviewsTab on first open,
      // so we don't need to seed it here. This also avoids TDZ ordering
      // issues with fetchGameReviews's useCallback declaration below.
    } catch (err) {
      console.error("enrichGameMetadata failed:", err);
      // Same rationale as the no-results branch — the Rust / IGDB /
      // LaunchBox call didn't even resolve. Reset the attempt counter
      // so a transient network blip or IPC failure doesn't burn one of
      // the user's two retries.
      enrichAttemptsThisSession.delete(gameId);
    }
  }, [gamesRef, updateGame]);

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
    fetchGameReviews,
    fetchAllImages,
    downloadImageSafe,
    isFrontendUsableImage,
    enrichAttemptsThisSession,
    MAX_ENRICH_ATTEMPTS,
  };
}

export { isFrontendUsableImage, fetchAllImages, downloadImageSafe, enrichAttemptsThisSession, MAX_ENRICH_ATTEMPTS };
