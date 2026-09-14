import {
  DEFAULT_NAVBAR_BUTTON_ORDER,
  DEFAULT_NAVBAR_TAB_ORDER,
  DEFAULT_INTERFACE_VISIBILITY,
  type InterfaceItemKey,
} from "../../../context/SettingsContext";
import {
  DEFAULT_DETAIL_TAB_ORDER,
  DEFAULT_HERO_ELEMENT_ORDER,
  DEFAULT_SIDEBAR_SECTION_VISIBILITY,
  DEFAULT_PAGE_ITEM_ORDER,
} from "../../../context/interfaceLayout";
import { normalizeHeroGridLayoutMap } from "../../../context/heroGrid";
import { buildDetailSectionItems } from "../interfaceItems";
import type { LayoutPreset, LayoutSnapshot } from "./types";

const CUSTOM_PRESETS_KEY = "gamelib.custom_layout_presets";

export function getDefaultLayoutSnapshot(): LayoutSnapshot {
  const detailSectionVisible = Object.fromEntries(
    buildDetailSectionItems(true).map((sec) => [sec.key, true]),
  ) as LayoutSnapshot["detailSectionVisible"];

  return {
    navbarTabOrder: [...DEFAULT_NAVBAR_TAB_ORDER],
    navbarButtonOrder: [...DEFAULT_NAVBAR_BUTTON_ORDER],
    interfaceVisibility: { ...DEFAULT_INTERFACE_VISIBILITY },
    sidebarPosition: "left",
    sidebarSectionVisible: { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY },
    pageItemVisible: {},
    pageItemOrder: { ...DEFAULT_PAGE_ITEM_ORDER },
    uiDensityMode: "complete",
    navbarMode: "full",
    commandPaletteMode: "full",
    showGameArtBackdrop: true,
    showCardBadges: true,
    showNavbarNowPlaying: true,
    detailSectionVisible,
    detailTabOrder: {
      game: [...DEFAULT_DETAIL_TAB_ORDER.game],
      store: [...DEFAULT_DETAIL_TAB_ORDER.store],
    },
    heroElementOrder: {
      game: [...DEFAULT_HERO_ELEMENT_ORDER],
      store: [...DEFAULT_HERO_ELEMENT_ORDER],
    },
    heroElementVisibility: {},
    heroGridLayout: {},
    uiScale: "auto",
  };
}

export const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: "balanced",
    nameKey: "settings.interface.presetBalanced",
    descKey: "settings.interface.presetBalancedDesc",
    snapshot: getDefaultLayoutSnapshot(),
  },
  {
    id: "minimal",
    nameKey: "settings.interface.presetMinimal",
    descKey: "settings.interface.presetMinimalDesc",
    snapshot: {
      navbarMode: "compact",
      commandPaletteMode: "simple",
      showGameArtBackdrop: false,
      showCardBadges: false,
      showNavbarNowPlaying: false,
      sidebarPosition: "left",
      interfaceVisibility: {
        ...DEFAULT_INTERFACE_VISIBILITY,
        navWishlist: false,
        navDeals: false,
        navNews: false,
        navEmulators: false,
        navMods: false,
        navActivity: false,
        navAchievements: false,
        navStorage: false,
        navCommunity: false,
        navFriends: false,
        btnDocs: false,
        btnBigScreen: false,
        badgePlatform: false,
        badgePlaytime: false,
        badgeInstall: false,
        badgeRating: false,
        badgeCrackwatch: false,
        badgeCompare: false,
        widgetKpis: false,
        widgetFilters: false,
      },
      sidebarSectionVisible: {
        search: true,
        activeFilters: false,
        gameList: true,
        alphabetRail: false,
        statsFooter: false,
      },
      // Explicitly empty => applying the preset resets any authored hero grid
      // back to the shipped flex layout.
      heroGridLayout: {},
    },
  },
  {
    id: "deck",
    nameKey: "settings.interface.presetDeck",
    descKey: "settings.interface.presetDeckDesc",
    snapshot: {
      navbarMode: "compact",
      commandPaletteMode: "simple",
      showGameArtBackdrop: true,
      showCardBadges: true,
      showNavbarNowPlaying: true,
      sidebarPosition: "left",
      navbarTabOrder: [
        "navHome",
        "navLibrary",
        "navStorage",
        "navActivity",
        "navStore",
        "navWishlist",
        "navDeals",
        "navAchievements",
        "navNews",
        "navEmulators",
        "navMods",
        "navCommunity",
        "navFriends",
      ],
      interfaceVisibility: {
        ...DEFAULT_INTERFACE_VISIBILITY,
        navMods: false,
        navEmulators: false,
        navCommunity: false,
        btnDocs: false,
        badgeCrackwatch: false,
        badgeCompare: false,
      },
      // Reset any authored hero grid to flex when this preset is applied.
      heroGridLayout: {},
    },
  },
  {
    id: "power",
    nameKey: "settings.interface.presetPower",
    descKey: "settings.interface.presetPowerDesc",
    snapshot: {
      ...getDefaultLayoutSnapshot(),
      navbarMode: "full",
      commandPaletteMode: "full",
      showGameArtBackdrop: true,
      showCardBadges: true,
      showNavbarNowPlaying: true,
    },
  },
  {
    id: "streamer",
    nameKey: "settings.interface.presetStreamer",
    descKey: "settings.interface.presetStreamerDesc",
    snapshot: {
      navbarMode: "compact",
      showGameArtBackdrop: true,
      showCardBadges: true,
      showNavbarNowPlaying: false,
      interfaceVisibility: {
        ...DEFAULT_INTERFACE_VISIBILITY,
        navFriends: false,
        navCommunity: false,
        navActivity: false,
        badgeCrackwatch: false,
      },
      detailSectionVisible: Object.fromEntries(
        buildDetailSectionItems(true).map((sec) => [
          sec.key,
          sec.key !== "activity" && sec.key !== "notes",
        ]),
      ) as LayoutSnapshot["detailSectionVisible"],
      // Reset any authored hero grid to flex when this preset is applied.
      heroGridLayout: {},
    },
  },
];

