import {
  Calculator,
  Compass,
  Download,
  Gamepad2,
  Heart,
  History,
  Palette as PaletteIcon,
  Puzzle,
  Search,
  Settings,
  Sparkles,
  Store,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";

export interface PaletteScopeDef {
  id: PaletteCategory;
  labelKey: string;
  icon: LucideIcon;
  /** Shown as a chip; the rest live behind the "More" popover. */
  primary?: boolean;
  /** Type-ahead prefix that also selects this scope. */
  prefix?: string;
}

/**
 * The palette's scope order. Alt+1…9 map to the first nine entries, so this
 * list doubles as the keyboard map and the "More" popover order.
 */
export const PALETTE_SCOPES: PaletteScopeDef[] = [
  { id: "all", labelKey: "commandPalette.scopeAll", icon: Search, primary: true },
  { id: "games", labelKey: "commandPalette.scopeGames", icon: Gamepad2, primary: true, prefix: "@" },
  { id: "store", labelKey: "commandPalette.scopeStore", icon: Store, primary: true, prefix: "?" },
  { id: "actions", labelKey: "commandPalette.scopeActions", icon: Sparkles, primary: true, prefix: ">" },
  {
    id: "navigation",
    labelKey: "commandPalette.scopeNavigation",
    icon: Compass,
    primary: true,
    prefix: "/",
  },
  { id: "recent", labelKey: "commandPalette.scopeRecent", icon: History },
  { id: "downloads", labelKey: "commandPalette.scopeDownloads", icon: Download, prefix: "$" },
  { id: "themes", labelKey: "commandPalette.scopeThemes", icon: PaletteIcon, prefix: "#" },
  { id: "docs", labelKey: "commandPalette.scopeDocs", icon: BookOpen },
  { id: "wishlist", labelKey: "commandPalette.scopeWishlist", icon: Heart, prefix: "!" },
  { id: "mods", labelKey: "commandPalette.scopeMods", icon: Puzzle, prefix: "%" },
  { id: "settings", labelKey: "commandPalette.scopeSettings", icon: Settings },
  { id: "utility", labelKey: "commandPalette.scopeUtility", icon: Calculator, prefix: "~" },
];

export const SCOPE_ORDER: PaletteCategory[] = PALETTE_SCOPES.map((scope) => scope.id);

export const PRIMARY_SCOPES = PALETTE_SCOPES.filter((scope) => scope.primary);
export const SECONDARY_SCOPES = PALETTE_SCOPES.filter((scope) => !scope.primary);

/** Prefix → scope mapping for type-ahead scope triggers. */
export const SCOPE_PREFIXES: Record<string, PaletteCategory> = Object.fromEntries(
  PALETTE_SCOPES.filter((scope) => scope.prefix).map((scope) => [scope.prefix as string, scope.id]),
);
