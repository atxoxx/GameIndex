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
  DetailTabOrderMap,
  DetailTopBarOrderMap,
  DetailTopBarVisibilityMap,
  HeroElementOrderMap,
  HeroElementVisibilityMap,
  PageItemOrderMap,
  PageItemVisibilityMap,
  SidebarSectionVisibility,
} from "../../../context/interfaceLayout";
import type { HeroGridLayoutMap } from "../../../context/heroGrid";

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
  /** Per-scope order of the detail-page tab bar (game + store). */
  detailTabOrder: DetailTabOrderMap;
  /** Per-scope order of the hero element blocks (game + store). */
  heroElementOrder: HeroElementOrderMap;
  /** OFF-only per-scope hero element visibility overrides. */
  heroElementVisibility: HeroElementVisibilityMap;
  /** Optional per-scope hero grid layout; empty => the shipped flex layout. */
  heroGridLayout: HeroGridLayoutMap;
  /** Per-scope order of the detail-page top bar (game + store). Optional so
   *  existing snapshot builders that predate this lane stay valid; presets
   *  still populate it explicitly. */
  detailTopBarOrder?: DetailTopBarOrderMap;
  /** OFF-only per-scope detail-page top-bar visibility overrides. */
  detailTopBarVisibility?: DetailTopBarVisibilityMap;
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
