import type { GamePassGame, Giveaway, PlaytesterGame } from "../../types/deals";
import {
  titleToSlug,
  type DealGroup,
  type DealsFiltersState,
  type GamePassFiltersState,
  type GiveawaysFiltersState,
  type PlaytesterFiltersState,
} from "./dealsConstants";

/**
 * Pure client-side filtering + ordering for the four deal sources.
 *
 * The backend already applies the server-side filters (minimum discount,
 * storefront, region). These helpers cover what the user can toggle instantly —
 * search, wishlist/owned scopes, ordering — and stay free of React so the
 * behaviour can be tested directly.
 */

export interface DealFilterContext {
  isWishlisted: (slug: string) => boolean;
  isOwned: (title: string) => boolean;
}

function matchesQuery(haystack: string[], query: string): boolean {
  if (!query) return true;
  return haystack.some((value) => value.toLowerCase().includes(query));
}

export function filterDealGroups(
  groups: DealGroup[],
  filters: DealsFiltersState,
  ctx: DealFilterContext,
): DealGroup[] {
  const query = filters.searchQuery.trim().toLowerCase();
  let list = groups.filter((group) => {
    if (!matchesQuery(
      [group.title, ...group.offers.map((offer) => offer.storeName)],
      query,
    )) {
      return false;
    }
    if (filters.wishlistOnly && !ctx.isWishlisted(titleToSlug(group.title))) {
      return false;
    }
    if (filters.hideOwned && ctx.isOwned(group.title)) return false;
    return true;
  });

  list = [...list].sort((a, b) => {
    switch (filters.sortBy) {
      case "discount_desc":
        return b.maxDiscount - a.maxDiscount;
      case "savings_desc":
        return b.savings - a.savings;
      case "price_asc":
        return a.bestPrice - b.bestPrice;
      case "price_desc":
        return b.bestPrice - a.bestPrice;
      case "title_desc":
        return b.title.localeCompare(a.title);
      case "title_asc":
      default:
        return a.title.localeCompare(b.title);
    }
  });

  return list;
}

export function filterGamePassGames(
  games: GamePassGame[],
  filters: GamePassFiltersState,
  ctx: DealFilterContext,
): GamePassGame[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const list = games.filter((game) => {
    if (!matchesQuery(
      [
        game.title,
        game.developer ?? "",
        game.publisher ?? "",
        ...game.categories,
      ],
      query,
    )) {
      return false;
    }
    if (filters.wishlistOnly && !ctx.isWishlisted(titleToSlug(game.title))) {
      return false;
    }
    if (filters.hideOwned && ctx.isOwned(game.title)) return false;
    return true;
  });

  return list.sort((a, b) => {
    switch (filters.sortBy) {
      case "title_desc":
        return b.title.localeCompare(a.title);
      case "release_desc": {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return db - da;
      }
      case "release_asc": {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return da - db;
      }
      case "title_asc":
      default:
        return a.title.localeCompare(b.title);
    }
  });
}

export function filterGiveaways(
  giveaways: Giveaway[],
  filters: GiveawaysFiltersState,
  now: number,
): Giveaway[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const list = giveaways.filter((giveaway) => {
    if (!matchesQuery(
      [giveaway.title, giveaway.storeName, giveaway.bundleTitle ?? ""],
      query,
    )) {
      return false;
    }
    if (
      filters.store !== "all" &&
      giveaway.storeName.toLowerCase() !== filters.store.toLowerCase()
    ) {
      return false;
    }
    if (filters.activeOnly && giveaway.expiry) {
      const end = new Date(giveaway.expiry).getTime();
      if (Number.isFinite(end) && end <= now) return false;
    }
    return true;
  });

  return list.sort((a, b) => {
    switch (filters.sortBy) {
      case "title_asc":
        return a.title.localeCompare(b.title);
      case "title_desc":
        return b.title.localeCompare(a.title);
      case "expiry_asc":
      default: {
        const ta = a.expiry ? new Date(a.expiry).getTime() : Infinity;
        const tb = b.expiry ? new Date(b.expiry).getTime() : Infinity;
        return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
      }
    }
  });
}

export function filterPlaytesterGames(
  games: PlaytesterGame[],
  filters: PlaytesterFiltersState,
  ctx: DealFilterContext,
): PlaytesterGame[] {
  const query = filters.searchQuery.trim().toLowerCase();

  const list = games.filter((game) => {
    if (!matchesQuery(
      [game.title, game.platform, game.kind, game.status, ...game.genres, game.description ?? ""],
      query,
    )) {
      return false;
    }
    if (filters.platform !== "all" && !game.platforms.includes(filters.platform)) {
      return false;
    }
    if (filters.genre !== "all" && !game.genres.includes(filters.genre)) {
      return false;
    }
    if (filters.status !== "all" && game.status !== filters.status) {
      return false;
    }
    if (filters.kind !== "all" && game.kind !== filters.kind) {
      return false;
    }
    if (filters.wishlistOnly && !ctx.isWishlisted(titleToSlug(game.title))) {
      return false;
    }
    if (filters.hideOwned && ctx.isOwned(game.title)) return false;
    return true;
  });

  return list.sort((a, b) => {
    switch (filters.sortBy) {
      case "newest_asc": {
        const da = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
        const db = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
        return da - db;
      }
      case "title_asc":
        return a.title.localeCompare(b.title);
      case "title_desc":
        return b.title.localeCompare(a.title);
      case "newest_desc":
      default: {
        const da = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
        const db = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
        return db - da;
      }
    }
  });
}

/** Giveaways closing within the urgent window, soonest first. */
export function endingSoonGiveaways(
  giveaways: Giveaway[],
  now: number,
  windowMs: number,
): Giveaway[] {
  return giveaways
    .filter((giveaway) => {
      if (!giveaway.expiry) return false;
      const end = new Date(giveaway.expiry).getTime();
      if (!Number.isFinite(end)) return false;
      const left = end - now;
      return left > 0 && left <= windowMs;
    })
    .sort((a, b) => {
      const ta = a.expiry ? new Date(a.expiry).getTime() : Infinity;
      const tb = b.expiry ? new Date(b.expiry).getTime() : Infinity;
      return ta - tb;
    });
}

/**
 * Deals in the user's wishlist, biggest discount first.
 *
 * The lookup is passed in rather than imported so the controller can bind it to
 * `useWishlist` while tests hand over a plain set.
 */
export function wishlistGroups(
  groups: DealGroup[],
  isWishlisted: (slug: string) => boolean,
): DealGroup[] {
  return groups
    .filter((group) => isWishlisted(titleToSlug(group.title)))
    .sort((a, b) => b.maxDiscount - a.maxDiscount);
}


