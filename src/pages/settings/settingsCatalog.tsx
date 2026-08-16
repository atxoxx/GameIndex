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
} from "./settingsIcons";

/**
 * settingsCatalog — the single source of truth for the settings page's
 * information architecture. One file owns:
 *
 *  - the tab order + per-tab label/description/icon (drives the header),
 *  - the sidebar groups (drives navigation),
 *  - every section inside every tab with its anchor id + keywords
 *    (drives the in-tab jump bar AND the cross-tab search index).
 *
 * Anything added to the catalog automatically appears in the sidebar,
 * the jump bar and the search results — there is no second list to keep
 * in sync. Labels are resolved through `t()` at build time, so the
 * index always matches the user's display language.
 */

interface TabMeta {
  tab: SettingsTab;
  labelKey: string;
  descKey: string;
  keywords: string;
  icon: ReactNode;
  sections: SettingsSectionDef[];
}

const TAB_ORDER: SettingsTab[] = [
  "general",
  "appearance",
  "hardware",
  "integrations",
  "downloads",
  "plugins",
  "launcher",
  "privacy",
];

export const SETTINGS_TABS: readonly SettingsTab[] = TAB_ORDER;

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return value !== undefined && (TAB_ORDER as string[]).includes(value);
}

/** Build the per-tab meta (localized). Memoize on `t` so the index only
 *  rebuilds when the language changes. */
export function useSettingsCatalog(t: (key: string, vars?: Record<string, unknown>) => string) {
  return useMemo(() => buildSettingsCatalog(t), [t]);
}

