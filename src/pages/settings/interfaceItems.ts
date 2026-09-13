import {
  Activity,
  BookOpen,
  ChartColumn,
  Download,
  Gamepad2,
  HardDrive,
  Heart,
  Home,
  Monitor,
  MonitorPlay,
  Puzzle,
  Rss,
  Settings,
  Store,
  Tag,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InterfaceItemKey } from "../../context/SettingsContext";

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
