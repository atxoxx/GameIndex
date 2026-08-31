import type { ReactNode } from "react";
import type { Game, StoreGameSummary } from "../../types/game";
import type { TorrentDownload } from "../../types/download";

export type PaletteCategory =
  | "all"
  | "recent"
  | "games"
  | "actions"
  | "navigation"
  | "themes"
  | "downloads"
  | "store"
  | "utility";

export interface PaletteQuickAction {
  id: string;
  icon: ReactNode;
  title: string;
  shortcut?: string;
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
}

export interface PaletteAchievementStats {
  unlocked: number;
  total: number;
  percentage: number;
}

export interface PaletteItem {
  id: string;
  category: "recent" | "games" | "actions" | "navigation" | "themes" | "downloads" | "store" | "utility";
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
  onSelect: () => void;
  onSecondarySelect?: () => void;
  onDeleteRecent?: () => void;

  // Rich metadata for Inspector panel & secondary actions
  gameData?: Game;
  storeData?: StoreGameSummary;
  downloadData?: TorrentDownload;
  calcData?: CalculationResult;
  achievementStats?: PaletteAchievementStats;
  metaDetails?: {
    label: string;
    value: string | number | ReactNode;
  }[];
  description?: string;
  isRecent?: boolean;
  frequency?: number;
}

export interface PaletteRecentItem {
  id: string;
  title: string;
  category: PaletteCategory;
  timestamp: number;
  frequency?: number;
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
  source?: string;
  genre?: string;
  tag?: string;
  developer?: string;
  publisher?: string;
  year?: number;
  yearOp?: ">" | "<" | "=";
}