export function buildSettingsCatalog(t: (key: string, vars?: Record<string, unknown>) => string) {
  const meta: Record<SettingsTab, TabMeta> = {
    general: {
      tab: "general",
      labelKey: "settings.general",
      descKey: "settings.general.desc",
      keywords: "language locale interface display update controller gamepad",
      icon: <GlobeIcon />,
      sections: [
        {
          id: "general-language",
          labelKey: "settings.language",
          keywords: "language locale interface display english deutsch francais espanol",
        },
        {
          id: "general-updates",
          labelKey: "updater.title",
          keywords: "update updater version auto check github install release",
        },
        {
          id: "general-gamepad",
          labelKey: "settings.section.gamepad",
          keywords: "gamepad controller deadzone stick sensitivity big screen couch",
        },
      ],
    },
    appearance: {
      tab: "appearance",
      labelKey: "settings.appearance",
      descKey: "settings.appearance.desc",
      keywords: "theme accent color display palette",
      icon: <PaletteIcon />,
      sections: [
        {
          id: "appearance-themes",
          labelKey: "settings.section.appearanceThemes",
          keywords: "theme dark light color scheme system sync auto game palette",
        },
        {
          id: "appearance-accent",
          labelKey: "settings.label.accent",
          keywords: "accent color custom swatch tint highlight preset",
        },
      ],
    },
    hardware: {
      tab: "hardware",
      labelKey: "settings.tab.hardware",
      descKey: "settings.hardware.sectionDesc",
      keywords: "gpu cpu ram monitor telemetry temperature metrics",
      icon: <HardwareIcon />,
      sections: [
        {
          id: "hw-detected",
          labelKey: "settings.hardware.subsectionDetected",
          keywords: "cpu processor ram memory gpu graphics card system info detected hardware",
        },
        {
          id: "hw-telemetry",
          labelKey: "settings.hardware.subsectionTelemetry",
          keywords: "fps frame rate monitoring metrics capture cpu load gpu load temperature sampling interval overhead",
        },
        {
          id: "hw-display",
          labelKey: "settings.hardware.subsectionDisplay",
          keywords: "units temperature celsius fahrenheit size storage gb gib decimal binary",
        },
      ],
    },
    integrations: {
      tab: "integrations",
      labelKey: "settings.tab.integrations",
      descKey: "settings.integrations.desc",
      keywords: "steam epic gog humble rockstar ubisoft connect sync store library",
      icon: <IntegrationsIcon />,
      sections: [
        {
          id: "integration-steam",
          labelKey: "settings.integration.steam",
          keywords: "steam connect sync login library api key steamid achievements playtime",
        },
        {
          id: "integration-epic",
          labelKey: "settings.integration.epicGames",
          keywords: "epic games store connect sync login library playtime",
        },
        {
          id: "integration-gog",
          labelKey: "settings.integration.gogGalaxy",
          keywords: "gog galaxy connect sync login library playtime",
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
          id: "section-datasync",
          labelKey: "settings.section.dataSync",
          keywords: "auto sync interval history retention achievements spoilers local tracking",
        },
        {
          id: "section-retro",
          labelKey: "settings.retro.title",
          keywords: "retro achievements retroachievements emulator rom hash console mapping",
        },
      ],
    },
    downloads: {
      tab: "downloads",
      labelKey: "nav.downloads",
      descKey: "settings.downloads.desc",
      keywords: "download save path speed limit debrid torrent bandwidth directory location",
      icon: <DownloadIcon />,
      sections: [
        {
          id: "downloads-location",
          labelKey: "settings.section.downloadLocation",
          keywords: "save path folder default always ask where downloads go directory storage location",
          icon: <FolderIcon />,
        },
        {
          id: "downloads-notifications",
          labelKey: "settings.section.notifications",
          keywords: "notify notification toast desktop complete finish alert os system",
          icon: <BellIcon />,
        },
        {
          id: "downloads-bandwidth",
          labelKey: "settings.section.bandwidth",
          keywords: "speed limit download upload seed kbps disable upload bandwidth throttling queue",
          icon: <GaugeIcon />,
        },
        {
          id: "downloads-blocked",
          labelKey: "settings.section.blockedDomains",
          keywords: "block domain filter blacklist tracker blocklist domains ignore",
          icon: <ShieldIcon />,
        },
        {
          id: "downloads-debrid",
          labelKey: "settings.section.debrid",
          keywords: "debrid alldebrid torbox api key token magnet direct download unrestrict hoster",
          icon: <CloudIcon />,
        },
      ],
    },
    plugins: {
      tab: "plugins",
      labelKey: "settings.tab.plugins",
      descKey: "settings.plugins.desc",
      keywords: "plugin extension script javascript import install enable disable trusted third party search provider",
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
      labelKey: "settings.tab.launcher",
      descKey: "settings.launcher.desc",
      keywords: "startup launch tray autostart uac discord window",
      icon: <RocketIcon />,
      sections: [
        {
          id: "launcher-startup",
          labelKey: "settings.launcher.groupStartup",
          keywords: "landing page boot start home page autostart sign in",
        },
        {
          id: "launcher-window",
          labelKey: "settings.launcher.groupWindow",
          keywords: "tray minimize close restore window game launch background",
        },
        {
          id: "launcher-elevation",
          labelKey: "settings.launcher.groupSystem",
          keywords: "uac elevation admin administrator prompt bypass permission",
        },
        {
          id: "launcher-presence",
          labelKey: "settings.launcher.groupPresence",
          keywords: "discord rich presence playing status activity",
        },
      ],
    },
    privacy: {
      tab: "privacy",
      labelKey: "settings.tab.privacy",
      descKey: "settings.wipe.desc",
      keywords: "wipe clear local storage cache data reset privacy",
      icon: <TrashIcon />,
      sections: [
        {
          id: "privacy-storage",
          labelKey: "settings.section.wipeData",
          keywords: "local storage wipe clear delete reset data cache items",
        },
      ],
    },
  };

  /** Sidebar groups — tabs only. */
  const groups: SettingsNavGroup[] = [
    {
      id: "personalize",
      label: t("settings.group.personalize"),
      items: [
        { tab: "general", label: t("settings.general"), icon: <GlobeIcon /> },
        { tab: "appearance", label: t("settings.appearance"), icon: <PaletteIcon /> },
        { tab: "hardware", label: t("settings.tab.hardware"), icon: <HardwareIcon /> },
      ],
    },
    {
      id: "connections",
      label: t("settings.group.connections"),
      items: [
        {
          tab: "integrations",
          label: t("settings.tab.integrations"),
          icon: <IntegrationsIcon />,
        },
      ],
    },
    {
      id: "downloads",
      label: t("settings.group.downloads"),
      items: [
        { tab: "downloads", label: t("nav.downloads"), icon: <DownloadIcon /> },
        { tab: "plugins", label: t("settings.tab.plugins"), icon: <PluginIcon /> },
      ],
    },
    {
      id: "system",
      label: t("settings.group.system"),
      items: [
        { tab: "launcher", label: t("settings.tab.launcher"), icon: <RocketIcon /> },
        { tab: "privacy", label: t("settings.tab.privacy"), icon: <TrashIcon /> },
      ],
    },
  ];

  // Group id → localized label, for search breadcrumbs.
  const groupLabel: Record<string, string> = Object.fromEntries(
    groups.map((g) => [g.id, g.label]),
  );

  /** Flat search index: every tab + every section, in display order. */
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
        searchIndex.push({
          id: section.id,
          tab: tabMeta.tab,
          kind: "section",
          label: t(section.labelKey),
          crumb: `${groupLabel[group.id]} › ${item.label}`,
          keywords: `${section.keywords} ${t(section.labelKey)}`,
          icon: section.icon,
        });
      }
    }
  }

  return { meta, groups, searchIndex, tabOrder: TAB_ORDER };
}

export type SettingsCatalog = ReturnType<typeof buildSettingsCatalog>;
