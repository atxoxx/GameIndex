/** Navigation keys and the draft fields each section owns.
 *
 *  The editor's draft is the flat set of state values initialised from the
 *  game record; this map drives per-section dirty counts and section resets.
 */

export type EditAreaKey = "details" | "media" | "launch" | "compatibility";

export type DetailsSectionKey = "identity" | "storage" | "tags" | "ratings" | "catalog";
export type MediaSectionKey = "artwork" | "screenshots" | "videos" | "links";
export type LaunchSectionKey = "executable" | "options" | "automation" | "integrations";
export type CompatibilitySectionKey = "runner" | "graphics" | "tools" | "environment" | "maintenance";

export type EditSectionKey =
  | DetailsSectionKey
  | MediaSectionKey
  | LaunchSectionKey
  | CompatibilitySectionKey;

export const DEFAULT_SECTION: Record<EditAreaKey, EditSectionKey> = {
  details: "identity",
  media: "artwork",
  launch: "executable",
  compatibility: "runner",
};

export const SECTION_DRAFT_KEYS: Record<EditSectionKey, readonly string[]> = {
  identity: [
    "editName",
    "editDisplayName",
    "editPlayStatus",
    "editPlatform",
    "editVersion",
    "editReleaseDate",
    "editDeveloper",
    "editPublisher",
    "editDescription",
  ],
  storage: [
    "editSizeBytes",
    "editSizeRootPath",
    "editPlaytimeHours",
    "editPlaytimeMinutes",
    "editCost",
    "editCurrency",
  ],
  tags: [
    "editGenres",
    "editThemes",
    "editGameModes",
    "editPlayerPerspectives",
    "editStoryline",
  ],
  ratings: [
    "editIgdbRating",
    "editCriticRating",
    "editTimeToBeatMain",
    "editTimeToBeatExtra",
    "editTimeToBeatComple",
  ],
  catalog: [
    "editCollection",
    "editFranchise",
    "editGameCategory",
    "editReleaseStatus",
    "editIsVr",
    "editSimilarGamesNames",
    "editAlternativeNames",
    "editMetadataSource",
    "editMetadataUrl",
    "editReleases",
    "editLanguageSupports",
  ],
  artwork: [
    "editIcon",
    "editCover",
    "editHero",
    "editLogo",
    "editCoverSource",
    "editLogoSource",
  ],
  screenshots: ["editScreenshots"],
  videos: ["editVideos"],
  links: ["editWebsites"],
  executable: ["editPath", "editExtraExecutables"],
  options: [
    "editLaunchArguments",
    "editRunAsAdmin",
    "editShowSteamLaunchSelection",
  ],
  automation: [
    "editPreLaunchScript",
    "editPreLaunchAdmin",
    "editPostExitScript",
    "editPostExitAdmin",
    "editCompanionApps",
  ],
  integrations: [
    "editMo2LaunchEnabled",
    "editMo2Profile",
    "editMo2Executable",
    "editMo2InstancePath",
    "editUntracked",
  ],
  runner: [
    "compatEnabled",
    "compatRunnerType",
    "compatCustomRunner",
    "compatPrefix",
    "compatArch",
    "compatWorkingDir",
    "compatWayland",
    "compatWow64",
    "compatLargeAddress",
    "compatAudioDriver",
    "compatWineDebug",
  ],
  graphics: [
    "compatDxvk",
    "compatVkd3d",
    "compatVkd3dDescriptorHeap",
    "compatDxvkAsync",
    "compatNtsync",
    "compatEsync",
    "compatFsync",
    "compatNvapi",
    "compatUseSpecificGpu",
    "compatDxvkHud",
    "compatVirtualDesktop",
    "compatVirtualDesktopRes",
  ],
  tools: [
    "compatMangoHud",
    "compatMangoHudHidden",
    "compatUmu",
    "compatController",
    "compatAnticheat",
    "compatGameMode",
    "compatPrime",
    "compatGamescope",
    "compatGamescopeArgs",
    "compatGamescopeMode",
    "compatGamescopeGameWidth",
    "compatGamescopeGameHeight",
    "compatGamescopeWindowWidth",
    "compatGamescopeWindowHeight",
    "compatGamescopeFilter",
    "compatGamescopeFsrSharpness",
    "compatGamescopeFpsLimit",
    "compatGamescopeRefreshRate",
    "compatGamescopeAdaptiveSync",
    "compatGamescopeHdr",
    "compatGamescopeStretch",
    "compatGamescopeForceWindowsFullscreen",
  ],
  environment: [
    "compatEnvPairs",
    "compatDllPairs",
    "excludedGlobalEnv",
    "excludedGlobalDlls",
    "compatPreLaunch",
  ],
  maintenance: [],
};

export const ALL_DRAFT_KEYS = Array.from(
  new Set(Object.values(SECTION_DRAFT_KEYS).flat()),
);

/** Which navigation area owns a section. */
export const AREA_FOR_SECTION: Record<EditSectionKey, EditAreaKey> = {
  identity: "details",
  storage: "details",
  tags: "details",
  ratings: "details",
  catalog: "details",
  artwork: "media",
  screenshots: "media",
  videos: "media",
  links: "media",
  executable: "launch",
  options: "launch",
  automation: "launch",
  integrations: "launch",
  runner: "compatibility",
  graphics: "compatibility",
  tools: "compatibility",
  environment: "compatibility",
  maintenance: "compatibility",
};
