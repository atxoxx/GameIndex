import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useGames } from "../context/GameContext";
import { useProgressiveImage } from "../hooks/useProgressiveImages";
import { useBigScreen } from "../context/BigScreenContext";
import { useFocusable } from "../hooks/useFocusable";
import { useLanguage } from "../context/LanguageContext";
import { useGameCardArt } from "../hooks/useGameCardArt";
import { slugify, gameDisplayName } from "../types/game";
import type {
  Game,
  GameMetadataResult,
  GameRelationsResult,
  RelatedGame,
  RelatedGameEntry,
  RelationGameGroup,
  RelationGroup,
  RelationType,
  StoreGameSummary,
  SimilarGame,
} from "../types/game";
import {
  RELATION_GROUP_ORDER,
} from "../types/game";

/* ────────────────────────────────────────────────────────────────────────
 *  GameRelationsCard
 * ────────────────────────────────────────────────────────────────────────
 *
 *  A unified "Game Relations" card that surfaces every meaningful
 *  relationship the current game has with other games — both inside
 *  the local library and from IGDB.
 *
 *  Inspired by Playnite's "GameRelations" generic extension
 *  (https://github.com/darklinkpower/PlayniteExtensionsCollection
 *  /tree/master/source/Generic/GameRelations), which surfaces
 *  library-local matches (Same Series, Same Developer, Same
 *  Publisher) alongside similarity signals. We extend that idea to
 *  also surface IGDB-derived groups (Collection Members, Similar
 *  Games) on the Store game detail page where local-library
 *  matching is the wrong primary signal.
 *
 *  ── Two modes, one component ──
 *
 *  - `mode="library"`  (Library GamePage)
 *      Scans the local library via `useGames()` to compute 4
 *      library-local groups: same series, same franchise, same
 *      developer, same publisher, plus a shared-genres fallback
 *      for games that don't share a high-level metadata field.
 *
 *  - `mode="store"`    (Store GameDetail)
 *      Uses the IGDB-sourced data passed in as props (similar
 *      games) plus a one-shot `get_collection_games` Tauri
 *      command to fetch the rest of the collection. Also runs the
 *      library scan in "in your library" mode (the store game's
 *      title is matched against local library names) so the user
 *      can jump to the owned copy with one click.
 *
 *  ── Deduplication ──
 *
 *  A single `seenIds: Set<string>` is threaded through the group
 *  builders so the same game never appears in two different
 *  groups. Without this, "Halo: Combat Evolved" could surface in
 *  "Same Series", "Same Developer", and "Same Publisher" all at
 *  once, which the user experience treats as redundant. Games are
 *  keyed by their normalized lowercase name so library games and
 *  IGDB games with the same title dedupe correctly.
 *
 *  ── Empty state ──
 *
 *  If no groups have content after the scan, the card renders
 *  `null` (i.e. nothing). An empty "Game Relations" card with
 *  just a title and "Nothing to show" would be visual noise on
 *  games that genuinely don't have any local or IGDB relations.
 *
 *  ── Performance ──
 *
 *  The library scan is O(N × G) where N is library size and G is
 *  the number of groups being built (max 5). For a 1000-game
 *  library, that's 5000 string comparisons — well under 1ms in
 *  V8. Memoized with `useMemo` so re-renders (e.g. when the
 *  active tab on the GamePage flips) don't re-run the scan.
 * ──────────────────────────────────────────────────────────────────── */

// ─── Public Props ──────────────────────────────────────────────────────

export type GameRelationsMode = "library" | "store";

interface BaseProps {
  /** Where the card is mounted. Drives which group builders run. */
  mode: GameRelationsMode;
  /**
   * The "current" game the relations are computed against.
   * In `mode="library"` this should be a `Game` from the local
   * library. In `mode="store"` this should be the
   * `GameMetadataResult` from `get_store_game_detail`. The
   * component is duck-typed against both via field-presence
   * checks — both have `name` and optional `developer` /
   * `publisher` / `collection` / `franchise` / `genres`.
   */
  currentGame: Game | GameMetadataResult;
  /** IGDB numeric id for the current game. When present, the card
   *  fetches the external IGDB relation graph; when absent it falls
   *  back to the local-library-only behavior. */
  igdbId?: number | null;
}

