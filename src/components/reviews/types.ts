import {
  type Game,
  type IgdbReview,
  type SteamHardware,
  type SteamReaction,
} from "../../types/game";

export type SourceFilter =
  | "all"
  | "steam"
  | "metacritic"
  | "opencritic";

export type DisplayOrder = "summary" | "all" | "recent" | "funny";
export type ReviewTypeFilter = "all" | "positive" | "negative";
export type PurchaseTypeFilter = "all" | "steam" | "other";
export type PlaytimePresetFilter = "none" | "over_1h" | "over_10h" | "custom";
export type PlaytimeDeviceFilter = "all" | "deck";

export interface ReviewItem {
  id: string;
  sourceIndex: number;
  source: "steam" | "metacritic" | "opencritic";
  sourceLabel: string;
  username: string;
  rating: number | null;
  ratingLabel: string;
  title: string;
  content: string;
  dateAdded?: number;
  reviewLength: number;
  reviewLengthBytes: number;
  language?: string;
  sentiment: "positive" | "negative" | null;
  votesUp?: number;
  votesFunny?: number;
  reactions?: SteamReaction[];
  commentCount?: number;
  authorPlaytimeAtReview?: number;
  authorPlaytimeForever?: number;
  authorDeckPlaytimeAtReview?: number;
  primarilySteamDeck?: boolean;
  receivedForFree?: boolean;
  writtenDuringEarlyAccess?: boolean;
  steamPurchase?: boolean;
  authorSteamId?: string;
  hw?: SteamHardware | string;
}

export interface DropdownItem {
  value: string;
  label: string;
  flag?: string;
}

export interface ExternalSourceDescriptor {
  id: string;
  name: string;
  url: string;
  description: string;
  accent: string;
  criticKey?: "metacritic" | "opencritic";
}

export interface ReviewsTabProps {
  game: Game;
  onReviewsFetched?: (reviews: IgdbReview[], source: string) => void;
}
