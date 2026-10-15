import type { DownloadSearchResult } from "../../types/plugins";

/** Debrid providers that can answer an instant-availability cache probe. */
const CACHE_CAPABLE_PROVIDERS = new Set(["alldebrid", "torbox"]);

const BTIH_IN_MAGNET = /urn:btih:([a-z0-9]{32,40})/i;
const BARE_HASH = /^[a-z0-9]{32,40}$/i;

/** Whether a configured provider supports `debrid_check_cache`. */
export function cacheCapableProvider(provider: string): boolean {
  return CACHE_CAPABLE_PROVIDERS.has((provider ?? "").trim().toLowerCase());
}

/**
 * The magnet URI to probe for this result, or `null` when it carries
 * nothing cache-checkable. A bare infohash is promoted to a magnet so
 * sources that only expose the hash can still be verified.
 */
export function cacheMagnetFor(
  match: Pick<DownloadSearchResult, "magnet" | "infohash">,
): string | null {
  const magnet = match.magnet?.trim();
  if (magnet) return magnet;
  const hash = match.infohash?.trim();
  if (hash && BARE_HASH.test(hash)) {
    return `magnet:?xt=urn:btih:${hash.toLowerCase()}`;
  }
  return null;
}

/**
 * Stable identity used to share a probe across results that point at the
 * same release. Prefers the infohash so two sources offering one torrent
 * resolve from a single API call.
 */
export function cacheKeyFor(
  provider: string,
  match: Pick<DownloadSearchResult, "magnet" | "infohash">,
): string | null {
  const magnet = cacheMagnetFor(match);
  if (!magnet) return null;
  const hash =
    match.infohash?.trim().toLowerCase() ||
    magnet.match(BTIH_IN_MAGNET)?.[1]?.toLowerCase();
  const normalizedProvider = (provider ?? "").trim().toLowerCase();
  return `${normalizedProvider}:${hash ?? magnet}`;
}

/** Cache verdicts remembered for the lifetime of the app session, so
 *  reopening the modal does not re-probe the same releases. */
const sessionResults = new Map<string, boolean>();

export function getSessionCache(key: string): boolean | undefined {
  return sessionResults.get(key);
}

export function setSessionCache(key: string, cached: boolean): void {
  sessionResults.set(key, cached);
}

/** Test seam — clears remembered verdicts between cases. */
export function clearSessionCache(): void {
  sessionResults.clear();
}
