import { useMemo } from "react";
import type { ReactNode } from "react";
import type {
  SettingsNavGroup,
  SettingsSearchEntry,
  SettingsSectionDef,
  SettingsTab,
} from "./types";
import {
  CloudIcon,
  DownloadIcon,
  FolderIcon,
  GaugeIcon,
  GlobeIcon,
  HardwareIcon,
  IntegrationsIcon,
  PaletteIcon,
  PluginIcon,
  RocketIcon,
  ShieldIcon,
  ListIcon,
  TrashIcon,
  BellIcon,
  DiscordIcon,
  BackupIcon,
  CompatibilityIcon,
  SettingsGearIcon,
  DiagnosticsIcon,
  OverlayIcon,
} from "./settingsIcons";

/**
 * settingsCatalog — the single source of truth for the settings page's
 * information architecture. One file owns:
 *
 *  - the tab order + per-tab label/description/icon (drives the header),
 *  - the rail groups (drives navigation),
 *  - every section inside every tab with its anchor id + keywords
 *    (drives in-tab jumps, the Essentials filter AND search),
 *  - the high-value individual settings that search should resolve to.
 *
 * Anything added to the catalog automatically appears in the rail, the
 * jump list and the search results — there is no second list to keep in
 * sync. Labels are resolved through `t()` at build time, so the index
 * always matches the user's display language.
 */

export interface TabMeta {
  tab: SettingsTab;
  labelKey: string;
  descKey: string;
  keywords: string;
  icon: ReactNode;
  sections: SettingsSectionDef[];
}

const TAB_ORDER: SettingsTab[] = [
  "overview",
  "general",
  "appearance",
  "interface",
  "hardware",
  "integrations",
  "discord",
  "downloads",
  "plugins",
  "launcher",
  "overlay",
  "saves",
  "compatibility",
  "privacy",
  "backup",
  "diagnostics",
];

export const SETTINGS_TABS: readonly SettingsTab[] = TAB_ORDER;

export function isSettingsTab(
  value: string | undefined,
  options?: { showFullLinuxUi?: boolean },
): value is SettingsTab {
  if (value === undefined) return false;
  if (value === "compatibility" && !options?.showFullLinuxUi) return false;
  return (TAB_ORDER as string[]).includes(value);
}

/** Build the per-tab meta (localized). Memoize on `t` so the index only
 *  rebuilds when the language changes. */
export function useSettingsCatalog(
  t: (key: string, vars?: Record<string, unknown>) => string,
  options?: { showFullLinuxUi?: boolean },
) {
  return useMemo(
    () => buildSettingsCatalog(t, options),
    [t, options?.showFullLinuxUi],
  );
}

