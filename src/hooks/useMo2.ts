import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Game } from "../types/game";
import type { Mo2Instance, Mo2Mod, Mo2Plugin, Mo2ProfileDetails } from "../types/mo2";
import { gameDisplayName } from "../types/game";
import { getGameMo2Config } from "../utils/mo2Storage";
import {
  mergeMo2Instances,
  resolveMo2Selection,
  selectMo2Instance,
} from "../utils/mo2Selection";

export interface Mo2SelectionPayload {
  instancePath: string;
  profile: string;
  executable: string;
}

export interface UseMo2Options {
  /** Called whenever the user commits a different instance/profile so the
   *  caller can persist the choice on the game record. */
  onSelectionChange?: (sel: Mo2SelectionPayload) => void;
}

export function useMo2(game: Game | null, options: UseMo2Options = {}) {
  const [instances, setInstances] = useState<Mo2Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<Mo2Instance | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [details, setDetails] = useState<Mo2ProfileDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gameIdRef = useRef<string | null>(null);
  gameIdRef.current = game?.id ?? null;

  const onSelectionChangeRef = useRef(options.onSelectionChange);
  onSelectionChangeRef.current = options.onSelectionChange;

  const notifySelection = useCallback((sel: Mo2SelectionPayload) => {
    try {
      onSelectionChangeRef.current?.(sel);
    } catch {
      // Persistence is caller-owned; never let it break the switch flow.
    }
  }, []);

  // Latest committed selection, so late-arriving detail responses can be
  // discarded instead of overwriting the new instance's data.
  const currentSelectionRef = useRef<{ instancePath: string; profile: string } | null>(null);
  currentSelectionRef.current =
    selectedInstance && selectedProfile
      ? { instancePath: selectedInstance.instancePath, profile: selectedProfile }
      : null;

  const clearError = useCallback(() => setError(null), []);

  // Detection scans the filesystem, so only run it when the identity of the
  // game (id/path/name) changes — not on playtime or MO2 setting updates.
  const detectionKey = game
    ? `${game.id}\u0000${game.path ?? ""}\u0000${gameDisplayName(game)}`
    : "";
  const lastDetectionKeyRef = useRef<string | null>(null);

  // 1. Detect instances when game changes
  const refreshInstances = useCallback(async (force = false) => {
    if (!game) {
      setInstances([]);
      setSelectedInstance(null);
      setSelectedProfile(null);
      setDetails(null);
      setError(null);
      return;
    }
    if (!force && lastDetectionKeyRef.current === detectionKey) return;
    lastDetectionKeyRef.current = detectionKey;

    const gameId = game.id;
    setLoading(true);
    setError(null);
    try {
      const detected = await invoke<Mo2Instance[]>("mo2_detect_instances", {
        gamePath: game.path ?? "",
        gameName: gameDisplayName(game),
      });

      const savedCfg = getGameMo2Config(gameId);
      const preferredPath = game.mo2InstancePath || savedCfg?.instancePath;

      let fullList = mergeMo2Instances(detected);
      const isKnown = (path: string) =>
        fullList.some((i) => i.instancePath.toLowerCase() === path.toLowerCase());

      if (preferredPath && !isKnown(preferredPath)) {
        try {
          const extra = await invoke<Mo2Instance[]>("mo2_detect_instances", {
            gamePath: preferredPath,
            gameName: gameDisplayName(game),
          });
          fullList = mergeMo2Instances(extra, fullList);
        } catch {
          // Non-blocking: keep the game-based detection results.
        }
      }

      // A manually located instance may live outside MO2's well-known
      // locations, so validate the saved path and keep it in the list.
      if (preferredPath && !isKnown(preferredPath)) {
        try {
          const saved = await invoke<Mo2Instance>("mo2_resolve_instance", {
            path: preferredPath,
          });
          if (saved?.instancePath) {
            fullList = mergeMo2Instances([saved], fullList);
          }
        } catch {
          // Non-blocking: the saved path is simply no longer usable.
        }
      }

      if (gameIdRef.current !== gameId) return;

      setInstances(fullList);

      if (fullList.length === 0) {
        setSelectedInstance(null);
        setSelectedProfile(null);
        setDetails(null);
        return;
      }

      // An instance unrelated to this game is shown for inspection only and
      // never persisted — the launch path refuses it.
      const matched = selectMo2Instance(fullList, preferredPath);
      const display = matched ?? fullList[0];

      const resolved = resolveMo2Selection([display], {
        instancePath: display.instancePath,
        profile: game.mo2Profile || savedCfg?.profile,
        executable: game.mo2Executable || savedCfg?.executable,
        gamePath: game.path,
        allowUnrelatedFallback: true,
      });

      setSelectedInstance(display);
      setSelectedProfile(
        resolved?.profile ??
          display.selectedProfile ??
          display.profiles[0] ??
          "Default",
      );
    } catch (e) {
      if (gameIdRef.current === gameId) {
        setInstances([]);
        setSelectedInstance(null);
        setSelectedProfile(null);
        setDetails(null);
        setError(String(e));
      }
    } finally {
      if (gameIdRef.current === gameId) {
        setLoading(false);
      }
    }
  }, [game, detectionKey]);

  useEffect(() => {
    void refreshInstances();
  }, [refreshInstances]);

  // 2. Fetch profile details when instance or profile changes. Keyed on the
  //    path/name rather than the instance object so a re-detect that returns
  //    fresh objects does not refetch unchanged details.
  const selectedInstancePath = selectedInstance?.instancePath ?? null;

  const refreshDetails = useCallback(async () => {
    if (!selectedInstancePath || !selectedProfile) {
      setDetails(null);
      return;
    }

    const instancePath = selectedInstancePath;
    const profileName = selectedProfile;
    const isStillCurrent = () => {
      const current = currentSelectionRef.current;
      return (
        current !== null &&
        current.instancePath.toLowerCase() === instancePath.toLowerCase() &&
        current.profile === profileName
      );
    };

    setLoading(true);
    try {
      const d = await invoke<Mo2ProfileDetails>("mo2_get_profile_details", {
        instancePath,
        profileName,
      });
      if (isStillCurrent()) setDetails(d);
    } catch (e) {
      if (isStillCurrent()) {
        setDetails(null);
        setError(String(e));
      }
    } finally {
      if (isStillCurrent()) setLoading(false);
    }
  }, [selectedInstancePath, selectedProfile]);

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

  // 7. Switch to another detected instance (or select a freshly located one).
  //    The switch always targets the NEW instance path — never the previous
  //    selection — and persists only after the backend accepted it.
  const selectInstance = useCallback(
    async (
      instance: Mo2Instance,
      opts: { profile?: string } = {}
    ): Promise<Mo2SelectionPayload> => {
      const savedCfg = game ? getGameMo2Config(game.id) : null;
      const resolved = resolveMo2Selection([instance], {
        instancePath: instance.instancePath,
        profile: opts.profile ?? game?.mo2Profile ?? savedCfg?.profile,
        gamePath: game?.path,
        allowUnrelatedFallback: true,
      });

      const selection: Mo2SelectionPayload = {
        instancePath: instance.instancePath,
        profile:
          resolved?.profile ??
          instance.selectedProfile ??
          instance.profiles[0] ??
          "Default",
        executable: resolved?.executable ?? "",
      };

      setSelectedInstance(instance);
      setSelectedProfile(selection.profile);
      setDetails(null);
      setError(null);

      try {
        await invoke("mo2_switch_profile", {
          instancePath: selection.instancePath,
          profileName: selection.profile,
        });
      } catch (e) {
        // The instance choice is still valid even when MO2's active profile
        // cannot be rewritten (read-only ini); launching passes the profile
        // explicitly, so persist the selection and surface the warning.
        setError(String(e));
      }

      notifySelection(selection);
      return selection;
    },
    [game, notifySelection]
  );

  // 8. Switch active profile on the current (or an explicitly named) instance
  const switchProfile = useCallback(
    async (profileName: string, instancePath?: string) => {
      const targetPath = instancePath ?? selectedInstance?.instancePath;
      if (!targetPath) return;

      setSelectedProfile(profileName);
      setDetails(null);

      try {
        await invoke("mo2_switch_profile", {
          instancePath: targetPath,
          profileName,
        });
      } catch (e) {
        setError(String(e));
        throw e;
      }

      const target =
        instances.find(
          (i) => i.instancePath.toLowerCase() === targetPath.toLowerCase()
        ) ??
        (selectedInstance &&
        selectedInstance.instancePath.toLowerCase() === targetPath.toLowerCase()
          ? selectedInstance
          : null);

      const persistedExecutable =
        game?.mo2Executable || (game ? getGameMo2Config(game.id)?.executable : undefined);

      const executable = target
        ? resolveMo2Selection([target], {
            instancePath: targetPath,
            profile: profileName,
            executable: persistedExecutable,
            gamePath: game?.path,
            allowUnrelatedFallback: true,
          })?.executable ?? ""
        : "";

      notifySelection({ instancePath: targetPath, profile: profileName, executable });
    },
    [selectedInstance, instances, game, notifySelection]
  );

  // 9. Create a new profile
  const createProfile = useCallback(
    async (profileName: string, cloneFrom?: string) => {
      if (!selectedInstance) return;
      const instancePath = selectedInstance.instancePath;
      await invoke("mo2_create_profile", {
        instancePath,
        profileName,
        cloneFrom: cloneFrom || null,
      });
      await refreshInstances();
      await switchProfile(profileName, instancePath);
    },
    [selectedInstance, refreshInstances, switchProfile]
  );

  // 10. Delete a profile
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

  // 11. Launch via MO2
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
          moExePath: selectedInstance.moExePath ?? null,
          runAsAdmin: game.runAsAdmin || false,
        });
        return msg;
      } finally {
        setLaunching(false);
      }
    },
    [game, selectedInstance, selectedProfile]
  );

  // 12. Validate a user-picked folder/ini/exe path and make it the selection.
  const addInstanceFromPath = useCallback(
    async (path: string): Promise<Mo2Instance> => {
      setError(null);

      let picked: Mo2Instance;
      try {
        picked = await invoke<Mo2Instance>("mo2_resolve_instance", { path });
      } catch (e) {
        setError(String(e));
        throw e;
      }

      if (!picked || !picked.instancePath) {
        const message = "No Mod Organizer 2 instance found at that path.";
        setError(message);
        throw new Error(message);
      }

      setInstances((prev) => mergeMo2Instances(prev, [picked]));

      try {
        await selectInstance(picked);
      } catch {
        // The instance is valid; the profile switch failure is already in `error`.
      }

      return picked;
    },
    [selectInstance]
  );

  // 13. Manually locate an MO2 folder. Returns null when the dialog was
  //     cancelled, and throws when the folder is not a valid instance so the
  //     caller can surface `error`.
  const browseForMo2 = useCallback(async (): Promise<Mo2Instance | null> => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select Mod Organizer 2 Folder",
    });
    if (typeof selected !== "string" || !selected) return null;
    return addInstanceFromPath(selected);
  }, [addInstanceFromPath]);

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
    clearError,
    refreshInstances,
    refreshDetails,
    setModEnabled,
    setModsEnabled,
    reorderMods,
    setPluginEnabled,
    reorderPlugins,
    selectInstance,
    switchProfile,
    createProfile,
    deleteProfile,
    launchViaMo2,
    browseForMo2,
    addInstanceFromPath,
  };
}
