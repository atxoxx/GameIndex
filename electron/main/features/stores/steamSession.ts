/**
 * Steam account session + owned-games sync.
 *
 * Port of `src-tauri/src/steam/auth.rs` (session validation) and
 * `steam/sync.rs` (owned games + local install enrichment).
 *
 * Sessions are persisted so `steam_get_session` works after a restart. The API
 * key is encrypted with Electron's `safeStorage` (DPAPI on Windows) whenever
 * the platform offers it; the stored document says which mode was used so a
 * profile moved between machines with different keyring availability degrades
 * to "reconnect" instead of crashing.
 *
 * `STEAM_API_KEY` from the build environment is only a fallback for the key;
 * the SteamID must come from the session (or the caller). Ownership is never
 * inferred from a name when the id is missing.
 */
import { safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { fetchOwnedGames, fetchPlayerSummaries, fallbackSteamApiKey } from "./steamApi";
import { steamInstallScan as steamInstallScanRaw } from "./steamSync";
import { resolveExecutable } from "./exe";

export interface SteamSession {
  steamId: string;
  apiKey: string;
  displayName?: string;
}

interface StoredSession {
  version: number;
  encrypted: boolean;
  /** Base64 ciphertext, or plain JSON when encryption is unavailable. */
  payload: string;
  savedAt: string;
}

function sessionFile(): string {
  return path.join(app.getPath("userData"), "steam-session.json");
}

export function loadSteamSession(): SteamSession | null {
  let stored: StoredSession;
  try {
    stored = JSON.parse(fs.readFileSync(sessionFile(), "utf8")) as StoredSession;
  } catch {
    return null;
  }
  if (!stored || typeof stored.payload !== "string") return null;
  try {
    let json: string;
    if (stored.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("[steam] stored session is encrypted but no OS keyring is available");
        return null;
      }
      json = safeStorage.decryptString(Buffer.from(stored.payload, "base64"));
    } else {
      json = stored.payload;
    }
    const parsed = JSON.parse(json) as SteamSession;
    if (!parsed || typeof parsed.apiKey !== "string" || typeof parsed.steamId !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[steam] could not decrypt the stored session:", error);
    return null;
  }
}

export function saveSteamSession(session: SteamSession): void {
  const json = JSON.stringify(session);
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const document: StoredSession = {
    version: 1,
    encrypted: canEncrypt,
    payload: canEncrypt
      ? safeStorage.encryptString(json).toString("base64")
      : json,
    savedAt: new Date().toISOString(),
  };
  const file = sessionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(document, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function clearSteamSession(): void {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {
    /* already gone */
  }
}

/** `steam_connect`: validate the pair against GetPlayerSummaries. */
export async function connectSteam(
  apiKey: string,
  steamId: string,
): Promise<SteamSession> {
  const key = apiKey.trim();
  const id = steamId.trim();
  if (!/^\d{17}$/.test(id)) {
    throw new Error(
      `Invalid Steam ID "${id}" — it must be the 17-digit SteamID64 shown on your Steam profile.`,
    );
  }
  if (!key) throw new Error("A Steam Web API key is required.");
  if (!/^[0-9A-Fa-f]{32}$/.test(key)) {
    throw new Error(
      "Invalid Steam Web API key format — it is a 32-character hexadecimal string from https://steamcommunity.com/dev/apikey.",
    );
  }

  let displayName: string | undefined;
  try {
    const players = await fetchPlayerSummaries(key, [id]);
    displayName = players[0]?.personaname;
  } catch (error) {
    throw new Error(
      `Steam rejected the API key or Steam ID — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const session: SteamSession = { steamId: id, apiKey: key, displayName };
  saveSteamSession(session);
  return session;
}

export interface SteamSyncedGame {
  appid: number;
  name: string;
  playtimeForever: number;
  exePath?: string;
  sizeBytes?: number;
  sizeRootPath?: string;
  rtimeLastPlayed?: number;
  familySharedBy?: string;
}

export interface SteamSyncResult {
  success: boolean;
  gamesSynced: number;
  playtimeUpdated: number;
  achievementsSynced: number;
  syncedGames: SteamSyncedGame[];
  installedAppids: number[];
  manifestAppids: number[];
  error?: string;
}

/**
 * `steam_sync_games`. Achievements live in the achievements workstream, so the
 * flag is accepted and reported as zero rather than silently failing.
 */
export async function syncSteamGames(options: {
  session?: SteamSession | null;
  includePlaytime: boolean;
  includeAchievements: boolean;
  includeFamilySharing: boolean;
}): Promise<SteamSyncResult> {
  const session = options.session ?? loadSteamSession();
  if (!session) {
    throw new Error(
      "Steam is not connected — add your Steam Web API key and SteamID64 in Settings → Integrations first.",
    );
  }
  const apiKey = session.apiKey || fallbackSteamApiKey();
  if (!apiKey) {
    throw new Error(
      "No Steam Web API key is available — enter one in Settings or set STEAM_API_KEY in the environment.",
    );
  }

  const owned = await fetchOwnedGames(apiKey, session.steamId);
  const scan = await steamInstallScanRaw();

  const installedAppids = [...scan.installedAppids].sort((a, b) => a - b);
  const manifestAppids = [...scan.manifestAppids].sort((a, b) => a - b);
  const installedSet = new Set(installedAppids);

  // Disk work (exe + size) is bounded, the same way the Rust fan-out is.
  const synced: SteamSyncedGame[] = [];
  let cursor = 0;
  const ownedEntries = owned.slice();
  const results = new Array<SteamSyncedGame>(ownedEntries.length);

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= ownedEntries.length) return;
      const game = ownedEntries[index];
      const entry: SteamSyncedGame = {
        appid: game.appid,
        name: game.name,
        playtimeForever: options.includePlaytime ? (game.playtime_forever ?? 0) : 0,
      };
      if (game.rtime_last_played && game.rtime_last_played > 0) {
        entry.rtimeLastPlayed = game.rtime_last_played;
      }
      if (installedSet.has(game.appid)) {
        const manifest = scan.manifests.get(game.appid);
        if (manifest) {
          const installedPath = path.join(
            manifest.libraryRoot,
            "steamapps",
            "common",
            manifest.installDir,
          );
          const exe = await resolveExecutable(installedPath, game.name);
          if (exe) entry.exePath = exe;
          const size = scan.sizes.get(game.appid);
          if (size !== undefined) {
            entry.sizeBytes = size;
            entry.sizeRootPath = installedPath;
          }
          if (manifest.lastOwner && manifest.lastOwner !== "0" && manifest.lastOwner !== session.steamId) {
            entry.familySharedBy = manifest.lastOwner;
          }
        }
      }
      results[index] = entry;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(6, Math.max(1, ownedEntries.length)) }, () => worker()),
  );
  for (const entry of results) if (entry) synced.push(entry);

  const playtimeUpdated = options.includePlaytime
    ? synced.filter((entry) => entry.playtimeForever > 0).length
    : 0;

  return {
    success: true,
    gamesSynced: synced.length,
    playtimeUpdated,
    achievementsSynced: 0,
    syncedGames: synced,
    installedAppids,
    manifestAppids,
  };
}