export function buildSettingsCatalog(
  t: (key: string, vars?: Record<string, unknown>) => string,
  options?: { showFullLinuxUi?: boolean },
) {
  const showFullLinuxUi = options?.showFullLinuxUi ?? false;
  const meta: Record<SettingsTab, TabMeta> = {
    overview: {
      tab: "overview",
      labelKey: "settings.nav.overview",
      descKey: "settings.overview.desc",
      keywords:
        "start here welcome setup checklist onboarding first run progress getting started stores connected library import recommended",
      icon: <RocketIcon />,
      sections: [
        {
          id: "overview-setup",
          labelKey: "settings.overview.setupTitle",
          keywords: "setup checklist steps progress onboarding finish configure",
          icon: <RocketIcon />,
        },
        {
          id: "overview-stores",
          labelKey: "settings.overview.storesTitle",
          keywords: "stores accounts steam epic gog humble battlenet ea xbox itch connect import library",
          icon: <IntegrationsIcon />,
        },
        {
          id: "overview-status",
          labelKey: "settings.overview.statusTitle",
          keywords: "version update library size downloads folder overlay status at a glance",
          icon: <GaugeIcon />,
        },
        {
          id: "overview-help",
          labelKey: "settings.overview.helpTitle",
          keywords: "help guide documentation setup wizard diagnostics support",
          icon: <GlobeIcon />,
        },
      ],
    },
    general: {
      tab: "general",
      labelKey: "settings.nav.general",
      descKey: "settings.general.desc",
      keywords:
        "language locale interface display update controller gamepad linux proton steam deck wine setup wizard",
      icon: <GlobeIcon />,
      sections: [
        {
          id: "general-language",
          labelKey: "settings.language",
          keywords:
            "language locale interface display english deutsch francais espanol russian chinese",
          settings: [
            { id: "setting-language", labelKey: "settings.language" },
          ],
        },
        {
          id: "general-setup",
          labelKey: "settingsPage.setupTitle",
          keywords: "setup wizard guided tour onboarding review language theme connections downloads",
        },
        {
          id: "general-updates",
          labelKey: "updater.title",
          keywords:
            "update updater version auto check github install release changelog",
          settings: [
            { id: "setting-auto-check-updates", labelKey: "updater.autoCheck" },
            { id: "setting-check-updates", labelKey: "updater.checkForUpdates" },
            { id: "setting-changelog", labelKey: "updater.changelog" },
          ],
        },
        {
          id: "general-gamepad",
          labelKey: "settings.section.gamepad",
          keywords:
            "gamepad controller deadzone stick sensitivity big screen couch drift",
          essential: false,
          settings: [
            { id: "setting-left-deadzone", labelKey: "settings.gamepad.leftDeadzone" },
            { id: "setting-right-deadzone", labelKey: "settings.gamepad.rightDeadzone" },
          ],
        },
        {
          id: "general-linux",
          labelKey: "settings.linux.title",
          keywords:
            "linux steam deck proton protondb wine compatibility verified runners prefix",
          essential: false,
        },
      ],
    },
    interface: {
      tab: "interface",
      labelKey: "settings.nav.interface",
      descKey: "settings.interface.desc",
      keywords:
        "interface visibility show hide navbar tabs buttons badges overlays widgets kpi filters subtabs clutter declutter simple complete layout scale density detail sections layout studio preview drag rearrange sidebar now playing card landing page startup",
      icon: <ListIcon />,
      sections: [
        {
          id: "interface-studio",
          labelKey: "settings.interface.studioTitle",
          keywords:
            "layout studio preview drag rearrange reorder hide show navbar tabs buttons sidebar sections widgets hero detail tabs card badges now playing scale zoom search inspector switch undo guide preset",
          essential: false,
        },
        {
          id: "interface-defaults-layout",
          labelKey: "settings.interface.globalAppearance",
          keywords:
            "global appearance interface scale scaling zoom simple ui mode compact navigation bar command palette dynamic game art backdrop ambient display density",
          settings: [
            { id: "setting-ui-scale", labelKey: "settings.appearance.uiScaleTitle" },
            { id: "setting-simple-ui", labelKey: "settings.appearance.simpleUiTitle" },
            { id: "setting-card-badges", labelKey: "settings.appearance.cardBadgesTitle" },
            {
              id: "setting-art-backdrop",
              labelKey: "settings.appearance.artBackdropTitle",
            },
          ],
        },
        {
          id: "interface-defaults-detail-sections",
          labelKey: "settings.detailSections.title",
          keywords:
            "detail sections overview steam features system requirements game relations time to beat protondb releases reviews activity notes achievements mods weblinks news",
          essential: false,
        },
      ],
    },
    appearance: {
      tab: "appearance",
      labelKey: "settings.nav.appearance",
      descKey: "settings.appearance.desc",
      keywords:
        "theme accent color display palette splash screen startup launch boot big screen tv layout motion animation sound",
      icon: <PaletteIcon />,
      sections: [
        {
          id: "appearance-ui-styles",
          labelKey: "settings.section.appearanceStyles",
          keywords:
            "style materials buttons geometry glass flat material design shape square rounded",
          settings: [
            { id: "setting-ui-style", labelKey: "settings.section.appearanceStyles" },
          ],
        },
        {
          id: "appearance-bigscreen",
          labelKey: "bigscreen.system.layoutStyle",
          keywords:
            "big screen tv couch layout preset xbox steam playstation switch classic navigation nav visibility tv mode ten foot",
          essential: false,
        },
        {
          id: "appearance-themes",
          labelKey: "settings.section.appearanceThemes",
          keywords:
            "theme dark light color scheme system sync auto game palette style material",
          settings: [
            { id: "setting-theme", labelKey: "settings.section.appearanceThemes" },
          ],
        },
        {
          id: "appearance-accent",
          labelKey: "settings.label.accent",
          keywords: "accent color custom swatch tint highlight preset",
          settings: [{ id: "setting-accent", labelKey: "settings.label.accent" }],
        },
        {
          id: "appearance-motion",
          labelKey: "settings.appearance.motionTitle",
          keywords:
            "motion reduce animations transitions accessibility speed instant animated media gif webp apng covers autoplay video trailers",
          essential: false,
        },
        {
          id: "appearance-sound",
          labelKey: "settings.sound.sectionTitle",
          keywords: "sound audio volume feedback effects clicks chime mute",
          essential: false,
          settings: [
            { id: "setting-sound-enabled", labelKey: "settings.sound.sectionTitle" },
          ],
        },
        {
          id: "appearance-splash",
          labelKey: "settings.section.appearanceSplash",
          keywords:
            "splash screen startup boot launch animation intro game progress disable hide",
          essential: false,
        },
      ],
    },
    hardware: {
      tab: "hardware",
      labelKey: "settings.nav.hardware",
      descKey: "settings.hardware.sectionDesc",
      keywords: "gpu cpu ram monitor telemetry temperature metrics sensors",
      icon: <HardwareIcon />,
      sections: [
        {
          id: "hw-detected",
          labelKey: "settings.hardware.subsectionDetected",
          keywords:
            "cpu processor ram memory gpu graphics card system info detected hardware",
        },
        {
          id: "hw-telemetry",
          labelKey: "settings.hardware.subsectionTelemetry",
          keywords:
            "fps frame rate monitoring metrics capture cpu load gpu load temperature sampling interval overhead",
          settings: [
            { id: "setting-telemetry", labelKey: "settings.hardware.subsectionTelemetry" },
          ],
        },
        {
          id: "hw-display",
          labelKey: "settings.hardware.subsectionDisplay",
          keywords:
            "units temperature celsius fahrenheit size storage gb gib decimal binary speed unit mbit mbps mo/s octets bits",
          settings: [
            { id: "setting-temp-unit", labelKey: "settings.hardware.subsectionDisplay" },
          ],
        },
      ],
    },
    integrations: {
      tab: "integrations",
      labelKey: "settings.nav.integrations",
      descKey: "settings.integrations.desc",
      keywords:
        "steam epic gog humble rockstar ubisoft connect sync store library battlenet battle.net blizzard ea origin xbox microsoft store itch.io itch beta experimental account login",
      icon: <IntegrationsIcon />,
      sections: [
        {
          id: "integration-steam",
          labelKey: "settings.integration.steam",
          keywords:
            "steam connect sync login library api key steamid achievements playtime",
        },
        {
          id: "integration-epic",
          labelKey: "settings.integration.epicGames",
          keywords: "epic games store connect sync login library playtime",
        },
        {
          id: "integration-gog",
          labelKey: "settings.integration.gogGalaxy",
          keywords: "gog galaxy connect sync login library playtime cookie",
        },
        {
          id: "integration-humble",
          labelKey: "settings.integration.humbleBundle",
          keywords: "humble bundle connect sync login purchases extras",
        },
        {
          id: "integration-rockstar",
          labelKey: "settings.integration.rockstarGamesLauncher",
          keywords: "rockstar games launcher scan gta red dead installed registry",
        },
        {
          id: "integration-uplay",
          labelKey: "settings.integration.ubisoftConnect",
          keywords: "ubisoft connect uplay scan registry import installed",
        },
        {
          id: "integration-battlenet",
          labelKey: "settings.integration.battleNet",
          keywords:
            "battle.net battlenet blizzard connect sync login library beta experimental",
        },
        {
          id: "integration-ea",
          labelKey: "settings.integration.ea",
          keywords:
            "ea app origin electronic arts connect sync login library beta experimental",
        },
        {
          id: "integration-xbox",
          labelKey: "settings.integration.xbox",
          keywords:
            "xbox microsoft store gamepass connect sync login library beta experimental",
        },
        {
          id: "integration-itch",
          labelKey: "settings.integration.itch",
          keywords:
            "itch.io itch indie connect sync login library beta experimental",
        },
        {
          id: "section-mods",
          labelKey: "settings.mods.title",
          keywords:
            "nexus mods curseforge modio api key account login token mod sites mod manager download update modding",
          essential: false,
        },
        {
          id: "section-retro",
          labelKey: "settings.retro.title",
          keywords:
            "retro achievements retroachievements emulator rom hash console mapping",
          essential: false,
        },
        {
          id: "section-datasync",
          labelKey: "settings.section.dataSync",
          keywords:
            "auto sync interval history retention achievements spoilers local tracking",
          essential: false,
        },
      ],
    },
    discord: {
      tab: "discord",
      labelKey: "settings.nav.discord",
      descKey: "settings.discord.tabDesc",
      keywords:
        "discord rich presence playing status activity cover art playtime website button privacy browsing",
      icon: <DiscordIcon />,
      sections: [
        {
          id: "discord-general",
          labelKey: "settings.discord.groupGeneral",
          keywords: "enable toggle master status running connection discord open",
          settings: [
            { id: "setting-discord-enabled", labelKey: "settings.discord.title" },
            {
              id: "setting-discord-status-display",
              labelKey: "settings.discord.statusDisplayTitle",
            },
          ],
        },
        {
          id: "discord-playing",
          labelKey: "settings.discord.groupPlaying",
          keywords:
            "cover art poster large image playtime elapsed session timer website button link achievements store",
          essential: false,
        },
        {
          id: "discord-browsing",
          labelKey: "settings.discord.groupBrowsing",
          keywords: "browsing activity page privacy hide where browsing downloads",
          essential: false,
        },
      ],
    },
    downloads: {
      tab: "downloads",
      labelKey: "settings.nav.downloads",
      descKey: "settings.downloads.desc",
      keywords:
        "download save path speed limit debrid torrent bandwidth directory location seeding queue",
      icon: <DownloadIcon />,
      sections: [
        {
          id: "downloads-location",
          labelKey: "settings.section.downloadLocation",
          keywords:
            "save path folder default always ask where downloads go directory storage location",
          icon: <FolderIcon />,
          settings: [
            { id: "setting-download-path", labelKey: "settings.section.downloadLocation" },
            { id: "setting-always-ask-path", labelKey: "settings.downloads.askSaveLocation" },
          ],
        },
        {
          id: "downloads-notifications",
          labelKey: "settings.section.notifications",
          keywords:
            "notify notification toast desktop complete finish alert os system",
          icon: <BellIcon />,
          settings: [
            { id: "setting-notify-complete", labelKey: "settings.downloads.showToast" },
          ],
        },
        {
          id: "downloads-bandwidth",
          labelKey: "settings.section.bandwidth",
          keywords:
            "speed limit download upload seed kbps disable upload bandwidth throttling queue speed unit mbit mbps mo/s octets bits seeding ratio",
          icon: <GaugeIcon />,
          settings: [
            { id: "setting-download-limit", labelKey: "settings.downloads.limitDownload" },
            { id: "setting-upload-limit", labelKey: "settings.downloads.limitUpload" },
          ],
        },
        {
          id: "downloads-engine",
          labelKey: "settings.section.downloadEngine",
          keywords:
            "engine connections segments multi connection installer post action after download move extract",
          essential: false,
          settings: [
            { id: "setting-multi-connection", labelKey: "settings.downloads.multiConnection" },
          ],
        },
        {
          id: "downloads-blocked",
          labelKey: "settings.section.blockedDomains",
          keywords: "block domain filter blacklist tracker blocklist domains ignore",
          icon: <ShieldIcon />,
          essential: false,
        },
        {
          id: "downloads-debrid",
          labelKey: "settings.section.debrid",
          keywords:
            "debrid alldebrid torbox api key token magnet direct download unrestrict hoster premium",
          icon: <CloudIcon />,
          essential: false,
        },
      ],
    },
    plugins: {
      tab: "plugins",
      labelKey: "settings.nav.plugins",
      descKey: "settings.plugins.desc",
      keywords:
        "plugin extension script javascript import install enable disable trusted third party search provider",
      icon: <PluginIcon />,
      sections: [
        {
          id: "plugins-import",
          labelKey: "settings.section.pluginsImport",
          keywords: "import install add plugin file js script trust verify hash sha256",
          icon: <PluginIcon />,
        },
        {
          id: "plugins-installed",
          labelKey: "settings.section.pluginsInstalled",
          keywords: "installed plugins list enable disable remove toggle uninstall error",
          icon: <ListIcon />,
        },
      ],
    },
    launcher: {
      tab: "launcher",
      labelKey: "settings.nav.launcher",
      descKey: "settings.launcher.desc",
      keywords: "startup launch tray autostart uac window minimize restore elevation",
      icon: <RocketIcon />,
      sections: [
        {
          id: "launcher-startup",
          labelKey: "settings.launcher.groupStartup",
          keywords: "landing page boot start home page autostart sign in",
          settings: [
            { id: "setting-landing-page", labelKey: "settings.launcher.landingTitle" },
            { id: "setting-autostart", labelKey: "settings.launcher.autostartTitle" },
          ],
        },
        {
          id: "launcher-window",
          labelKey: "settings.launcher.groupWindow",
          keywords: "tray minimize close restore window game launch background",
          settings: [
            { id: "setting-close-to-tray", labelKey: "settings.launcher.trayTitle" },
            {
              id: "setting-minimize-on-launch",
              labelKey: "settings.launcher.minimizeTitle",
            },
            { id: "setting-restore-on-exit", labelKey: "settings.launcher.restoreTitle" },
          ],
        },
        {
          id: "launcher-elevation",
          labelKey: "settings.launcher.groupSystem",
          keywords: "uac elevation admin administrator prompt bypass permission",
          essential: false,
          settings: [
            { id: "setting-uac", labelKey: "settings.launcher.uacTitle" },
          ],
        },
      ],
    },
    privacy: {
      tab: "privacy",
      labelKey: "settings.nav.privacy",
      descKey: "settings.wipe.desc",
      keywords:
        "wipe clear local storage cache data reset privacy friends notifications read receipts adblock cookies",
      icon: <TrashIcon />,
      sections: [
        {
          id: "privacy-friends",
          labelKey: "settings.section.friends",
          keywords:
            "friends notifications desktop alerts read receipts dm messages presence privacy",
          icon: <BellIcon />,
        },
        {
          id: "privacy-browsing",
          labelKey: "settings.section.browsing",
          keywords:
            "adblock ads ad blocker cookie consent banner gdpr trackers webview preview weblinks news filter privacy",
          icon: <ShieldIcon />,
          essential: false,
        },
        {
          id: "privacy-storage",
          labelKey: "settings.section.wipeData",
          keywords: "local storage wipe clear delete reset data cache items",
        },
      ],
    },
    backup: {
      tab: "backup",
      labelKey: "settings.nav.backup",
      descKey: "settings.backup.desc",
      keywords:
        "backup restore export import save snapshot archive gibak games library playtime sessions activity achievements settings",
      icon: <BackupIcon />,
      sections: [
        {
          id: "backup-overview",
          labelKey: "settings.backup.subtab.overview",
          keywords:
            "overview last backup contents summary what is included size databases archives snapshots storage",
        },
        {
          id: "backup-create",
          labelKey: "settings.backup.subtab.create",
          keywords:
            "create backup export save snapshot archive file gibak presets quick",
        },
        {
          id: "backup-restore",
          labelKey: "settings.backup.subtab.restore",
          keywords:
            "restore import recover load backup archive gibak replace merge inspect safety drag drop",
        },
        {
          id: "backup-settings",
          labelKey: "settings.backup.subtab.settings",
          keywords:
            "storage automation backup folder directory auto exit retention schedule prune rules",
          essential: false,
        },
      ],
    },
    saves: {
      tab: "saves",
      labelKey: "settings.nav.saves",
      descKey: "settings.saves.desc",
      keywords:
        "save saves backup backups snapshot restore version history autosave steam cloud proton prefix emulator retention",
      icon: <BackupIcon />,
      sections: [
        {
          id: "saves-feature",
          labelKey: "saves.settings.title",
          keywords:
            "enable toggle auto backup on exit game exit safety snapshot before restore emulator saves",
          icon: <ShieldIcon />,
        },
        {
          id: "saves-storage",
          labelKey: "saves.settings.storageTitle",
          keywords:
            "backup folder directory location retention keep ignore patterns exclude globs",
          icon: <FolderIcon />,
        },
        {
          id: "saves-maintenance",
          labelKey: "saves.settings.maintenanceTitle",
          keywords:
            "scan library back up all total size count snapshot statistics",
          icon: <BackupIcon />,
          essential: false,
        },
      ],
    },
    diagnostics: {
      tab: "diagnostics",
      labelKey: "settings.nav.diagnostics",
      descKey: "settings.diagnostics.desc",
      keywords:
        "diagnostics crash log report error debug troubleshooting system report version copy export open folder support bug",
      icon: <DiagnosticsIcon />,
      sections: [
        {
          id: "diagnostics-crash",
          labelKey: "settings.diagnostics.crashTitle",
          keywords:
            "crash log report error panic exception backtrace stack trace debug dump txt",
          icon: <DiagnosticsIcon />,
        },
        {
          id: "diagnostics-system",
          labelKey: "settings.diagnostics.systemTitle",
          keywords:
            "system report version os cpu ram gpu hardware info support copy clipboard",
          icon: <HardwareIcon />,
        },
      ],
    },
    overlay: {
      tab: "overlay",
      labelKey: "settings.nav.overlay",
      descKey: "settings.overlay.desc",
      keywords:
        "overlay hud in-game ticker panel hotkey fps cpu gpu telemetry click-through corner opacity widgets notes achievements downloads notifications",
      icon: <OverlayIcon />,
      sections: [
        {
          id: "overlay-general",
          labelKey: "settings.overlay.sectionGeneral",
          keywords:
            "enable hotkey shortcut toggle corner position opacity transparent click-through always on top",
          settings: [
            { id: "setting-overlay-enabled", labelKey: "settings.overlay.enable" },
          ],
        },
        {
          id: "overlay-accessibility",
          labelKey: "overlay.settings.accessibility",
          keywords:
            "accessibility high contrast text scale readable large font visibility colour blind",
          essential: false,
        },
        {
          id: "overlay-capture",
          labelKey: "settings.overlay.sectionCapture",
          keywords:
            "screenshot capture record video replay buffer bitrate fps resolution folder microphone audio png jpg hotkey",
          essential: false,
          settings: [
            { id: "setting-screenshot-hotkey", labelKey: "settings.overlay.sectionCapture" },
          ],
        },
        {
          id: "overlay-widgets",
          labelKey: "settings.overlay.sectionWidgets",
          keywords:
            "ticker panel widgets fps cpu gpu session achievements downloads notifications notes",
          essential: false,
        },
      ],
    },
    compatibility: {
      tab: "compatibility",
      labelKey: "settings.nav.compatibility",
      descKey: "settings.tab.compatibility.desc",
      keywords:
        "linux wine proton dxvk vkd3d esync fsync mangohud gamemode gamescope runner prefix compatibility dll overrides umu launcher steam runtime controller gamepad sdl anticheat eac battleye",
      icon: <CompatibilityIcon />,
      sections: [
        {
          id: "compat-runners",
          labelKey: "settings.compatibility.sectionRunners",
          keywords:
            "runner wine proton default path prefix directory custom scan version wow64",
        },
        {
          id: "compat-prefixes",
          labelKey: "compatibility.subtabPrefixes",
          keywords:
            "wineprefix prefix pfx drive_c win32 win64 create clean winecfg winetricks regedit taskmgr duplicate backup restore delete",
        },
        {
          id: "compat-graphics",
          labelKey: "settings.compatibility.sectionGraphics",
          keywords:
            "dxvk vkd3d descriptor heap directx vulkan nvapi dlss hud graphics d3d async virtual desktop",
          essential: false,
        },
        {
          id: "compat-sync-engine",
          labelKey: "compatibility.subtabSyncEngine",
          keywords:
            "sync esync fsync ntsync winesync wineland wayland native wow64 large address debug audio driver",
          essential: false,
        },
        {
          id: "compat-gamescope",
          labelKey: "compatibility.subtabGamescope",
          keywords:
            "gamescope microcompositor resolution fsr nis scaling filter sharpness fps refresh rate hdr vrr adaptive sync",
          essential: false,
        },
        {
          id: "compat-tools",
          labelKey: "settings.compatibility.sectionTools",
          keywords:
            "mangohud hide hidden umu launcher steam runtime gamemode overlay governor prime offload discrete gpu",
        },
        {
          id: "compat-env",
          labelKey: "settings.compatibility.sectionEnv",
          keywords:
            "environment variables dll overrides custom prefix wrapper env key value",
          essential: false,
        },
        {
          id: "compat-system",
          labelKey: "settings.compatibility.sectionSystem",
          keywords:
            "system diagnostics linux wayland x11 vulkan winetricks kill wineserver processes winecfg regedit taskmgr",
          essential: false,
        },
      ],
    },
  };

  /** Rail groups — tabs only, ordered from "first thing a new user needs"
   *  to "things you fix once something breaks". */
  const groups: SettingsNavGroup[] = [
    {
      id: "start",
      label: t("settings.group.start"),
      icon: <RocketIcon />,
      items: [
        {
          tab: "overview",
          label: t("settings.nav.overview"),
          hint: t("settings.nav.overview.hint"),
          icon: <RocketIcon />,
        },
      ],
    },
    {
      id: "stores",
      label: t("settings.group.stores"),
      icon: <IntegrationsIcon />,
      items: [
        {
          tab: "integrations",
          label: t("settings.nav.integrations"),
          hint: t("settings.nav.integrations.hint"),
          icon: <IntegrationsIcon />,
        },
        {
          tab: "discord",
          label: t("settings.nav.discord"),
          hint: t("settings.nav.discord.hint"),
          icon: <DiscordIcon />,
        },
      ],
    },
    {
      id: "look",
      label: t("settings.group.look"),
      icon: <PaletteIcon />,
      items: [
        {
          tab: "appearance",
          label: t("settings.nav.appearance"),
          hint: t("settings.nav.appearance.hint"),
          icon: <PaletteIcon />,
        },
        {
          tab: "interface",
          label: t("settings.nav.interface"),
          hint: t("settings.nav.interface.hint"),
          icon: <ListIcon />,
        },
      ],
    },
    {
      id: "gameplay",
      label: t("settings.group.gameplay"),
      icon: <OverlayIcon />,
      items: [
        {
          tab: "launcher",
          label: t("settings.nav.launcher"),
          hint: t("settings.nav.launcher.hint"),
          icon: <RocketIcon />,
        },
        {
          tab: "overlay",
          label: t("settings.nav.overlay"),
          hint: t("settings.nav.overlay.hint"),
          icon: <OverlayIcon />,
        },
        {
          tab: "saves",
          label: t("settings.nav.saves"),
          hint: t("settings.nav.saves.hint"),
          icon: <BackupIcon />,
        },
        ...(showFullLinuxUi
          ? [
              {
                tab: "compatibility" as const,
                label: t("settings.nav.compatibility"),
                hint: t("settings.nav.compatibility.hint"),
                icon: <CompatibilityIcon />,
              },
            ]
          : []),
      ],
    },
    {
      id: "downloads",
      label: t("settings.group.downloads"),
      icon: <DownloadIcon />,
      items: [
        {
          tab: "downloads",
          label: t("settings.nav.downloads"),
          hint: t("settings.nav.downloads.hint"),
          icon: <DownloadIcon />,
        },
        {
          tab: "plugins",
          label: t("settings.nav.plugins"),
          hint: t("settings.nav.plugins.hint"),
          icon: <PluginIcon />,
        },
      ],
    },
    {
      id: "system",
      label: t("settings.group.system"),
      icon: <SettingsGearIcon />,
      items: [
        {
          tab: "general",
          label: t("settings.nav.general"),
          hint: t("settings.nav.general.hint"),
          icon: <GlobeIcon />,
        },
        {
          tab: "hardware",
          label: t("settings.nav.hardware"),
          hint: t("settings.nav.hardware.hint"),
          icon: <HardwareIcon />,
        },
        {
          tab: "privacy",
          label: t("settings.nav.privacy"),
          hint: t("settings.nav.privacy.hint"),
          icon: <TrashIcon />,
        },
        {
          tab: "backup",
          label: t("settings.nav.backup"),
          hint: t("settings.nav.backup.hint"),
          icon: <BackupIcon />,
        },
        {
          tab: "diagnostics",
          label: t("settings.nav.diagnostics"),
          hint: t("settings.nav.diagnostics.hint"),
          icon: <DiagnosticsIcon />,
        },
      ],
    },
  ];

  // Group id → localized label, for search breadcrumbs.
  const groupLabel: Record<string, string> = Object.fromEntries(
    groups.map((g) => [g.id, g.label]),
  );

  /** Flat search index: every tab, section and indexed setting, in display
   *  order. Settings resolve to their section anchor so a jump always
   *  lands somewhere real. */
  const searchIndex: SettingsSearchEntry[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      const tabMeta = meta[item.tab];
      searchIndex.push({
        id: item.tab,
        tab: item.tab,
        kind: "tab",
        label: item.label,
        crumb: groupLabel[group.id],
        keywords: tabMeta.keywords,
        icon: item.icon,
      });
      for (const section of tabMeta.sections) {
        const sectionLabel = t(section.labelKey);
        searchIndex.push({
          id: section.id,
          tab: tabMeta.tab,
          kind: "section",
          label: sectionLabel,
          crumb: `${groupLabel[group.id]} › ${item.label}`,
          keywords: `${section.keywords} ${sectionLabel}`,
          icon: section.icon,
          sectionId: section.id,
        });
        for (const setting of section.settings ?? []) {
          const settingLabel = t(setting.labelKey);
          searchIndex.push({
            id: setting.id,
            tab: tabMeta.tab,
            kind: "setting",
            label: settingLabel,
            crumb: `${item.label} › ${sectionLabel}`,
            keywords: `${setting.keywords ?? ""} ${settingLabel} ${section.keywords}`,
            icon: section.icon,
            sectionId: setting.section ?? section.id,
          });
        }
      }
    }
  }

  const tabOrder: SettingsTab[] = showFullLinuxUi
    ? TAB_ORDER
    : TAB_ORDER.filter((tab) => tab !== "compatibility");

  return { meta, groups, searchIndex, tabOrder };
}

export type SettingsCatalog = ReturnType<typeof buildSettingsCatalog>;

/** Which rail group owns each tab. Kept next to the group definitions so a
 *  moved tab is a one-line change here instead of a chain of ifs. */
const TAB_GROUP: Record<SettingsTab, string> = {
  overview: "start",
  integrations: "stores",
  discord: "stores",
  appearance: "look",
  interface: "look",
  launcher: "gameplay",
  overlay: "gameplay",
  saves: "gameplay",
  compatibility: "gameplay",
  downloads: "downloads",
  plugins: "downloads",
  general: "system",
  hardware: "system",
  privacy: "system",
  backup: "system",
  diagnostics: "system",
};

/** Find which rail group owns a given settings tab. */
export function getCategoryForTab(tab: SettingsTab): string {
  return TAB_GROUP[tab] ?? "system";
}
