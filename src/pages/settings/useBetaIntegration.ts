import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game } from "../../types/game";
import type {
  BetaAuthState,
  BetaSettings,
  BetaSyncedGame,
  BetaSyncResult,
  BetaStoreKey,
} from "../../types/betaStores";

/** IPC command name for a beta store: `<key>_<command>`. */
export function betaCommand(key: BetaStoreKey, command: string): string {
  return `${key}_${command}`;
}

const DEFAULT_SETTINGS: BetaSettings = {
  connectAccount: true,
  importInstalledGames: true,
  importUninstalledGames: true,
};

const SYNC_INFO_PREFIX = "gamelib-beta-sync-info-";

/**
 * Map a sync result's entries into library `Game` objects. Pure so it can
 * be unit-tested without rendering the hook. Entries without an id are
 * dropped defensively.
 */
export function toLibGames(
  entries: BetaSyncedGame[] | undefined,
  platform: string
): Game[] {
  return (entries ?? [])
    .filter((entry) => Boolean(entry?.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.title,
      path: entry.installPath ?? "",
      platform,
      installed: entry.isInstalled,
      playTime: formatPlayTime(entry.playtimeMinutes ?? 0),
      addedAt: Date.now(),
      coverArtUrl: entry.coverUrl,
      lastPlayed: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined,
    }));
}

/**
 * useBetaIntegration — generic state + handlers for one beta store.
 *
 * All four beta stores expose the same IPC surface, so a single hook is
 * parameterized by the store key. `platform` is the library platform
 * string games are tagged with (also used as the `{store}` label in the
 * i18n strings).
 */
export function useBetaIntegration(key: BetaStoreKey, platform: string) {
  const { showToast } = useToast();
  const { games, addGames } = useGames();
  const { t } = useLanguage();

  const [auth, setAuth] = useState<BetaAuthState>({ isAuthenticated: false });
  const [settings, setSettings] = useState<BetaSettings>(DEFAULT_SETTINGS);
  const [syncResult, setSyncResult] = useState<BetaSyncResult | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const syncInfoKey = `${SYNC_INFO_PREFIX}${key}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authenticated: boolean = await invoke(betaCommand(key, "is_authenticated"));
        if (cancelled) return;
        setAuth({ isAuthenticated: authenticated });
        if (authenticated) {
          const saved = localStorage.getItem(syncInfoKey);
          if (saved) {
            try {
              setAuth((prev) => ({ ...prev, ...JSON.parse(saved) }));
            } catch {
              /* malformed entry — ignore */
            }
          }
        }
      } catch {
        /* not authenticated */
      }
      try {
        const loaded = await invoke<BetaSettings>(betaCommand(key, "get_settings"));
        if (!cancelled && loaded) setSettings({ ...DEFAULT_SETTINGS, ...loaded });
      } catch {
        /* keep defaults */
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function handleLogin() {
    setIsLoggingIn(true);
    try {
      showToast(t("settings.beta.loginHint", { store: platform }), "info");
      const session = await invoke<{ username: string }>(betaCommand(key, "start_login"));
      setAuth({ isAuthenticated: true, username: session.username });
      localStorage.setItem(
        syncInfoKey,
        JSON.stringify({ username: session.username })
      );
      showToast(
        t("settings.beta.connected", {
          store: platform,
          display: session.username ? ` ${session.username}` : "",
        }),
        "success"
      );
      await handleSync();
    } catch (err) {
      showToast(
        t("settings.beta.connectFailed", { store: platform, error: String(err) }),
        "error"
      );
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleSync() {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const result: BetaSyncResult = await invoke(betaCommand(key, "sync_library"));
      setSyncResult(result);
      if (result.success) {
        // Dedup on the persisted game id — survives restarts, unlike the
        // in-memory store-id fields the first-party hooks rely on.
        const existingIds = new Set(games.map((g) => g.id));
        const newGames = toLibGames(result.syncedGames, platform).filter(
          (g) => !existingIds.has(g.id)
        );
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            t("settings.beta.syncedNew", {
              store: platform,
              games: result.gamesImported,
              new: newGames.length,
            }),
            "success"
          );
        } else {
          showToast(
            t("settings.beta.syncedAll", {
              store: platform,
              games: result.gamesImported,
            }),
            "success"
          );
        }
        setAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        try {
          const info = JSON.parse(localStorage.getItem(syncInfoKey) || "{}");
          localStorage.setItem(
            syncInfoKey,
            JSON.stringify({ ...info, lastSync: result.lastSync })
          );
        } catch {
          /* malformed entry — ignore */
        }
      }
    } catch (err) {
      setSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(
        t("settings.beta.syncFailed", { store: platform, error: String(err) }),
        "error"
      );
    } finally {
      setIsSyncing(false);
    }
  }

  async function disconnect() {
    try {
      await invoke(betaCommand(key, "logout"));
      setAuth({ isAuthenticated: false });
      setSyncResult(null);
      localStorage.removeItem(syncInfoKey);
      showToast(t("settings.beta.disconnected", { store: platform }), "info");
    } catch (err) {
      showToast(t("settings.failed", { error: String(err) }), "error");
    }
  }

  async function updateSetting<K extends keyof BetaSettings>(
    settingKey: K,
    value: BetaSettings[K]
  ) {
    const next = { ...settings, [settingKey]: value };
    setSettings(next);
    try {
      await invoke(betaCommand(key, "save_settings"), { settings: next });
    } catch (err) {
      showToast(
        t("settings.beta.saveFailed", { store: platform, error: String(err) }),
        "error"
      );
    }
  }

  return {
    auth,
    settings,
    syncResult,
    isLoggingIn,
    isSyncing,
    handleLogin,
    handleSync,
    disconnect,
    updateSetting,
  };
}
