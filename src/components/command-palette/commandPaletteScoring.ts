import type { Game } from "../../types/game";
import type { ParsedQueryFilters } from "./commandPaletteTypes";
import { scoreMatch } from "./commandPaletteUtils";

export interface GameFilterContext {
  isGameUntracked: (id: string) => boolean;
  runningGameIds: string[];
  wishlistNames: Set<string>;
}

/** Applies every structured power-filter token to a library slice. */
export function applyGameFilters(
  games: Game[],
  filters: ParsedQueryFilters,
  ctx: GameFilterContext
): Game[] {
  let list = games;

  if (filters.isInstalled) list = list.filter((g) => g.installed);
  if (filters.isCloud) list = list.filter((g) => !g.installed);
  if (filters.isFavorite) list = list.filter((g) => g.favorite);
  if (filters.excludeFavorite) list = list.filter((g) => !g.favorite);
  if (filters.isUnplayed) {
    list = list.filter((g) => (!g.playTime || g.playTime === "0h") && !g.lastPlayed);
  }
  if (filters.isRunning) list = list.filter((g) => ctx.runningGameIds.includes(g.id));
  if (filters.isUntracked) list = list.filter((g) => ctx.isGameUntracked(g.id));
  if (filters.isModded) {
    list = list.filter((g) => g.mo2LaunchEnabled || !!g.mo2Profile || !!g.mo2InstancePath);
  }
  if (filters.platform) {
    const pf = filters.platform.toLowerCase();
    list = list.filter((g) => g.platform?.toLowerCase().includes(pf));
  }
  if (filters.isWishlisted) {
    list = list.filter((g) => ctx.wishlistNames.has(g.name.toLowerCase()));
  }

  if (filters.source) {
    const src = filters.source.toLowerCase();
    list = list.filter((g) => {
      if (src === "steam") return !!g.steamAppId || g.platform?.toLowerCase().includes("steam");
      if (src === "gog") return !!g.gogGameId || g.platform?.toLowerCase().includes("gog");
      if (src === "epic") return !!g.epicNamespace || g.platform?.toLowerCase().includes("epic");
      if (src === "rockstar") return !!g.rockstarTitleId || g.platform?.toLowerCase().includes("rockstar");
      if (src === "ubisoft" || src === "uplay") {
        return !!g.uplayGameId || g.platform?.toLowerCase().includes("ubisoft");
      }
      if (src === "emulated" || src === "emulator") {
        return !!g.emulatorId || g.platform?.toLowerCase().includes("emulator");
      }
      return g.platform?.toLowerCase().includes(src) || g.metadataSource?.toLowerCase().includes(src);
    });
  }

  if (filters.genre) {
    const gen = filters.genre.toLowerCase();
    list = list.filter((g) => g.genres?.some((gn) => gn.toLowerCase().includes(gen)));
  }
  if (filters.tag) {
    const tg = filters.tag.toLowerCase();
    list = list.filter(
      (g) =>
        g.genres?.some((gn) => gn.toLowerCase().includes(tg)) ||
        g.themes?.some((th) => th.toLowerCase().includes(tg))
    );
  }
  if (filters.developer) {
    const dev = filters.developer.toLowerCase();
    list = list.filter((g) => g.developer?.toLowerCase().includes(dev));
  }
  if (filters.publisher) {
    const pub = filters.publisher.toLowerCase();
    list = list.filter((g) => g.publisher?.toLowerCase().includes(pub));
  }
  if (filters.year && filters.yearOp) {
    list = list.filter((g) => {
      if (!g.releaseDate) return false;
      const matchYear = parseInt(g.releaseDate.match(/\b\d{4}\b/)?.[0] || "0", 10);
      if (!matchYear) return false;
      if (filters.yearOp === ">") return matchYear > (filters.year || 0);
      if (filters.yearOp === "<") return matchYear < (filters.year || 0);
      return matchYear === filters.year;
    });
  }
  if (filters.rating && filters.ratingOp) {
    list = list.filter((g) => {
      const r = g.rating || 0;
      if (filters.ratingOp === ">") return r > (filters.rating || 0);
      if (filters.ratingOp === "<") return r < (filters.rating || 0);
      return r === filters.rating;
    });
  }
  if (filters.playtimeHours !== undefined && filters.playtimeOp) {
    list = list.filter((g) => {
      const hours = parseFloat((g.playTime || "").match(/\d+(?:\.\d+)?/)?.[0] || "0");
      if (filters.playtimeOp === ">") return hours > (filters.playtimeHours || 0);
      if (filters.playtimeOp === "<") return hours < (filters.playtimeHours || 0);
      return hours === filters.playtimeHours;
    });
  }
  if (filters.sizeBytes !== undefined && filters.sizeOp) {
    list = list.filter((g) => {
      const sz = g.sizeBytes || 0;
      if (filters.sizeOp === ">") return sz > (filters.sizeBytes || 0);
      if (filters.sizeOp === "<") return sz < (filters.sizeBytes || 0);
      return sz === filters.sizeBytes;
    });
  }

  return list;
}

/** Ranks games by recency (blank query) or fuzzy relevance, then applies sort token. */
export function rankGames(
  list: Game[],
  query: string,
  isBlank: boolean,
  sort?: ParsedQueryFilters["sort"]
): Game[] {
  const sorted = [...list];
  if (sort === "recent") sorted.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  else if (sort === "playtime") {
    sorted.sort((a, b) => {
      const ha = parseFloat((a.playTime || "").match(/\d+(?:\.\d+)?/)?.[0] || "0");
      const hb = parseFloat((b.playTime || "").match(/\d+(?:\.\d+)?/)?.[0] || "0");
      return hb - ha;
    });
  } else if (sort === "rating") sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  else if (sort === "size") sorted.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  else if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));

  if (isBlank) {
    if (!sort) sorted.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
    return sorted;
  }

  const scored = sorted
    .map((g) => ({
      game: g,
      score: scoreMatch(query, g.name, [
        g.developer,
        g.publisher,
        g.platform,
        ...(g.genres || []),
        ...(g.themes || []),
      ]),
    }))
    .filter((item) => item.score > 0);

  if (!sort) scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.game);
}

/** Counts how many entries of a list match the query (or all of them when blank). */
export function countMatches<T>(
  list: T[],
  query: string,
  isBlank: boolean,
  getTitle: (item: T) => string,
  getExtras?: (item: T) => (string | undefined)[]
): number {
  if (isBlank) return list.length;
  let total = 0;
  for (const item of list) {
    if (scoreMatch(query, getTitle(item), getExtras ? getExtras(item) : []) > 0) total++;
  }
  return total;
}