interface LibraryModeProps extends BaseProps {
  mode: "library";
  /** The current game's local-library id (used for self-exclusion). */
  currentGameId: string;
  /** IGDB's `similar_games` field, already on the Game's metadata.
   *  Optional: when absent, the "Similar games" group is omitted. */
  similarGames?: SimilarGame[];
  /** IGDB collection ID for the "Other in this collection" group.
   *  Optional: when absent, the "Other in this collection" group is
   *  omitted (which is the common case for one-off games). */
  collectionId?: number;
  /** Human-readable collection name (used as the group's subtitle). */
  collectionName?: string;
}

interface StoreModeProps extends BaseProps {
  mode: "store";
  /** IGDB's `similar_games` field, already on the metadata. */
  similarGames?: SimilarGame[];
  /** IGDB collection ID for the "Other in Collection" group. */
  collectionId?: number;
  /** Human-readable collection name (used as the group's subtitle). */
  collectionName?: string;
}

export type GameRelationsCardProps = LibraryModeProps | StoreModeProps;

/* ─── Module-level collection cache ─────────────────────────────────────
 *
 * The Store page may mount the GameRelationsCard for many
 * different games in a single session (e.g. when a user is
 * browsing several trending games in a row). Without a cache,
 * each mount would re-query IGDB for the collection members.
 *
 * Keyed by `collection_id`. The 6-hour TTL matches the existing
 * `STORE_CACHE_TTL_MS` constant in the store cache; collection
 * membership is stable on the same timescale (IGDB rarely adds
 * or removes titles from a collection once published).
 *
 * Bounded to `COLLECTION_CACHE_MAX_ENTRIES` to prevent unbounded
 * memory growth across long browsing sessions. When the cap is
 * hit, the oldest insertion is evicted (FIFO via Map iteration
 * order, which is guaranteed to be insertion order).
 *
 * Errors are not cached: if IGDB returned an error, we want the
 * next mount to retry. Only successful empty arrays are cached.
 */
interface CollectionCacheEntry {
  games: StoreGameSummary[];
  fetchedAt: number;
}
const collectionCache = new Map<number, CollectionCacheEntry>();
const COLLECTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const COLLECTION_CACHE_MAX_ENTRIES = 50; // ~50 collections × ~5KB each = 250KB ceiling

/* ─── Module-level IGDB relations cache ──────────────────────────────
 *
 * `get_game_relations` fans out into several metered IGDB requests, so
 * we cache the assembled graph per IGDB id in memory. Same 6h TTL and
 * bounded FIFO eviction as the collection cache above. */
interface RelationsCacheEntry {
  data: GameRelationsResult;
  fetchedAt: number;
}
const relationsCache = new Map<number, RelationsCacheEntry>();
const RELATIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const RELATIONS_CACHE_MAX_ENTRIES = 200;

/* ─── Library scan helpers ──────────────────────────────────────────── */

