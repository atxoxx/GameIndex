import { useState, useMemo, useCallback, useEffect, type SyntheticEvent } from "react";
import { useSteamGridArt, usePrefetchImage } from "../context/SteamGridDbContext";
import {
  extractSteamAppId,
  extractSteamAppIdFromWebsites,
  type Game,
  type StoreGameSummary,
} from "../types/game";

export interface UseGameCardArtOptions {
  game?:
    | Partial<Game>
    | StoreGameSummary
    | {
        id?: string | number;
        name?: string;
        steamAppId?: number | null;
        websites?: string[] | null;
        path?: string | null;
        coverArtUrl?: string | null;
        coverUrl?: string | null;
        iconUrl?: string | null;
      }
    | null;
  appId?: number | null;
  defaultCoverUrl?: string | null;
  defaultIconUrl?: string | null;
  isHovered?: boolean;
  isFocused?: boolean;
  isListOrSmall?: boolean;
}

export interface UseGameCardArtResult {
  /** The final active image URL to display in <img> or background */
  displayUrl: string | null;
  /** True when the currently displayed image is animated (APNG / animated WebP) */
  isAnimated: boolean;
  /** True when the currently displayed image is an icon (rather than a poster) */
  isIcon: boolean;
  /** Best available static poster URL */
  staticPosterUrl: string | null;
  /** Best available animated poster URL */
  animatedPosterUrl: string | null;
  /** Best available icon URL */
  iconUrl: string | null;
  /** Resolved Steam AppID (or null) */
  steamAppId: number | null;
  /** Error event handler for <img> tag fallback chains */
  handleError: (e: SyntheticEvent<HTMLImageElement>) => void;
  /** Whether SteamGridDB lookups failed */
  sgdbFailed: boolean;
}

