import type { ReactNode } from "react";
import type { Game, StoreGameSummary } from "../../types/game";
import type { TorrentDownload } from "../../types/download";

/** Scopes the palette can be filtered to. `all` shows every category. */
export type PaletteCategory =
  | "all"
  | "recent"
  | "games"
  | "mods"
  | "wishlist"
  | "actions"
  | "navigation"
  | "themes"
  | "downloads"
  | "store"
  | "docs"
  | "settings"
  | "utility";

/**
 * Visual section a result belongs to. Categories drive scope filtering and
 * counts; groups drive the section headers in the result list. They usually
 * match, except for the launcher surfaces (`pinned`, `suggested`, `queries`)
 * which mix items from several categories.
 */
export type PaletteGroup =
  | "pinned"
  | "queries"
  | "recent"
  | "recentGames"
  | "suggested"
  | "games"
  | "mods"
  | "wishlist"
  | "actions"
  | "navigation"
  | "themes"
  | "downloads"
  | "store"
  | "docs"
  | "settings"
  | "utility";

export interface PaletteQuickAction {
  id: string;
  icon: ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}

export interface PaletteSecondaryAction {
  id: string;
  icon: ReactNode;
  title: string;
  description?: string;
  shortcut?: string;
  badge?: string;
  onExecute: () => void;
}

export interface CalculationResult {
  expression: string;
  result: string;
  details?: string;
  unit?: string;
  calcType?: "math" | "data" | "frametime" | "download" | "resolution";
}

export interface PaletteAchievementStats {
  unlocked: number;
  total: number;
  percentage: number;
}

export interface LibraryStatsData {
  totalGames: number;
  installedGames: number;
  totalSizeBytes: number;
  totalPlaytimeHours: number;
  favoriteCount: number;
  unplayedCount: number;
  topPlayedGame?: {
    name: string;
    playTime: string;
    coverArtUrl?: string;
  };
}

export interface RandomGameData {
  game: Game;
  filterUsed?: string;
  onReroll: () => void;
}

/** A settings tab or section resolved from the settings catalog. */
export interface PaletteSettingsData {
  tab: string;
  sectionId?: string;
}

/** A documentation article resolved from the docs index. */
export interface PaletteDocsData {
  id: string;
  categoryId: string;
}

export interface PaletteItem {
  id: string;
  category: PaletteCategory;
  /** Section header this item renders under. Defaults to `category`. */
  group?: PaletteGroup;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeType?: "accent" | "success" | "warning" | "info" | "neutral";
  icon?: ReactNode;
  thumb?: string;
  swatchColors?: { bg: string; text: string; accent: string };
  actionText?: string;
  shortcut?: string;
  secondaryActionText?: string;
  quickActions?: PaletteQuickAction[];
  /** Optional longer text shown in the preview pane. */
  description?: string;
  onSelect: () => void;
  onSecondarySelect?: () => void;
  onDeleteRecent?: () => void;

  /** Rich metadata for the preview pane and the secondary actions drawer. */
  gameData?: Game;
  storeData?: StoreGameSummary;
  downloadData?: TorrentDownload;
  calcData?: CalculationResult;
  achievementStats?: PaletteAchievementStats;
  statsData?: LibraryStatsData;
  randomGameData?: RandomGameData;
  settingsData?: PaletteSettingsData;
  docsData?: PaletteDocsData;
  metaDetails?: {
    label: string;
    value: string | number | ReactNode;
  }[];
  isRecent?: boolean;
  frequency?: number;

  /** Pin support (games, pages, actions, themes, settings, docs). */
  pinnable?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;

  /** Query replayed when a recent-search row is activated. */
  recentQuery?: string;
}

export interface PaletteRecentItem {
  id: string;
  title: string;
  category: PaletteCategory;
  timestamp: number;
  frequency?: number;
}

export interface PalettePin {
  id: string;
  category: PaletteCategory;
  title: string;
  timestamp: number;
}

export interface MatchHighlight {
  start: number;
  end: number;
}

export interface ParsedQueryFilters {
  cleanQuery: string;
  isInstalled?: boolean;
  isCloud?: boolean;
  isRunning?: boolean;
  isWishlisted?: boolean;
  isFavorite?: boolean;
  excludeFavorite?: boolean;
  isUnplayed?: boolean;
  isUntracked?: boolean;
  isHidden?: boolean;
  isModded?: boolean;
  isVR?: boolean;
  source?: string;
  platform?: string;
  genre?: string;
  tag?: string;
  developer?: string;
  publisher?: string;
  year?: number;
  yearOp?: ">" | "<" | "=";
  rating?: number;
  ratingOp?: ">" | "<" | "=";
  playtimeHours?: number;
  playtimeOp?: ">" | "<" | "=";
  sizeBytes?: number;
  sizeOp?: ">" | "<" | "=";
  sort?: "recent" | "playtime" | "rating" | "name" | "size";
}
