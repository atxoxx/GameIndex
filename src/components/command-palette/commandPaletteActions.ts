import { createElement } from "react";
import type { NavigateFunction } from "react-router-dom";
import {
  Activity,
  BookOpen,
  Camera,
  Check,
  Compass,
  Download,
  ExternalLink,
  Gamepad2,
  HardDrive,
  Heart,
  Languages,
  Layers,
  LayoutGrid,
  Monitor,
  MonitorPlay,
  Palette,
  Pause,
  Play,
  PlaySquare,
  Puzzle,
  RefreshCw,
  Rss,
  Settings,
  Shield,
  Sparkles,
  Store,
  Tag,
  Trash2,
  Trophy,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { PaletteItem } from "./commandPaletteTypes";
import { THEME_COLORS, clearRecentItems } from "./commandPaletteUtils";
import type { ThemeConfig } from "../../context/ThemeContext";
import type { ViewDensity } from "../../types/game";

export interface CreateActionsParams {
  navigate: NavigateFunction;
  onClose: () => void;
  showToast: (message: string, type?: "success" | "error" | "info" | "warning") => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  isBigScreen: boolean;
  setBigScreen: (val: boolean) => void;
  uiSoundEnabled: boolean;
  setUiSoundEnabled: (val: boolean) => void;
  uiSoundVolume: number;
  setUiSoundVolume: (val: number) => void;
  isSidebarRail?: boolean;
  toggleSidebarRail?: () => void;
  currentDensity?: ViewDensity;
  setDensity?: (density: ViewDensity) => void;
  currentLanguage: string;
  setLanguage: (lang: string) => Promise<void>;
  languages: { code: string; label: string }[];
  themes: ThemeConfig[];
  currentTheme: string;
  setTheme: (themeId: string) => void;
  pauseAllDownloads?: () => Promise<number>;
  resumeAllDownloads?: () => Promise<number>;
  checkForUpdates?: (manual?: boolean) => Promise<void>;
  activeDownloadsCount?: number;
  runningGame?: { id: string; name: string } | null;
  forceCloseGame?: (game: any) => Promise<void>;
  onHistoryCleared?: () => void;
}

export function createSystemActions(params: CreateActionsParams): PaletteItem[] {
  const {
    navigate,
    onClose,
    showToast,
    t,
    isBigScreen,
    setBigScreen,
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    toggleSidebarRail,
    isSidebarRail,
    currentDensity,
    setDensity,
    currentLanguage,
    setLanguage,
    languages,
    themes,
    currentTheme,
    setTheme,
    pauseAllDownloads,
    resumeAllDownloads,
    checkForUpdates,
    activeDownloadsCount = 0,
    runningGame,
    forceCloseGame,
    onHistoryCleared,
  } = params;

  const items: PaletteItem[] = [];

  // Running Game Stop Action
  if (runningGame && forceCloseGame) {
    items.push({
      id: "act-force-close-game",
      category: "actions",
      title: t("commandPalette.actForceCloseGame", { name: runningGame.name }),
      subtitle: t("commandPalette.actForceCloseGameDesc"),
      badge: "Running",
      badgeType: "warning",
      icon: createElement(PlaySquare, { size: 16 }),
      description: t("commandPalette.actForceCloseGameDesc"),
      actionText: t("commandPalette.stop"),
      onSelect: () => {
        onClose();
        forceCloseGame(runningGame as any);
        showToast(t("commandPalette.toastGameStopped", { name: runningGame.name }), "info");
      },
    });
  }

  // 1. Core Quick Toggles
  items.push({
    id: "act-toggle-bigscreen",
    category: "actions",
    title: isBigScreen ? t("topnav.exitBigScreen") : t("topnav.enterBigScreen"),
    subtitle: t("commandPalette.actBigScreenDesc"),
    badge: isBigScreen ? "Active" : undefined,
    badgeType: isBigScreen ? "success" : undefined,
    icon: createElement(MonitorPlay, { size: 16 }),
    description: t("commandPalette.actBigScreenDesc"),
    actionText: t("commandPalette.hintSelect"),
    onSelect: () => {
      onClose();
      setBigScreen(!isBigScreen);
    },
  });

  items.push({
    id: "act-toggle-sound",
    category: "actions",
    title: uiSoundEnabled ? t("commandPalette.muteSound") : t("commandPalette.unmuteSound"),
    subtitle: uiSoundEnabled
      ? `${t("commandPalette.soundOn")} (${Math.round(uiSoundVolume * 100)}%)`
      : t("commandPalette.soundOff"),
    badge: uiSoundEnabled ? "ON" : "OFF",
    badgeType: uiSoundEnabled ? "success" : "neutral",
    icon: uiSoundEnabled ? createElement(Volume2, { size: 16 }) : createElement(VolumeX, { size: 16 }),
    description: t("settings.sound.sectionDesc"),
    actionText: t("commandPalette.hintSelect"),
    onSelect: () => {
      onClose();
      setUiSoundEnabled(!uiSoundEnabled);
      showToast(
        uiSoundEnabled ? t("commandPalette.toastSoundMuted") : t("commandPalette.toastSoundEnabled"),
        "info"
      );
    },
  });

  if (uiSoundEnabled) {
    items.push({
      id: "act-volume-up",
      category: "actions",
      title: t("commandPalette.volumeUp"),
      subtitle: `${t("commandPalette.currentVolume")}: ${Math.round(uiSoundVolume * 100)}%`,
      icon: createElement(Volume2, { size: 16 }),
      description: t("commandPalette.volumeUpDesc"),
      actionText: "+10%",
      onSelect: () => {
        const next = Math.min(1, Math.round((uiSoundVolume + 0.1) * 10) / 10);
        setUiSoundVolume(next);
        showToast(`${t("settings.sound.volumeTitle")}: ${Math.round(next * 100)}%`, "info");
      },
    });

    items.push({
      id: "act-volume-down",
      category: "actions",
      title: t("commandPalette.volumeDown"),
      subtitle: `${t("commandPalette.currentVolume")}: ${Math.round(uiSoundVolume * 100)}%`,
      icon: createElement(VolumeX, { size: 16 }),
      description: t("commandPalette.volumeDownDesc"),
      actionText: "-10%",
      onSelect: () => {
        const next = Math.max(0, Math.round((uiSoundVolume - 0.1) * 10) / 10);
        setUiSoundVolume(next);
        showToast(`${t("settings.sound.volumeTitle")}: ${Math.round(next * 100)}%`, "info");
      },
    });
  }

  if (toggleSidebarRail) {
    items.push({
      id: "act-toggle-sidebar",
      category: "actions",
      title: isSidebarRail ? t("commandPalette.expandSidebar") : t("commandPalette.collapseSidebar"),
      subtitle: t("commandPalette.actToggleSidebarDesc"),
      badge: isSidebarRail ? "Rail" : "Full",
      icon: createElement(LayoutGrid, { size: 16 }),
      description: t("commandPalette.actToggleSidebarDesc"),
      actionText: t("commandPalette.hintSelect"),
      onSelect: () => {
        toggleSidebarRail();
      },
    });
  }

  // 2. Library & Storage Operations
  items.push({
    id: "act-rescan-library",
    category: "actions",
    title: t("commandPalette.rescanLibrary"),
    subtitle: t("commandPalette.rescanLibraryDesc"),
    icon: createElement(RefreshCw, { size: 16 }),
    description: t("commandPalette.rescanLibraryDesc"),
    actionText: t("commandPalette.hintSelect"),
    onSelect: () => {
      onClose();
      navigate("/library");
      showToast(t("commandPalette.rescanStartedToast"), "info");
    },
  });

  items.push({
    id: "act-open-captures",
    category: "actions",
    title: t("commandPalette.openCaptures"),
    subtitle: t("commandPalette.openCapturesDesc"),
    icon: createElement(Camera, { size: 16 }),
    description: t("commandPalette.openCapturesDesc"),
    actionText: "↵",
    onSelect: () => {
      onClose();
      navigate("/community");
    },
  });

  items.push({
    id: "act-storage-cleanup",
    category: "actions",
    title: t("commandPalette.storageCleaner"),
    subtitle: t("commandPalette.storageCleanerDesc"),
    icon: createElement(HardDrive, { size: 16 }),
    description: t("commandPalette.storageCleanerDesc"),
    actionText: "↵",
    onSelect: () => {
      onClose();
      navigate("/storage");
    },
  });

  // 3. Clear Command Palette Search History
  items.push({
    id: "act-clear-palette-history",
    category: "actions",
    title: t("commandPalette.clearRecentHistory"),
    subtitle: t("commandPalette.clearRecentHistoryDesc"),
    icon: createElement(Trash2, { size: 16 }),
    description: t("commandPalette.clearRecentHistoryDesc"),
    actionText: t("commandPalette.clear"),
    onSelect: () => {
      clearRecentItems();
      onHistoryCleared?.();
      showToast(t("commandPalette.historyClearedToast"), "info");
    },
  });

  // 4. Downloads Actions
  if (pauseAllDownloads && activeDownloadsCount > 0) {
    items.push({
      id: "act-pause-all-downloads",
      category: "actions",
      title: t("commandPalette.pauseAllDownloads"),
      subtitle: t("commandPalette.activeDownloadsCount", { count: activeDownloadsCount }),
      icon: createElement(Pause, { size: 16 }),
      badge: String(activeDownloadsCount),
      badgeType: "warning",
      description: t("commandPalette.pauseAllDownloadsDesc"),
      actionText: t("commandPalette.pause"),
      onSelect: () => {
        onClose();
        pauseAllDownloads()
          .then((count) => {
            showToast(t("commandPalette.toastPausedDownloads", { count }), "info");
          })
          .catch(() => {});
      },
    });
  }

  if (resumeAllDownloads) {
    items.push({
      id: "act-resume-all-downloads",
      category: "actions",
      title: t("commandPalette.resumeAllDownloads"),
      subtitle: t("commandPalette.resumeAllDownloadsDesc"),
      icon: createElement(Play, { size: 16 }),
      description: t("commandPalette.resumeAllDownloadsDesc"),
      actionText: t("commandPalette.resume"),
      onSelect: () => {
        onClose();
        resumeAllDownloads()
          .then((count) => {
            showToast(t("commandPalette.toastResumedDownloads", { count }), "info");
          })
          .catch(() => {});
      },
    });
  }

  // 5. Application Updates & Documentation
  if (checkForUpdates) {
    items.push({
      id: "act-check-updates",
      category: "actions",
      title: t("commandPalette.checkUpdates"),
      subtitle: t("commandPalette.checkUpdatesDesc"),
      icon: createElement(Sparkles, { size: 16 }),
      description: t("commandPalette.checkUpdatesDesc"),
      actionText: t("commandPalette.check"),
      onSelect: () => {
        onClose();
        checkForUpdates(true);
      },
    });
  }

  items.push({
    id: "act-open-docs",
    category: "actions",
    title: t("nav.docs"),
    subtitle: t("commandPalette.docsDesc"),
    icon: createElement(BookOpen, { size: 16 }),
    description: t("commandPalette.docsDesc"),
    actionText: "↵",
    onSelect: () => {
      onClose();
      navigate("/docs");
    },
  });

  // 6. Density Switching
  if (setDensity) {
    const densities: { id: ViewDensity; title: string; desc: string }[] = [
      { id: "cozy", title: t("commandPalette.densityCozy"), desc: t("commandPalette.densityCozyDesc") },
      { id: "compact", title: t("commandPalette.densityCompact"), desc: t("commandPalette.densityCompactDesc") },
      { id: "cinematic", title: "Cinematic", desc: "Wide cards with rich backdrop art" },
    ];

    densities.forEach((d) => {
      const isCurrent = currentDensity === d.id;
      items.push({
        id: `act-density-${d.id}`,
        category: "actions",
        title: d.title,
        subtitle: d.desc,
        badge: isCurrent ? "Active" : undefined,
        badgeType: isCurrent ? "success" : undefined,
        icon: isCurrent ? createElement(Check, { size: 15 }) : createElement(Layers, { size: 15 }),
        description: d.desc,
        actionText: isCurrent ? "Active" : t("commandPalette.hintSelect"),
        onSelect: () => {
          setDensity(d.id);
          showToast(t("commandPalette.toastDensityChanged", { density: d.title }), "success");
        },
      });
    });
  }

  // 7. Language Switching
  languages.forEach((lang) => {
    const isCurrent = currentLanguage === lang.code;
    items.push({
      id: `act-lang-${lang.code}`,
      category: "actions",
      title: `${t("commandPalette.switchLanguage")}: ${lang.label}`,
      subtitle: lang.code.toUpperCase(),
      badge: isCurrent ? "Active" : undefined,
      badgeType: isCurrent ? "success" : undefined,
      icon: isCurrent ? createElement(Check, { size: 15 }) : createElement(Languages, { size: 15 }),
      description: `${t("commandPalette.switchLanguage")} ${lang.label}`,
      actionText: isCurrent ? "Active" : t("commandPalette.hintSelect"),
      onSelect: () => {
        setLanguage(lang.code);
        showToast(`${t("settings.language")}: ${lang.label}`, "success");
      },
    });
  });

  // 8. Settings Deep-Links
  const settingsSections = [
    { path: "/settings/general", titleKey: "settings.tab.general", descKey: "settings.tab.general.desc", icon: Settings },
    { path: "/settings/appearance", titleKey: "settings.tab.appearance", descKey: "settings.tab.appearance.desc", icon: Palette },
    { path: "/settings/integrations", titleKey: "settings.tab.integrations", descKey: "settings.tab.integrations.desc", icon: RefreshCw },
    { path: "/settings/downloads", titleKey: "settings.tab.downloads", descKey: "settings.tab.downloads.desc", icon: Download },
    { path: "/settings/hardware", titleKey: "settings.tab.hardware", descKey: "settings.tab.hardware.desc", icon: Activity },
    { path: "/settings/launcher", titleKey: "settings.tab.launcher", descKey: "settings.tab.launcher.desc", icon: Gamepad2 },
    { path: "/settings/privacy", titleKey: "settings.tab.privacy", descKey: "settings.tab.privacy.desc", icon: Shield },
  ];

  settingsSections.forEach((sec) => {
    items.push({
      id: `act-settings-${sec.path}`,
      category: "actions",
      title: `${t("nav.settings")} · ${t(sec.titleKey)}`,
      subtitle: t(sec.descKey),
      icon: createElement(sec.icon, { size: 15 }),
      description: t(sec.descKey),
      actionText: "↵",
      onSelect: () => {
        onClose();
        navigate(sec.path);
      },
    });
  });

  // 9. Themes
  themes.forEach((th) => {
    const isCurrent = th.id === currentTheme;
    const colors = THEME_COLORS[th.id] || THEME_COLORS.dark;

    items.push({
      id: `theme-${th.id}`,
      category: "themes",
      title: th.meta.name,
      subtitle: `${t("commandPalette.switchTheme")} ${th.meta.name}`,
      badge: th.meta.descriptor.toUpperCase(),
      icon: isCurrent ? createElement(Check, { size: 15 }) : createElement(Palette, { size: 15 }),
      swatchColors: colors,
      description: `${th.meta.name} (${th.meta.descriptor})`,
      actionText: isCurrent ? "Active" : t("commandPalette.hintSelect"),
      onSelect: () => {
        setTheme(th.id);
        showToast(t("settings.themeChanged", { theme: th.meta.name }), "success");
      },
    });
  });

  return items;
}

export function createNavigationItems(
  navigate: NavigateFunction,
  onClose: () => void,
  t: (key: string, vars?: Record<string, unknown>) => string
): PaletteItem[] {
  const routes = [
    { path: "/home", labelKey: "nav.home", descKey: "commandPalette.navDescHome", icon: Compass },
    { path: "/library", labelKey: "nav.library", descKey: "commandPalette.navDescLibrary", icon: Monitor },
    { path: "/store", labelKey: "nav.store", descKey: "commandPalette.navDescStore", icon: Store },
    { path: "/wishlist", labelKey: "nav.wishlist", descKey: "commandPalette.navDescWishlist", icon: Heart },
    { path: "/deals", labelKey: "nav.deals", descKey: "commandPalette.navDescDeals", icon: Tag },
    { path: "/activity", labelKey: "nav.activity", descKey: "commandPalette.navDescActivity", icon: Activity },
    { path: "/achievements", labelKey: "nav.achievements", descKey: "commandPalette.navDescAchievements", icon: Trophy },
    { path: "/emulators", labelKey: "nav.emulators", descKey: "commandPalette.navDescEmulators", icon: Gamepad2 },
    { path: "/mods", labelKey: "nav.mods", descKey: "commandPalette.navDescMods", icon: Puzzle },
    { path: "/downloads", labelKey: "nav.downloads", descKey: "commandPalette.navDescDownloads", icon: Download },
    { path: "/storage", labelKey: "nav.storage", descKey: "commandPalette.navDescStorage", icon: HardDrive },
    { path: "/news", labelKey: "nav.news", descKey: "commandPalette.navDescNews", icon: Rss },
    { path: "/community", labelKey: "nav.community", descKey: "commandPalette.navDescCommunity", icon: Users },
    { path: "/friends", labelKey: "nav.friends", descKey: "commandPalette.navDescFriends", icon: Users },
    { path: "/settings", labelKey: "nav.settings", descKey: "commandPalette.navDescSettings", icon: Settings },
    { path: "/docs", labelKey: "nav.docs", descKey: "commandPalette.navDescDocs", icon: BookOpen },
  ];

  return routes.map((r) => ({
    id: `nav-${r.path}`,
    category: "navigation",
    title: t(r.labelKey),
    subtitle: `${t("commandPalette.navTo")} ${r.path}`,
    icon: createElement(r.icon, { size: 16 }),
    description: t(r.descKey),
    actionText: "↵",
    quickActions: [
      {
        id: "open",
        icon: createElement(ExternalLink, { size: 12 }),
        title: t("commandPalette.quickActionPage"),
        onClick: (e) => {
          e.stopPropagation();
          onClose();
          navigate(r.path);
        },
      },
    ],
    onSelect: () => {
      onClose();
      navigate(r.path);
    },
  }));
}