/** Resolve Steam AppID from game object or websites/path. */
export function resolveSteamAppId(
  game?: UseGameCardArtOptions["game"],
  fallbackAppId?: number | string | null
): number | null {
  if (fallbackAppId != null) {
    const n = typeof fallbackAppId === "number" ? fallbackAppId : parseInt(String(fallbackAppId), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (!game) return null;

  if ("steamAppId" in game && game.steamAppId != null) {
    const n = typeof game.steamAppId === "number" ? game.steamAppId : parseInt(String(game.steamAppId), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if ("path" in game && typeof game.path === "string" && game.path) {
    const fromPath = extractSteamAppId(game.path);
    if (fromPath != null) return fromPath;
  }
  if ("websites" in game && Array.isArray(game.websites)) {
    const fromWebsites = extractSteamAppIdFromWebsites(game.websites);
    if (fromWebsites != null) return fromWebsites;
  }
  return null;
}

/**
 * useGameCardArt
 * ──────────────
 * Unified artwork hook for all game cards across the app.
 *
 * 1. Resolves Steam AppID from game metadata (game.steamAppId, steam:// path, or IGDB websites).
 * 2. Fetches SteamGridDB community assets (batched via SteamGridDbContext).
 * 3. Eagerly prefetches the animated WebP/APNG grid so hover transitions are instant.
 * 4. In list detailed rows or compact/small UI (`isListOrSmall`), prioritizes square icons
 *    (`game.iconUrl ?? sgdb?.iconUrl`) over vertical posters.
 * 5. When hovered or focused in grid/cinematic modes, swaps to the animated SteamGridDB grid
 *    if available.
 * 6. Handles CDN failure fallback chains (animated -> static -> coverArtUrl -> Steam CDN).
 */
export function useGameCardArt(options: UseGameCardArtOptions): UseGameCardArtResult {
  const {
    game,
    appId: explicitAppId,
    defaultCoverUrl,
    defaultIconUrl,
    isHovered = false,
    isFocused = false,
    isListOrSmall = false,
  } = options;

  const [sgdbAnimatedFailed, setSgdbAnimatedFailed] = useState(false);
  const [sgdbStaticFailed, setSgdbStaticFailed] = useState(false);
  const [sgdbIconFailed, setSgdbIconFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  const steamAppId = useMemo(
    () => resolveSteamAppId(game, explicitAppId),
    [game, explicitAppId]
  );

  useEffect(() => {
    setSgdbAnimatedFailed(false);
    setSgdbStaticFailed(false);
    setSgdbIconFailed(false);
    setCoverFailed(false);
    setIconFailed(false);
  }, [steamAppId, game]);

  const sgdb = useSteamGridArt(steamAppId);

  // Extract base assets
  const ownCover = useMemo(() => {
    if (defaultCoverUrl) return defaultCoverUrl;
    if (!game) return null;
    if ("coverArtUrl" in game && game.coverArtUrl) return game.coverArtUrl;
    if ("coverUrl" in game && game.coverUrl) return game.coverUrl;
    return null;
  }, [defaultCoverUrl, game]);

  const ownIcon = useMemo(() => {
    if (defaultIconUrl) return defaultIconUrl;
    if (!game) return null;
    if ("iconUrl" in game && game.iconUrl) return game.iconUrl;
    return null;
  }, [defaultIconUrl, game]);

  const sgdbStatic = sgdb?.gridUrl && !sgdbStaticFailed ? sgdb.gridUrl : null;
  const sgdbAnimated = sgdb?.gridAnimatedUrl && !sgdbAnimatedFailed ? sgdb.gridAnimatedUrl : null;
  const sgdbIcon = sgdb?.iconUrl && !sgdbIconFailed ? sgdb.iconUrl : null;
  const isActive = isHovered || isFocused;

  // Decode animated art only for an actively hovered card. Prefetching every
  // visible card creates large decoded image buffers and raises working-set RAM.
  usePrefetchImage(isActive ? sgdbAnimated : null);

  // Resolve best icon & poster
  const resolvedIcon = !iconFailed && ownIcon ? ownIcon : sgdbIcon;
  const resolvedStaticPoster = !coverFailed && ownCover ? ownCover : sgdbStatic;

  // Determine final display URL and type
  const { displayUrl, isAnimated, isIcon } = useMemo(() => {
    // 1. In list detailed row or compact/small UI mode: prefer icon!
    if (isListOrSmall) {
      if (resolvedIcon) {
        return { displayUrl: resolvedIcon, isAnimated: false, isIcon: true };
      }
      // If no icon available, fall back to poster/animated
      if (isActive && sgdbAnimated) {
        return { displayUrl: sgdbAnimated, isAnimated: true, isIcon: false };
      }
      return { displayUrl: resolvedStaticPoster, isAnimated: false, isIcon: false };
    }

    // 2. In card/grid modes: on hover/focus, use animated grid if available!
    if (isActive && sgdbAnimated) {
      return { displayUrl: sgdbAnimated, isAnimated: true, isIcon: false };
    }

    // 3. Default: static poster
    if (resolvedStaticPoster) {
      return { displayUrl: resolvedStaticPoster, isAnimated: false, isIcon: false };
    }

    // 4. Fallback to icon if no poster exists
    if (resolvedIcon) {
      return { displayUrl: resolvedIcon, isAnimated: false, isIcon: true };
    }

    return { displayUrl: null, isAnimated: false, isIcon: false };
  }, [isListOrSmall, resolvedIcon, isActive, sgdbAnimated, resolvedStaticPoster]);

  // Robust error fallback handler
  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const src = img.src;

      if (sgdbAnimated && (src === sgdbAnimated || src.includes(sgdbAnimated))) {
        setSgdbAnimatedFailed(true);
        return;
      }
      if (sgdbStatic && (src === sgdbStatic || src.includes(sgdbStatic))) {
        setSgdbStaticFailed(true);
        return;
      }
      if (sgdbIcon && (src === sgdbIcon || src.includes(sgdbIcon))) {
        setSgdbIconFailed(true);
        return;
      }
      if (ownIcon && (src === ownIcon || src.includes(ownIcon))) {
        setIconFailed(true);
        return;
      }

      // Steam CDN ladder fallback for Steam games
      if (steamAppId) {
        if (src.includes("library_600x900_2x")) {
          img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`;
          return;
        }
        if (src.includes("library_600x900")) {
          img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;
          return;
        }
      }

      setCoverFailed(true);
    },
    [sgdbAnimated, sgdbStatic, sgdbIcon, ownIcon, steamAppId]
  );

  return {
    displayUrl,
    isAnimated,
    isIcon,
    staticPosterUrl: resolvedStaticPoster,
    animatedPosterUrl: sgdbAnimated,
    iconUrl: resolvedIcon,
    steamAppId,
    handleError,
    sgdbFailed: Boolean(sgdbAnimatedFailed && sgdbStaticFailed),
  };
}

export default useGameCardArt;
