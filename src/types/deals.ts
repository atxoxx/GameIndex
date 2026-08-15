/**
 * TypeScript types for the Deals tab.
 *
 * Mirrors the Rust structs in `src-tauri/src/deals.rs`. Field names follow
 * the camelCase serialization emitted by `#[serde(rename_all = "camelCase")]`
 * on the Rust side, so they line up 1:1 with the `invoke<T>()` return shape.
 */

/** A single Xbox GamePass catalog title. Returned by `fetch_gamepass_catalog`. */
export interface GamePassGame {
  /** Stable product id from the Microsoft catalog. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Short marketing blurb (may be missing for older entries). */
  description?: string | null;
  /** Square/poster image URL (RemoteSauce ImageItem URL). */
  coverImage?: string | null;
  /** Primary developer name (split from the catalog's combined string). */
  developer?: string | null;
  /** Primary publisher name (split from the catalog's combined string). */
  publisher?: string | null;
  /** Genre / category names ("Action", "RPG", etc.). */
  categories: string[];
  /** Platform names ("Xbox", "PC"). */
  platforms: string[];
  /** ISO date string for the original release. */
  releaseDate?: string | null;
  /** Big ProductId from the catalog (used to build the Xbox store deeplink). */
  productId?: string | null;
  /** Convenience deeplink straight to the Xbox store page for the title. */
  deeplink?: string | null;
}

/** A single deal row from IsThereAnyDeal. Returned by `fetch_isthereanydeal_deals`. */
export interface DealItem {
  /** Internal deal id (the ITAD link UUID). */
  id: string;
  /** Game title as it appears in the deal. */
  gameTitle: string;
  /** Store display name ("Steam", "Humble Store", "GreenManGaming"). */
  storeName: string;
  /** Direct purchase URL on the store — opened in the system browser. */
  storeUrl: string;
  /** Current price in EUR after discount. The original price is not
   * exposed by the ITAD homepage scrape, so there's no separate
   * `normalPrice` field. */
  dealPrice: number;
  /** Discount percentage (0–100). */
  discountPercent: number;
  /** ISO 8601 timestamp when the deal expires. Always `null` from
   * the homepage scrape — the frontend hides the "Ends" badge. */
  expiration?: string | null;
  /** Platform name. Always "Windows" from the homepage scrape. */
  platform: string;
  /** Square thumbnail. Always `null` from the homepage scrape —
   * the frontend shows the fallback icon. */
  thumbnail?: string | null;
}

/** Filters for `fetch_gamepass_catalog`. Empty/null fields mean "no filter". */
export interface GamePassFilters {
  /** ISO 3166-1 alpha-2 region code, e.g. "US", "UK". Defaults to "US". */
  region?: string | null;
  /** Category names; only games matching at least one are returned. */
  categories?: string[] | null;
  /** Platform filter ("xbox" | "pc" | "cloud" | "all"). */
  platform?: string | null;
}

/** Filters for `fetch_isthereanydeal_deals`. Empty/null fields mean "no filter". */
export interface DealsFilters {
  /** Kept for API compatibility but ignored by the backend — the
   * ITAD homepage doesn't expose per-deal platform info, so there's
   * nothing to filter on. */
  platform?: string | null;
  /** Minimum discount %, 0 means no minimum. */
  minDiscount?: number | null;
  /** "all" or a specific store id. */
  store?: string | null;
}

/** A single free game from ITAD's giveaways list.
 * Returned by `fetch_giveaways`. One entry per individual game. */