export function loadCustomPresets(): LayoutPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (p) => p && typeof p === "object" && typeof p.id === "string" && p.customName,
      );
    }
  } catch {
    /* fallback to empty */
  }
  return [];
}

export function saveCustomPreset(name: string, snapshot: LayoutSnapshot): LayoutPreset {
  const existing = loadCustomPresets();
  const newPreset: LayoutPreset = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nameKey: "",
    descKey: "",
    isCustom: true,
    customName: name.trim() || "Custom Layout",
    snapshot: { ...snapshot },
  };

  const updated = [newPreset, ...existing].slice(0, 20);
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
  } catch {
    /* ignore write errors */
  }
  return newPreset;
}

export function deleteCustomPreset(id: string): void {
  const existing = loadCustomPresets();
  const filtered = existing.filter((p) => p.id !== id);
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(filtered));
  } catch {
    /* ignore */
  }
}

export function exportLayoutToJson(snapshot: LayoutSnapshot): string {
  return JSON.stringify(
    {
      app: "GameIndex",
      version: 3,
      exportedAt: new Date().toISOString(),
      layout: snapshot,
    },
    null,
    2,
  );
}

export function importLayoutFromJson(jsonStr: string): Partial<LayoutSnapshot> | null {
  try {
    const data = JSON.parse(jsonStr);
    const layout = data.layout ?? data;
    if (!layout || typeof layout !== "object") return null;

    const result: Partial<LayoutSnapshot> = {};

    if (Array.isArray(layout.navbarTabOrder)) {
      result.navbarTabOrder = layout.navbarTabOrder;
    }
    if (Array.isArray(layout.navbarButtonOrder)) {
      result.navbarButtonOrder = layout.navbarButtonOrder;
    }
    if (layout.interfaceVisibility && typeof layout.interfaceVisibility === "object") {
      result.interfaceVisibility = layout.interfaceVisibility;
    }
    if (layout.sidebarPosition === "left" || layout.sidebarPosition === "right") {
      result.sidebarPosition = layout.sidebarPosition;
    }
    if (layout.sidebarSectionVisible && typeof layout.sidebarSectionVisible === "object") {
      result.sidebarSectionVisible = layout.sidebarSectionVisible;
    }
    if (layout.pageItemVisible && typeof layout.pageItemVisible === "object") {
      result.pageItemVisible = layout.pageItemVisible;
    }
    if (layout.pageItemOrder && typeof layout.pageItemOrder === "object") {
      result.pageItemOrder = layout.pageItemOrder;
    }
    if (layout.uiDensityMode === "simple" || layout.uiDensityMode === "complete") {
      result.uiDensityMode = layout.uiDensityMode;
    }
    if (layout.navbarMode === "full" || layout.navbarMode === "compact") {
      result.navbarMode = layout.navbarMode;
    }
    if (layout.commandPaletteMode === "simple" || layout.commandPaletteMode === "full") {
      result.commandPaletteMode = layout.commandPaletteMode;
    }
    if (typeof layout.showGameArtBackdrop === "boolean") {
      result.showGameArtBackdrop = layout.showGameArtBackdrop;
    }
    if (typeof layout.showCardBadges === "boolean") {
      result.showCardBadges = layout.showCardBadges;
    }
    if (typeof layout.showNavbarNowPlaying === "boolean") {
      result.showNavbarNowPlaying = layout.showNavbarNowPlaying;
    }
    if (layout.detailSectionVisible && typeof layout.detailSectionVisible === "object") {
      result.detailSectionVisible = layout.detailSectionVisible;
    }
    if (layout.detailTabOrder && typeof layout.detailTabOrder === "object") {
      result.detailTabOrder = layout.detailTabOrder;
    }
    if (layout.heroElementOrder && typeof layout.heroElementOrder === "object") {
      result.heroElementOrder = layout.heroElementOrder;
    }
    if (layout.heroElementVisibility && typeof layout.heroElementVisibility === "object") {
      result.heroElementVisibility = layout.heroElementVisibility;
    }
    if (layout.heroGridLayout && typeof layout.heroGridLayout === "object") {
      result.heroGridLayout = normalizeHeroGridLayoutMap(layout.heroGridLayout);
    }
    if (typeof layout.uiScale === "string") {
      result.uiScale = layout.uiScale;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

export function isItemModifiedFromDefault(
  id: string,
  currentValue: unknown,
  defaults: LayoutSnapshot,
): boolean {
  if (id in defaults.interfaceVisibility) {
    return (
      (currentValue as boolean) !==
      defaults.interfaceVisibility[id as InterfaceItemKey]
    );
  }
  if (id in defaults.sidebarSectionVisible) {
    return (
      (currentValue as boolean) !==
      defaults.sidebarSectionVisible[id as keyof typeof defaults.sidebarSectionVisible]
    );
  }
  if (id in defaults.detailSectionVisible) {
    return (
      (currentValue as boolean) !==
      defaults.detailSectionVisible[id as keyof typeof defaults.detailSectionVisible]
    );
  }
  return false;
}
