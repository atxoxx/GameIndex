import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import type { Game, GameMetadataResult } from "../types/game";
import type { TorrentDownload } from "../types/download";

const STORAGE_KEY = "gameindex_dl_posters_v1";

// In-memory cache backed by localStorage
const coverArtCache = new Map<string, string | null>();

// Initialize cache from localStorage
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === "string" || v === null) {
          coverArtCache.set(k, v);
        }
      });
    }
  }
} catch {}

function saveCacheToStorage() {
  try {
    const obj: Record<string, string | null> = {};
    coverArtCache.forEach((v, k) => {
      obj[k] = v;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

/**
 * Strips release tags, scene groups, repacker names, versions, and brackets from download names.
 * e.g. "S.T.A.L.K.E.R. 2 [FitGirl Monkey Repack]" -> "S.T.A.L.K.E.R. 2"
 */
export function cleanGameTitle(rawName: string): string {
  let cleaned = rawName
    // Remove bracketed info: [FitGirl], [DODI], [RUNE], [FLT], [MULTI12], etc.
    .replace(/\[[^\]]*\]/g, " ")
    // Remove paren info with scene/repack terms
    .replace(/\([^)]*(repack|fitgirl|dodi|build|version|v\d|multi\d|dlc|update|edition|crack|portable)[^)]*\)/gi, " ")
    // Remove common release keywords
    .replace(
      /\b(repack|fitgirl|dodi|elamigos|tenoke|rune|skidrow|codex|empress|goldberg|steamrip|kaoskrew|gog|portable|monkey|rip|iso|flt|razor1911|cpty)\b/gi,
      " ",
    )
    // Normalize underscores to spaces
    .replace(/([a-zA-Z0-9])_([a-zA-Z0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // Strip trailing dashes, versions, numbers
  cleaned = cleaned.replace(/[-–—]\s*$/, "").trim();

  return cleaned || rawName;
}

/**
 * Normalizes title for alphanumeric comparison (ignoring case, punctuation, spaces).
 * e.g. "S.T.A.L.K.E.R. 2" -> "stalker2"
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Helper to fetch game poster from backend scraper with fallback searches.
 */
async function fetchPosterMetadata(title: string): Promise<string | null> {
  // 1. Direct search with cleaned title
  try {
    const results = await invoke<GameMetadataResult[]>("search_game_metadata", {
      gameName: title,
      skipLaunchbox: false,
    });
    if (results && results.length > 0) {
      for (const res of results) {
        const cover = res.images?.cover || res.images?.hero || res.images?.banner || res.images?.icon;
        if (cover) return cover;
      }
    }
  } catch {}

  // 2. Alternative search stripping periods (e.g. "S.T.A.L.K.E.R. 2" -> "STALKER 2")
  const strippedDots = title.replace(/\./g, "").trim();
  if (strippedDots !== title && strippedDots.length > 1) {
    try {
      const results = await invoke<GameMetadataResult[]>("search_game_metadata", {
        gameName: strippedDots,
        skipLaunchbox: false,
      });
      if (results && results.length > 0) {
        for (const res of results) {
          const cover = res.images?.cover || res.images?.hero || res.images?.banner || res.images?.icon;
          if (cover) return cover;
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Custom hook to resolve the best vertical poster artwork and matched Game entity for a download.
 *
 * 1. Checks `download.gameId` in local GameContext.
 * 2. Fuzzy-matches cleaned download title against local library titles.
 * 3. Falls back to querying `search_game_metadata` from the scraper (Steam / IGDB) and caching the result.
 */
export function useDownloadCoverArt(download: TorrentDownload): {
  matchedGame: Game | null;
  coverArtUrl: string | null;
  loading: boolean;
} {
  const { games } = useGames();
  const cleanedName = useMemo(() => cleanGameTitle(download.name), [download.name]);
  const normCleaned = useMemo(() => normalizeTitle(cleanedName), [cleanedName]);

  // 1 & 2: Local library matching
  const matchedGame = useMemo(() => {
    if (download.gameId) {
      const byId = games.find((g) => g.id === download.gameId);
      if (byId) return byId;
    }

    if (!normCleaned) return null;

    // Direct / Substring normalized match against library games
    return (
      games.find((g) => {
        const normG = normalizeTitle(g.name);
        if (!normG) return false;
        return normCleaned.includes(normG) || normG.includes(normCleaned);
      }) || null
    );
  }, [games, download.gameId, normCleaned]);

  const localArtwork = matchedGame?.coverArtUrl || matchedGame?.coverSourceUrl || matchedGame?.iconUrl || null;
  const [remoteArtwork, setRemoteArtwork] = useState<string | null>(() => {
    return coverArtCache.get(normCleaned) || null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If local game has artwork or we already have a cached remote artwork, nothing to fetch
    if (localArtwork || coverArtCache.has(normCleaned)) {
      if (coverArtCache.has(normCleaned)) {
        setRemoteArtwork(coverArtCache.get(normCleaned) || null);
      }
      return;
    }

    if (!cleanedName || cleanedName.length < 2) return;

    let isMounted = true;
    setLoading(true);

    fetchPosterMetadata(cleanedName)
      .then((art) => {
        if (!isMounted) return;
        coverArtCache.set(normCleaned, art);
        saveCacheToStorage();
        setRemoteArtwork(art);
      })
      .catch((err) => {
        console.warn(`[useDownloadCoverArt] Failed to fetch poster for "${cleanedName}":`, err);
        coverArtCache.set(normCleaned, null);
        saveCacheToStorage();
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [cleanedName, normCleaned, localArtwork]);

  return {
    matchedGame,
    coverArtUrl: localArtwork || remoteArtwork,
    loading,
  };
}
