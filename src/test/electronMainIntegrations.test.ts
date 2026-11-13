import { describe, expect, it } from "vitest";
import {
  isBattleNetOverview,
  isEaLoggedIn,
  isEpicRedirect,
  isGogRedirect,
  isHumbleLibraryUrl,
  isItchLoggedIn,
  isXboxRedirect,
} from "../../electron/main/features/integrations/authMatch";

const url = (value: string): URL => new URL(value);

describe("store login success matching", () => {
  it("accepts only loopback Epic launcher redirects with a code", () => {
    expect(isEpicRedirect(url("http://localhost/launcher/authorized?code=abc"))).toBe(true);
    expect(isEpicRedirect(url("http://127.0.0.1:8080/launcher/authorized?code=abc"))).toBe(true);
    expect(isEpicRedirect(url("http://localhost/launcher/authorized"))).toBe(false);
    expect(isEpicRedirect(url("https://evil.com/?next=localhost/launcher/authorized?code=abc"))).toBe(false);
    expect(isEpicRedirect(url("https://localhost.evil.com/launcher/authorized?code=abc"))).toBe(false);
  });

  it("accepts only the GOG embed callback with a code", () => {
    expect(isGogRedirect(url("https://embed.gog.com/on_login_success?origin=client&code=abc"))).toBe(true);
    expect(isGogRedirect(url("https://embed.gog.com/on_login_success"))).toBe(false);
    expect(isGogRedirect(url("https://evil.com/?next=https://embed.gog.com/on_login_success?code=x"))).toBe(false);
  });

  it("matches Humble's library page on the real domain", () => {
    expect(isHumbleLibraryUrl(url("https://www.humblebundle.com/home/library"))).toBe(true);
    expect(isHumbleLibraryUrl(url("https://humblebundle.com.evil.com/home/library"))).toBe(false);
  });

  it("matches Battle.net overview, EA home, Xbox redirect and itch dashboard", () => {
    expect(isBattleNetOverview(url("https://account.battle.net/overview"))).toBe(true);
    expect(isBattleNetOverview(url("https://account.battle.net/login"))).toBe(false);
    expect(isEaLoggedIn(url("https://www.ea.com/"))).toBe(true);
    expect(isEaLoggedIn(url("https://www.ea.com/en-us"))).toBe(false);
    expect(isXboxRedirect(url("https://login.live.com/oauth20_desktop.srf?code=x"))).toBe(true);
    expect(isXboxRedirect(url("https://login.live.com/oauth20_authorize.srf"))).toBe(false);
    expect(isItchLoggedIn(url("https://itch.io/dashboard"))).toBe(true);
    expect(isItchLoggedIn(url("https://itch.io/login"))).toBe(false);
  });
});
