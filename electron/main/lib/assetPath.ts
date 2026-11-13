/**
 * Resolve the filesystem path carried by a `giasset://` request.
 *
 * `convertFileSrc()` emits `giasset://local/<percent-encoded absolute path>`.
 * URL parsing leaves the pathname as `/<encoded path>`, so only the protocol's
 * own leading slash may be removed *before* decoding. Decoding first and then
 * stripping every slash destroys POSIX absoluteness (`/%2Fhome` → `home`),
 * which made every local image on Linux resolve against the process cwd.
 */
import path from "node:path";

export function filePathFromAssetUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const encoded = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  if (!decoded) return null;
  return path.normalize(decoded);
}
