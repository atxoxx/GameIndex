import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import type { HumbleAuthState, HumbleSettings, HumbleSyncResult } from "../../types/humble";

/**
 * useHumbleIntegration — owns every piece of Humble Bundle state on the
 * Settings page: the cookie-auth probe, the WebView connect, the sync /
 * disconnect handlers, the Playnite-parity import toggles, and the
 * sync-to-library import pipeline.
 */
export function useHumbleIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { t } = useLanguage();

  const [humbleAuth, setHumbleAuth] = useState<HumbleAuthState>({ isAuthenticated: false });
  const [humbleSyncResult, setHumbleSyncResult] = useState<HumbleSyncResult | null>(null);
  const [humbleSettings, setHumbleSettings] = useState<HumbleSettings>({
    connectAccount: false,
    ignoreThirdPartyStoreGames: true,
    importThirdPartyDrmFree: false,
    importGeneralLibrary: true,
    importGameExtras: false,
    importTroveGames: false,
    launchViaHumbleApp: true,
  });
  const [isHumbleLoggingIn, setIsHumbleLoggingIn] = useState(false);
  const [isHumbleSyncing, setIsHumbleSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authenticated: boolean = await invoke("humble_is_authenticated");
        if (cancelled) return;
        setHumbleAuth({ isAuthenticated: authenticated });
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-humble-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setHumbleAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
      await loadHumbleSettings();
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadHumbleSettings() {
    try {
      const s = await invoke<HumbleSettings>("humble_get_settings");
      if (s) setHumbleSettings(s);
    } catch (e) {
      console.error("Failed to load Humble settings:", e);
    }
  }

  async function handleHumbleLogin() {
    setIsHumbleLoggingIn(true);
    try {
      showToast(t("settings.humbleLoginHint"), "info");
      const session = await invoke<{ username: string }>("humble_start_login");
      setHumbleAuth({ isAuthenticated: true, username: session.username });
      await loadHumbleSettings();
      localStorage.setItem(
        "gamelib-humble-sync-info",
        JSON.stringify({ username: session.username })
      );
      showToast(
        t("settings.humbleConnected", { display: session.username ? ` as ${session.username}` : "" }),
        "success"
      );
      await handleHumbleSync();
    } catch (err) {
      showToast(t("settings.humbleConnectFailed", { error: err }), "error");
    } finally {
      setIsHumbleLoggingIn(false);
    }
  }

  async function handleHumbleSync() {
    setIsHumbleSyncing(true);
    setHumbleSyncResult(null);
    try {
      const result: HumbleSyncResult = await invoke("humble_sync_library");
      setHumbleSyncResult(result);
      if (result.success) {
        const existingHumbleIds = new Set(
          games.filter((gm) => gm.humbleGameId).map((gm) => gm.humbleGameId)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingHumbleIds.has(entry.humbleGameId)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Humble",
            installed: entry.isInstalled,
            playTime: "0h",
            addedAt: Date.now(),
            humbleGameId: entry.humbleGameId,
            humbleIsTrove: entry.isTrove,
            humbleIsExtra: entry.isExtra,
            coverArtUrl: entry.coverUrl,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }

        for (const entry of result.syncedGames ?? []) {
          if (!existingHumbleIds.has(entry.humbleGameId)) continue;
          const game = games.find((g) => g.humbleGameId === entry.humbleGameId);
          if (game && entry.isInstalled && game.installed !== entry.isInstalled) {
            updateGame(game.id, {
              installed: true,
              path: entry.installPath ?? game.path,
            });
          }
        }

        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            t("settings.humbleSyncedNew", { games: result.gamesImported, new: newGames.length }),
            "success"
          );
        } else {
          showToast(
            t("settings.humbleSyncedAll", { games: result.gamesImported }),
            "success"
          );
        }

        setHumbleAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        // Merge `lastSync` into the existing entry instead of rewriting it:
        // right after a login the `humbleAuth` closure is still the pre-login
        // value, so a full overwrite would clobber the username the login
        // handler just persisted.
        try {
          const info = JSON.parse(
            localStorage.getItem("gamelib-humble-sync-info") || "{}"
          );
          localStorage.setItem(
            "gamelib-humble-sync-info",
            JSON.stringify({ ...info, lastSync: result.lastSync })
          );
        } catch { /* malformed entry — ignore */ }
      }
    } catch (err) {
      setHumbleSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(t("settings.humbleSyncFailed", { error: err }), "error");
    } finally {
      setIsHumbleSyncing(false);
    }
  }

  async function disconnectHumble() {
    try {
      await invoke("humble_logout");
      setHumbleAuth({ isAuthenticated: false });
      setHumbleSyncResult(null);
      localStorage.removeItem("gamelib-humble-sync-info");
      showToast(t("settings.humbleDisconnected"), "info");
    } catch (err) {
      showToast(t("settings.failed", { error: err }), "error");
    }
  }

  async function updateHumbleSetting<K extends keyof HumbleSettings>(
    key: K,
    value: HumbleSettings[K]
  ) {
    const next = { ...humbleSettings, [key]: value };
    setHumbleSettings(next);
    try {
      await invoke("humble_save_settings", { settings: next });
    } catch (err) {
      showToast(t("settings.humbleSaveFailed", { error: err }), "error");
    }
  }

  return {
    humbleAuth,
    humbleSyncResult,
    humbleSettings,
    isHumbleLoggingIn,
    isHumbleSyncing,
    handleHumbleLogin,
    handleHumbleSync,
    disconnectHumble,
    updateHumbleSetting,
  };
}
