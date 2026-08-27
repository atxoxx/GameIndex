import type { ReactNode } from "react";
import type { Game, StoreGameSummary } from "../../types/game";
import type { TorrentDownload } from "../../types/download";

export type PaletteCategory =
  | "all"
  | "games"
  | "actions"
  | "navigation"
  | "themes"
  | "downloads"
  | "store";

export interface PaletteQuickAction {
  id: string;
  icon: ReactNode;
  title: string;
  shortcut?: string;
  onClick: (e: React.MouseEvent) => void;
}

export interface PaletteItem {
  id: string;
  category: "games" | "actions" | "navigation" | "themes" | "downloads" | "store";
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

  // Rich metadata for Inspector panel
  gameData?: Game;
  storeData?: StoreGameSummary;
  downloadData?: TorrentDownload;
  metaDetails?: {
    label: string;
    value: string | number | ReactNode;
  }[];
  description?: string;
}

export interface PaletteRecentItem {
  id: string;
  title: string;
  category: PaletteCategory;
  timestamp: number;
}

export interface MatchHighlight {
  start: number;
  end: number;
}
