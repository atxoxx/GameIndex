import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Game } from "../types/game";
import type { Mo2Instance, Mo2Mod, Mo2Plugin, Mo2ProfileDetails } from "../types/mo2";
import { gameDisplayName } from "../types/game";
import { getGameMo2Config, saveGameMo2Config } from "../utils/mo2Storage";

export function useMo2(game: Game | null) {
  const [instances, setInstances] = useState<Mo2Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Mo2Instance | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [details, setDetails] = useState<Mo2ProfileDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameIdRef = useRef<string | null>(null);
  gameIdRef.current = game?.id ?? null;

  // 1. Detect instances when game changes
  const refreshInstances = useCallback(async () => {
    if (!game) {
      setInstances([]);
      setSelectedInstance(null);
      setSelectedProfile(null);
      setDetails(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const list = await invoke<Mo2Instance[]>("mo2_detect_instances", {
        gamePath: game.path ?? "",
        gameName: gameDisplayName(game),
      });

      if (gameIdRef.current === game.id) {
        setInstances(list);
        if (list.length > 0) {
          setSelectedInstance((prev) => {
            if (prev) {
              const matched = list.find((i) => i.instancePath.toLowerCase() === prev.instancePath.toLowerCase());
              if (matched) return matched;
            }
            return list[0];
          });
          const savedCfg = getGameMo2Config(game.id);
          setSelectedProfile((prev) => {
            if (prev && list.some((i) => i.profiles.some((p) => p.toLowerCase() === prev.toLowerCase()))) {
              return prev;
            }
            return (
              game.mo2Profile ||
              savedCfg?.profile ||
              list[0].selectedProfile ||
              list[0].profiles[0] ||
              "Default"
            );
          });
        } else {
          setSelectedInstance(null);
          setSelectedProfile(null);
          setDetails(null);
        }
      }
    } catch (e) {
      if (gameIdRef.current === game.id) {
        setError(String(e));
      }
    } finally {
      if (gameIdRef.current === game.id) {
        setLoading(false);
      }
    }
  }, [game]);

  useEffect(() => {
    void refreshInstances();
  }, [refreshInstances]);

  // 2. Fetch profile details when instance or profile changes
  const refreshDetails = useCallback(async () => {
    if (!selectedInstance || !selectedProfile) {
      setDetails(null);
      return;
    }

    setLoading(true);
    try {
      const d = await invoke<Mo2ProfileDetails>("mo2_get_profile_details", {
        instancePath: selectedInstance.instancePath,
        profileName: selectedProfile,
      });
      setDetails(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedInstance, selectedProfile]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  // 3. Toggle mod enabled/disabled
  const setModEnabled = useCallback(
    async (modName: string, enabled: boolean) => {
      if (!selectedInstance || !selectedProfile) return;

      // Optimistic update
      setDetails((prev) => {
        if (!prev) return null;
        const nextMods = prev.mods.map((m) =>
          m.name === modName ? { ...m, enabled } : m
        );
        const activeCount = nextMods.filter((m) => m.enabled && !m.isSeparator).length;
        return {
          ...prev,
          mods: nextMods,
          activeModCount: activeCount,
        };
      });

      try {
        await invoke("mo2_set_mod_enabled", {
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          modName,
          enabled,
        });
      } catch (e) {
        // Rollback
        void refreshDetails();
        throw e;
      }
    },
    [selectedInstance, selectedProfile, refreshDetails]
  );

  // Batch toggle multiple mods
  const setModsEnabled = useCallback(
    async (updates: Record<string, boolean>) => {
      if (!selectedInstance || !selectedProfile || Object.keys(updates).length === 0) return;

      // Optimistic update
      setDetails((prev) => {
        if (!prev) return null;
        const nextMods = prev.mods.map((m) => {
          if (m.name in updates) {
            return { ...m, enabled: updates[m.name] };
          }
          return m;
        });
        const activeCount = nextMods.filter((m) => m.enabled && !m.isSeparator).length;
        return {
          ...prev,
          mods: nextMods,
          activeModCount: activeCount,
        };
      });

      try {
        await invoke("mo2_set_mods_enabled", {
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          updates,
        });
      } catch (e) {
        void refreshDetails();
        throw e;
      }
    },
    [selectedInstance, selectedProfile, refreshDetails]
  );

  // 4. Reorder mods (priority)
  const reorderMods = useCallback(
    async (orderedModNames: string[]) => {
      if (!selectedInstance || !selectedProfile) return;

      // Optimistic reorder
      setDetails((prev) => {
        if (!prev) return null;
        const modMap = new Map(prev.mods.map((m) => [m.name, m]));
        const nextMods: Mo2Mod[] = [];
        orderedModNames.forEach((name, idx) => {
          const item = modMap.get(name);
          if (item) {
            nextMods.push({ ...item, priority: idx });
          }
        });
        return {
          ...prev,
          mods: nextMods,
        };
      });

      try {
        await invoke("mo2_reorder_mods", {
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          orderedModNames,
        });
      } catch (e) {
        void refreshDetails();
        throw e;
      }
    },
    [selectedInstance, selectedProfile, refreshDetails]
  );

  // 5. Toggle plugin enabled/disabled
  const setPluginEnabled = useCallback(
    async (pluginName: string, enabled: boolean) => {
      if (!selectedInstance || !selectedProfile) return;

      setDetails((prev) => {
        if (!prev) return null;
        const nextPlugins = prev.plugins.map((p) =>
          p.name === pluginName ? { ...p, enabled } : p
        );
        const activeCount = nextPlugins.filter((p) => p.enabled).length;
        return {
          ...prev,
          plugins: nextPlugins,
          activePluginCount: activeCount,
        };
      });

      try {
        await invoke("mo2_set_plugin_enabled", {
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          pluginName,
          enabled,
        });
      } catch (e) {
        void refreshDetails();
        throw e;
      }
    },
    [selectedInstance, selectedProfile, refreshDetails]
  );

  // 6. Reorder plugins
  const reorderPlugins = useCallback(
    async (orderedPluginNames: string[]) => {
      if (!selectedInstance || !selectedProfile) return;

      setDetails((prev) => {
        if (!prev) return null;
        const pMap = new Map(prev.plugins.map((p) => [p.name, p]));
        const nextPlugins: Mo2Plugin[] = [];
        orderedPluginNames.forEach((name, idx) => {
          const item = pMap.get(name);
          if (item) {
            nextPlugins.push({ ...item, priority: idx });
          }
        });
        return {
          ...prev,
          plugins: nextPlugins,
        };
      });

      try {
        await invoke("mo2_reorder_plugins", {
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          orderedPluginNames,
        });
      } catch (e) {
        void refreshDetails();
        throw e;
      }
    },
    [selectedInstance, selectedProfile, refreshDetails]
  );

  // 7. Switch active profile
  const switchProfile = useCallback(
    async (profileName: string) => {
      if (!selectedInstance) return;
      setSelectedProfile(profileName);
      if (game) {
        const prevCfg = getGameMo2Config(game.id);
        saveGameMo2Config(game.id, {
          enabled: prevCfg?.enabled ?? (game.mo2LaunchEnabled ?? false),
          profile: profileName,
          executable: prevCfg?.executable ?? (game.mo2Executable ?? ""),
          instancePath: selectedInstance.instancePath,
        });
      }
      try {
        await invoke("mo2_switch_profile", {
          instancePath: selectedInstance.instancePath,
          profileName,
        });
      } catch {
        // Non-blocking
      }
    },
    [selectedInstance, game]
  );

  // 8. Create a new profile
  const createProfile = useCallback(
    async (profileName: string, cloneFrom?: string) => {
      if (!selectedInstance) return;
      await invoke("mo2_create_profile", {
        instancePath: selectedInstance.instancePath,
        profileName,
        cloneFrom: cloneFrom || null,
      });
      await refreshInstances();
      await switchProfile(profileName);
    },
    [selectedInstance, refreshInstances, switchProfile]
  );

  // 9. Delete a profile
  const deleteProfile = useCallback(
    async (profileName: string) => {
      if (!selectedInstance) return;
      await invoke("mo2_delete_profile", {
        instancePath: selectedInstance.instancePath,
        profileName,
      });
      await refreshInstances();
    },
    [selectedInstance, refreshInstances]
  );

  // 10. Launch via MO2
  const launchViaMo2 = useCallback(
    async (executableTitleOrPath: string) => {
      if (!game || !selectedInstance || !selectedProfile) return;
      setLaunching(true);
      try {
        const msg = await invoke<string>("mo2_launch_game", {
          gameId: game.id,
          gameName: gameDisplayName(game),
          instancePath: selectedInstance.instancePath,
          profileName: selectedProfile,
          executable: executableTitleOrPath,
        });
        return msg;
      } finally {
        setLaunching(false);
      }
    },
    [game, selectedInstance, selectedProfile]
  );

  // 11. Manually select an MO2 folder
  const browseForMo2 = useCallback(async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Mod Organizer 2 Folder",
      });
      if (typeof selected === "string" && selected) {
        const list = await invoke<Mo2Instance[]>("mo2_detect_instances", {
          gamePath: selected,
          gameName: game ? gameDisplayName(game) : "",
        });
        if (list.length > 0) {
          setInstances((prev) => {
            const seen = new Set(prev.map((i) => i.instancePath.toLowerCase()));
            const toAdd = list.filter((i) => !seen.has(i.instancePath.toLowerCase()));
            return [...prev, ...toAdd];
          });
          const picked = list[0];
          setSelectedInstance(picked);
          setSelectedProfile(picked.selectedProfile || picked.profiles[0] || "Default");
        }
      }
    } catch {
      // dialog cancelled
    }
  }, [game]);

  return {
    instances,
    selectedInstance,
    setSelectedInstance,
    selectedProfile,
    setSelectedProfile,
    details,
    loading,
    launching,
    error,
    refreshInstances,
    refreshDetails,
    setModEnabled,
    setModsEnabled,
    reorderMods,
    setPluginEnabled,
    reorderPlugins,
    switchProfile,
    createProfile,
    deleteProfile,
    launchViaMo2,
    browseForMo2,
  };
}
