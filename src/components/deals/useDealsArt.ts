import { useEffect, useMemo, useState } from "react";
import { useSteamGridArt } from "../../context/SteamGridDbContext";
import { useAnimatedMediaEnabled } from "../../context/SettingsContext";
import type { SgdbAssets } from "../../types/steamgriddb";
import { invoke } from "@tauri-apps/api/core";

interface UseDealsArtOptions {
  /** Steam AppID resolved from the store URL, when the deal is for a Steam game. */
  appId?: number | null;
  /** Source artwork (ITAD thumbnail, Game Pass cover, Playtester thumbnail). */
  image?: string | null;
  /** Cards favour the 16:9 header crop; the modal favours the wide hero art. */
  variant?: "card" | "hero";
}

interface UseDealsArtResult {
  url: string | null;
  onError: () => void;
}

/**
 * Artwork for a deal tile or modal hero.
 *
 * Cards skip SteamGridDB entirely: a grid can hold hundreds of tiles, and one
 * community lookup (plus a multi-megabyte decode) per tile is what made the
 * deals page crawl. Cards use the small Steam `header` capsule or the source
 * image. Only the single open modal asks SteamGridDB for wide hero art.
 */
export function useDealsArt({
  appId,
  image,
  variant = "card",
}: UseDealsArtOptions): UseDealsArtResult {
  const isHero = variant === "hero";
  const sgdb = useSteamGridArt(isHero ? appId ?? null : null);
  const animatedEnabled = useAnimatedMediaEnabled();

  const candidates = useMemo(() => {
    const list: string[] = [];

    if (isHero && animatedEnabled && sgdb?.heroAnimatedUrl) {
      list.push(sgdb.heroAnimatedUrl);
    }
    if (isHero && sgdb?.heroUrl) list.push(sgdb.heroUrl);

    if (appId) {
      // `library_hero` is the 3:1 atmospheric shot; the `header` capsule is the
      // 460x215 crop that decompresses fast in a dense card grid.
      list.push(
        isHero
          ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`
          : `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      );
    }
    if (image) list.push(image);
    return list.filter((url, index) => list.indexOf(url) === index);
  }, [animatedEnabled, appId, image, isHero, sgdb?.heroAnimatedUrl, sgdb?.heroUrl]);

  const signature = candidates.join("|");
  const [state, setState] = useState({ signature, index: 0 });

  // A new source (different game) restarts the ladder without an effect.
  const index = state.signature === signature ? state.index : 0;

  const url = candidates[index] ?? null;

  return {
    url,
    onError: () => setState({ signature, index: index + 1 }),
  };
}

/**
 * Hero art for titles that have no Steam AppID (giveaways, Game Pass, demos).
 *
 * `sgdb_get_assets` also resolves by game name, so the detail modal can show
 * real key art for a non-Steam store page. Only called while a modal is open -
 * a grid of cards must never fire one lookup per tile.
 */
export function useSgdbArtByName(title: string, enabled: boolean): SgdbAssets | null {
  const [assets, setAssets] = useState<SgdbAssets | null>(null);

  useEffect(() => {
    if (!enabled || title.trim().length < 2) {
      setAssets(null);
      return;
    }

    let cancelled = false;
    invoke<SgdbAssets | null>("sgdb_get_assets", {
      steamAppId: null,
      gameName: title,
    })
      .then((result) => {
        if (!cancelled) setAssets(result ?? null);
      })
      .catch(() => {
        if (!cancelled) setAssets(null);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, title]);

  return assets;
}