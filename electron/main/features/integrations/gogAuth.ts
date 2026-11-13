/**
 * GOG account login (Galaxy OAuth + session cookies).
 *
 * Ported from `src-tauri/src/gog/auth.rs`: the embedded browser signs into
 * `login.gog.com`, GOG redirects to `embed.gog.com/on_login_success?code=…`,
 * and the code is exchanged through GOG's non-standard GET token endpoint.
 * The cookies captured from the same window are required for the owned-library
 * endpoint later.
 */
import { session } from "electron";
import { httpJson } from "../../lib/http";
import { deleteSecret, readSecret, writeSecret } from "../../lib/secureDocument";
import {
  closeAuthWindow,
  openAuthWindow,
  AUTH_USER_AGENT,
  type AuthCookie,
} from "../../surfaces/authWindow";

import { isGogRedirect } from "./authMatch";

const GOG_CLIENT_ID = "46899977096215655";
const GOG_CLIENT_SECRET =
  "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_AUTH_URL =
  "https://login.gog.com/auth" +
  "?client_id=46899977096215655" +
  "&layout=galaxy" +
  "&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient" +
  "&response_type=code";
const GOG_TOKEN_URL = "https://auth.gog.com/token";
const GOG_REDIRECT_URI = "https://embed.gog.com/on_login_success?origin=client";
const TOKENS_KEY = "gog_tokens";
const SESSION_KEY = "gog_session";
const COOKIES_KEY = "gog_cookies";
const PARTITION = "persist:auth-gog";
const GOG_COOKIE_DOMAINS = ["gog.com", "gogcdn.com", "gog-static.com"];

export interface GogTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

export interface GogSession {
  userId: string;
  username: string;
  loggedInAt: number;
}

interface GogTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: string;
  error?: string;
  error_description?: string;
}

interface GogAccountBasic {
  userId?: string;
  username?: string;
  user_id?: string;
  email?: string;
}

async function exchangeCode(code: string): Promise<GogTokenResponse> {
  const query = new URLSearchParams({
    client_id: GOG_CLIENT_ID,
    client_secret: GOG_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: GOG_REDIRECT_URI,
  });
  const response = await httpJson<GogTokenResponse>(`${GOG_TOKEN_URL}?${query.toString()}`, {
    headers: { "user-agent": AUTH_USER_AGENT },
    timeoutMs: 20_000,
  });
  if (!response.access_token || !response.refresh_token) {
    throw new Error(
      response.error_description || response.error || "GOG token exchange failed",
    );
  }
  return response;
}

async function fetchAccount(): Promise<GogAccountBasic | null> {
  const tokens = getGogTokens();
  if (!tokens) return null;
  try {
    return await httpJson<GogAccountBasic>("https://menu.gog.com/v1/account/basic", {
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "user-agent": AUTH_USER_AGENT,
      },
      timeoutMs: 15_000,
    });
  } catch (error) {
    console.warn("[gog] account probe failed:", error);
    return null;
  }
}

export function getGogTokens(): GogTokens | null {
  return readSecret<GogTokens>(TOKENS_KEY);
}

export function getGogSession(): GogSession | null {
  return readSecret<GogSession>(SESSION_KEY);
}

export function getGogCookies(): AuthCookie[] {
  return readSecret<AuthCookie[]>(COOKIES_KEY) ?? [];
}

/** Embedded login + token exchange + cookie capture. */
export async function gogStartLogin(): Promise<GogSession> {
  const auth = await openAuthWindow({
    provider: "gog",
    url: GOG_AUTH_URL,
    title: "GOG Login",
    userAgent: AUTH_USER_AGENT,
    resetSession: true,
    success: {
      kind: "code",
      matches: isGogRedirect,
      param: "code",
      captureDomains: GOG_COOKIE_DOMAINS,
    },
  });
  if (!auth.code) throw new Error("GOG login did not return an authorization code");

  const response = await exchangeCode(auth.code);
  const tokens: GogTokens = {
    accessToken: response.access_token as string,
    refreshToken: response.refresh_token as string,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    userId: response.user_id ?? "",
  };
  writeSecret(TOKENS_KEY, tokens);
  if (auth.cookies && auth.cookies.length > 0) {
    writeSecret(COOKIES_KEY, auth.cookies);
  }

  const account = await fetchAccount();
  const session: GogSession = {
    userId: account?.userId ?? account?.user_id ?? tokens.userId,
    username: account?.username ?? account?.email ?? "GOG account",
    loggedInAt: Date.now(),
  };
  if (session.userId && session.userId !== tokens.userId) {
    tokens.userId = session.userId;
    writeSecret(TOKENS_KEY, tokens);
  }
  writeSecret(SESSION_KEY, session);
  return session;
}

export function gogIsAuthenticated(): boolean {
  return getGogTokens() !== null;
}

export async function gogLogout(): Promise<null> {
  deleteSecret(TOKENS_KEY);
  deleteSecret(SESSION_KEY);
  deleteSecret(COOKIES_KEY);
  closeAuthWindow("gog");
  await session.fromPartition(PARTITION).clearStorageData().catch(() => undefined);
  return null;
}

/** Refresh the access token when it is close to expiry. */
export async function refreshGogIfNeeded(): Promise<GogTokens | null> {
  const tokens = getGogTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 5 * 60 * 1000) return tokens;
  const query = new URLSearchParams({
    client_id: GOG_CLIENT_ID,
    client_secret: GOG_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  try {
    const response = await httpJson<GogTokenResponse>(`${GOG_TOKEN_URL}?${query.toString()}`, {
      headers: { "user-agent": AUTH_USER_AGENT },
      timeoutMs: 20_000,
    });
    if (!response.access_token) return tokens;
    const next: GogTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
      userId: response.user_id ?? tokens.userId,
    };
    writeSecret(TOKENS_KEY, next);
    return next;
  } catch (error) {
    console.warn("[gog] token refresh failed:", error);
    return tokens;
  }
}
