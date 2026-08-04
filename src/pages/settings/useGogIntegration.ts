import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, type Game } from "../../types/game";
import type { GogAuthState, GogSyncResult } from "../../types/gog";

/**
 * useGogIntegration — owns every piece of GOG Galaxy state on the
 * Settings page: the auth probe, the single-phase WebView connect,
 * the sync / disconnect handlers, and the sync-to-library import
 * pipeline.
 */
export function useGogIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { t } = useLanguage();

  const [gogAuth, setGogAuth] = useState<GogAuthState>({ isAuthenticated: false });
  const [gogSyncResult, setGogSyncResult] = useState<GogSyncResult | null>(null);
  const [isGogLoggingIn, setIsGogLoggingIn] = useState(false);
  const [isGogSyncing, setIsGogSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authenticated: boolean = await invoke("gog_is_authenticated");
        if (cancelled) return;
        setGogAuth({ isAuthenticated: authenticated });
        if (authenticated) {
          const saved = localStorage.getItem("gamelib-gog-sync-info");
          if (saved) {
            try {
              const info = JSON.parse(saved);
              setGogAuth((prev) => ({ ...prev, ...info }));
            } catch { /* ignore */ }
          }
        }
      } catch { /* not authenticated */ }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGogLogin() {
    setIsGogLoggingIn(true);
    try {
      showToast(t("settings.gogLoginHint"), "info");
      const session = await invoke<{ userId: string; username: string }>(
        "gog_start_login"
      );
      setGogAuth({
        isAuthenticated: true,
        userId: session.userId,
        username: session.username,
      });
      localStorage.setItem(
        "gamelib-gog-sync-info",
        JSON.stringify(session)
      );
      showToast(
        t("settings.gogConnected", { display: session.username ? ` as ${session.username}` : "" }),
        "success"
      );
      await handleGogSync();
    } catch (err) {
      showToast(t("settings.gogConnectFailed", { error: err }), "error");
    } finally {
      setIsGogLoggingIn(false);
    }
  }

  async function handleGogSync() {
    setIsGogSyncing(true);
    setGogSyncResult(null);
    try {
      const result: GogSyncResult = await invoke("gog_sync_library");
      setGogSyncResult(result);
      if (result.success) {
        const existingGogIds = new Set(
          games.filter((gm) => gm.gogGameId).map((gm) => gm.gogGameId)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingGogIds.has(entry.gogGameId)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "GOG",
            installed: entry.isInstalled,
            playTime: formatPlayTime(entry.playtimeMinutes ?? 0),
            addedAt: Date.now(),
            gogGameId: entry.gogGameId,
            gogPlaytime: entry.playtimeMinutes,
            coverArtUrl: entry.coverUrl,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
            lastPlayed: entry.lastPlayed ? entry.lastPlayed * 1000 : undefined,
          });
        }

        for (const entry of result.syncedGames ?? []) {
          if (!existingGogIds.has(entry.gogGameId)) continue;
          const game = games.find((g) => g.gogGameId === entry.gogGameId);
          if (!game) continue;
          const patch: Partial<Game> = {};
          if (game.installed !== entry.isInstalled) patch.installed = entry.isInstalled;
          if (entry.installPath && entry.installPath !== game.path) patch.path = entry.installPath;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          const syncedLastPlayed = entry.lastPlayed
            ? entry.lastPlayed * 1000
            : undefined;
          if (
            syncedLastPlayed &&
            (!game.lastPlayed || syncedLastPlayed > game.lastPlayed)
          ) {
            patch.lastPlayed = syncedLastPlayed;
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }

        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            t("settings.gogSyncedNew", { games: result.gamesImported, new: newGames.length }),
            "success"
          );
        } else {
          showToast(
            t("settings.gogSyncedAll", { games: result.gamesImported }),
            "success"
          );
        }

        setGogAuth((prev) => ({ ...prev, lastSync: result.lastSync }));
        // Merge `lastSync` into the existing entry instead of rewriting it:
        // right after a login the `gogAuth` closure is still the pre-login
        // value, so a full overwrite would clobber the account metadata the
        // login handler just persisted.
        try {
          const info = JSON.parse(
            localStorage.getItem("gamelib-gog-sync-info") || "{}"
          );
          localStorage.setItem(
            "gamelib-gog-sync-info",
            JSON.stringify({ ...info, lastSync: result.lastSync })
          );
        } catch { /* malformed entry — ignore */ }
      }
    } catch (err) {
      setGogSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        syncedGames: [],
      });
      showToast(t("settings.gogSyncFailed", { error: err }), "error");
    } finally {
      setIsGogSyncing(false);
    }
  }

  async function disconnectGog() {
    try {
      await invoke("gog_logout");
      setGogAuth({ isAuthenticated: false });
      setGogSyncResult(null);
      localStorage.removeItem("gamelib-gog-sync-info");
      showToast(t("settings.gogDisconnected"), "info");
    } catch (err) {
      showToast(t("settings.failed", { error: err }), "error");
    }
  }

  return {
    gogAuth,
    gogSyncResult,
    isGogLoggingIn,
    isGogSyncing,
    handleGogLogin,
    handleGogSync,
    disconnectGog,
  };
}
