/**
 * itch.io types shared by the Deals page (itch.io subtab) and the itch.io game
 * detail route.
 *
 * itch.io has no public catalogue API, so every list/detail shape here mirrors
 * what the store's own HTML exposes. Prices are in USD (itch's only checkout
 * currency); a `null` price means the game is free / name-your-own-price.
 */

export type ItchSort =
  | "popular"
  | "new-and-popular"
  | "top-sellers"
  | "top-rated"
  | "newest"
  | "price-asc"
  | "price-desc";

export type ItchPriceFilter =
  | "all"
  | "on-sale"
  | "free"
  | "5-dollars-or-less"
  | "15-dollars-or-less";

export type ItchPlatformFilter =
  | "all"
  | "web"
  | "windows"
  | "osx"
  | "linux"
  | "android";

export interface ItchGameSummary {
  /** itch game id (`data-game_id`). */
  id: string;
  /** `author/game` — the itch URL path, stable across renames of nothing. */
  slug: string;
  url: string;
  title: string;
  author: string;
  authorUrl: string | null;
  coverUrl: string | null;
  blurb: string | null;
  /** Minimum/final price in USD, `null` when free. */
  price: number | null;
  originalPrice: number | null;
  discountPercent: number;
  onSale: boolean;
  genre: string | null;
  /** Download platforms reported by the grid, e.g. `Windows`, `HTML5`. */
  platforms: string[];
  /** True when the request targeted itch's HTML5 platform facet. */
  playableInBrowser: boolean;
}

export interface ItchUpload {
  id: string;
  name: string;
  size: string | null;
  platforms: string[];
}

export interface ItchInfoRow {
  label: string;
  value: string;
}

export interface ItchGameDetail extends ItchGameSummary {
  descriptionHtml: string | null;
  screenshots: string[];
  /** YouTube/Vimeo embed URL of the page's trailer, when present. */
  trailerUrl: string | null;
  tags: string[];
  info: ItchInfoRow[];
  uploads: ItchUpload[];
  /** `html-classic.itch.zone` iframe URL that runs the game in-app. */
  playUrl: string | null;
  purchaseUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
  status: string | null;
  updated: string | null;
  released: string | null;
  devlogCount: number;
  commentCount: number;
  currency: string;
}

export interface ItchFeed {
  games: ItchGameSummary[];
  hasMore: boolean;
  /** Page number to request next (itch paginates with `?page=N`). */
  nextOffset: number;
  /** Total hits itch reported, when the page prints a count. */
  total: number | null;
  page: number;
}

export interface ItchFilters {
  sort: ItchSort;
  price: ItchPriceFilter;
  /** `genre-rpg` / `tag-horror` style facet segment, or null. */
  category: string | null;
  platform: ItchPlatformFilter;
  query: string;
  page: number;
}

export interface ItchOwnedFeed extends ItchFeed {
  /** False when there is no stored itch.io session. */
  authenticated: boolean;
}

/** itch's browsable genres, in the order the store lists them. */
export const ITCH_GENRES: { segment: string; label: string }[] = [
  { segment: "genre-action", label: "Action" },
  { segment: "genre-adventure", label: "Adventure" },
  { segment: "genre-platformer", label: "Platformer" },
  { segment: "genre-puzzle", label: "Puzzle" },
  { segment: "genre-rpg", label: "RPG" },
  { segment: "genre-shooter", label: "Shooter" },
  { segment: "genre-simulation", label: "Simulation" },
  { segment: "genre-sports", label: "Sports" },
  { segment: "genre-strategy", label: "Strategy" },
  { segment: "genre-visual-novel", label: "Visual Novel" },
  { segment: "genre-other", label: "Other" },
];

/** A handful of the tags that make itch browsing useful, not a full taxonomy. */
export const ITCH_TAGS: { segment: string; label: string }[] = [
  { segment: "tag-horror", label: "Horror" },
  { segment: "tag-pixel-art", label: "Pixel Art" },
  { segment: "tag-roguelike", label: "Roguelike" },
  { segment: "tag-metroidvania", label: "Metroidvania" },
  { segment: "tag-point-and-click", label: "Point & Click" },
  { segment: "tag-interactive-fiction", label: "Interactive Fiction" },
  { segment: "tag-survival", label: "Survival" },
  { segment: "tag-cozy", label: "Cozy" },
  { segment: "tag-multiplayer", label: "Multiplayer" },
  { segment: "tag-singleplayer", label: "Singleplayer" },
  { segment: "tag-cyoa", label: "CYOA" },
  { segment: "tag-game-jam", label: "Game Jam" },
];
