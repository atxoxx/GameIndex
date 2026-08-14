import type { ReactNode } from "react";
import type { Game } from "../../types/game";

export interface WebLinksTabProps {
  game: Game;
  visible?: boolean;
  onWebsitesChange?: (websites: string[]) => void;
}

export type SourceCategoryKey =
  | "all"
  | "stores"
  | "wikis"
  | "community"
  | "modding"
  | "mylinks";

export type FixedSourceKey =
  | "steam"
  | "steamdb"
  | "isthereanydeal"
  | "gog"
  | "epic"
  | "protondb"
  | "pcgamingwiki"
  | "hltb"
  | "metacritic"
  | "igdb"
  | "ign"
  | "youtube"
  | "twitch"
  | "reddit"
  | "nexusmods"
  | "moddb"
  | "speedrun"
  | "steamgriddb";

export type SteamSectionKey =
  | "store"
  | "community"
  | "discussions"
  | "news"
  | "workshop"
  | "guides"
  | "screenshots"
  | "videos"
  | "achievements"
  | "broadcasts";

export interface SourceDef {
  /** Identifier for fixed sources or user-added URL */
  key: string;
  label: string;
  category: SourceCategoryKey;
  /** Brand color for active highlights and borders */
  accent: string;
  /** Background badge color for chip */
  iconBg: string;
  /** Inline SVG element */
  icon: ReactNode;
  /** Set for custom links */
  url?: string;
  /** Optional custom tag or note */
  tag?: string;
}

export interface SteamSectionDef {
  key: SteamSectionKey;
  label: string;
  i18nKey: string;
  icon: ReactNode;
  /** Whether an AppID is strictly required to navigate (false for store search fallback) */
  requiresAppId?: boolean;
}

export type ViewHeightMode = "standard" | "tall" | "max";

export interface CustomLinkItem {
  id: string;
  url: string;
  label: string;
  host: string;
  tag?: string;
}
