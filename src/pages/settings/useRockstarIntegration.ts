import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useToast } from "../../context/ToastContext";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import type { RockstarSyncResult } from "../../types/rockstar";

/**
 * useRockstarIntegration — Rockstar Games Launcher is a pure
 * installed-games scan (no account/auth), so the only state here is
 * the last scan result + the in-flight flag.
 */
export function useRockstarIntegration() {
  const { showToast } = useToast();
  const { games, addGames, updateGame } = useGames();
  const { t } = useLanguage();

  const [rockstarSyncResult, setRockstarSyncResult] = useState<RockstarSyncResult | null>(null);
  const [isRockstarSyncing, setIsRockstarSyncing] = useState(false);

  async function handleRockstarSync() {
    setIsRockstarSyncing(true);
    setRockstarSyncResult(null);
    try {
      const result: RockstarSyncResult = await invoke("rockstar_sync_library");
      setRockstarSyncResult(result);
      if (result.success) {
        const existingRockstarIds = new Set(
          games.filter((gm) => gm.rockstarTitleId).map((gm) => gm.id)
        );
        const newGames: Game[] = [];
        for (const entry of result.syncedGames ?? []) {
          if (existingRockstarIds.has(entry.id)) continue;
          newGames.push({
            id: entry.id,
            name: entry.title,
            path: entry.installPath ?? "",
            platform: "Rockstar",
            installed: entry.isInstalled,
            playTime: "0h 0m",
            addedAt: Date.now(),
            rockstarTitleId: entry.titleId,
            iconUrl: entry.iconPath,
            sizeBytes: entry.sizeBytes,
            sizeRootPath: entry.sizeRootPath,
            sizeDetectedAt:
              entry.sizeBytes !== undefined ? new Date().toISOString() : undefined,
          });
        }
        if (newGames.length > 0) {
          addGames(newGames);
          showToast(
            t("settings.rockstarScannedNew", { games: result.gamesImported, new: newGames.length }),
            "success"
          );
        } else {
          showToast(
            t("settings.rockstarScannedAll", { games: result.gamesImported }),
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
      setRockstarSyncResult({
        success: false,
        gamesImported: 0,
        gamesSkipped: 0,
        errors: [String(err)],
        lastSync: 0,
        clientInstalled: false,
        clientPath: "",
        syncedGames: [],
      });
      showToast(t("settings.rockstarScanFailed", { error: err }), "error");
    } finally {
      setIsRockstarSyncing(false);
    }
  }

  return { rockstarSyncResult, isRockstarSyncing, handleRockstarSync };
}
