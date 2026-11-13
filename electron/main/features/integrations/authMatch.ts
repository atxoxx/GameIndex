/**
 * Strict success-URL matchers for embedded store logins.
 *
 * Kept dependency-free so they can be tested without Electron. Matching on a
 * parsed URL (host + path + required parameter) prevents a page from spoofing a
 * redirect by putting `localhost/launcher/authorized` in a query string.
 */

export function isEpicRedirect(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLoopback) return false;
  return (
    url.searchParams.has("code") &&
    url.pathname.replace(/\/+$/, "").endsWith("/launcher/authorized")
  );
}

export function isEpicRedirectPage(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "www.epicgames.com" &&
    url.pathname.replace(/\/+$/, "") === "/id/api/redirect"
  );
}

/** Extract `authorizationCode` from Epic's redirect JSON page. */
export function extractEpicAuthorizationCode(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const match = /"authorizationCode"\s*:\s*"([^"]+)"/i.exec(trimmed);
  if (match?.[1]) return match[1];
  try {
    const parsed = JSON.parse(trimmed) as { authorizationCode?: unknown };
    return typeof parsed.authorizationCode === "string" ? parsed.authorizationCode : null;
  } catch {
    return null;
  }
}

export function isGogRedirect(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "embed.gog.com" &&
    url.pathname.replace(/\/+$/, "") === "/on_login_success" &&
    url.searchParams.has("code")
  );
}

export function isHumbleLibraryUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!(host === "humblebundle.com" || host.endsWith(".humblebundle.com"))) {
    return false;
  }
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/home/library" || path === "/user/settings";
}

export function isBattleNetOverview(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "account.battle.net" &&
    url.pathname.startsWith("/overview")
  );
}

export function isItchLoggedIn(url: URL): boolean {
  if (!url.hostname.toLowerCase().endsWith("itch.io")) return false;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/dashboard" || path.startsWith("/my-collections");
}

export function isEaLoggedIn(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "www.ea.com" &&
    url.pathname.replace(/\/+$/, "") === ""
  );
}

export function isXboxRedirect(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "login.live.com" &&
    url.pathname === "/oauth20_desktop.srf"
  );
}
