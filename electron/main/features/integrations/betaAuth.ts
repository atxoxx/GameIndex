/**
 * Embedded cookie logins for the beta store clients.
 *
 * Battle.net, EA, Xbox/Microsoft and itch.io are cookie- or OAuth-driven; the
 * old Tauri build opened each provider's login page and captured the resulting
 * session cookies. This module ports that table to the shared auth window.
 * Cloud sync for these stores is still local-only, but signing in now uses the
 * real provider page instead of a fake local session.
 */
import { session } from "electron";
import { deleteSecret, readSecret, writeSecret } from "../../lib/secureDocument";
import {
  closeAuthWindow,
  openAuthWindow,
  AUTH_USER_AGENT,
  type AuthCookie,
  type AuthSuccess,
} from "../../surfaces/authWindow";

import {
  isBattleNetOverview,
  isEaLoggedIn,
  isItchLoggedIn,
  isXboxRedirect,
} from "./authMatch";

export type BetaAuthKey = "battlenet" | "ea" | "xbox" | "itch";

interface BetaAuthSpec {
  url: string;
  title: string;
  success: AuthSuccess;
  partition: string;
  cookiesKey: string;
  sessionKey: string;
  resetSession?: boolean;
}

const XBOX_CLIENT_ID = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const XBOX_REDIRECT = "https://login.live.com/oauth20_desktop.srf";

const SPECS: Record<BetaAuthKey, BetaAuthSpec> = {
  battlenet: {
    url: "https://account.battle.net/",
    title: "Battle.net Login",
    partition: "persist:auth-battlenet",
    cookiesKey: "battlenet_cookies",
    sessionKey: "battlenet_session",
    success: {
      kind: "cookies",
      matches: isBattleNetOverview,
      domains: ["battle.net", "blizzard.com"],
      settleMs: 1_000,
    },
  },
  ea: {
    url: "https://www.ea.com/login",
    title: "EA Login",
    partition: "persist:auth-ea",
    cookiesKey: "ea_cookies",
    sessionKey: "ea_session",
    success: {
      kind: "cookies",
      matches: isEaLoggedIn,
      domains: ["ea.com"],
      settleMs: 1_000,
    },
  },
  xbox: {
    url:
      "https://login.live.com/oauth20_authorize.srf" +
      `?client_id=${XBOX_CLIENT_ID}` +
      "&response_type=code" +
      "&scope=service%3A%3Auser.auth.xboxlive.com%3A%3AMBI_SSL" +
      `&redirect_uri=${encodeURIComponent(XBOX_REDIRECT)}`,
    title: "Microsoft Account Login",
    partition: "persist:auth-xbox",
    cookiesKey: "xbox_cookies",
    sessionKey: "xbox_session",
    success: {
      kind: "cookies",
      matches: isXboxRedirect,
      domains: ["live.com", "microsoft.com", "microsoftonline.com"],
      settleMs: 1_000,
    },
  },
  itch: {
    url: "https://itch.io/login",
    title: "itch.io Login",
    partition: "persist:auth-itch",
    cookiesKey: "itch_cookies",
    sessionKey: "itch_session",
    resetSession: true,
    success: {
      kind: "cookies",
      matches: isItchLoggedIn,
      domains: ["itch.io", "itch.zone"],
      settleMs: 1_000,
    },
  },
};

export interface BetaAuthSession {
  cookies: AuthCookie[];
  loggedInAt: number;
}

export function betaCookies(key: BetaAuthKey): AuthCookie[] {
  const spec = SPECS[key];
  return readSecret<AuthCookie[]>(spec.cookiesKey) ?? [];
}

export async function betaStartLogin(key: BetaAuthKey): Promise<BetaAuthSession> {
  const spec = SPECS[key];
  const result = await openAuthWindow({
    provider: key,
    url: spec.url,
    title: spec.title,
    userAgent: AUTH_USER_AGENT,
    success: spec.success,
    resetSession: spec.resetSession,
  });
  const cookies = result.cookies ?? [];
  if (cookies.length === 0) {
    throw new Error(`${spec.title} did not return a session cookie`);
  }
  writeSecret(spec.cookiesKey, cookies);
  const sessionRecord: BetaAuthSession = { cookies, loggedInAt: Date.now() };
  writeSecret(spec.sessionKey, sessionRecord);
  return sessionRecord;
}

export function betaLogout(key: BetaAuthKey): void {
  const spec = SPECS[key];
  deleteSecret(spec.cookiesKey);
  deleteSecret(spec.sessionKey);
  closeAuthWindow(key);
  void session.fromPartition(spec.partition).clearStorageData().catch(() => undefined);
}