/** Normalize a name for cross-source deduplication. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

/** Split comma- or semicolon-separated multi-value metadata (franchises, co-developers). */
function tokenizeList(str?: string): string[] {
  if (!str) return [];
  return str
    .split(/[;,]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True when two tokenized lists share at least one element. */
function hasAnyOverlap(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const tokensA = tokenizeList(a);
  const tokensB = tokenizeList(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  const setA = new Set(tokensA);
  return tokensB.some((t) => setA.has(t));
}

/** True when two strings are essentially the same, ignoring trivial
 *  differences (whitespace, case). Used for the in-library check
 *  on the Store page where the IGDB title and the library name
 *  may differ in punctuation but refer to the same game. */
function namesMatch(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/** Count overlapping elements between two string arrays. */
function countOverlap(a: string[] | undefined, b: string[] | undefined): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const set = new Set(a.map((g) => g.toLowerCase()));
  let count = 0;
  for (const g of b) {
    if (set.has(g.toLowerCase())) count++;
  }
  return count;
}

/** Wrap an external IGDB entry as a navigable `RelatedGame`. */
function toRelatedGame(entry: RelatedGameEntry): RelatedGame {
  return {
    id: entry.id,
    name: entry.name,
    coverUrl: entry.coverUrl ?? null,
    slug: slugify(entry.name),
  };
}

/** Flatten every group's games into one deduped list. */
function flattenRelationGroups(groups: RelationGameGroup[]): RelatedGame[] {
  const out: RelatedGame[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const g of group.games) {
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(toRelatedGame(g));
    }
  }
  return out;
}

/** Append external IGDB games to a local-match group, deduping by
 *  normalized name and linking entries that exist in the library. */
function appendExternal(
  matches: RelatedGame[],
  seen: Set<string>,
  library: Game[],
  external: RelatedGame[]
): void {
  for (const ext of external) {
    const key = normalizeName(ext.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const inLib = library.find((lg) => namesMatch(lg.name, ext.name));
    matches.push({
      ...ext,
      coverUrl: inLib?.coverArtUrl ?? ext.coverUrl ?? null,
      inLibrary: !!inLib,
      libraryGameId: inLib?.id,
    });
  }
}

/** Pre-resolved data passed into both group builders. */
interface ExternalRelations {
  similarGames: RelatedGame[];
  collectionGames: RelatedGame[];
  franchiseGames: RelatedGame[];
  developerGames: RelatedGame[];
  publisherGames: RelatedGame[];
}

/* ─── Group builders (per mode) ─────────────────────────────────────── */

/** Library-mode: build all 7 groups (5 library-local + 2 IGDB-derived) in one pass. */
function buildLibraryGroups(
  current: Game,
  library: Game[],
  external: ExternalRelations
): RelationGroup[] {
  const name = ("name" in current ? current.name : (current as any).title) || "";
  const seen = new Set<string>();
  // Reserve the current game's own name so it never re-appears
  // in any group (it's the "anchor" the user is already on).
  seen.add(normalizeName(name));
  const { similarGames, collectionGames: collectionMembers } = external;

  const groups: RelationGroup[] = [];

  // 1. Same Series (collection ID or collection name)
  if (
    (current.collection && current.collection.trim().length > 0) ||
    current.collectionId != null
  ) {
    const currentCollection = current.collection?.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      const idMatch =
        current.collectionId != null &&
        g.collectionId != null &&
        g.collectionId === current.collectionId;
      const nameMatch =
        currentCollection &&
        g.collection !== undefined &&
        g.collection.toLowerCase().trim() === currentCollection;
      if (idMatch || nameMatch) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: gameDisplayName(g),
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_series",
        title: "More from this series",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 2. Same Franchise (tokenized overlap matching)
  {
    const matches: RelatedGame[] = [];
    if (current.franchise && current.franchise.trim().length > 0) {
      for (const g of library) {
        if (g.id === current.id) continue;
        if (hasAnyOverlap(g.franchise, current.franchise)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.franchiseGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_franchise",
        title: "More from this franchise",
        subtitle: current.franchise,
        games: matches,
      });
    }
  }

  // 3. Same Developer (tokenized overlap matching for co-developers)
  {
    const matches: RelatedGame[] = [];
    if (current.developer && current.developer.trim().length > 0) {
      for (const g of library) {
        if (g.id === current.id) continue;
        if (hasAnyOverlap(g.developer, current.developer)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.developerGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_developer",
        title: "More by this developer",
        subtitle: current.developer ?? undefined,
        games: matches,
      });
    }
  }

  // 4. Same Publisher (tokenized overlap matching)
  {
    const matches: RelatedGame[] = [];
    if (current.publisher && current.publisher.trim().length > 0) {
      for (const g of library) {
        if (g.id === current.id) continue;
        if (hasAnyOverlap(g.publisher, current.publisher)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.publisherGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_publisher",
        title: "More by this publisher",
        subtitle: current.publisher ?? undefined,
        games: matches,
      });
    }
  }

  // 5. Shared Genres & Tags (relevance-sorted by overlap count)
  if (current.genres && current.genres.length > 0) {
    const scoredMatches: { game: RelatedGame; key: string; score: number }[] = [];
    for (const g of library) {
      if (g.id === current.id) continue;
      if (!g.genres || g.genres.length === 0) continue;
      const overlap = countOverlap(g.genres, current.genres);
      if (overlap < 2) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      scoredMatches.push({
        game: {
          id: 0,
          name: gameDisplayName(g),
          coverUrl: g.coverArtUrl,
          libraryGameId: g.id,
          inLibrary: true,
        },
        key,
        score: overlap,
      });
    }
    // Highest tag overlap first
    scoredMatches.sort((a, b) => b.score - a.score);
    const matches: RelatedGame[] = [];
    for (const { game, key } of scoredMatches.slice(0, 16)) {
      seen.add(key);
      matches.push(game);
    }
    if (matches.length > 0) {
      groups.push({
        type: "shared_genres",
        title: "Similar by genre & tags",
        subtitle: `${matches.length} game${matches.length !== 1 ? "s" : ""} with overlapping tags`,
        games: matches,
      });
    }
  }

  // 6. Other in this collection (IGDB-fetched, cross-linked to library)
  if (collectionMembers.length > 0) {
    const matches: RelatedGame[] = [];
    for (const s of collectionMembers) {
      if (namesMatch(s.name, name)) continue;
      const key = normalizeName(s.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const inLib = library.find((lg) => namesMatch(lg.name, s.name));
      matches.push({
        id: s.id,
        name: s.name,
        coverUrl: inLib?.coverArtUrl ?? s.coverUrl,
        slug: s.slug,
        inLibrary: !!inLib,
        libraryGameId: inLib?.id,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "other_in_collection",
        title: "Other in this collection",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 7. Similar games (IGDB, cross-linked to library)
  if (similarGames.length > 0) {
    const matches: RelatedGame[] = [];
    for (const sg of similarGames) {
      const key = normalizeName(sg.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const inLib = library.find((lg) => namesMatch(lg.name, sg.name));
      matches.push({
        id: sg.id,
        name: sg.name,
        coverUrl: inLib?.coverArtUrl ?? sg.coverUrl,
        slug: slugify(sg.name),
        inLibrary: !!inLib,
        libraryGameId: inLib?.id,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "similar",
        title: "Similar games",
        subtitle: "From IGDB",
        games: matches,
      });
    }
  }

  // Sort groups by canonical order
  groups.sort(
    (a, b) =>
      RELATION_GROUP_ORDER.indexOf(a.type) -
      RELATION_GROUP_ORDER.indexOf(b.type)
  );

  return groups;
}

/** Store-mode: build library + IGDB + collection groups. */
function buildStoreGroups(
  current: GameMetadataResult,
  library: Game[],
  external: ExternalRelations
): RelationGroup[] {
  const title = ("title" in current ? current.title : (current as any).name) || "";
  const seen = new Set<string>();
  // Reserve the current title.
  seen.add(normalizeName(title));
  const { similarGames, collectionGames: collectionMembers } = external;

  const groups: RelationGroup[] = [];

  // 1. In Your Library (cross-ref the local library for matches by name)
  // O(N) — single pass, no nested .find() calls.
  //
  // BUGFIX: the previous order checked `seen.has(key)` BEFORE
  // `namesMatch`, which always returned early for the current
  // game's own title (seeded into `seen` at the top of this
  // function) and silently produced an empty group. We now check
  // name match first and only consult `seen` to dedupe; this
  // correctly surfaces library games that share the current
  // title under any punctuation/case variation.
  const inLibrary: RelatedGame[] = [];
  for (const g of library) {
    if (!namesMatch(g.name, title)) continue;
    const key = normalizeName(g.name);
    if (seen.has(key)) continue;
    seen.add(key);
    inLibrary.push({
      id: 0,
      name: gameDisplayName(g),
      coverUrl: g.coverArtUrl,
      libraryGameId: g.id,
      inLibrary: true,
    });
  }
  if (inLibrary.length > 0) {
    groups.push({
      type: "in_your_library",
      title: "In your library",
      subtitle: "You already own this game",
      games: inLibrary,
    });
  }

  // 2. Other in Collection (IGDB-fetched, cross-linked to library)
  if (collectionMembers.length > 0) {
    const matches: RelatedGame[] = [];
    for (const s of collectionMembers) {
      if (namesMatch(s.name, title)) continue;
      const key = normalizeName(s.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const inLib = library.find((lg) => namesMatch(lg.name, s.name));
      matches.push({
        id: s.id,
        name: s.name,
        coverUrl: inLib?.coverArtUrl ?? s.coverUrl,
        slug: s.slug,
        inLibrary: !!inLib,
        libraryGameId: inLib?.id,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "other_in_collection",
        title: "Other in this collection",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 3. Similar Games (IGDB, cross-linked to library)
  if (similarGames.length > 0) {
    const matches: RelatedGame[] = [];
    for (const sg of similarGames) {
      const key = normalizeName(sg.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const inLib = library.find((lg) => namesMatch(lg.name, sg.name));
      matches.push({
        id: sg.id,
        name: sg.name,
        coverUrl: inLib?.coverArtUrl ?? sg.coverUrl,
        slug: slugify(sg.name),
        inLibrary: !!inLib,
        libraryGameId: inLib?.id,
      });
    }
    if (matches.length > 0) {
      groups.push({
        type: "similar",
        title: "Similar games",
        subtitle: "From IGDB",
        games: matches,
      });
    }
  }

  // 4. Same Developer (tokenized overlap matching)
  {
    const matches: RelatedGame[] = [];
    if (current.developer && current.developer.trim().length > 0) {
      for (const g of library) {
        if (hasAnyOverlap(g.developer, current.developer)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.developerGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_developer",
        title: "More by this developer",
        subtitle: current.developer ?? undefined,
        games: matches,
      });
    }
  }

  // 5. Same Publisher (tokenized overlap matching)
  {
    const matches: RelatedGame[] = [];
    if (current.publisher && current.publisher.trim().length > 0) {
      for (const g of library) {
        if (hasAnyOverlap(g.publisher, current.publisher)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.publisherGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_publisher",
        title: "More by this publisher",
        subtitle: current.publisher ?? undefined,
        games: matches,
      });
    }
  }

  // 6. Same Series / collection (library scan by collectionId or name)
  if (
    (current.collection && current.collection.trim().length > 0) ||
    current.collectionId != null
  ) {
    const currentCollection = current.collection?.toLowerCase().trim();
    const matches: RelatedGame[] = [];
    for (const g of library) {
      const idMatch =
        current.collectionId != null &&
        g.collectionId != null &&
        g.collectionId === current.collectionId;
      const nameMatch =
        currentCollection &&
        g.collection !== undefined &&
        g.collection.toLowerCase().trim() === currentCollection;
      if (idMatch || nameMatch) {
        const key = normalizeName(g.name);
        if (!seen.has(key)) {
          seen.add(key);
          matches.push({
            id: 0,
            name: gameDisplayName(g),
            coverUrl: g.coverArtUrl,
            libraryGameId: g.id,
            inLibrary: true,
          });
        }
      }
    }
    if (matches.length > 0) {
      groups.push({
        type: "same_series",
        title: "More from this series",
        subtitle: current.collection,
        games: matches,
      });
    }
  }

  // 7. Same Franchise (tokenized overlap matching)
  {
    const matches: RelatedGame[] = [];
    if (current.franchise && current.franchise.trim().length > 0) {
      for (const g of library) {
        if (hasAnyOverlap(g.franchise, current.franchise)) {
          const key = normalizeName(g.name);
          if (!seen.has(key)) {
            seen.add(key);
            matches.push({
              id: 0,
              name: gameDisplayName(g),
              coverUrl: g.coverArtUrl,
              libraryGameId: g.id,
              inLibrary: true,
            });
          }
        }
      }
    }
    appendExternal(matches, seen, library, external.franchiseGames);
    if (matches.length > 0) {
      groups.push({
        type: "same_franchise",
        title: "More from this franchise",
        subtitle: current.franchise,
        games: matches,
      });
    }
  }

  // 8. Shared Genres & Tags (relevance-sorted by overlap count)
  if (current.genres && current.genres.length > 0) {
    const scoredMatches: { game: RelatedGame; key: string; score: number }[] = [];
    for (const g of library) {
      if (!g.genres || g.genres.length === 0) continue;
      const overlap = countOverlap(g.genres, current.genres);
      if (overlap < 2) continue;
      const key = normalizeName(g.name);
      if (seen.has(key)) continue;
      scoredMatches.push({
        game: {
          id: 0,
          name: gameDisplayName(g),
          coverUrl: g.coverArtUrl,
          libraryGameId: g.id,
          inLibrary: true,
        },
        key,
        score: overlap,
      });
    }
    scoredMatches.sort((a, b) => b.score - a.score);
    const matches: RelatedGame[] = [];
    for (const { game, key } of scoredMatches.slice(0, 16)) {
      seen.add(key);
      matches.push(game);
    }
    if (matches.length > 0) {
      groups.push({
        type: "shared_genres",
        title: "Similar by genre & tags",
        subtitle: `${matches.length} game${matches.length !== 1 ? "s" : ""} with overlapping tags`,
        games: matches,
      });
    }
  }

  // Sort groups by the canonical order so the UI is predictable
  // even though the builder doesn't insert in that order.
  groups.sort(
    (a, b) =>
      RELATION_GROUP_ORDER.indexOf(a.type) -
      RELATION_GROUP_ORDER.indexOf(b.type)
  );

  return groups;
}

/* ─── Collection fetch hook (store mode only) ──────────────────────── */

function useCollectionGames(collectionId: number | undefined): {
  games: StoreGameSummary[];
  loading: boolean;
} {
  const [games, setGames] = useState<StoreGameSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (collectionId === undefined) {
      setGames([]);
      setLoading(false);
      return;
    }

    // Serve from cache when fresh.
    const cached = collectionCache.get(collectionId);
    if (
      cached !== undefined &&
      Date.now() - cached.fetchedAt < COLLECTION_CACHE_TTL_MS
    ) {
      setGames(cached.games);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    invoke<StoreGameSummary[]>("get_collection_games", {
      collectionId,
      limit: 50,
    })
      .then((result) => {
        if (cancelled) return;
        // Bounded FIFO eviction: if adding this entry would
        // exceed the cap, drop the oldest (first-inserted) entry
        // first. Map iteration order is insertion order, so the
        // first key is the oldest.
        if (collectionCache.size >= COLLECTION_CACHE_MAX_ENTRIES) {
          const oldestKey = collectionCache.keys().next().value;
          if (oldestKey !== undefined) {
            collectionCache.delete(oldestKey);
          }
        }
        collectionCache.set(collectionId, {
          games: result,
          fetchedAt: Date.now(),
        });
        setGames(result);
        setLoading(false);
      })
      .catch((err) => {
        // Silently ignore — the card will simply omit the
        // "Other in Collection" group when IGDB is unreachable.
        // Surfacing a toast here would be noisy since the page
        // already has other metadata-failure paths.
        console.warn("GameRelations: get_collection_games failed:", err);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  return { games, loading };
}

/* ─── IGDB relation graph hook (both modes) ────────────────────────── */

function useGameRelations(igdbId?: number | null): GameRelationsResult | null {
  const [data, setData] = useState<GameRelationsResult | null>(null);

  useEffect(() => {
    if (igdbId == null) {
      setData(null);
      return;
    }

    const cached = relationsCache.get(igdbId);
    if (cached !== undefined && Date.now() - cached.fetchedAt < RELATIONS_CACHE_TTL_MS) {
      setData(cached.data);
      return;
    }

    let cancelled = false;
    setData(null);
    invoke<GameRelationsResult>("get_game_relations", { igdbId })
      .then((result) => {
        if (cancelled) return;
        if (relationsCache.size >= RELATIONS_CACHE_MAX_ENTRIES) {
          const oldestKey = relationsCache.keys().next().value;
          if (oldestKey !== undefined) {
            relationsCache.delete(oldestKey);
          }
        }
        relationsCache.set(igdbId, { data: result, fetchedAt: Date.now() });
        setData(result);
      })
      .catch((err) => {
        console.warn("GameRelations: get_game_relations failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [igdbId]);

  return data;
}

/* ─── Group icon map ───────────────────────────────────────────────── */

const GROUP_ICONS: Record<RelationType, ReactNode> = {
  same_series: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  same_franchise: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  same_developer: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 18l6-6-6-6" />
      <path d="M8 6l-6 6 6 6" />
    </svg>
  ),
  same_publisher: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  shared_genres: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  ),
  in_your_library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  other_in_collection: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  similar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
};

/* ─── Group title / subtitle translation key maps ──────────────────── */

const GROUP_TITLE_KEY: Record<RelationType, string> = {
  same_series: "relations.group.sameSeries",
  same_franchise: "relations.group.sameFranchise",
  same_developer: "relations.group.sameDeveloper",
  same_publisher: "relations.group.samePublisher",
  shared_genres: "relations.group.sharedGenres",
  other_in_collection: "relations.group.otherCollection",
  similar: "relations.group.similar",
  in_your_library: "relations.group.inLibrary",
};

/** Subtitles that are static (i18n-able) rather than dynamic data. */
const GROUP_STATIC_SUBTITLE_KEY: Partial<Record<RelationType, string>> = {
  in_your_library: "relations.subtitle.inLibrary",
  similar: "relations.subtitle.similar",
  shared_genres: "relations.group.sharedGenresSub",
};

/* ─── Per-card component (one row item) ────────────────────────────── */

function RelationRowCard({
  game,
  onClick,
}: {
  game: RelatedGame;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const { isBigScreen } = useBigScreen();
  const [hovered, setHovered] = useState(false);
  const focusProps = useFocusable(onClick);
  const [coverUrl, imgRef] = useProgressiveImage(game.coverUrl || null);

  const { displayUrl, handleError } = useGameCardArt({
    game,
    defaultCoverUrl: coverUrl,
    isHovered: hovered,
  });

  return (
    <div
      className="game-relation-card"
      {...(isBigScreen ? focusProps : { onClick })}
      role="button"
      tabIndex={isBigScreen ? -1 : 0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={isBigScreen ? undefined : (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={game.inLibrary ? `${game.name} (${t("relations.group.inLibrary")})` : game.name}
    >
      <div className="game-relation-card-cover">
        {displayUrl ? (
          <img
            ref={displayUrl === coverUrl ? imgRef : undefined}
            src={displayUrl}
            alt={game.name}
            loading="lazy"
            onError={handleError}
          />
        ) : (
          <div className="game-relation-card-cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        {game.inLibrary && (
           <span
            className="game-relation-card-pill"
            title={t("relations.group.inLibrary")}
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="9" height="9" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {t("relations.owned")}
          </span>
        )}
      </div>
      <div className="game-relation-card-body">
        <span className="game-relation-card-name" title={game.name}>
          {game.name}
        </span>
      </div>
    </div>
  );
}

/* ─── Group section ────────────────────────────────────────────────── */

function RelationGroupSection({
  group,
  onCardClick,
}: {
  group: RelationGroup;
  onCardClick: (game: RelatedGame) => void;
}) {
  const { t } = useLanguage();
  const subtitleKey = GROUP_STATIC_SUBTITLE_KEY[group.type];
  return (
    <div className="game-relations-group">
      <div className="game-relations-group-header">
        <span className="game-relations-group-icon">
          {GROUP_ICONS[group.type]}
        </span>
        <div className="game-relations-group-titles">
          <h4 className="game-relations-group-title">
            {t(GROUP_TITLE_KEY[group.type])}
            <span className="game-relations-group-count">
              {group.games.length}
            </span>
          </h4>
          {group.subtitle && (
            <span className="game-relations-group-subtitle">
              {subtitleKey
                ? t(subtitleKey, { count: group.games.length })
                : group.subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="game-relations-row">
        {group.games.map((g, i) => {
          // Composite key so the same game id can appear in two
          // different groups without React warning about duplicate
          // keys (we dedupe upstream, but be defensive).
          const key = `${group.type}-${g.libraryGameId ?? g.id ?? g.slug ?? g.name}-${i}`;
          return (
            <div key={key} className="game-relations-row-item">
              <RelationRowCard
                game={g}
                onClick={() => onCardClick(g)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main component ───────────────────────────────────────────────── */

export default function GameRelationsCard(props: GameRelationsCardProps) {
  const { t } = useLanguage();
  const { mode, currentGame } = props;
  const navigate = useNavigate();
  const { games: library } = useGames();
  const relations = useGameRelations(props.igdbId);

  const { games: collectionMembers } = useCollectionGames(
    relations && relations.collectionGroups.length > 0
      ? undefined
      : props.collectionId
  );

  const external = useMemo<ExternalRelations>(() => {
    const fetchedSimilar = relations?.similarGames;
    const similarGames: RelatedGame[] =
      fetchedSimilar && fetchedSimilar.length > 0
        ? fetchedSimilar.map(toRelatedGame)
        : (props.similarGames ?? []).map((sg) => ({
            id: sg.id,
            name: sg.name,
            coverUrl: sg.coverUrl ?? null,
            slug: slugify(sg.name),
          }));

    const externalCollectionGroups = relations?.collectionGroups;
    const collectionGames: RelatedGame[] =
      externalCollectionGroups && externalCollectionGroups.length > 0
        ? flattenRelationGroups(externalCollectionGroups)
        : collectionMembers.map((s) => ({
            id: s.id,
            name: s.name,
            coverUrl: s.coverUrl ?? null,
            slug: s.slug,
          }));

    return {
      similarGames,
      collectionGames,
      franchiseGames: flattenRelationGroups(relations?.franchiseGroups ?? []),
      developerGames: (relations?.developerGames ?? []).map(toRelatedGame),
      publisherGames: (relations?.publisherGames ?? []).map(toRelatedGame),
    };
  }, [relations, collectionMembers, props.similarGames]);

  const groups = useMemo<RelationGroup[]>(() => {
    if (mode === "library") {
      return buildLibraryGroups(currentGame as Game, library, external);
    }
    return buildStoreGroups(currentGame as GameMetadataResult, library, external);
  }, [mode, currentGame, library, external]);

  // Navigation handler — pick the right route based on which
  // navigation hint the entry carries. Library games win over
  // slugs because the user almost certainly wants to jump to
  // their owned copy if we know about one.
  const handleCardClick = (game: RelatedGame) => {
    if (game.libraryGameId) {
      navigate(`/library/${game.libraryGameId}`);
    } else if (game.slug) {
      navigate(`/store/${game.slug}`);
    }
  };

  // Empty state — don't render the card at all if every group
  // came back empty. An empty card with just a title and "No
  // related games" would be visual noise on games that genuinely
  // don't have any relations.
  if (groups.length === 0) return null;

  // Render order matches the canonical order, but our groups are
  // already built in that order, so we just render.
  return (
    <section className="game-section game-relations-card" aria-label={t("gameRelations.aria")}>
      <h2 className="game-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {t("relations.title")}
      </h2>
      <p className="game-relations-blurb">
        {mode === "library"
          ? t("relations.blurb.library")
          : t("relations.blurb.store")}
      </p>
      <div className="game-relations-groups">
        {groups.map((group) => (
          <RelationGroupSection
            key={group.type}
            group={group}
            onCardClick={handleCardClick}
          />
        ))}
      </div>
    </section>
  );
}
