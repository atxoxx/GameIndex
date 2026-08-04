import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import type { UplaySettings, UplaySyncResult } from "../../types/uplay";

/**
 * useUplayIntegration — Ubisoft Connect is a pure installed-games +
 * owned-library scan (no account/auth), plus a small persisted settings
 * blob for the import toggles.
 */
export function useUplayIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { t } = useLanguage();

  const [uplaySyncResult, setUplaySyncResult] = useState<UplaySyncResult | null>(null);
  const [isUplaySyncing, setIsUplaySyncing] = useState(false);
  const [uplaySettings, setUplaySettings] = useState<UplaySettings>({
    importInstalledGames: true,
    importUninstalledGames: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await invoke<UplaySettings>("uplay_get_settings");
        if (!cancelled && s) setUplaySettings(s);
      } catch (e) {
        console.error("Failed to load Uplay settings:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function updateUplaySetting<K extends keyof UplaySettings>(
    key: K,
    value: UplaySettings[K],
  ) {
    const next = { ...uplaySettings, [key]: value };
    setUplaySettings(next);
    try {
      await invoke("uplay_save_settings", { settings: next });
    } catch (err) {
      showToast(t("settings.uplaySaveFailed", { error: err }), "error");
    }
  }

  async function handleUplaySync() {
    setIsUplaySyncing(true);
    setUplaySyncResult(null);
    try {
      const result: UplaySyncResult = await invoke("uplay_sync_library");
      setUplaySyncResult(result);
      if (result.success) {
        const existingUplayIds = new Set(
          games.filter((gm) => gm.uplayGameId).map((gm) => gm.id)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingUplayIds.has(entry.id)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installDir ?? "",
            platform: "Ubisoft",
            installed: entry.isInstalled,
            playTime: "0h 0m",
            addedAt: Date.now(),
            uplayGameId: entry.uplayId,
            uplayIsConnect: true,
            coverArtUrl: entry.coverImage,
            iconUrl: entry.iconImage,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            t("settings.ubisoftScannedNew", { games: result.gamesImported, new: newGames.length }),
            "success"
          );
        } else {
          showToast(
            t("settings.ubisoftScannedAll", { games: result.gamesImported }),
            "success"
          );
        }

        for (const entry of result.syncedGames ?? []) {
          const game = games.find((g) => g.id === entry.id);
          if (!game) continue;
          const patch: Partial<Game> = {};
          if (game.installed !== entry.isInstalled) patch.installed = entry.isInstalled;
          if (entry.sizeBytes !== undefined) {
            patch.sizeBytes = entry.sizeBytes;
            patch.sizeRootPath = entry.sizeRootPath;
            patch.sizeDetectedAt = new Date().toISOString();
          }
          if (Object.keys(patch).length > 0) updateGame(game.id, patch);
        }
      }
    } catch (err) {
      setUplaySyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        clientInstalled: false,
        clientPath: "",
        syncedGames: [],
      });
      showToast(t("settings.ubisoftScanFailed", { error: err }), "error");
    } finally {
      setIsUplaySyncing(false);
    }
  }

  return {
    uplaySyncResult,
    isUplaySyncing,
    uplaySettings,
    updateUplaySetting,
    handleUplaySync,
  };
}
