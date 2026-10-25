import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../../context/GameContext";
import { useToast } from "../../../context/ToastContext";
import { useLanguage } from "../../../context/LanguageContext";
import { useSettings } from "../../../context/SettingsContext";
import { useSizeUnit } from "../../../hooks/useSizeUnit";
import { getCachedInstalledVersion } from "../../../hooks/useGameUpdateCheck";
import {
  type Game,
  type GameMetadataResult,
  type CompanionApp,
  type GameExecutable,
  type SimilarGame,
  type ReleaseDateInfo,
  type LanguageSupportInfo,
  formatSize,
  formatPlayTime,
  parsePlayTime,
  type PlayStatus,
  extractSteamAppIdFromWebsites,
  gameDisplayName,
  gameIsVr,
} from "../../../types/game";
import type { Mo2Instance } from "../../../types/mo2";
import { getGameMo2Config, saveGameMo2Config } from "../../../utils/mo2Storage";
import type { SteamLaunchOption } from "../../../types/steam";
import { toWebviewAssetUrl } from "../../../utils/artworkUrl";
import type { CompatibilitySettings } from "../../../pages/settings/CompatibilityTab";
import { ARTWORK_SLOT_LABEL_KEYS } from "./editConstants";
import { ALL_DRAFT_KEYS, SECTION_DRAFT_KEYS } from "./draftKeys";

