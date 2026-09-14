import {
  Activity,
  ArrowLeft,
  BookOpen,
  ChartColumn,
  Clock,
  Download,
  EllipsisVertical,
  FileText,
  Gamepad2,
  HardDrive,
  Heart,
  Home,
  Image,
  Monitor,
  MonitorPlay,
  Play,
  Puzzle,
  Rss,
  Settings,
  Store,
  Tag,
  Trophy,
  Users,
  Wine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DetailTopBarKey } from "../../context/interfaceLayout";
import type { DetailSectionKey, InterfaceItemKey } from "../../context/SettingsContext";

/**
 * interfaceItems — the header/navbar item catalog shared by the Interface
 * settings tab and the Layout Studio modal.
 *
 * Icons live here (not in the pure data model in context/interfaceLayout.ts)
 * so both UI surfaces render the exact same glyph for a key, and TopNav's own
 * tab list stays the runtime source of truth for paths.
 */
export interface InterfaceItemDef {
  key: InterfaceItemKey;
  /** Translation key for the user-facing label. */
  labelKey: string;
  icon: LucideIcon;
}

/** Top navbar tabs — labels reuse the existing `nav.*` keys. Order here is
 *  the shipped default; the live order comes from `navbarTabOrder`. */
export const NAV_TAB_ITEMS: InterfaceItemDef[] = [
  { key: "navHome", labelKey: "nav.home", icon: Home },
  { key: "navStore", labelKey: "nav.store", icon: Store },
  { key: "navLibrary", labelKey: "nav.library", icon: Monitor },
  { key: "navWishlist", labelKey: "nav.wishlist", icon: Heart },
  { key: "navDeals", labelKey: "nav.deals", icon: Tag },
  { key: "navActivity", labelKey: "nav.activity", icon: Activity },
  { key: "navNews", labelKey: "nav.news", icon: Rss },
  { key: "navEmulators", labelKey: "nav.emulators", icon: Gamepad2 },
  { key: "navMods", labelKey: "nav.mods", icon: Puzzle },
  { key: "navAchievements", labelKey: "nav.achievements", icon: Trophy },
  { key: "navStorage", labelKey: "nav.storage", icon: HardDrive },
  { key: "navCommunity", labelKey: "nav.community", icon: ChartColumn },
  { key: "navFriends", labelKey: "nav.friends", icon: Users },
];

/** Right-cluster buttons in the top bar. */
export const NAV_BUTTON_ITEMS: InterfaceItemDef[] = [
  { key: "btnDownloads", labelKey: "settings.interface.btnDownloads", icon: Download },
  { key: "btnSettings", labelKey: "settings.interface.btnSettings", icon: Settings },
  { key: "btnDocs", labelKey: "settings.interface.btnDocs", icon: BookOpen },
  { key: "btnBigScreen", labelKey: "settings.interface.btnBigScreen", icon: MonitorPlay },
];

export const NAV_ITEM_BY_KEY: Record<string, InterfaceItemDef> = Object.fromEntries(
  [...NAV_TAB_ITEMS, ...NAV_BUTTON_ITEMS].map((item) => [item.key, item]),
);

/**
 * Icons for the detail-page top-bar items (game + store). Labels/intent live
 * in `DETAIL_TOP_BAR_LABEL_KEY` (context/interfaceLayout.ts); the glyphs live
 * here so both detail pages and the Layout Studio render the same icon.
 */
export const DETAIL_TOP_BAR_ICONS: Record<DetailTopBarKey, LucideIcon> = {
  back: ArrowLeft,
  wineLogs: Wine,
  editDetails: FileText,
  editMedia: Image,
  editLaunch: Play,
  editCompatibility: Clock,
  quickActions: EllipsisVertical,
};

/** Granular card-badge toggles. The first four refine the master "Show Card
 *  Badges" switch; the last two are independent overlays. */
export const BADGE_ITEMS: { key: InterfaceItemKey; labelKey: string }[] = [
  { key: "badgePlatform", labelKey: "settings.interface.badgePlatform" },
  { key: "badgePlaytime", labelKey: "settings.interface.badgePlaytime" },
  { key: "badgeInstall", labelKey: "settings.interface.badgeInstall" },
  { key: "badgeRating", labelKey: "settings.interface.badgeRating" },
  { key: "badgeCrackwatch", labelKey: "settings.interface.badgeCrackwatch" },
  { key: "badgeCompare", labelKey: "settings.interface.badgeCompare" },
];

/** Library-card badge keys that respect the "Show Card Badges" master. */
export const MASTER_GATED_BADGES = new Set<InterfaceItemKey>([
  "badgePlatform",
  "badgePlaytime",
  "badgeInstall",
  "badgeRating",
]);

/** The global widget categories — the "every page" counterpart of the
 *  per-page widget toggles in the Layout Studio's page tabs. */
export const WIDGET_ITEMS: { key: InterfaceItemKey; labelKey: string }[] = [
  { key: "widgetKpis", labelKey: "settings.interface.widgetKpis" },
  { key: "widgetFilters", labelKey: "settings.interface.widgetFilters" },
  { key: "widgetSubtabs", labelKey: "settings.interface.widgetSubtabs" },
  { key: "widgetHero", labelKey: "settings.interface.widgetHeroCollage" },
  { key: "widgetDashboard", labelKey: "settings.interface.widgetDashboard" },
];

export interface DetailSectionItem {
  key: DetailSectionKey;
  titleKey: string;
  descKey: string;
}

function detailSectionItem(key: DetailSectionKey): DetailSectionItem {
  return {
    key,
    titleKey: `settings.detailSections.${key}.title`,
    descKey: `settings.detailSections.${key}.desc`,
  };
}

/**
 * Game & Store detail-page sections, in display order. ProtonDB only exists
 * where the Linux/Steam Deck support level surfaces it, so it is included on
 * demand — the same rule the old Interface panel applied.
 */
export function buildDetailSectionItems(
  includeProtonDb: boolean,
): DetailSectionItem[] {
  const leading: DetailSectionKey[] = [
    "steamFeatures",
    "systemRequirements",
    "gameRelations",
    "timeToBeat",
  ];
  const trailing: DetailSectionKey[] = [
    "releases",
    "reviews",
    "activity",
    "notes",
    "achievements",
    "mods",
    "weblinks",
    "news",
  ];
  const keys = includeProtonDb
    ? [...leading, "protonDb" as DetailSectionKey, ...trailing]
    : [...leading, ...trailing];
  return keys.map(detailSectionItem);
}

/** Reorder `items` to follow a user-arranged key list, keeping unknown keys
 *  (added in a later release) at the end in their shipped order. */
export function sortByOrder(
  items: InterfaceItemDef[],
  order: InterfaceItemKey[],
): InterfaceItemDef[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...items].sort(
    (a, b) =>
      (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Move one entry within a key list and return the new array. */
export function moveKey<T>(keys: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) {
    return keys;
  }
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
