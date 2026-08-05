import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game } from "../../types/game";
import type { SteamAuthState, SteamSession, SteamSettings, SteamSyncResult } from "../../types/steam";

/**
 * useSteamIntegration — owns every piece of Steam state on the Settings
 * page: the keychain session probe, the API-key + SteamID64 paste-in
 * inputs, the connect / sync / disconnect handlers, the sync-to-library
 * import pipeline, and the one-shot auto-reconnect on mount.
 */
export function useSteamIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { reloadCache } = useAchievements();
  const { t } = useLanguage();

  // Tracks whether the initial Steam-session probe has resolved.
  // Starts false so the API-key + SteamID inputs don't flash in with
  // hydrated localStorage values on remount BEFORE the keychain probe
  // confirms they're actually still connected via Connect Steam.
  const [steamAuthReady, setSteamAuthReady] = useState(false);
  const [steamAuth, setSteamAuth] = useState<SteamAuthState>({ isAuthenticated: false });
  const [isSteamLoggingIn, setIsSteamLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SteamSyncResult | null>(null);
  const [steamSettings, setSteamSettings] = useState<SteamSettings>({
    autoSyncOnLaunch: true,
    syncPlaytime: true,
    syncAchievements: false,
  });
  // The user gets their API key from
  // https://steamcommunity.com/dev/apikey and their SteamID64 from
  // https://steamid.pro/ (both linked from the inputs in the tab).
  // Both fields are persisted to localStorage on every keystroke and
  // re-hydrated on mount, so navigating away — or a reboot — doesn't
  // wipe them. The keychain still owns the verified SteamSession blob.
  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamId, setSteamId] = useState("");

  // Hydrate the Steam API key + SteamID64 inputs from localStorage.
  useEffect(() => {
    try {
      setSteamApiKey(localStorage.getItem("gamelib-steam-apikey") || "");
      setSteamId(localStorage.getItem("gamelib-steam-steamid") || "");
    } catch (e) {
      console.error("Failed to load Steam credentials from localStorage:", e);
    }
  }, []);

  // Load persisted Steam sync-behaviour toggles.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("gamelib-steam-settings");
      if (saved) setSteamSettings(JSON.parse(saved));
    } catch { /* keep defaults */ }
  }, []);

  // Probe the keychain for an existing verified session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session: SteamSession | null = await invoke("steam_get_session");
        if (cancelled) return;
        if (session) {
          setSteamAuth({ isAuthenticated: true, session });
          const saved = localStorage.getItem("gamelib-steam-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setSteamAuth((prev) => ({ ...prev, lastSync: info.lastSync }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* no session yet */ }
      finally {
        // Reveal the form only after the probe resolves (success OR error).
        if (!cancelled) setSteamAuthReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-reconnect on mount if we have local credentials but the
  // keychain probe didn't find a verified session. Runs exactly once:
  // `steamAuthReady` only flips false→true after the initial probe.
  useEffect(() => {
    if (!steamAuthReady) return;

    if (steamAuth.isAuthenticated) return;
    if (!steamApiKey.trim() || !steamId.trim()) return;

    void handleSteamLogin({ autoSync: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steamAuthReady]);

  async function handleSteamLogin(options: { autoSync?: boolean } = {}) {
    const { autoSync = true } = options;
    if (!steamApiKey.trim() || !steamId.trim()) {
      showToast(t("settings.apiKeyRequired"), "error");
      return;
    }
    setIsSteamLoggingIn(true);
    try {
      const session: SteamSession = await invoke("steam_connect", {
        apiKey: steamApiKey.trim(),
        steamId: steamId.trim(),
      });

      setSteamAuth({ isAuthenticated: true, session });

      localStorage.setItem("gamelib-steam-sync-info", JSON.stringify({
        displayName: session.displayName,
      }));
      showToast(t("settings.steamConnected", { display: session.displayName ? ` as ${session.displayName}` : "" }), "success");

      if (autoSync) {
        void handleSyncNow(session);
      }
    } catch (err) {
      showToast(t("settings.steamConnectFailed", { error: err }), "error");
    } finally {
      setIsSteamLoggingIn(false);
    }
  }

  async function handleSyncNow(session?: SteamSession) {
    const s = session ?? steamAuth.session;
    if (!s) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result: SteamSyncResult = await invoke("steam_sync_games", {
        session: s,
        includePlaytime: steamSettings.syncPlaytime,
        includeAchievements: steamSettings.syncAchievements,
      });
      setSyncResult(result);
      if (result.success) {
        // Push the freshly-synced ownership list into the backend
        // `StoreChecker` so DownloadModal's "you own this" pills have
        // real data (the name-based fallback alone can't confirm
        // Steam ownership).
        const ownedAppIds = (result.syncedGames ?? []).map((g) => g.appid);
        invoke("set_steam_owned", { appids: ownedAppIds }).catch(() => undefined);
        const g = result.gamesSynced ?? 0;
        const p = result.playtimeUpdated ?? 0;
        const a = result.achievementsSynced ?? 0;

        // Persist synced games to the library, skipping duplicates by Steam AppID
        const existingAppIds = new Set(games.map((gm) => gm.steamAppId).filter(Boolean));
        const installedSet = new Set(result.installedAppids ?? []);
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingAppIds.has(entry.appid)) continue;
          const steamCdnCover = `https://cdn.akamai.steamstatic.com/steam/apps/${entry.appid}/library_600x900_2x.jpg`;
          const steamCdnHero  = `https://cdn.akamai.steamstatic.com/steam/apps/${entry.appid}/library_hero.jpg`;
          newGames.push({
            id: `steam-${entry.appid}`,
            name: entry.name,
            path: entry.exePath ?? "",
            platform: "Steam",
            installed: installedSet.has(entry.appid) || !!entry.exePath,
            playTime: formatPlayTime(entry.playtimeForever),
            addedAt: Date.now(),
            steamAppId: entry.appid,
            steamPlaytime: entry.playtimeForever,
            storeSource: "steam" as const,
            coverArtUrl: steamCdnCover,
            bannerUrl: steamCdnHero,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt: entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            lastPlayed: entry.rtimeLastPlayed ? entry.rtimeLastPlayed * 1000 : undefined,
          });
        }

        if (steamSettings.syncAchievements) {
          await reloadCache();
        }

        // Refresh existing Steam entries from the sync result — flip
        // `installed` / path / size when the local-install scan reports
        // a different install state.
        for (const entry of result.syncedGames ?? []) {
          if (!existingAppIds.has(entry.appid)) continue;
          const game = games.find((g) => g.steamAppId === entry.appid);
          if (!game) continue;
          const patch: Partial<Game> = {};
          const isInstalled = installedSet.has(entry.appid) || !!entry.exePath;
          if (game.installed !== isInstalled) patch.installed = isInstalled;
          if (entry.exePath && entry.exePath !== game.path) patch.path = entry.exePath;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          const syncedLastPlayed = entry.rtimeLastPlayed ? entry.rtimeLastPlayed * 1000 : undefined;
          if (syncedLastPlayed && (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)) {
            patch.lastPlayed = syncedLastPlayed;
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }

        const achMsg = steamSettings.syncAchievements ? ` · ${a} games achievements synced` : "";
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(t("settings.steamSyncedNew", { games: g, playtime: p, ach: achMsg, new: newGames.length }), "success");
        } else {
          showToast(t("settings.steamSyncedAll", { games: g, playtime: p, ach: achMsg }), "success");
        }
      }
    } catch (err) {
      setSyncResult({ success: false, gamesSynced: 0, playtimeUpdated: 0, achievementsSynced: 0, syncedGames: [], installedAppids: [], error: String(err) });
      showToast(t("settings.steamSyncFailed", { error: err }), "error");
    } finally {
      setIsSyncing(false);
    }
  }

  async function disconnectSteam() {
    try {
      await invoke("steam_logout");
      // Clear the backend ownership set so stale Steam titles stop
      // counting as owned after the account is disconnected.
      invoke("set_steam_owned", { appids: [] }).catch(() => undefined);
      setSteamAuth({ isAuthenticated: false });
      setSyncResult(null);
      localStorage.removeItem("gamelib-steam-sync-info");
      // Intentionally NOT clearing `gamelib-steam-apikey` /
      // `gamelib-steam-steamid` here: the requirement is for the
      // user's pasted input to persist, so reconnecting shouldn't
      // force them to re-paste the 32-char key and 17-digit ID.
      showToast(t("settings.steamDisconnected"), "info");
    } catch (err) {
      showToast(t("settings.failed", { error: err }), "error");
    }
  }

  return {
    steamAuthReady,
    steamAuth,
    isSteamLoggingIn,
    isSyncing,
    syncResult,
    steamSettings,
    setSteamSettings,
    steamApiKey,
    setSteamApiKey,
    steamId,
    setSteamId,
    handleSteamLogin,
    handleSyncNow,
    disconnectSteam,
  };
}
