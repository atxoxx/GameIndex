/**
 * Humble Bundle cookie login.
 *
 * Humble has no OAuth API for library access; the old Tauri build opened the
 * login page in a WebView, watched for the library page and captured the
 * `.humblebundle.com` session cookies. This is the Electron port.
 */
import { session } from "electron";
import { httpText } from "../../lib/http";
import { deleteSecret, readSecret, writeSecret } from "../../lib/secureDocument";
import {
  closeAuthWindow,
  openAuthWindow,
  AUTH_USER_AGENT,
  type AuthCookie,
} from "../../surfaces/authWindow";

import { isHumbleLibraryUrl } from "./authMatch";

const LOGIN_URL = "https://www.humblebundle.com/";
const COOKIES_KEY = "humble_cookies";
const SESSION_KEY = "humble_session";
const PARTITION = "persist:auth-humble";

export interface HumbleSession {
  username: string;
  loggedInAt: number;
}

function cookieHeader(cookies: AuthCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function probeUsername(cookies: AuthCookie[]): Promise<string> {
  try {
    const response = await httpText("https://www.humblebundle.com/home/library", {
      headers: {
        cookie: cookieHeader(cookies),
        "user-agent": AUTH_USER_AGENT,
      },
      timeoutMs: 15_000,
    });
    const match =
      /"user_display_name"\s*:\s*"([^"]+)"/i.exec(response.text) ??
      /<span[^>]*class="[^"]*user[^"]*"[^>]*>([^<]{2,60})<\/span>/i.exec(response.text);
    return match?.[1]?.trim() || "Humble account";
  } catch {
    return "Humble account";
  }
}

export function getHumbleCookies(): AuthCookie[] {
  return readSecret<AuthCookie[]>(COOKIES_KEY) ?? [];
}

export function getHumbleSession(): HumbleSession | null {
  return readSecret<HumbleSession>(SESSION_KEY);
}

export async function humbleStartLogin(): Promise<HumbleSession> {
  const result = await openAuthWindow({
    provider: "humble",
    url: LOGIN_URL,
    title: "Humble Bundle Login",
    userAgent: AUTH_USER_AGENT,
    success: {
      kind: "cookies",
      matches: isHumbleLibraryUrl,
      domains: ["humblebundle.com"],
      settleMs: 1_000,
    },
  });
  const cookies = result.cookies ?? [];
  if (cookies.length === 0) {
    throw new Error("Humble login did not return a session cookie");
  }
  writeSecret(COOKIES_KEY, cookies);
  const session: HumbleSession = {
    username: await probeUsername(cookies),
    loggedInAt: Date.now(),
  };
  writeSecret(SESSION_KEY, session);
  return session;
}

export function humbleIsAuthenticated(): boolean {
  return getHumbleCookies().length > 0;
}

export async function humbleLogout(): Promise<null> {
  deleteSecret(COOKIES_KEY);
  deleteSecret(SESSION_KEY);
  closeAuthWindow("humble");
  await session.fromPartition(PARTITION).clearStorageData().catch(() => undefined);
  return null;
}