export interface EditGameControllerArgs {
  game: Game;
  onClose: () => void;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function useEditGameController({ game, onClose }: EditGameControllerArgs) {
  const { showToast } = useToast();
  const { updateGame, isGameUntracked, toggleGameTracking } = useGames();
  const { unit: sizeUnit } = useSizeUnit();
  const { t } = useLanguage();
  const { showFullLinuxUi, isWindowsHost, isLinuxHost } = useSettings();

  // Snapshot of the values the modal opened with. Dirty counts compare the
  // live draft against this, and section resets write these values back.
  // Artwork is persisted immediately, so `markBaseline` moves those keys
  // forward when a pick lands.
  const baselineRef = useRef<Record<string, unknown> | null>(null);
  const markBaseline = (updates: Record<string, unknown>) => {
    if (baselineRef.current) Object.assign(baselineRef.current, updates);
  };

  // Windows executables on a Linux host run through the Wine/Proton
  // compatibility layer by default (the launcher routes `.exe` files
  // there even without a saved profile), so the toggle should reflect
  // that instead of showing the layer as off. Only an explicit
  // saved `enabled` value overrides the platform default.
  const compatEnabledByDefault =
    showFullLinuxUi && isLinuxHost && /\.exe$/i.test(game.path || "");


  const [editName, setEditName] = useState(game.name);
  const [editDisplayName, setEditDisplayName] = useState(game.displayName || "");
  const [editPlatform, setEditPlatform] = useState(game.platform);
  const cachedVersion = getCachedInstalledVersion(game.id);
  const [editVersion, setEditVersion] = useState(game.version || cachedVersion || "");
  const [detectingVersion, setDetectingVersion] = useState(false);
  const [editPlayStatus, setEditPlayStatus] = useState<PlayStatus>(game.playStatus || "backlog");
  const [editUntracked, setEditUntracked] = useState(game.untracked ?? isGameUntracked(game.id));
  const [editDeveloper, setEditDeveloper] = useState(game.developer || "");
  const [editPublisher, setEditPublisher] = useState(game.publisher || "");
  const [editReleaseDate, setEditReleaseDate] = useState(game.releaseDate || "");
  const [editDescription, setEditDescription] = useState(game.description || "");
  const [editStoryline, setEditStoryline] = useState(game.storyline || "");

  const [editIgdbRating, setEditIgdbRating] = useState(game.igdbRating || 0);
  const [editCriticRating, setEditCriticRating] = useState(game.criticRating || 0);
  const [editGenres, setEditGenres] = useState<string[]>(game.genres || []);
  const [editThemes, setEditThemes] = useState<string[]>(game.themes || []);
  const [editGameModes, setEditGameModes] = useState<string[]>(game.gameModes || []);
  const [editPlayerPerspectives, setEditPlayerPerspectives] = useState<string[]>(game.playerPerspectives || []);
  const [editTimeToBeatMain, setEditTimeToBeatMain] = useState(game.timeToBeat?.normally ? Math.round(game.timeToBeat.normally / 3600) : 0);
  const [editTimeToBeatExtra, setEditTimeToBeatExtra] = useState(game.timeToBeat?.hastily ? Math.round(game.timeToBeat.hastily / 3600) : 0);
  const [editTimeToBeatComple, setEditTimeToBeatComple] = useState(game.timeToBeat?.completely ? Math.round(game.timeToBeat.completely / 3600) : 0);
  const [editSimilarGamesNames, setEditSimilarGamesNames] = useState<string[]>(
    game.similarGames ? game.similarGames.map((g) => g.name) : []
  );
  const [editCollection, setEditCollection] = useState(game.collection || "");
  const [editFranchise, setEditFranchise] = useState(game.franchise || "");
  const [editGameCategory, setEditGameCategory] = useState(game.gameCategory || "");
  const [editReleaseStatus, setEditReleaseStatus] = useState(game.releaseStatus || "");
  // VR flag: seed from the effective state (persisted flag or heuristic) so
  // the checkbox reflects what the badge already shows, and write an
  // explicit value on save to make the user's choice sticky.
  const [editIsVr, setEditIsVr] = useState(() => gameIsVr(game));
  const [editAlternativeNames, setEditAlternativeNames] = useState<string[]>(game.alternativeNames || []);

  const [editIcon, setEditIcon] = useState(game.iconUrl || "");
  const [editCover, setEditCover] = useState(game.coverArtUrl || "");
  const [editHero, setEditHero] = useState(game.bannerUrl || "");
  const [editLogo, setEditLogo] = useState(game.logoUrl || "");
  const [editCoverSource, setEditCoverSource] = useState(game.coverSourceUrl);
  const [editLogoSource, setEditLogoSource] = useState(game.logoSourceUrl);
  const [editScreenshots, setEditScreenshots] = useState<string[]>(game.screenshots || []);
  const [editVideos, setEditVideos] = useState<string[]>(game.videos || []);
  const [editWebsites, setEditWebsites] = useState<string[]>(game.websites || []);

  const [editSizeBytes, setEditSizeBytes] = useState<number | undefined>(game.sizeBytes);
  const [editSizeRootPath, setEditSizeRootPath] = useState<string | undefined>(game.sizeRootPath);
  const [detectingSize, setDetectingSize] = useState(false);
  const [editMetadataSource, setEditMetadataSource] = useState(game.metadataSource || "");
  const [editMetadataUrl, setEditMetadataUrl] = useState(game.metadataUrl || "");
  const [editReleases, setEditReleases] = useState<ReleaseDateInfo[]>(game.releases || []);
  const [editLanguageSupports, setEditLanguageSupports] = useState<LanguageSupportInfo[]>(game.languageSupports || []);

  const [editPlaytimeHours, setEditPlaytimeHours] = useState<number>(
    Math.floor(parsePlayTime(game.playTime) / 60)
  );
  const [editPlaytimeMinutes, setEditPlaytimeMinutes] = useState<number>(
    parsePlayTime(game.playTime) % 60
  );

  // ── Purchase cost (v16) ──
  const [editCost, setEditCost] = useState<string>(
    game.purchaseCost != null ? String(game.purchaseCost) : ""
  );
  const [editCurrency, setEditCurrency] = useState<string>(
    game.purchaseCurrency || "USD"
  );
  const [prefillingCost, setPrefillingCost] = useState(false);
  /** How the current value got there: auto price lookup, or the user
   *  pressing "look up price". Drives the inline hint. */
  const [costSource, setCostSource] = useState<"auto" | "manual" | null>(null);
  const autoPrefilledRef = useRef(false);
  const parsedEditCost = parseFloat(editCost.replace(",", "."));
  const validEditCost =
    editCost.trim() !== "" && isFinite(parsedEditCost) && parsedEditCost >= 0;
  const editCostPerHour = validEditCost
    ? parsedEditCost / (parsePlayTime(game.playTime) / 60)
    : null;

  async function handlePrefillCost() {
    if (prefillingCost) return;
    setPrefillingCost(true);
    try {
      const res = await invoke<Record<string, { salePrice?: number | null; normalPrice?: number | null }>>(
        "fetch_game_prices_batch",
        { gameNames: [gameDisplayName(game) || game.name] }
      );
      const price = res && Object.values(res)[0];
      const cents = price?.salePrice ?? price?.normalPrice;
      if (cents == null || !isFinite(cents)) {
        showToast(t("edit.cost.prefillUnavailable"), "info");
      } else {
        setEditCost(cents.toFixed(2));
        if (!editCurrency) setEditCurrency("USD");
        setCostSource("manual");
        showToast(t("edit.cost.prefillDone"), "success");
      }
    } catch (err) {
      showToast(t("edit.cost.prefillError", { error: String(err) }), "error");
    } finally {
      setPrefillingCost(false);
    }
  }

  // Auto-fill from the price the app already knows for this title (the
  // CheapShark cache behind `fetch_game_prices_batch` is usually warm —
  // store cards request the same names). Runs once per modal open and
  // only when the user has not set a cost: a stored value always wins,
  // and a failed lookup is silent because the manual button remains.
  useEffect(() => {
    if (game.purchaseCost != null) return;
    if (autoPrefilledRef.current) return;
    autoPrefilledRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke<Record<string, { salePrice?: number | null; normalPrice?: number | null }>>(
          "fetch_game_prices_batch",
          { gameNames: [gameDisplayName(game) || game.name] }
        );
        if (cancelled) return;
        const price = res && Object.values(res)[0];
        const cents = price?.salePrice ?? price?.normalPrice;
        if (cents == null || !isFinite(cents) || cents < 0) return;
        const autoCost = cents.toFixed(2);
        const autoCurrency = game.purchaseCurrency ? undefined : "USD";
        setEditCost(autoCost);
        if (autoCurrency) setEditCurrency(autoCurrency);
        setCostSource("auto");
        // A suggestion is not an edit: keep the guard quiet until the user
        // actually changes the value or presses "Look up price".
        markBaseline({
          editCost: autoCost,
          ...(autoCurrency ? { editCurrency: autoCurrency } : {}),
        });
      } catch {
        // Offline / no match: leave the field empty; the button retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game.id, game.purchaseCost, game.purchaseCurrency, game.name, game.displayName]);

  function resetPlaytimeEdits() {
    setEditPlaytimeHours(0);
    setEditPlaytimeMinutes(0);
  }

  // Deep link from the game page's empty value tile is handled by the shell,
  // which selects the Storage section before focusing the cost field.

  const lastSeenPlaytimeRef = useRef(game.playTime);
  useEffect(() => {
    if (game.playTime === lastSeenPlaytimeRef.current) return;
    lastSeenPlaytimeRef.current = game.playTime;
    const total = parsePlayTime(game.playTime);
    setEditPlaytimeHours(Math.floor(total / 60));
    setEditPlaytimeMinutes(total % 60);
  }, [game.playTime]);

  const [editPath, setEditPath] = useState(game.path || "");
  const [editLaunchArguments, setEditLaunchArguments] = useState(game.launchArguments || "");
  const [editRunAsAdmin, setEditRunAsAdmin] = useState(game.runAsAdmin || false);
  const [editShowSteamLaunchSelection, setEditShowSteamLaunchSelection] = useState(game.showSteamLaunchSelection || false);
  const [editPreLaunchScript, setEditPreLaunchScript] = useState(game.preLaunchScript || "");
  const [editPreLaunchAdmin, setEditPreLaunchAdmin] = useState(game.preLaunchAdmin || false);
  const [editPostExitScript, setEditPostExitScript] = useState(game.postExitScript || "");
  const [editPostExitAdmin, setEditPostExitAdmin] = useState(game.postExitAdmin || false);
  const [editCompanionApps, setEditCompanionApps] = useState<CompanionApp[]>(
    game.companionApps && game.companionApps.length > 0
      ? game.companionApps.map((c) => ({ ...c }))
      : []
  );

  const [editExtraExecutables, setEditExtraExecutables] = useState<GameExecutable[]>(
    game.extraExecutables && game.extraExecutables.length > 0
      ? game.extraExecutables.map((e) => ({ ...e }))
      : []
  );

  // ── Mod Organizer 2 State ─────────────────────────────────────────
  const [mo2Instances, setMo2Instances] = useState<Mo2Instance[]>([]);
  const [editMo2LaunchEnabled, setEditMo2LaunchEnabled] = useState<boolean>(() => {
    const cfg = getGameMo2Config(game.id);
    return game.mo2LaunchEnabled ?? cfg?.enabled ?? false;
  });
  const [editMo2Profile, setEditMo2Profile] = useState<string>(() => {
    const cfg = getGameMo2Config(game.id);
    return game.mo2Profile || cfg?.profile || "";
  });
  const [editMo2Executable, setEditMo2Executable] = useState<string>(() => {
    const cfg = getGameMo2Config(game.id);
    return game.mo2Executable || cfg?.executable || "";
  });
  const [editMo2InstancePath, setEditMo2InstancePath] = useState<string>(() => {
    const cfg = getGameMo2Config(game.id);
    return game.mo2InstancePath || cfg?.instancePath || "";
  });

  useEffect(() => {
    let cancelled = false;
    const preferred = editMo2InstancePath.trim();
    invoke<Mo2Instance[]>("mo2_detect_instances", {
      gamePath: preferred || game.path || "",
      gameName: gameDisplayName(game),
    })
      .then(async (instances) => {
        if (cancelled) return;
        let list = instances || [];
        if (preferred && !list.some((i) => i.instancePath.toLowerCase() === preferred.toLowerCase())) {
          try {
            const extra = await invoke<Mo2Instance[]>("mo2_detect_instances", {
              gamePath: preferred,
              gameName: gameDisplayName(game),
            });
            if (!cancelled && extra && extra.length > 0) {
              list = [...extra, ...list];
            }
          } catch {
            // ignore
          }
        }
        if (cancelled) return;
        setMo2Instances(list);
        if (list.length > 0) {
          const matched = (preferred ? list.find((i) => i.instancePath.toLowerCase() === preferred.toLowerCase()) : null) || list[0];
          if (!preferred) {
            setEditMo2InstancePath(matched.instancePath);
            markBaseline({ editMo2InstancePath: matched.instancePath });
          }
          if (!editMo2Profile) {
            const nextProfile = matched.selectedProfile || matched.profiles[0] || "Default";
            setEditMo2Profile(nextProfile);
            markBaseline({ editMo2Profile: nextProfile });
          }
          if (!editMo2Executable && matched.customExecutables && matched.customExecutables.length > 0) {
            setEditMo2Executable(matched.customExecutables[0].title);
            markBaseline({ editMo2Executable: matched.customExecutables[0].title });
          }
        }
      })
      .catch((err) => {
        console.warn("Failed to detect MO2 instances:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [game.path, game.name, game.displayName]);

  // ── Compatibility / Proton / Wine State ──────────────────────────
  const [compatEnabled, setCompatEnabled] = useState(
    game.compatibility?.enabled ?? compatEnabledByDefault
  );
  const [compatRunnerType, setCompatRunnerType] = useState<"default" | "proton" | "wine" | "custom">(
    game.compatibility?.runnerType ?? "default"
  );
  const [compatCustomRunner, setCompatCustomRunner] = useState(
    game.compatibility?.customRunnerPath ?? ""
  );
  const [compatPrefix, setCompatPrefix] = useState(
    game.compatibility?.customWinePrefix ?? ""
  );
  const [compatArch, setCompatArch] = useState<"win64" | "win32">(
    game.compatibility?.arch ?? "win64"
  );
  const [compatWorkingDir, setCompatWorkingDir] = useState(
    game.compatibility?.workingDir ?? ""
  );
  const [compatDxvk, setCompatDxvk] = useState<boolean | null>(
    game.compatibility?.enableDxvk ?? null
  );
  const [compatVkd3d, setCompatVkd3d] = useState<boolean | null>(
    game.compatibility?.enableVkd3d ?? null
  );
  const [compatVkd3dDescriptorHeap, setCompatVkd3dDescriptorHeap] = useState<boolean | null>(
    game.compatibility?.enableVkd3dDescriptorHeap ?? null
  );
  const [compatEsync, setCompatEsync] = useState<boolean | null>(
    game.compatibility?.enableEsync ?? null
  );
  const [compatFsync, setCompatFsync] = useState<boolean | null>(
    game.compatibility?.enableFsync ?? null
  );
  const [compatNvapi, setCompatNvapi] = useState<boolean | null>(
    game.compatibility?.enableDxvkNvapi ?? null
  );
  const [compatNtsync, setCompatNtsync] = useState<boolean | null>(
    game.compatibility?.enableNtsync ?? null
  );
  const [compatDxvkAsync, setCompatDxvkAsync] = useState<boolean | null>(
    game.compatibility?.enableDxvkAsync ?? null
  );
  const [compatWayland, setCompatWayland] = useState<boolean | null>(
    game.compatibility?.enableWayland ?? null
  );
  const [compatWow64, setCompatWow64] = useState<boolean | null>(
    game.compatibility?.enableWow64 ?? null
  );
  const [compatLargeAddress, setCompatLargeAddress] = useState<boolean | null>(
    game.compatibility?.enableLargeAddressAware ?? null
  );
  const [compatWineDebug, setCompatWineDebug] = useState(
    game.compatibility?.wineDebug ?? ""
  );
  const [compatAudioDriver, setCompatAudioDriver] = useState(
    game.compatibility?.audioDriver ?? ""
  );
  const [compatVirtualDesktop, setCompatVirtualDesktop] = useState<boolean | null>(
    game.compatibility?.virtualDesktop ?? null
  );
  const [compatVirtualDesktopRes, setCompatVirtualDesktopRes] = useState(
    game.compatibility?.virtualDesktopRes ?? ""
  );
  const [compatDxvkHud, setCompatDxvkHud] = useState(
    game.compatibility?.dxvkHud ?? ""
  );
  const [compatMangoHud, setCompatMangoHud] = useState<boolean | null>(
    game.compatibility?.enableMangoHud ?? null
  );
  const [compatMangoHudHidden, setCompatMangoHudHidden] = useState<boolean | null>(
    game.compatibility?.mangohudHidden ?? null
  );
  const [compatUmu, setCompatUmu] = useState<boolean | null>(
    game.compatibility?.enableUmuLauncher ?? null
  );
  const [compatController, setCompatController] = useState<boolean | null>(
    game.compatibility?.enableControllerSupport ?? null
  );
  const [compatAnticheat, setCompatAnticheat] = useState<boolean | null>(
    game.compatibility?.enableAnticheatSupport ?? null
  );
  const [compatGameMode, setCompatGameMode] = useState<boolean | null>(
    game.compatibility?.enableGameMode ?? null
  );
  const [compatGamescope, setCompatGamescope] = useState<boolean | null>(
    game.compatibility?.enableGamescope ?? null
  );
  const [compatGamescopeArgs, setCompatGamescopeArgs] = useState(
    game.compatibility?.gamescopeArgs ?? ""
  );
  const [compatGamescopeMode, setCompatGamescopeMode] = useState<"fullscreen" | "borderless" | "windowed" | "">(
    (game.compatibility?.gamescopeMode as "fullscreen" | "borderless" | "windowed") || ""
  );
  const [compatGamescopeGameWidth, setCompatGamescopeGameWidth] = useState<number | undefined>(
    game.compatibility?.gamescopeGameWidth ?? undefined
  );
  const [compatGamescopeGameHeight, setCompatGamescopeGameHeight] = useState<number | undefined>(
    game.compatibility?.gamescopeGameHeight ?? undefined
  );
  const [compatGamescopeWindowWidth, setCompatGamescopeWindowWidth] = useState<number | undefined>(
    game.compatibility?.gamescopeWindowWidth ?? undefined
  );
  const [compatGamescopeWindowHeight, setCompatGamescopeWindowHeight] = useState<number | undefined>(
    game.compatibility?.gamescopeWindowHeight ?? undefined
  );
  const [compatGamescopeFilter, setCompatGamescopeFilter] = useState<"fsr" | "nis" | "linear" | "nearest" | "integer" | "">(
    (game.compatibility?.gamescopeFilter as "fsr" | "nis" | "linear" | "nearest" | "integer") || ""
  );
  const [compatGamescopeFsrSharpness, setCompatGamescopeFsrSharpness] = useState<number | undefined>(
    game.compatibility?.gamescopeFsrSharpness ?? undefined
  );
  const [compatGamescopeFpsLimit, setCompatGamescopeFpsLimit] = useState<number | undefined>(
    game.compatibility?.gamescopeFpsLimit ?? undefined
  );
  const [compatGamescopeRefreshRate, setCompatGamescopeRefreshRate] = useState<number | undefined>(
    game.compatibility?.gamescopeRefreshRate ?? undefined
  );
  const [compatGamescopeAdaptiveSync, setCompatGamescopeAdaptiveSync] = useState<boolean | null>(
    game.compatibility?.gamescopeAdaptiveSync ?? null
  );
  const [compatGamescopeHdr, setCompatGamescopeHdr] = useState<boolean | null>(
    game.compatibility?.gamescopeHdr ?? null
  );
  const [compatGamescopeStretch, setCompatGamescopeStretch] = useState<boolean | null>(
    game.compatibility?.gamescopeStretch ?? null
  );
  const [compatGamescopeForceWindowsFullscreen, setCompatGamescopeForceWindowsFullscreen] = useState<boolean | null>(
    game.compatibility?.gamescopeForceWindowsFullscreen ?? null
  );
  const [compatPrime, setCompatPrime] = useState<boolean | null>(
    game.compatibility?.primeRenderOffload ?? null
  );
  const [compatUseSpecificGpu, setCompatUseSpecificGpu] = useState<boolean | null>(
    game.compatibility?.useSpecificGpu ?? null
  );
  const [compatPreLaunch, setCompatPreLaunch] = useState(
    game.compatibility?.preLaunchWrapper ?? ""
  );
  const [compatEnvPairs, setCompatEnvPairs] = useState<{ key: string; value: string }[]>(() => {
    if (!game.compatibility?.environmentVariables) return [];
    return Object.entries(game.compatibility.environmentVariables).map(([k, v]) => ({ key: k, value: v }));
  });
  const [compatDllPairs, setCompatDllPairs] = useState<{ dll: string; mode: string }[]>(() => {
    if (!game.compatibility?.dllOverrides) return [];
    return Object.entries(game.compatibility.dllOverrides).map(([k, v]) => ({ dll: k, mode: v }));
  });
  const [excludedGlobalEnv, setExcludedGlobalEnv] = useState<string[]>(
    game.compatibility?.excludedGlobalEnv ?? []
  );
  const [excludedGlobalDlls, setExcludedGlobalDlls] = useState<string[]>(
    game.compatibility?.excludedGlobalDlls ?? []
  );
  const [globalCompatSettings, setGlobalCompatSettings] = useState<CompatibilitySettings | null>(null);
  const [availableRunners, setAvailableRunners] = useState<Array<{ id: string; name: string; path: string; kind: string }>>([]);
  const [availablePrefixes, setAvailablePrefixes] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [runningTool, setRunningTool] = useState<string | null>(null);

  // The "hide MangoHud by default" override only makes sense when the
  // overlay will actually run: explicitly on for this game, or left on
  // the global default and the global setting enables MangoHud.
  const mangohudActive =
    compatMangoHud === true ||
    (compatMangoHud === null && (globalCompatSettings?.enableMangoHud ?? false));

  useEffect(() => {
    invoke<Array<{ id: string; name: string; path: string; kind: string }>>("list_compatibility_runners")
      .then((r) => setAvailableRunners(r || []))
      .catch(() => {});
    invoke<CompatibilitySettings>("get_compatibility_settings")
      .then((s) => setGlobalCompatSettings(s || null))
      .catch(() => {});
    invoke<Array<{ id: string; name: string; path: string }>>("list_wine_prefixes")
      .then((list) => setAvailablePrefixes(list || []))
      .catch(() => {});
  }, []);

  const handleToggleExcludeGlobalEnv = (key: string) => {
    setExcludedGlobalEnv((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleToggleExcludeGlobalDll = (dll: string) => {
    setExcludedGlobalDlls((prev) =>
      prev.includes(dll) ? prev.filter((d) => d !== dll) : [...prev, dll]
    );
  };

  const handleRemoveFromGlobalEnv = async (key: string) => {
    if (!globalCompatSettings) return;
    const updatedEnv = { ...globalCompatSettings.customEnvironmentVariables };
    delete updatedEnv[key];
    const updatedSettings: CompatibilitySettings = {
      ...globalCompatSettings,
      customEnvironmentVariables: updatedEnv,
    };
    try {
      await invoke("set_compatibility_settings", { settings: updatedSettings });
      setGlobalCompatSettings(updatedSettings);
      setExcludedGlobalEnv((prev) => prev.filter((k) => k !== key));
      showToast(t("gameEdit.compatibility.globalEnvRemoved", { key }) || `Removed ${key} from global environment`, "success");
    } catch (err) {
      showToast(t("edit.toast.globalSettingsFailed", { error: String(err) }), "error");
    }
  };

  const handleRemoveFromGlobalDll = async (dll: string) => {
    if (!globalCompatSettings) return;
    const updatedDlls = { ...globalCompatSettings.customDllOverrides };
    delete updatedDlls[dll];
    const updatedSettings: CompatibilitySettings = {
      ...globalCompatSettings,
      customDllOverrides: updatedDlls,
    };
    try {
      await invoke("set_compatibility_settings", { settings: updatedSettings });
      setGlobalCompatSettings(updatedSettings);
      setExcludedGlobalDlls((prev) => prev.filter((d) => d !== dll));
      showToast(t("gameEdit.compatibility.globalDllRemoved", { dll }) || `Removed ${dll} from global DLL overrides`, "success");
    } catch (err) {
      showToast(t("edit.toast.globalSettingsFailed", { error: String(err) }), "error");
    }
  };

  const handlePickRunner = async () => {
    try {
      const picked = await open({ multiple: false, title: t("gameEdit.compatibility.pickRunner") || "Select Wine/Proton runner" });
      if (picked && typeof picked === "string") {
        setCompatCustomRunner(picked);
        setCompatRunnerType("custom");
      }
    } catch (err) {
      console.error("Failed to pick runner", err);
    }
  };

  const handlePickPrefix = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: t("gameEdit.compatibility.pickPrefix") || "Select WINEPREFIX directory" });
      if (picked && typeof picked === "string") {
        setCompatPrefix(picked);
      }
    } catch (err) {
      console.error("Failed to pick prefix", err);
    }
  };

  const handlePickWorkingDir = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: t("gameEdit.compatibility.pickWorkingDir") || "Select Working Directory" });
      if (picked && typeof picked === "string") {
        setCompatWorkingDir(picked);
      }
    } catch (err) {
      console.error("Failed to pick working dir", err);
    }
  };

  const handleRunWineTool = async (tool: string, args?: string[]) => {
    setRunningTool(tool);
    try {
      const effectivePrefix = compatPrefix.trim() || undefined;
      const effectiveRunner = compatRunnerType === "custom" && compatCustomRunner.trim()
        ? compatCustomRunner.trim()
        : undefined;

      await invoke("run_wine_tool", {
        gameId: game.id,
        prefixPath: effectivePrefix,
        runnerPath: effectiveRunner,
        tool,
        args,
      });
      showToast(t("gameEdit.compatibility.toolStarted", { tool }) || `Launched ${tool}`, "success");
    } catch (err) {
      showToast(t("gameEdit.compatibility.toolError", { error: String(err) }) || `Failed to run ${tool}: ${err}`, "error");
    } finally {
      setRunningTool(null);
    }
  };

  const [steamLaunchOptions, setSteamLaunchOptions] = useState<SteamLaunchOption[] | null>(null);
  useEffect(() => {
    if (game.platform !== "Steam" || !game.steamAppId) {
      setSteamLaunchOptions(null);
      return;
    }
    let cancelled = false;
    invoke<SteamLaunchOption[]>("steam_launch_options", { steamAppId: game.steamAppId })
      .then((options) => {
        if (!cancelled) setSteamLaunchOptions(options);
      })
      .catch(() => {
        if (!cancelled) setSteamLaunchOptions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [game.platform, game.steamAppId]);

  const steamLaunchListLabel = steamLaunchOptions
    ? steamLaunchOptions
        .map((o) => o.description.trim() || `Option ${o.index}`)
        .join(", ")
    : "";

  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [showMetadataPanel, setShowMetadataPanel] = useState(false);
  const [applyingMetadata, setApplyingMetadata] = useState(false);

  const [mediaFetchSlot, setMediaFetchSlot] = useState<
    "icon" | "cover" | "hero" | "logo" | null
  >(null);
  const [fetchingImageKey, setFetchingImageKey] = useState<string | null>(null);


  function setImageSlot(key: "icon" | "cover" | "hero" | "banner" | "logo", value: string) {
    const slot = key === "banner" ? "hero" : key;
    if (slot === "icon") setEditIcon(value);
    else if (slot === "cover") setEditCover(value);
    else if (slot === "hero") setEditHero(value);
    else setEditLogo(value);
  }

  function artworkPatch(
    key: "icon" | "cover" | "hero" | "banner" | "logo",
    value: string,
    sourceUrl?: string
  ): Partial<Game> {
    const slot = key === "banner" ? "hero" : key;
    const url = value || undefined;
    if (slot === "icon") return { iconUrl: url };
    if (slot === "cover") {
      return {
        coverArtUrl: url,
        coverSourceUrl: sourceUrl ?? (/^https:\/\//i.test(value) ? value : undefined),
      };
    }
    if (slot === "hero") return { bannerUrl: url };
    return {
      logoUrl: url,
      logoSourceUrl: sourceUrl ?? (/^https:\/\//i.test(value) ? value : undefined),
    };
  }

  /** DB-only artwork patch for `patch_game`: just the touched column(s), with
   *  `null` to clear. `patch_game` ignores missing keys, so this can never
   *  revive a stale value for another slot. */
  function artworkDbPatch(
    key: "icon" | "cover" | "hero" | "banner" | "logo",
    value: string,
    sourceUrl?: string
  ): Record<string, string | null> {
    const slot = key === "banner" ? "hero" : key;
    const url = value || null;
    if (slot === "icon") return { iconUrl: url };
    if (slot === "cover") {
      return {
        coverArtUrl: url,
        coverSourceUrl: sourceUrl ?? (/^https:\/\//i.test(value) ? value : null),
      };
    }
    if (slot === "hero") return { bannerUrl: url };
    return {
      logoUrl: url,
      logoSourceUrl: sourceUrl ?? (/^https:\/\//i.test(value) ? value : null),
    };
  }

  function persistImageSlot(
    key: "icon" | "cover" | "hero" | "banner" | "logo",
    value: string,
    sourceUrl?: string
  ) {
    const patch = artworkPatch(key, value, sourceUrl);
    setImageSlot(key, value);
    if (key === "cover") {
      setEditCoverSource(sourceUrl ?? (/^https:\/\//i.test(value) ? value : undefined));
    } else if (key === "logo") {
      setEditLogoSource(sourceUrl ?? (/^https:\/\//i.test(value) ? value : undefined));
    }
    // Artwork writes through immediately, so it is already saved: move the
    // baseline with it to keep the unsaved-changes guard honest.
    const slot = key === "banner" ? "hero" : key;
    const draftKey = { icon: "editIcon", cover: "editCover", hero: "editHero", logo: "editLogo" }[slot];
    const sourceKey = slot === "cover" ? "editCoverSource" : slot === "logo" ? "editLogoSource" : null;
    markBaseline({
      [draftKey]: value,
      ...(sourceKey
        ? { [sourceKey]: sourceUrl ?? (/^https:\/\//i.test(value) ? value : undefined) }
        : {}),
    });
    updateGame(game.id, patch);
    // Persist only the touched artwork column through the merge-safe
    // `patch_game`. A full-row `save_game` built from a stale snapshot could
    // roll back another slot (or wipe the heavy media arrays) when the user
    // picks several images, so the targeted patch is what makes each
    // selection stick. `null` clears a column because `patch_game` leaves
    // absent keys untouched.
    invoke("patch_game", { id: game.id, patch: artworkDbPatch(key, value, sourceUrl) }).catch((err) =>
      console.warn(`Immediate artwork persist failed for ${game.name}:`, err)
    );
  }

  function freshAssetUrl(url: string): string {
    return `${url}${url.includes("?") ? "&" : "?"}v=${Date.now()}`;
  }

  function artworkSavedToast(key: "icon" | "cover" | "hero" | "banner" | "logo") {
    showToast(
      t("editExtras.artworkSaved", { slot: t(ARTWORK_SLOT_LABEL_KEYS[key]) }),
      "success"
    );
  }

  async function searchMetadata(): Promise<GameMetadataResult[]> {
    return invoke("search_game_metadata", {
      gameName: editName.trim() || game.name,
      steamAppId: editName.trim() ? undefined : game.steamAppId,
    });
  }

  async function applyRemoteImage(slot: "icon" | "cover" | "hero" | "banner" | "logo", url: string): Promise<boolean> {
    setImageSlot(slot, url);
    const relativePath = await invoke<string | null>("download_artwork", {
      gameId: game.id,
      slot: slot === "banner" ? "hero" : slot,
      url,
    });
    if (relativePath) {
      const assetUrl = freshAssetUrl(
        toWebviewAssetUrl(
          await invoke<string>("artwork_asset_url", { relativePath })
        )
      );
      persistImageSlot(slot, assetUrl, url);
      artworkSavedToast(slot);
      return true;
    }
    showToast(t("editExtras.failedToDownloadImage"), "error");
    return false;
  }

  async function handleFetchMetadata() {
    setFetchingMetadata(true);
    setMetadataResults([]);
    setShowMetadataPanel(true);
    try {
      const results: GameMetadataResult[] = await searchMetadata();
      setMetadataResults(results);
      if (results.length === 0) showToast(t("edit.toast.metadataNotFound"), "info");
    } catch (err) {
      showToast(t("edit.toast.metadataSearchFailed", { error: String(err) }), "error");
    } finally {
      setFetchingMetadata(false);
    }
  }

  function handleFetchImage(slot: "icon" | "cover" | "hero" | "logo") {
    // Open the focused search modal for manual title matching (remasters,
    // ports, fan projects). The inline gallery already lists the auto-fetched
    // sources under the pinned panel.
    setMediaFetchSlot(slot);
  }

  async function handleApplyFetchedImage(
    slot: "icon" | "cover" | "hero" | "logo",
    url: string
  ): Promise<void> {
    await applyRemoteImage(slot, url);
  }

  async function handleApplyMetadata(result: GameMetadataResult) {
    setApplyingMetadata(true);
    try {
      const imageKeys = ["icon", "cover", "hero", "banner", "logo"] as const;
      const imageEntries = imageKeys
        .map((key) => [key, result.images[key]] as const)
        .filter(([, url]) => url != null);
      const downloadedEntries = await Promise.all(
        imageEntries.map(async ([key, url]) => {
          const relativePath = await invoke<string | null>("download_artwork", {
            gameId: game.id,
            slot: key === "banner" ? "hero" : key,
            url,
          });
          const assetUrl = relativePath
            ? freshAssetUrl(
                toWebviewAssetUrl(
                  await invoke<string>("artwork_asset_url", { relativePath })
                )
              )
            : undefined;
          return [key, assetUrl] as const;
        }),
      );
      const downloaded: Record<string, string | undefined> = Object.fromEntries(downloadedEntries);

      const iconUrl = downloaded.icon;
      const coverUrl = downloaded.cover || game.coverArtUrl;
      const heroUrl = downloaded.hero;
      const bannerUrl = downloaded.banner;
      const logoUrl = downloaded.logo;
      const finalBannerUrl = bannerUrl ?? heroUrl ?? undefined;

      setEditName(result.title || game.name);
      setEditDescription(result.description || "");
      setEditDeveloper(result.developer || "");
      setEditPublisher(result.publisher || "");
      setEditReleaseDate(result.releaseDate || "");
      setEditGenres(result.genres || []);
      setEditStoryline(result.storyline || "");
      setEditIgdbRating(result.igdbRating || 0);
      setEditCriticRating(result.criticRating || 0);
      setEditThemes(result.themes || []);
      setEditGameModes(result.gameModes || []);
      setEditPlayerPerspectives(result.playerPerspectives || []);
      if (result.isVr != null) setEditIsVr(result.isVr);

      if (iconUrl) setEditIcon(iconUrl);
      if (coverUrl) setEditCover(coverUrl);
      if (finalBannerUrl) setEditHero(finalBannerUrl);
      if (logoUrl) setEditLogo(logoUrl);
      if (downloaded.cover) setEditCoverSource(result.images.cover ?? undefined);
      if (downloaded.logo) setEditLogoSource(result.images.logo ?? undefined);

      setEditScreenshots(result.screenshots || []);
      setEditVideos(result.videos || []);
      setEditWebsites(result.websites || []);

      setEditTimeToBeatMain(result.timeToBeat?.normally ? Math.round(result.timeToBeat.normally / 3600) : 0);
      const fetchedExtra = result.timeToBeat?.mainExtra ?? result.timeToBeat?.hastily;
      setEditTimeToBeatExtra(fetchedExtra ? Math.round(fetchedExtra / 3600) : 0);
      setEditTimeToBeatComple(result.timeToBeat?.completely ? Math.round(result.timeToBeat.completely / 3600) : 0);
      setEditSimilarGamesNames(result.similarGames ? result.similarGames.map((g) => g.name) : []);
      setEditReleases(result.releases || []);
      setEditLanguageSupports(result.languageSupports || []);

      setEditCollection(result.collection || "");
      setEditFranchise(result.franchise || "");
      setEditGameCategory(result.gameCategory || "");
      setEditReleaseStatus(result.releaseStatus || "");
      setEditAlternativeNames(result.alternativeNames || []);

      setEditMetadataSource(result.sourceName);
      setEditMetadataUrl(result.sourceUrl);

      showToast(t("edit.toast.metadataApplied", { source: result.sourceName }), "success");
      setShowMetadataPanel(false);
    } catch (err) {
      showToast(t("edit.toast.metadataApplyFailed", { error: String(err) }), "error");
    } finally {
      setApplyingMetadata(false);
    }
  }

  async function handlePickImage(key: "icon" | "cover" | "hero" | "logo") {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("edit.dialog.selectImage", { slot: t(ARTWORK_SLOT_LABEL_KEYS[key]) }),
        filters: [{ name: t("edit.dialog.filter.images"), extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (filePath && typeof filePath === "string") {
        const relativePath = await invoke<string | null>("store_artwork_file", {
          gameId: game.id,
          slot: key,
          filePath,
        });
        if (relativePath) {
          const assetUrl = freshAssetUrl(
            toWebviewAssetUrl(
              await invoke<string>("artwork_asset_url", { relativePath })
            )
          );
          persistImageSlot(key, assetUrl);
          artworkSavedToast(key);
        }
      }
    } catch (err) {
      showToast(t("editExtras.failedToLoadImage"), "error");
    }
  }

  function handleRemoveImage(key: "icon" | "cover" | "hero" | "logo") {
    persistImageSlot(key, "");
    showToast(
      t("editExtras.artworkRemoved", { slot: t(ARTWORK_SLOT_LABEL_KEYS[key]) }),
      "info"
    );
  }

  async function handleApplyIgdbImage(imageUrl: string, slot: "icon" | "cover" | "hero" | "banner" | "logo") {
    setFetchingImageKey(slot);
    try {
      await applyRemoteImage(slot, imageUrl);
    } catch (err) {
      showToast(t("edit.toast.imageApplyFailed", { error: String(err) }), "error");
    } finally {
      setFetchingImageKey(null);
    }
  }

  async function openFolderAndDetectSize() {
    if (detectingSize) return;
    setDetectingSize(true);
    try {
      const picked = await open({ directory: true, multiple: false, title: t("edit.dialog.selectGameFolder") });
      if (!picked || Array.isArray(picked)) return;
      const folder = picked as string;
      const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
        exePath: "",
        gameName: (editName || game.name || "").trim(),
        rootOverride: folder,
      });
      setEditSizeBytes(result.sizeBytes);
      setEditSizeRootPath(result.rootPath);
      showToast(t("edit.toast.sizeDetected", { size: formatSize(result.sizeBytes, sizeUnit) }), "success");
    } catch (err) {
      console.error("detect_game_size failed", err);
      showToast(t("edit.toast.sizeReadFailed", { error: String(err) }), "error");
    } finally {
      setDetectingSize(false);
    }
  }

  function clearSize() {
    setEditSizeBytes(undefined);
    setEditSizeRootPath(undefined);
  }

  async function handleDetectVersion() {
    if (detectingVersion) return;
    const cached = getCachedInstalledVersion(game.id);
    if (cached && !editVersion) {
      setEditVersion(cached);
    }
    setDetectingVersion(true);
    try {
      let detected: string | null = null;
      try {
        const res = await invoke<{ version: string; source: string } | string | null>("detect_game_version", {
          query: {
            gameId: game.id,
            path: editPath || game.path,
            detectedExe: game.detectedExe,
            installDir: editSizeRootPath || game.sizeRootPath,
            platform: editPlatform || game.platform,
            steamAppId: game.steamAppId,
          },
        });
        if (typeof res === "string" && res.trim()) {
          detected = res.trim();
        } else if (res && typeof res === "object" && "version" in res && res.version) {
          detected = res.version.trim();
        }
      } catch {
        // Fall back to get_exe_file_version
      }

      if (!detected) {
        const exe = (editPath || game.path || game.detectedExe || "").trim();
        if (exe) {
          detected = await invoke<string | null>("get_exe_file_version", { path: exe }).catch(() => null);
        }
      }

      const finalDetected = detected || cached;
      if (finalDetected) {
        setEditVersion(finalDetected);
        showToast(t("edit.versionDetected", { version: finalDetected }), "success");
      } else {
        showToast(t("edit.versionDetectNotFound"), "info");
      }
    } catch {
      if (cached) {
        setEditVersion(cached);
        showToast(t("edit.versionDetected", { version: cached }), "success");
      } else {
        showToast(t("edit.versionDetectNotFound"), "info");
      }
    } finally {
      setDetectingVersion(false);
    }
  }

  async function handlePickExecutable() {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("edit.dialog.selectGameExe"),
        filters: [
          { name: t("edit.dialog.filter.executables"), extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: t("edit.dialog.filter.allFiles"), extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") setEditPath(filePath);
    } catch (err) {
      showToast(t("edit.toast.selectExecutableFailed"), "error");
    }
  }

  async function handlePickScript(setter: (path: string) => void, title: string) {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title,
        filters: [
          { name: t("edit.dialog.filter.scripts"), extensions: ["bat", "cmd", "ps1", "exe"] },
          { name: t("edit.dialog.filter.allFiles"), extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") setter(filePath);
    } catch (err) {
      showToast(t("edit.toast.selectFileFailed"), "error");
    }
  }

  async function handlePickCompanion(index: number) {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("edit.dialog.selectCompanion"),
        filters: [
          { name: t("edit.dialog.filter.executables"), extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: t("edit.dialog.filter.allFiles"), extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") {
        setEditCompanionApps((prev) =>
          prev.map((c, i) => (i === index ? { ...c, path: filePath } : c))
        );
      }
    } catch (err) {
      showToast(t("edit.toast.selectFileFailed"), "error");
    }
  }

  function addCompanionApp() {
    setEditCompanionApps((prev) => [
      ...prev,
      { path: "", arguments: "", delayMs: 0, runAsAdmin: false },
    ]);
  }

  function updateCompanionApp(index: number, patch: Partial<CompanionApp>) {
    setEditCompanionApps((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
  }

  function removeCompanionApp(index: number) {
    setEditCompanionApps((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Additional executables (alternate launch targets) ──────────────
  function updateExtraExe(index: number, patch: Partial<GameExecutable>) {
    setEditExtraExecutables((prev) =>
      prev.map((e, i) => (i === index ? { ...e, ...patch } : e))
    );
  }

  function addExtraExe() {
    setEditExtraExecutables((prev) => [...prev, { path: "" }]);
  }

  function removeExtraExe(index: number) {
    setEditExtraExecutables((prev) => prev.filter((_, i) => i !== index));
  }

  async function handlePickExtraExe(index: number) {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("edit.dialog.selectExecutable"),
        filters: [
          { name: t("edit.dialog.filter.executables"), extensions: ["exe", "bat", "lnk", "cmd"] },
          { name: t("edit.dialog.filter.allFiles"), extensions: ["*"] },
        ],
      });
      if (filePath && typeof filePath === "string") {
        updateExtraExe(index, { path: filePath });
      }
    } catch {
      showToast(t("edit.toast.selectFileFailed"), "error");
    }
  }

  function appendLaunchArg(arg: string) {
    const trimmed = editLaunchArguments.trim();
    if (!trimmed) {
      setEditLaunchArguments(arg);
    } else if (!trimmed.includes(arg)) {
      setEditLaunchArguments(`${trimmed} ${arg}`);
    }
  }

  function saveEdits() {
    const newName = editName.trim() || game.name;
    const newPlatform = editPlatform.trim() || game.platform;
    const newIcon = editIcon || undefined;
    const newSizeBytes = editSizeBytes;
    const newSizeRootPath = editSizeRootPath;
    const newSizeDetectedAt = editSizeBytes != null ? new Date().toISOString() : undefined;
    const newCover = editCover || undefined;
    const newHero = editHero || undefined;
    const newLogo = editLogo || undefined;

    const newDescription = editDescription.trim() || undefined;
    const newDeveloper = editDeveloper.trim() || undefined;
    const newPublisher = editPublisher.trim() || undefined;
    const newReleaseDate = editReleaseDate.trim() || undefined;
    const newGenres = editGenres.length > 0 ? editGenres : undefined;
    const newStoryline = editStoryline.trim() || undefined;
    const newIgdbRating = editIgdbRating > 0 ? Number(editIgdbRating) : undefined;
    const newCriticRating = editCriticRating > 0 ? Number(editCriticRating) : undefined;
    const newThemes = editThemes.length > 0 ? editThemes : undefined;
    const newGameModes = editGameModes.length > 0 ? editGameModes : undefined;
    const newPlayerPerspectives = editPlayerPerspectives.length > 0 ? editPlayerPerspectives : undefined;

    const existingSims = game.similarGames || [];
    const newSimilarGames: SimilarGame[] = editSimilarGamesNames
      .map((name, index) => {
        const existing = existingSims.find((g) => g.name.toLowerCase() === name.toLowerCase());
        return {
          id: existing ? existing.id : index,
          name,
          coverUrl: existing ? existing.coverUrl : undefined,
        };
      });

    const newReleases = editReleases.filter((r) => r.platform);
    const newLanguageSupports = editLanguageSupports.length > 0 ? editLanguageSupports : undefined;
    const newAlternativeNames = editAlternativeNames.filter(Boolean);

    const newSteamAppId =
      game.steamAppId ?? extractSteamAppIdFromWebsites(editWebsites) ?? undefined;

    updateGame(game.id, {
      name: newName,
      displayName: editDisplayName.trim() || undefined,
      platform: newPlatform,
      steamAppId: newSteamAppId,
      iconUrl: newIcon,
      coverArtUrl: newCover,
      coverSourceUrl: editCoverSource || (/^https:\/\//i.test(newCover || "") ? newCover : undefined),
      bannerUrl: newHero,
      logoUrl: newLogo,
      logoSourceUrl: editLogoSource || (/^https:\/\//i.test(newLogo || "") ? newLogo : undefined),
      description: newDescription,
      sizeBytes: newSizeBytes,
      sizeRootPath: newSizeRootPath,
      sizeDetectedAt: newSizeDetectedAt,
      developer: newDeveloper,
      publisher: newPublisher,
      releaseDate: newReleaseDate,
      genres: newGenres,
      storyline: newStoryline,
      igdbRating: newIgdbRating,
      criticRating: newCriticRating,
      themes: newThemes,
      gameModes: newGameModes,
      playerPerspectives: newPlayerPerspectives,
      screenshots: editScreenshots.length > 0 ? editScreenshots : undefined,
      videos: editVideos.length > 0 ? editVideos : undefined,
      websites: editWebsites.length > 0 ? editWebsites : undefined,
      timeToBeat: {
        // Keep the HLTB stat sheet (and the legacy IGDB-only fields)
        // intact — the form only edits the three headline values.
        ...(game.timeToBeat?.hltb ? { hltb: game.timeToBeat.hltb } : {}),
        ...(game.timeToBeat?.hastily ? { hastily: game.timeToBeat.hastily } : {}),
        ...(game.timeToBeat?.allStyles ? { allStyles: game.timeToBeat.allStyles } : {}),
        normally: editTimeToBeatMain > 0 ? editTimeToBeatMain * 3600 : undefined,
        mainExtra: editTimeToBeatExtra > 0 ? editTimeToBeatExtra * 3600 : undefined,
        completely: editTimeToBeatComple > 0 ? editTimeToBeatComple * 3600 : undefined,
      },
      similarGames: newSimilarGames.length > 0 ? newSimilarGames : undefined,
      releases: newReleases.length > 0 ? newReleases : undefined,
      igdbReviews: game.igdbReviews,
      alternativeNames: newAlternativeNames.length > 0 ? newAlternativeNames : undefined,
      collection: editCollection.trim() || undefined,
      franchise: editFranchise.trim() || undefined,
      gameCategory: editGameCategory.trim() || undefined,
      releaseStatus: editReleaseStatus.trim() || undefined,
      isVr: editIsVr,
      languageSupports: newLanguageSupports,
      metadataSource: editMetadataSource ? editMetadataSource : undefined,
      metadataUrl: editMetadataUrl ? editMetadataUrl : undefined,
      version: editVersion.trim() || undefined,
      // Always persist a plain string — `undefined` here crashes the
      // sidebar's path-dedup pass (`g.path.toLowerCase()` outside the
      // error boundary) on the next re-render, blanking the whole app.
      path: editPath.trim(),
      // Attaching an executable means the game is present on disk — flip
      // it to installed. One-way only: clearing a path never downgrades
      // installed (launcher titles stay installed without a local exe).
      installed: editPath.trim() ? true : game.installed,
      launchArguments: editLaunchArguments.trim() || undefined,
      runAsAdmin: editRunAsAdmin || undefined,
      showSteamLaunchSelection: editShowSteamLaunchSelection || undefined,
      preLaunchScript: editPreLaunchScript.trim() || undefined,
      preLaunchAdmin: editPreLaunchAdmin || undefined,
      postExitScript: editPostExitScript.trim() || undefined,
      postExitAdmin: editPostExitAdmin || undefined,
      companionApps:
        editCompanionApps.length > 0
          ? editCompanionApps
              .filter((c) => c.path.trim())
              .map((c) => ({
                path: c.path.trim(),
                arguments: c.arguments?.trim() || undefined,
                delayMs: Math.max(0, Number(c.delayMs) || 0),
                runAsAdmin: c.runAsAdmin || undefined,
              }))
          : undefined,
      extraExecutables:
        editExtraExecutables.length > 0
          ? editExtraExecutables
              .filter((e) => e.path.trim())
              .map((e) => ({
                path: e.path.trim(),
                label: e.label?.trim() || undefined,
                arguments: e.arguments?.trim() || undefined,
                runAsAdmin: e.runAsAdmin || undefined,
              }))
          : undefined,
      mo2LaunchEnabled: editMo2LaunchEnabled,
      mo2Profile: editMo2Profile.trim() || undefined,
      mo2Executable: editMo2Executable.trim() || undefined,
      mo2InstancePath: editMo2InstancePath.trim() || undefined,
      playStatus: editPlayStatus,
      playTime: formatPlayTime(
        Math.max(0, Math.floor(editPlaytimeHours)) * 60 +
        Math.max(0, Math.min(59, Math.floor(editPlaytimeMinutes)))
      ),
      // $/hour tracker: persist a cleared field as "unknown" rather than
      // 0 — a zero cost reads as "free game" in the value stats.
      purchaseCost: validEditCost ? parsedEditCost : undefined,
      purchaseCurrency: validEditCost
        ? editCurrency.trim().toUpperCase() || "USD"
        : undefined,
      compatibility:
        compatEnabled ||
        compatRunnerType !== "default" ||
        compatCustomRunner.trim() ||
        compatPrefix.trim() ||
        compatArch !== "win64" ||
        compatWorkingDir.trim() ||
        compatDxvk !== null ||
        compatVkd3d !== null ||
        compatVkd3dDescriptorHeap !== null ||
        compatEsync !== null ||
        compatFsync !== null ||
        compatNvapi !== null ||
        compatNtsync !== null ||
        compatDxvkAsync !== null ||
        compatWayland !== null ||
        compatWow64 !== null ||
        compatLargeAddress !== null ||
        compatWineDebug.trim() ||
        compatAudioDriver.trim() ||
        compatVirtualDesktop !== null ||
        compatVirtualDesktopRes.trim() ||
        compatDxvkHud.trim() ||
        compatMangoHud !== null ||
        compatMangoHudHidden !== null ||
        compatUmu !== null ||
        compatController !== null ||
        compatAnticheat !== null ||
        compatGameMode !== null ||
        compatGamescope !== null ||
        compatGamescopeArgs.trim() ||
        compatGamescopeMode.trim() ||
        compatGamescopeGameWidth !== undefined ||
        compatGamescopeGameHeight !== undefined ||
        compatGamescopeWindowWidth !== undefined ||
        compatGamescopeWindowHeight !== undefined ||
        compatGamescopeFilter.trim() ||
        compatGamescopeFsrSharpness !== undefined ||
        compatGamescopeFpsLimit !== undefined ||
        compatGamescopeRefreshRate !== undefined ||
        compatGamescopeAdaptiveSync !== null ||
        compatGamescopeHdr !== null ||
        compatGamescopeStretch !== null ||
        compatGamescopeForceWindowsFullscreen !== null ||
        compatPrime !== null ||
        compatUseSpecificGpu !== null ||
        compatPreLaunch.trim() ||
        compatEnvPairs.length > 0 ||
        compatDllPairs.length > 0 ||
        excludedGlobalEnv.length > 0 ||
        excludedGlobalDlls.length > 0
          ? {
              enabled: compatEnabled,
              runnerType: compatRunnerType,
              customRunnerPath: compatCustomRunner.trim() || undefined,
              customWinePrefix: compatPrefix.trim() || undefined,
              arch: compatArch,
              workingDir: compatWorkingDir.trim() || undefined,
              enableDxvk: compatDxvk,
              enableVkd3d: compatVkd3d,
              enableVkd3dDescriptorHeap: compatVkd3dDescriptorHeap,
              enableEsync: compatEsync,
              enableFsync: compatFsync,
              enableDxvkNvapi: compatNvapi,
              enableNtsync: compatNtsync,
              enableDxvkAsync: compatDxvkAsync,
              enableWayland: compatWayland,
              enableWow64: compatWow64,
              enableLargeAddressAware: compatLargeAddress,
              wineDebug: compatWineDebug.trim() || undefined,
              audioDriver: compatAudioDriver.trim() || undefined,
              virtualDesktop: compatVirtualDesktop,
              virtualDesktopRes: compatVirtualDesktopRes.trim() || undefined,
              dxvkHud: compatDxvkHud.trim() || undefined,
              enableMangoHud: compatMangoHud,
              mangohudHidden: compatMangoHudHidden,
              enableUmuLauncher: compatUmu,
              enableControllerSupport: compatController,
              enableAnticheatSupport: compatAnticheat,
              enableGameMode: compatGameMode,
              enableGamescope: compatGamescope,
              gamescopeArgs: compatGamescopeArgs.trim() || undefined,
              gamescopeMode: compatGamescopeMode ? compatGamescopeMode : undefined,
              gamescopeGameWidth: compatGamescopeGameWidth,
              gamescopeGameHeight: compatGamescopeGameHeight,
              gamescopeWindowWidth: compatGamescopeWindowWidth,
              gamescopeWindowHeight: compatGamescopeWindowHeight,
              gamescopeFilter: compatGamescopeFilter ? compatGamescopeFilter : undefined,
              gamescopeFsrSharpness: compatGamescopeFsrSharpness,
              gamescopeFpsLimit: compatGamescopeFpsLimit,
              gamescopeRefreshRate: compatGamescopeRefreshRate,
              gamescopeAdaptiveSync: compatGamescopeAdaptiveSync,
              gamescopeHdr: compatGamescopeHdr,
              gamescopeStretch: compatGamescopeStretch,
              gamescopeForceWindowsFullscreen: compatGamescopeForceWindowsFullscreen,
              primeRenderOffload: compatPrime,
              useSpecificGpu: compatUseSpecificGpu,
              preLaunchWrapper: compatPreLaunch.trim() || undefined,
              environmentVariables: compatEnvPairs.reduce((acc, { key, value }) => {
                if (key.trim()) acc[key.trim()] = value;
                return acc;
              }, {} as Record<string, string>),
              dllOverrides: compatDllPairs.reduce((acc, { dll, mode }) => {
                if (dll.trim()) acc[dll.trim()] = mode;
                return acc;
              }, {} as Record<string, string>),
              excludedGlobalEnv: excludedGlobalEnv.length > 0 ? excludedGlobalEnv : undefined,
              excludedGlobalDlls: excludedGlobalDlls.length > 0 ? excludedGlobalDlls : undefined,
            }
          : undefined,
    });
    saveGameMo2Config(game.id, {
      enabled: editMo2LaunchEnabled,
      profile: editMo2Profile.trim() || undefined,
      executable: editMo2Executable.trim() || undefined,
      instancePath: editMo2InstancePath.trim() || undefined,
    });
    if (editUntracked !== (game.untracked ?? isGameUntracked(game.id))) {
      toggleGameTracking(game.id, editUntracked);
    }
    onClose();
    showToast(t("edit.toast.gameUpdated"), "success");
  }

  const activeMo2Instance =
    mo2Instances.find((i) => i.instancePath === editMo2InstancePath) ||
    mo2Instances[0];

  const selectedRunner = availableRunners.find(
    (r) => r.path === compatCustomRunner.trim()
  );
  const hasRunnerOverride =
    Boolean(compatCustomRunner.trim()) || compatRunnerType !== "default";
  const runnerSelectValue =
    selectedRunner?.path ?? (hasRunnerOverride ? "custom" : "default");

  const defaultPrefixPath = globalCompatSettings?.defaultPrefix?.trim() || "";
  const defaultPrefixDisplay = (() => {
    if (!defaultPrefixPath) return "";
    const known = availablePrefixes.find((p) => p.path === defaultPrefixPath);
    return known ? `${known.name} (${known.path})` : defaultPrefixPath;
  })();
  const compatPrefixOverride = compatPrefix.trim();
  const hasUnknownPrefix =
    Boolean(compatPrefixOverride) &&
    !availablePrefixes.some((p) => p.path === compatPrefixOverride);

  const globalRunnerLabel = (() => {
    const path = globalCompatSettings?.defaultRunnerPath?.trim();
    if (!path) return t("gameEdit.compatibility.globalRunnerAuto") || "Auto-detect";
    return availableRunners.find((r) => r.path === path)?.name ?? path;
  })();
  const globalAudioDriverLabel = (() => {
    const driver = globalCompatSettings?.audioDriver;
    if (!driver || driver === "auto") return t("gameEdit.compatibility.globalAudioAuto") || "Auto";
    if (driver === "pulse") return "PulseAudio";
    if (driver === "alsa") return "ALSA";
    if (driver === "oss") return "OSS";
    return driver;
  })();
  const globalGamescopeModeLabel = (() => {
    const mode = globalCompatSettings?.gamescopeMode || "fullscreen";
    if (mode === "borderless") return t("compatibility.mode_borderless") || "Borderless";
    if (mode === "windowed") return t("compatibility.mode_windowed") || "Windowed";
    return t("compatibility.mode_fullscreen") || "Fullscreen";
  })();
  const globalGamescopeFilterLabel = (() => {
    switch (globalCompatSettings?.gamescopeFilter || "fsr") {
      case "auto":
        return t("compatibility.filter_auto") || "Auto";
      case "nis":
        return t("compatibility.filter_nis") || "NVIDIA NIS";
      case "linear":
        return t("compatibility.filter_linear") || "Linear";
      case "nearest":
        return t("compatibility.filter_nearest") || "Nearest";
      case "integer":
        return t("compatibility.filter_integer") || "Integer Scaling";
      default:
        return t("compatibility.filter_fsr") || "AMD FSR";
    }
  })();
  const globalSettingNone = t("gameEdit.compatibility.globalSettingNotSet") || "Not set";
  const globalWineDebugLabel = globalCompatSettings?.wineDebug || "-all";
  const globalVirtualDesktopResLabel = globalCompatSettings?.virtualDesktopRes || "1920x1080";
  const globalGameResLabel =
    globalCompatSettings?.gamescopeGameWidth && globalCompatSettings.gamescopeGameHeight
      ? `${globalCompatSettings.gamescopeGameWidth}x${globalCompatSettings.gamescopeGameHeight}`
      : globalSettingNone;
  const globalOutputResLabel =
    globalCompatSettings?.gamescopeWindowWidth && globalCompatSettings.gamescopeWindowHeight
      ? `${globalCompatSettings.gamescopeWindowWidth}x${globalCompatSettings.gamescopeWindowHeight}`
      : globalSettingNone;
  const globalGamescopeArgsLabel = globalCompatSettings?.gamescopeArgs || globalSettingNone;
  const globalFsrSharpnessLabel = String(globalCompatSettings?.gamescopeFsrSharpness ?? 5);
  const globalFpsLimitLabel =
    globalCompatSettings?.gamescopeFpsLimit != null
      ? String(globalCompatSettings.gamescopeFpsLimit)
      : globalSettingNone;
  const globalRefreshRateLabel =
    globalCompatSettings?.gamescopeRefreshRate != null
      ? String(globalCompatSettings.gamescopeRefreshRate)
      : globalSettingNone;


  // ── Draft / dirty tracking ─────────────────────────────────────────
  const draftSnapshot: Record<string, unknown> = {
    editName,
    editDisplayName,
    editPlayStatus,
    editPlatform,
    editVersion,
    editReleaseDate,
    editDeveloper,
    editPublisher,
    editDescription,
    editSizeBytes,
    editSizeRootPath,
    editPlaytimeHours,
    editPlaytimeMinutes,
    editCost,
    editCurrency,
    editGenres,
    editThemes,
    editGameModes,
    editPlayerPerspectives,
    editStoryline,
    editIgdbRating,
    editCriticRating,
    editTimeToBeatMain,
    editTimeToBeatExtra,
    editTimeToBeatComple,
    editCollection,
    editFranchise,
    editGameCategory,
    editReleaseStatus,
    editIsVr,
    editSimilarGamesNames,
    editAlternativeNames,
    editMetadataSource,
    editMetadataUrl,
    editReleases,
    editLanguageSupports,
    editIcon,
    editCover,
    editHero,
    editLogo,
    editCoverSource,
    editLogoSource,
    editScreenshots,
    editVideos,
    editWebsites,
    editPath,
    editExtraExecutables,
    editLaunchArguments,
    editRunAsAdmin,
    editShowSteamLaunchSelection,
    editPreLaunchScript,
    editPreLaunchAdmin,
    editPostExitScript,
    editPostExitAdmin,
    editCompanionApps,
    editMo2LaunchEnabled,
    editMo2Profile,
    editMo2Executable,
    editMo2InstancePath,
    editUntracked,
    compatEnabled,
    compatRunnerType,
    compatCustomRunner,
    compatPrefix,
    compatArch,
    compatWorkingDir,
    compatWayland,
    compatWow64,
    compatLargeAddress,
    compatAudioDriver,
    compatWineDebug,
    compatDxvk,
    compatVkd3d,
    compatVkd3dDescriptorHeap,
    compatDxvkAsync,
    compatNtsync,
    compatEsync,
    compatFsync,
    compatNvapi,
    compatUseSpecificGpu,
    compatDxvkHud,
    compatVirtualDesktop,
    compatVirtualDesktopRes,
    compatMangoHud,
    compatMangoHudHidden,
    compatUmu,
    compatController,
    compatAnticheat,
    compatGameMode,
    compatPrime,
    compatGamescope,
    compatGamescopeArgs,
    compatGamescopeMode,
    compatGamescopeGameWidth,
    compatGamescopeGameHeight,
    compatGamescopeWindowWidth,
    compatGamescopeWindowHeight,
    compatGamescopeFilter,
    compatGamescopeFsrSharpness,
    compatGamescopeFpsLimit,
    compatGamescopeRefreshRate,
    compatGamescopeAdaptiveSync,
    compatGamescopeHdr,
    compatGamescopeStretch,
    compatGamescopeForceWindowsFullscreen,
    compatEnvPairs,
    compatDllPairs,
    excludedGlobalEnv,
    excludedGlobalDlls,
    compatPreLaunch,
  };

  if (!baselineRef.current) {
    baselineRef.current = { ...draftSnapshot };
  }

  const dirtyKeys = ALL_DRAFT_KEYS.filter(
    (key) => !sameValue(draftSnapshot[key], baselineRef.current?.[key]),
  );
  const dirtySet = new Set(dirtyKeys);
  const dirtyBySection = Object.fromEntries(
    Object.entries(SECTION_DRAFT_KEYS).map(([section, keys]) => [
      section,
      keys.filter((key) => dirtySet.has(key)).length,
    ]),
  ) as Record<keyof typeof SECTION_DRAFT_KEYS, number>;
  const dirtyCount = dirtyKeys.length;

  type DraftSetter = (value: never) => void;
  const DRAFT_SETTERS: Record<string, DraftSetter> = {
    editName: setEditName,
    editDisplayName: setEditDisplayName,
    editPlayStatus: setEditPlayStatus,
    editPlatform: setEditPlatform,
    editVersion: setEditVersion,
    editReleaseDate: setEditReleaseDate,
    editDeveloper: setEditDeveloper,
    editPublisher: setEditPublisher,
    editDescription: setEditDescription,
    editSizeBytes: setEditSizeBytes,
    editSizeRootPath: setEditSizeRootPath,
    editPlaytimeHours: setEditPlaytimeHours,
    editPlaytimeMinutes: setEditPlaytimeMinutes,
    editCost: setEditCost,
    editCurrency: setEditCurrency,
    editGenres: setEditGenres,
    editThemes: setEditThemes,
    editGameModes: setEditGameModes,
    editPlayerPerspectives: setEditPlayerPerspectives,
    editStoryline: setEditStoryline,
    editIgdbRating: setEditIgdbRating,
    editCriticRating: setEditCriticRating,
    editTimeToBeatMain: setEditTimeToBeatMain,
    editTimeToBeatExtra: setEditTimeToBeatExtra,
    editTimeToBeatComple: setEditTimeToBeatComple,
    editCollection: setEditCollection,
    editFranchise: setEditFranchise,
    editGameCategory: setEditGameCategory,
    editReleaseStatus: setEditReleaseStatus,
    editIsVr: setEditIsVr,
    editSimilarGamesNames: setEditSimilarGamesNames,
    editAlternativeNames: setEditAlternativeNames,
    editMetadataSource: setEditMetadataSource,
    editMetadataUrl: setEditMetadataUrl,
    editReleases: setEditReleases,
    editLanguageSupports: setEditLanguageSupports,
    editIcon: setEditIcon,
    editCover: setEditCover,
    editHero: setEditHero,
    editLogo: setEditLogo,
    editCoverSource: setEditCoverSource,
    editLogoSource: setEditLogoSource,
    editScreenshots: setEditScreenshots,
    editVideos: setEditVideos,
    editWebsites: setEditWebsites,
    editPath: setEditPath,
    editExtraExecutables: setEditExtraExecutables,
    editLaunchArguments: setEditLaunchArguments,
    editRunAsAdmin: setEditRunAsAdmin,
    editShowSteamLaunchSelection: setEditShowSteamLaunchSelection,
    editPreLaunchScript: setEditPreLaunchScript,
    editPreLaunchAdmin: setEditPreLaunchAdmin,
    editPostExitScript: setEditPostExitScript,
    editPostExitAdmin: setEditPostExitAdmin,
    editCompanionApps: setEditCompanionApps,
    editMo2LaunchEnabled: setEditMo2LaunchEnabled,
    editMo2Profile: setEditMo2Profile,
    editMo2Executable: setEditMo2Executable,
    editMo2InstancePath: setEditMo2InstancePath,
    editUntracked: setEditUntracked,
    compatEnabled: setCompatEnabled,
    compatRunnerType: setCompatRunnerType,
    compatCustomRunner: setCompatCustomRunner,
    compatPrefix: setCompatPrefix,
    compatArch: setCompatArch,
    compatWorkingDir: setCompatWorkingDir,
    compatWayland: setCompatWayland,
    compatWow64: setCompatWow64,
    compatLargeAddress: setCompatLargeAddress,
    compatAudioDriver: setCompatAudioDriver,
    compatWineDebug: setCompatWineDebug,
    compatDxvk: setCompatDxvk,
    compatVkd3d: setCompatVkd3d,
    compatVkd3dDescriptorHeap: setCompatVkd3dDescriptorHeap,
    compatDxvkAsync: setCompatDxvkAsync,
    compatNtsync: setCompatNtsync,
    compatEsync: setCompatEsync,
    compatFsync: setCompatFsync,
    compatNvapi: setCompatNvapi,
    compatUseSpecificGpu: setCompatUseSpecificGpu,
    compatDxvkHud: setCompatDxvkHud,
    compatVirtualDesktop: setCompatVirtualDesktop,
    compatVirtualDesktopRes: setCompatVirtualDesktopRes,
    compatMangoHud: setCompatMangoHud,
    compatMangoHudHidden: setCompatMangoHudHidden,
    compatUmu: setCompatUmu,
    compatController: setCompatController,
    compatAnticheat: setCompatAnticheat,
    compatGameMode: setCompatGameMode,
    compatPrime: setCompatPrime,
    compatGamescope: setCompatGamescope,
    compatGamescopeArgs: setCompatGamescopeArgs,
    compatGamescopeMode: setCompatGamescopeMode,
    compatGamescopeGameWidth: setCompatGamescopeGameWidth,
    compatGamescopeGameHeight: setCompatGamescopeGameHeight,
    compatGamescopeWindowWidth: setCompatGamescopeWindowWidth,
    compatGamescopeWindowHeight: setCompatGamescopeWindowHeight,
    compatGamescopeFilter: setCompatGamescopeFilter,
    compatGamescopeFsrSharpness: setCompatGamescopeFsrSharpness,
    compatGamescopeFpsLimit: setCompatGamescopeFpsLimit,
    compatGamescopeRefreshRate: setCompatGamescopeRefreshRate,
    compatGamescopeAdaptiveSync: setCompatGamescopeAdaptiveSync,
    compatGamescopeHdr: setCompatGamescopeHdr,
    compatGamescopeStretch: setCompatGamescopeStretch,
    compatGamescopeForceWindowsFullscreen: setCompatGamescopeForceWindowsFullscreen,
    compatEnvPairs: setCompatEnvPairs,
    compatDllPairs: setCompatDllPairs,
    excludedGlobalEnv: setExcludedGlobalEnv,
    excludedGlobalDlls: setExcludedGlobalDlls,
    compatPreLaunch: setCompatPreLaunch,
  };

  function resetSection(section: keyof typeof SECTION_DRAFT_KEYS) {
    const baseline = baselineRef.current;
    if (!baseline) return;
    for (const key of SECTION_DRAFT_KEYS[section]) {
      DRAFT_SETTERS[key]?.(baseline[key] as never);
    }
  }

  function resetAll() {
    const baseline = baselineRef.current;
    if (!baseline) return;
    for (const key of ALL_DRAFT_KEYS) {
      DRAFT_SETTERS[key]?.(baseline[key] as never);
    }
  }

  return {
    game,
    t,
    sizeUnit,
    showFullLinuxUi,
    isWindowsHost,
    isLinuxHost,
    cachedVersion,
    activeMo2Instance,
    selectedRunner,
    runnerSelectValue,
    defaultPrefixPath,
    defaultPrefixDisplay,
    compatPrefixOverride,
    hasUnknownPrefix,
    globalRunnerLabel,
    globalAudioDriverLabel,
    globalGamescopeModeLabel,
    globalGamescopeFilterLabel,
    globalSettingNone,
    globalWineDebugLabel,
    globalVirtualDesktopResLabel,
    globalGameResLabel,
    globalOutputResLabel,
    globalGamescopeArgsLabel,
    globalFsrSharpnessLabel,
    globalFpsLimitLabel,
    globalRefreshRateLabel,
    mangohudActive,
    steamLaunchOptions,
    steamLaunchListLabel,
    editName,
    setEditName,
    editDisplayName,
    setEditDisplayName,
    editVersion,
    setEditVersion,
    detectingVersion,
    editPlayStatus,
    setEditPlayStatus,
    editUntracked,
    setEditUntracked,
    editDeveloper,
    setEditDeveloper,
    editPublisher,
    setEditPublisher,
    editReleaseDate,
    setEditReleaseDate,
    editDescription,
    setEditDescription,
    editStoryline,
    setEditStoryline,
    editIgdbRating,
    setEditIgdbRating,
    editCriticRating,
    setEditCriticRating,
    editGenres,
    setEditGenres,
    editThemes,
    setEditThemes,
    editGameModes,
    setEditGameModes,
    editPlayerPerspectives,
    setEditPlayerPerspectives,
    editTimeToBeatMain,
    setEditTimeToBeatMain,
    editTimeToBeatExtra,
    setEditTimeToBeatExtra,
    editTimeToBeatComple,
    setEditTimeToBeatComple,
    editSimilarGamesNames,
    setEditSimilarGamesNames,
    editCollection,
    setEditCollection,
    editFranchise,
    setEditFranchise,
    editGameCategory,
    setEditGameCategory,
    editReleaseStatus,
    setEditReleaseStatus,
    editIsVr,
    setEditIsVr,
    editAlternativeNames,
    setEditAlternativeNames,
    editPlatform,
    setEditPlatform,
    editIcon,
    editCover,
    editHero,
    editLogo,
    editCoverSource,
    editLogoSource,
    editScreenshots,
    setEditScreenshots,
    editVideos,
    setEditVideos,
    editWebsites,
    setEditWebsites,
    editSizeBytes,
    editSizeRootPath,
    detectingSize,
    editMetadataSource,
    setEditMetadataSource,
    editMetadataUrl,
    setEditMetadataUrl,
    editReleases,
    setEditReleases,
    editLanguageSupports,
    setEditLanguageSupports,
    editPlaytimeHours,
    setEditPlaytimeHours,
    editPlaytimeMinutes,
    setEditPlaytimeMinutes,
    editCost,
    setEditCost,
    editCurrency,
    setEditCurrency,
    prefillingCost,
    costSource,
    setCostSource,
    parsedEditCost,
    validEditCost,
    editCostPerHour,
    editPath,
    setEditPath,
    editLaunchArguments,
    setEditLaunchArguments,
    editRunAsAdmin,
    setEditRunAsAdmin,
    editShowSteamLaunchSelection,
    setEditShowSteamLaunchSelection,
    editPreLaunchScript,
    setEditPreLaunchScript,
    editPreLaunchAdmin,
    setEditPreLaunchAdmin,
    editPostExitScript,
    setEditPostExitScript,
    editPostExitAdmin,
    setEditPostExitAdmin,
    editCompanionApps,
    setEditCompanionApps,
    editExtraExecutables,
    setEditExtraExecutables,
    updateExtraExe,
    addExtraExe,
    removeExtraExe,
    handlePickExtraExe,
    appendLaunchArg,
    mo2Instances,
    editMo2LaunchEnabled,
    setEditMo2LaunchEnabled,
    editMo2Profile,
    setEditMo2Profile,
    editMo2Executable,
    setEditMo2Executable,
    editMo2InstancePath,
    setEditMo2InstancePath,
    compatEnabled,
    setCompatEnabled,
    compatRunnerType,
    setCompatRunnerType,
    compatCustomRunner,
    setCompatCustomRunner,
    compatPrefix,
    setCompatPrefix,
    compatArch,
    setCompatArch,
    compatWorkingDir,
    setCompatWorkingDir,
    compatDxvk,
    setCompatDxvk,
    compatVkd3d,
    setCompatVkd3d,
    compatVkd3dDescriptorHeap,
    setCompatVkd3dDescriptorHeap,
    compatEsync,
    setCompatEsync,
    compatFsync,
    setCompatFsync,
    compatNvapi,
    setCompatNvapi,
    compatNtsync,
    setCompatNtsync,
    compatDxvkAsync,
    setCompatDxvkAsync,
    compatWayland,
    setCompatWayland,
    compatWow64,
    setCompatWow64,
    compatLargeAddress,
    setCompatLargeAddress,
    compatWineDebug,
    setCompatWineDebug,
    compatAudioDriver,
    setCompatAudioDriver,
    compatVirtualDesktop,
    setCompatVirtualDesktop,
    compatVirtualDesktopRes,
    setCompatVirtualDesktopRes,
    compatDxvkHud,
    setCompatDxvkHud,
    compatMangoHud,
    setCompatMangoHud,
    compatMangoHudHidden,
    setCompatMangoHudHidden,
    compatUmu,
    setCompatUmu,
    compatController,
    setCompatController,
    compatAnticheat,
    setCompatAnticheat,
    compatGameMode,
    setCompatGameMode,
    compatGamescope,
    setCompatGamescope,
    compatGamescopeArgs,
    setCompatGamescopeArgs,
    compatGamescopeMode,
    setCompatGamescopeMode,
    compatGamescopeGameWidth,
    setCompatGamescopeGameWidth,
    compatGamescopeGameHeight,
    setCompatGamescopeGameHeight,
    compatGamescopeWindowWidth,
    setCompatGamescopeWindowWidth,
    compatGamescopeWindowHeight,
    setCompatGamescopeWindowHeight,
    compatGamescopeFilter,
    setCompatGamescopeFilter,
    compatGamescopeFsrSharpness,
    setCompatGamescopeFsrSharpness,
    compatGamescopeFpsLimit,
    setCompatGamescopeFpsLimit,
    compatGamescopeRefreshRate,
    setCompatGamescopeRefreshRate,
    compatGamescopeAdaptiveSync,
    setCompatGamescopeAdaptiveSync,
    compatGamescopeHdr,
    setCompatGamescopeHdr,
    compatGamescopeStretch,
    setCompatGamescopeStretch,
    compatGamescopeForceWindowsFullscreen,
    setCompatGamescopeForceWindowsFullscreen,
    compatPrime,
    setCompatPrime,
    compatUseSpecificGpu,
    setCompatUseSpecificGpu,
    compatPreLaunch,
    setCompatPreLaunch,
    compatEnvPairs,
    setCompatEnvPairs,
    compatDllPairs,
    setCompatDllPairs,
    excludedGlobalEnv,
    setExcludedGlobalEnv,
    excludedGlobalDlls,
    setExcludedGlobalDlls,
    globalCompatSettings,
    availableRunners,
    availablePrefixes,
    runningTool,
    fetchingMetadata,
    metadataResults,
    showMetadataPanel,
    setShowMetadataPanel,
    applyingMetadata,
    mediaFetchSlot,
    setMediaFetchSlot,
    fetchingImageKey,
    handlePrefillCost,
    resetPlaytimeEdits,
    handleFetchMetadata,
    handleApplyMetadata,
    handleFetchImage,
    handleApplyFetchedImage,
    handlePickImage,
    handleRemoveImage,
    handleApplyIgdbImage,
    openFolderAndDetectSize,
    clearSize,
    handleDetectVersion,
    handlePickExecutable,
    handlePickScript,
    handlePickCompanion,
    addCompanionApp,
    updateCompanionApp,
    removeCompanionApp,
    handlePickRunner,
    handlePickPrefix,
    handlePickWorkingDir,
    handleRunWineTool,
    handleToggleExcludeGlobalEnv,
    handleToggleExcludeGlobalDll,
    handleRemoveFromGlobalEnv,
    handleRemoveFromGlobalDll,
    saveEdits,
    isDirty: dirtyCount > 0,
    dirtyCount,
    dirtyBySection,
    dirtyKeys,
    resetSection,
    resetAll,
  };
}


