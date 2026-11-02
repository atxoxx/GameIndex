// studioIcons — the glyph catalog shared by the studio's rail, inspector and
// preview. Keeping it out of the components means a page, tab and hero element
// render the same icon everywhere in the workspace.

import {
  Activity,
  Download,
  FileText,
  GalleryHorizontal,
  Gamepad2,
  Globe,
  HardDrive,
  Heart,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  List,
  Map as MapIcon,
  MessageSquare,
  Monitor,
  MonitorPlay,
  Newspaper,
  PlayCircle,
  Puzzle,
  Rss,
  Save,
  Store,
  Tag,
  Tags,
  Trophy,
  Type,
  UserCheck,
  Users,
  Wallpaper,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { DetailTabKey, HeroElementKey, InterfacePageKey } from "../../../context/interfaceLayout";

export const STUDIO_PAGE_ICON: Record<InterfacePageKey, LucideIcon> = {
  global: LayoutTemplate,
  home: Home,
  library: Gamepad2,
  game: MonitorPlay,
  store: Store,
  storeGame: Store,
  wishlist: Heart,
  deals: Tag,
  news: Rss,
  activity: Activity,
  achievements: Trophy,
  downloads: Download,
  storage: HardDrive,
  community: Users,
  friends: UserCheck,
  emulators: Monitor,
  mods: Puzzle,
  saves: Save,
};

export const STUDIO_DETAIL_TAB_ICON: Record<DetailTabKey, LucideIcon> = {
  overview: LayoutDashboard,
  reviews: MessageSquare,
  activity: Activity,
  notes: FileText,
  achievements: Trophy,
  mods: Wrench,
  saves: Save,
  weblinks: Globe,
  news: Newspaper,
  dlc: Puzzle,
  map: MapIcon,
};

export const STUDIO_HERO_ELEMENT_ICON: Record<HeroElementKey, LucideIcon> = {
  background: Wallpaper,
  poster: GalleryHorizontal,
  title: Type,
  meta: List,
  genres: Tags,
  kpis: LayoutGrid,
  actions: PlayCircle,
};
