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

export function isGogRedirect(url: URL): boolean {
  return (
    url.hostname.toLowerCase() === "embed.gog.com" &&
    url.pathname.replace(/\/+$/, "") === "/on_login_success" &&
    url.searchParams.has("code")
  );
}

export function isHumbleLibraryUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    (host === "humblebundle.com" || host.endsWith(".humblebundle.com")) &&
    url.pathname.startsWith("/home/library")
  );
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
