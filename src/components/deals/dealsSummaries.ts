import type { GamePassGame, Giveaway, PlaytesterGame } from "../../types/deals";
import type { StoreGameSummary } from "../../types/game";
import type { DealGroup } from "../../pages/deals/dealsConstants";
import { titleToSlug } from "../../pages/deals/dealsConstants";

/**
 * Wishlist payloads for each deals source.
 *
 * `useWishlist` stores a `StoreGameSummary`, so a deal/giveaway/playtest has to
 * be shaped like a store result before it can be saved. Keeping the mapping in
 * one module means the card and the detail modal always agree on the entry.
 */

function baseSummary(
  title: string,
  extra: Partial<StoreGameSummary>,
): StoreGameSummary {
  return {
    id: 0,
    name: title,
    slug: titleToSlug(title),
    summary: null,
    rating: null,
    aggregatedRating: null,
    coverUrl: null,
    logoUrl: null,
    genres: [],
    platforms: [],
    firstReleaseDate: null,
    totalRatingCount: 0,
    hypes: 0,
    ...extra,
  };
}

export function dealGroupSummary(group: DealGroup): StoreGameSummary {
  return baseSummary(group.title, {
    coverUrl: group.best.thumbnail ?? null,
    platforms: [group.best.platform],
  });
}

export function gamePassSummary(game: GamePassGame): StoreGameSummary {
  return baseSummary(game.title, {
    summary: game.description ?? null,
    coverUrl: game.coverImage ?? null,
    genres: game.categories,
    platforms: game.platforms,
    firstReleaseDate: game.releaseDate ?? null,
  });
}

export function giveawaySummary(giveaway: Giveaway): StoreGameSummary {
  return baseSummary(giveaway.title, {
    summary: giveaway.bundleTitle !== giveaway.title ? giveaway.bundleTitle : null,
    coverUrl: giveaway.imageUrl ?? null,
  });
}

export function playtesterSummary(
  game: PlaytesterGame,
  overrides?: Partial<StoreGameSummary>,
): StoreGameSummary {
  return baseSummary(game.title, {
    summary: game.description ?? null,
    coverUrl: game.thumbnail ?? null,
    genres: game.genres,
    platforms: game.platform ? [game.platform] : [],
    ...overrides,
  });
}
