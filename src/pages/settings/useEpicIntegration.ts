import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game } from "../../types/game";
import type { EpicAuthState, EpicSyncResult } from "../../types/epic";

/**
 * useEpicIntegration — owns every piece of Epic state on the Settings
 * page: the auth probe, the OAuth connect / sync / disconnect handlers,
 * the one-click keychain-recovery banner state, and the sync-to-library
 * import pipeline.
 */
export function useEpicIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { t } = useLanguage();

  const [epicAuth, setEpicAuth] = useState<EpicAuthState>({ isAuthenticated: false });
  const [epicSyncResult, setEpicSyncResult] = useState<EpicSyncResult | null>(null);
  const [isEpicLoggingIn, setIsEpicLoggingIn] = useState(false);
  const [isEpicSyncing, setIsEpicSyncing] = useState(false);
  // Tracks a "previous session is unreachable" state where the OS keychain
  // entry was wiped externally but localStorage still holds a legacy
  // refresh token. Surfaced as a one-click recovery banner.
  const [epicStaleSession, setEpicStaleSession] = useState<{
    refreshToken: string;
    accountId: string;
    displayName?: string;
  } | null>(null);
  const [isEpicRecovering, setIsEpicRecovering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authenticated: boolean = await invoke("epic_is_authenticated");
        if (cancelled) return;
        setEpicAuth({ isAuthenticated: authenticated });
        if (!authenticated) {
          const savedRaw = localStorage.getItem("gamelib-epic-sync-info");
          if (savedRaw) {
            try {
              const info = JSON.parse(savedRaw);
              if (info?.refreshToken && info?.accountId) {
                setEpicStaleSession({
                  refreshToken: info.refreshToken,
                  accountId: info.accountId,
                  displayName: info.displayName,
                });
                return;
              }
            } catch { /* malformed legacy entry — ignore */ }
          }
        }
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-epic-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setEpicAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEpicLogin() {
    setIsEpicLoggingIn(true);
    try {
      showToast(t("settings.epicLoginHint"), "info");
      const authCode: string = await invoke("epic_start_login");

      const tokens = await invoke<{ accountId: string; displayName?: string }>("epic_finish_login", { authCode });
      setEpicAuth({
        isAuthenticated: true,
        accountId: tokens.accountId,
        displayName: tokens.displayName,
      });
      // Persist ONLY the metadata-only shape. The full OAuth tokens
      // belong in the OS keychain, which epic_finish_login wrote via
      // save_tokens. localStorage is js-readable, never store bearer
      // tokens there.
      localStorage.setItem(
        "gamelib-epic-sync-info",
        JSON.stringify({
          accountId: tokens.accountId,
          displayName: tokens.displayName,
          lastSync: Date.now(),
        })
      );
      showToast(t("settings.epicConnected", { display: tokens.displayName ? ` as ${tokens.displayName}` : "" }), "success");
      await handleEpicSync();
    } catch (err) {
      showToast(t("settings.epicConnectFailed", { error: err }), "error");
    } finally {
      setIsEpicLoggingIn(false);
    }
  }

  async function handleEpicSync() {
    setIsEpicSyncing(true);
    setEpicSyncResult(null);
    try {
      const result: EpicSyncResult = await invoke("epic_sync_library");
      setEpicSyncResult(result);
      if (result.success) {
        // Push the freshly-synced ownership list into the backend
        // `StoreChecker` (namespace:catalogItemId composite ids) so
        // DownloadModal's "you own this" pills have real data.
        const ownedIds = (result.syncedGames ?? []).map(
          (g) => `${g.namespace}:${g.catalogItemId}`
        );
        invoke("set_epic_owned", { ids: ownedIds }).catch(() => undefined);
        const existingEpicIds = new Set(
          games
            .filter((gm) => gm.epicNamespace && gm.epicCatalogItemId)
            .map((gm) => `${gm.epicNamespace}-${gm.epicCatalogItemId}`)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingEpicIds.has(`${entry.namespace}-${entry.catalogItemId}`)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Epic",
            installed: entry.isInstalled,
            playTime: formatPlayTime(entry.playtimeMinutes ?? 0),
            addedAt: Date.now(),
            epicNamespace: entry.namespace,
            epicCatalogItemId: entry.catalogItemId,
            coverArtUrl: entry.coverUrl,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt: entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            lastPlayed: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(t("settings.epicSyncedNew", { games: result.gamesImported, new: newGames.length }), "success");
        } else {
          showToast(t("settings.epicSyncedAll", { imported: result.gamesImported }), "success");
        }

        for (const entry of result.syncedGames ?? []) {
          const existingId = `${entry.namespace}-${entry.catalogItemId}`;
          if (!existingEpicIds.has(existingId)) continue;
          const game = games.find(
            (g) => g.epicNamespace === entry.namespace && g.epicCatalogItemId === entry.catalogItemId
          );
          if (!game) continue;
          const patch: Partial<Game> = {};
          if (game.installed !== entry.isInstalled) patch.installed = entry.isInstalled;
          if (entry.installPath && entry.installPath !== game.path) patch.path = entry.installPath;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          const syncedLastPlayed = entry.lastPlayed ? entry.lastPlayed * 1000 : undefined;
          if (syncedLastPlayed && (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)) {
            patch.lastPlayed = syncedLastPlayed;
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }

        setEpicAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        // Merge `lastSync` into the existing entry instead of rewriting it:
        // right after a login the `epicAuth` closure is still the pre-login
        // value, so a full overwrite would clobber the account metadata the
        // login handler just persisted.
        try {
          const info = JSON.parse(
            localStorage.getItem("gamelib-epic-sync-info") || "{}"
          );
          localStorage.setItem(
            "gamelib-epic-sync-info",
            JSON.stringify({ ...info, lastSync: result.lastSync })
          );
        } catch { /* malformed entry — ignore */ }
      }
    } catch (err) {
      setEpicSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(t("settings.epicSyncFailed", { error: err }), "error");
    } finally {
      setIsEpicSyncing(false);
    }
  }

  async function disconnectEpic() {
    try {
      await invoke("epic_logout");
      // Clear the backend ownership set so stale Epic titles stop
      // counting as owned after the account is disconnected.
      invoke("set_epic_owned", { ids: [] }).catch(() => undefined);
      setEpicAuth({ isAuthenticated: false });
      setEpicSyncResult(null);
      localStorage.removeItem("gamelib-epic-sync-info");
      showToast(t("settings.epicDisconnected"), "info");
      setEpicStaleSession(null);
    } catch (err) {
      showToast(t("settings.failed", { error: err }), "error");
    }
  }

  // One-click recovery from a wiped keychain entry. The Rust side
  // epic_login_with_refresh_token re-exchanges the localStorage
  // refresh_token for fresh tokens.
  async function handleEpicRecover() {
    const stale = epicStaleSession;
    if (!stale) return;
    setIsEpicRecovering(true);
    try {
      const fresh = await invoke<{ accountId: string; displayName?: string }>(
        "epic_login_with_refresh_token",
        {
          refreshToken: stale.refreshToken,
          accountId: stale.accountId,
          displayName: stale.displayName,
        }
      );
      setEpicAuth({
        isAuthenticated: true,
        accountId: fresh.accountId,
        displayName: fresh.displayName,
      });
      localStorage.setItem(
        "gamelib-epic-sync-info",
        JSON.stringify({
          accountId: fresh.accountId,
          displayName: fresh.displayName,
          lastSync: Date.now(),
        })
      );
      setEpicStaleSession(null);
      showToast(
        t("settings.epicRecovered", { display: fresh.displayName ? ` as ${fresh.displayName}` : "" }),
        "success"
      );
      await handleEpicSync();
    } catch (err) {
      showToast(t("settings.gogRecoveryFailed", { error: err }), "error");
      setEpicStaleSession(null);
      try {
        const raw = localStorage.getItem("gamelib-epic-sync-info");
        if (raw) {
          const info = JSON.parse(raw);
          if (info?.refreshToken) {
            localStorage.setItem(
              "gamelib-epic-sync-info",
              JSON.stringify({
                accountId: info.accountId,
                displayName: info.displayName,
              })
            );
          }
        }
      } catch { /* ignore */ }
    } finally {
      setIsEpicRecovering(false);
    }
  }

  return {
    epicAuth,
    epicSyncResult,
    isEpicLoggingIn,
    isEpicSyncing,
    epicStaleSession,
    isEpicRecovering,
    handleEpicLogin,
    handleEpicSync,
    disconnectEpic,
    handleEpicRecover,
  };
}