export interface Giveaway {
  /** Composite id (`"{giveawayId}-{gameId}"`). */
  id: string;
  /** Individual game title (e.g. "The Life and Suffering of Sir Brante"). */
  title: string;
  /** Parent giveaway title for context (e.g. "...free on Steam"). */
  bundleTitle: string;
  /** Storefront display name (e.g. "Steam", "Humble Bundle"). */
  storeName: string;
  /** Cover image URL. `null` when ITAD doesn't expose one — the
   * frontend shows a fallback icon. */
  imageUrl?: string | null;
  /** Direct claim URL (the giveaway's store/claim page). */
  dealUrl: string;
  /** 18+ flag. */
  isMature: boolean;
  /** ISO 8601 expiration timestamp. `null` when no expiry is set. */
  expiry?: string | null;
}

/** A single playtest / demo / beta entry from playtester.io.
 * Returned by `fetch_playtester_games`. */
export interface PlaytesterGame {
  /** Stable slug (unique per game) — also used as the card id. */
  id: string;
  /** URL slug; used to build the detail URL and thumbnail. */
  slug: string;
  /** Human-readable title. */
  title: string;
  /** Short marketing blurb (may be missing). */
  description?: string | null;
  /** Cover thumbnail URL. */
  thumbnail?: string | null;
  /** Primary platform badge ("Steam", "itch.io", …). Empty when unknown. */
  platform: string;
  /** Every platform the game is available on ("Steam", "itch.io", …). */
  platforms: string[];
  /** Displayed genres (the two featured categories shown on the card). */
  genres: string[];
  /** Offer type ("Demo", "Open Beta", "Closed Beta", …). */
  kind: string;
  /** Availability status ("Active" / "Inactive"). */
  status: string;
  /** ISO 8601 timestamp when the entry was added. */
  dateAdded?: string | null;
  /** Absolute URL of the game page on Playtester. */
  url: string;
}

/** A page of the Playtester feed, plus cursor info for "load more".
 * Returned by `fetch_playtester_games`. */
export interface PlaytesterFeed {
  games: PlaytesterGame[];
  hasMore: boolean;
  nextOffset: number;
  /** Total number of listing pages (homepage + category pages). */
  total: number;
}

/** One platform link (name + store URL) on a Playtester detail page. */
export interface PlaytesterPlatformLink {
  name: string;
  url: string;
}

/** One system-requirement row (label + value). */
export interface PlaytesterRequirement {
  label: string;
  value: string;
}

/** A screenshot / gallery image on a Playtester detail page. */
export interface PlaytesterPhoto {
  url: string;
  caption?: string | null;
}

/** A trailer / gameplay video on a Playtester detail page. */
export interface PlaytesterVideo {
  name?: string | null;
  thumbnailUrl?: string | null;
  /** Playable media URL (HLS manifest or direct file). */
  contentUrl?: string | null;
  /** Embeddable player URL (Cloudflare Stream iframe). */
  embedUrl?: string | null;
  duration?: string | null;
}

/** Full metadata for a single playtester.io game, scraped on demand.
 * Returned by `fetch_playtester_game_detail`. */
export interface PlaytesterGameDetail {
  slug: string;
  title: string;
  /** Availability status text (e.g. "Active Now"). */
  status?: string | null;
  studio?: string | null;
  studioUrl?: string | null;
  /** ISO timestamp when the entry was added. */
  added?: string | null;
  /** Short description. */
  description?: string | null;
  /** Offer type ("Demo", "Beta", …). */
  kind?: string | null;
  releaseDate?: string | null;
  languages?: string | null;
  controller?: string | null;
  platforms: PlaytesterPlatformLink[];
  systemRequirements: PlaytesterRequirement[];
  /** Screenshots (from the page's VideoGame JSON-LD). */
  photos: PlaytesterPhoto[];
  /** Trailers / gameplay videos (from the page's VideoGame JSON-LD). */
  videos: PlaytesterVideo[];
  /** Primary CTA target (e.g. the Steam store page). */
  demoUrl?: string | null;
  /** `steam://install/…` deep link, when available. */
  installUrl?: string | null;
  steamdbUrl?: string | null;
  thumbnail?: string | null;
  /** Absolute URL of the game page on Playtester. */
  url: string;
}
