import type { LucideIcon } from "lucide-react";
import type {
  CommandPaletteMode,
  DetailSectionVisibility,
  InterfaceItemKey,
  InterfaceVisibility,
  NavbarMode,
  SidebarPosition,
  UiDensityMode,
  UiScale,
} from "../../../context/SettingsContext";
import type {
  PageItemOrderMap,
  PageItemVisibilityMap,
  SidebarSectionVisibility,
} from "../../../context/interfaceLayout";

export type ViewportPreset = "desktop" | "handheld" | "ultrawide" | "compact";

export type FilterFilterMode = "all" | "visible" | "hidden" | "modified";

export type StudioGroupKey =
  | "layout"
  | "header"
  | "sidebar"
  | "badges"
  | "widgets"
  | "details";

export interface OrderListItem {
  id: string;
  label: string;
  icon: LucideIcon;
  hidden: boolean;
  hint?: string;
  isModified?: boolean;
}

export interface LayoutSnapshot {
  navbarTabOrder: InterfaceItemKey[];
  navbarButtonOrder: InterfaceItemKey[];
  interfaceVisibility: InterfaceVisibility;
  sidebarPosition: SidebarPosition;
  sidebarSectionVisible: SidebarSectionVisibility;
  pageItemVisible: PageItemVisibilityMap;
  pageItemOrder: PageItemOrderMap;
  uiDensityMode: UiDensityMode;
  navbarMode: NavbarMode;
  commandPaletteMode: CommandPaletteMode;
  showGameArtBackdrop: boolean;
  showCardBadges: boolean;
  showNavbarNowPlaying: boolean;
  detailSectionVisible: DetailSectionVisibility;
  uiScale: UiScale;
}

export interface LayoutPreset {
  id: string;
  nameKey: string;
  descKey: string;
  isCustom?: boolean;
  customName?: string;
  iconName?: string;
  snapshot: Partial<LayoutSnapshot>;
}
