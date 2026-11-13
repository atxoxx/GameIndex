/**
 * Epic Games account login (Launcher OAuth).
 *
 * Ported from `src-tauri/src/epic/auth.rs`: the embedded browser completes the
 * Epic ID login and redirects to `localhost/launcher/authorized?code=…`; the
 * code is exchanged for launcher tokens with Epic's public client credential.
 */
import { session } from "electron";
import { httpText, formBody } from "../../lib/http";
import { deleteSecret, readSecret, writeSecret } from "../../lib/secureDocument";
import { closeAuthWindow, openAuthWindow, AUTH_USER_AGENT } from "../../surfaces/authWindow";

import {
  extractEpicAuthorizationCode,
  isEpicRedirect,
  isEpicRedirectPage,
} from "./authMatch";

const EPIC_AUTH_ENCODED =
  "MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=";
const EPIC_TOKEN_URL =
  "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
const EPIC_LOGIN_URL =
  "https://www.epicgames.com/id/login?redirectUrl=" +
  encodeURIComponent(
    "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code",
  );
const TOKENS_KEY = "epic_tokens";
const PARTITION = "persist:auth-epic";

export interface EpicTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  displayName?: string;
}

interface EpicTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  account_id?: string;
  display_name?: string;
  errorCode?: string;
  errorMessage?: string;
}

async function exchange(body: URLSearchParams): Promise<EpicTokens> {
  const response = await httpText(EPIC_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `basic ${EPIC_AUTH_ENCODED}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": AUTH_USER_AGENT,
    },
    body,
    timeoutMs: 20_000,
  });
  let parsed: EpicTokenResponse;
  try {
    parsed = JSON.parse(response.text) as EpicTokenResponse;
  } catch {
    throw new Error(`Epic token exchange returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok || !parsed.access_token || !parsed.refresh_token || !parsed.account_id) {
    throw new Error(
      parsed.errorMessage || parsed.errorCode
        ? `Epic login failed: ${parsed.errorMessage ?? parsed.errorCode}`
        : `Epic login failed (HTTP ${response.status})`,
    );
  }
  const tokens: EpicTokens = {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: Date.now() + (parsed.expires_in ?? 3600) * 1000,
    accountId: parsed.account_id,
    displayName: parsed.display_name,
  };
  writeSecret(TOKENS_KEY, tokens);
  return tokens;
}

/** Open the embedded login and return the one-time authorization code. */
export async function epicStartLogin(): Promise<string> {
  const result = await openAuthWindow({
    provider: "epic",
    url: EPIC_LOGIN_URL,
    title: "Epic Games Login",
    userAgent: AUTH_USER_AGENT,
    resetSession: true,
    success: {
      kind: "body",
      matches: (url) => isEpicRedirectPage(url) || isEpicRedirect(url),
      extract: extractEpicAuthorizationCode,
      settleMs: 400,
    },
  });
  if (!result.code) throw new Error("Epic login did not return an authorization code");
  return result.code;
}

/** Exchange the auth code for tokens and persist them. */
export async function epicFinishLogin(authCode: string): Promise<EpicTokens> {
  const code = authCode.trim();
  if (!code) throw new Error("An Epic authorization code is required");
  return exchange(
    formBody({
      grant_type: "authorization_code",
      code,
      token_type: "eg1",
    }),
  );
}

export async function epicLoginWithRefreshToken(
  refreshToken: string,
  accountId: string,
  displayName?: string,
): Promise<EpicTokens> {
  const token = refreshToken.trim();
  if (!token) throw new Error("An Epic refresh token is required");
  const tokens = await exchange(
    formBody({
      grant_type: "refresh_token",
      refresh_token: token,
      token_type: "eg1",
    }),
  );
  if (accountId.trim()) tokens.accountId = accountId.trim();
  if (displayName?.trim()) tokens.displayName = displayName.trim();
  writeSecret(TOKENS_KEY, tokens);
  return tokens;
}

export function getEpicTokens(): EpicTokens | null {
  return readSecret<EpicTokens>(TOKENS_KEY);
}

export function epicIsAuthenticated(): boolean {
  return getEpicTokens() !== null;
}

export async function epicLogout(): Promise<null> {
  deleteSecret(TOKENS_KEY);
  closeAuthWindow("epic");
  await session.fromPartition(PARTITION).clearStorageData().catch(() => undefined);
  return null;
}

/** Refresh the access token shortly before it expires. */
export async function refreshEpicIfNeeded(): Promise<EpicTokens | null> {
  const tokens = getEpicTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 5 * 60 * 1000) return tokens;
  try {
    return await epicLoginWithRefreshToken(
      tokens.refreshToken,
      tokens.accountId,
      tokens.displayName,
    );
  } catch (error) {
    console.warn("[epic] token refresh failed:", error);
    return tokens;
  }
}
