// useGameBackdropArt — resolves the best full-bleed background artwork
// for a game, preferring SteamGridDB's ANIMATED hero (APNG / animated
// WebP) when the community has one, with a safe static fallback ladder.
//
// Used by the Big Screen dashboard backdrop (Home / Store) and the
// tabbed game / store-detail heroes. Card artwork stays in
// `useGameCardArt`; this hook is specifically about wide backgrounds.
//
// Resolution order for the static layer:
//   1. SteamGridDB hero (wide community art)
//   2. The game's own bannerUrl
//   3. Steam CDN `library_hero.jpg` (Steam titles only)
//   4. The game's cover art
//
// The animated layer only ever resolves from SteamGridDB's
// `heroAnimatedUrl` — animated *grids* are 2:3 portrait art and crop
// badly as a 16:9 background.

import { useMemo } from "react";
import { useSteamGridArt } from "../context/SteamGridDbContext";
import { resolveSteamAppId } from "./useGameCardArt";
import type { Game, StoreGameSummary } from "../types/game";

/** Anything with the image/source fields this hook can read. */
export type BackdropArtSource =
  | Partial<Game>
  | StoreGameSummary
  | {
      id?: string | number;
      name?: string;
      steamAppId?: number | null;
      websites?: string[] | null;
      path?: string | null;
      platform?: string | null;
      coverArtUrl?: string | null;
      coverUrl?: string | null;
      bannerUrl?: string | null;
    }
  | null
  | undefined;

export interface BackdropArt {
  /** Best always-available static hero/banner/cover, or null. */
  staticUrl: string | null;
  /** Animated hero (APNG / animated WebP) when available, else null. */
  animatedUrl: string | null;
}

export interface GameBackdropArtOptions {
  /** Bypass artwork resolution entirely (e.g. while a page is hidden). */
  enabled?: boolean;
}

/** Steam CDN wide hero for a known AppID. */
export function steamLibraryHeroUrl(appId: number | null | undefined): string | null {
  if (appId == null || !Number.isFinite(appId) || appId <= 0) return null;
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`;
}

/**
 * Pure priority resolver. Exported so the fallback ladder is unit
 * testable without mounting React or hitting the network.
 */
export function pickBackdropArt(input: {
  heroAnimatedUrl?: string | null;
  heroUrl?: string | null;
  bannerUrl?: string | null;
  /** Steam CDN library hero — only passed for Steam-platform titles. */
  steamHeroUrl?: string | null;
  coverArtUrl?: string | null;
}): BackdropArt {
  const clean = (value?: string | null): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };

  return {
    staticUrl:
      clean(input.heroUrl) ??
      clean(input.bannerUrl) ??
      clean(input.steamHeroUrl) ??
      clean(input.coverArtUrl) ??
      null,
    animatedUrl: clean(input.heroAnimatedUrl),
  };
}

function readBannerUrl(game: BackdropArtSource): string | null {
  if (!game || !("bannerUrl" in game)) return null;
  return game.bannerUrl ?? null;
}

function readCoverArtUrl(game: BackdropArtSource): string | null {
  if (!game) return null;
  if ("coverArtUrl" in game && game.coverArtUrl) return game.coverArtUrl;
  if ("coverUrl" in game && game.coverUrl) return game.coverUrl;
  return null;
}

function readPlatform(game: BackdropArtSource): string | null {
  if (!game || !("platform" in game)) return null;
  return game.platform ?? null;
}

/**
 * Resolve animated + static background art for a game. Kicks off the
 * batched SteamGridDB lookup (cached by AppID across the app) and
 * degrades to the game's own banner/cover while it resolves.
 */
export function useGameBackdropArt(
  game: BackdropArtSource,
  options: GameBackdropArtOptions = {},
): BackdropArt {
  const { enabled = true } = options;

  const steamAppId = useMemo(
    () => resolveSteamAppId(game, null),
    [game],
  );

  const sgdb = useSteamGridArt(enabled ? steamAppId : null);

  return useMemo(() => {
    // The Steam CDN fallback is deliberately gated on Steam-platform
    // titles: a name-matched appid for a GOG/Epic game can be wrong,
    // and a wrong `library_hero.jpg` is worse than the cover.
    const platform = readPlatform(game);
    const steamHeroUrl =
      platform === "Steam" ? steamLibraryHeroUrl(steamAppId) : null;

    return pickBackdropArt({
      heroAnimatedUrl: sgdb?.heroAnimatedUrl ?? null,
      heroUrl: sgdb?.heroUrl ?? null,
      bannerUrl: readBannerUrl(game),
      steamHeroUrl,
      coverArtUrl: readCoverArtUrl(game),
    });
  }, [game, sgdb, steamAppId]);
}

export default useGameBackdropArt;
