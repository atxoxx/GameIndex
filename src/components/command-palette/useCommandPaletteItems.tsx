import { useMemo } from "react";
import {
  BarChart3,
  Calculator,
  Dices,
  Download,
  ExternalLink,
  Folder,
  Gamepad2,
  Heart,
  History,
  Pause,
  Play,
  Square,
  Store,
  X,
  Puzzle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { gameDisplayName, type AchievementSummary, type Game, type StoreGameSummary } from "../../types/game";
import type { TorrentDownload } from "../../types/download";
import type {
  CalculationResult,
  LibraryStatsData,
  PaletteCategory,
  PaletteItem,
  PaletteRecentItem,
  ParsedQueryFilters,
} from "./commandPaletteTypes";
import {
  deleteRecentItem,
  saveRecentItem,
  getRecentItems,
  scoreMatch,
  sortRecentItems,
} from "./commandPaletteUtils";
import { playActionSound, playLaunchSound } from "../../utils/soundEffects";

export interface UseCommandPaletteItemsParams {
  rawQuery: string;
  cleanQuery: string;
  scope: PaletteCategory;
  parsedFilters: ParsedQueryFilters;
  calcResult: CalculationResult | null;
  randomGame: Game | null;
  setRandomGameKey: React.Dispatch<React.SetStateAction<number>>;
  libraryStats: LibraryStatsData;
  runningGame: Game | null;
  runningGameIds: string[];
  games: Game[];
  systemActions: PaletteItem[];
  navRoutes: PaletteItem[];
  downloads?: TorrentDownload[];
  igdbResults: StoreGameSummary[];
  wishlistItems: StoreGameSummary[];
  isWishlisted: (slug: string) => boolean;
  toggleWishlist?: (game: StoreGameSummary) => void;
  achievementsCache?: Record<string, AchievementSummary>;
  t: (key: string, vars?: Record<string, unknown>) => string;
  onClose: () => void;
  navigate: (path: string) => void;
  launchGame: (game: Game) => void;
  forceCloseGame: (game: Game) => void;
  showToast: (msg: string, type?: "success" | "error" | "info" | "warning") => void;
  updateGame: (id: string, updates: Partial<Game>) => void;
  isGameUntracked: (id: string) => boolean;
  setDownloadTarget: (target: { name: string; id?: string; poster?: string } | null) => void;
  setRawQuery: (q: string) => void;
  resumeDownload?: (id: string) => void;
  pauseDownload?: (id: string) => void;
  recentVersion: number;
  setRecentVersion: React.Dispatch<React.SetStateAction<number>>;
}

interface GameFilterContext {
  isGameUntracked: (id: string) => boolean;
  runningGameIds: string[];
  wishlistNames: Set<string>;
}

/** Applies every structured power-filter token to a library slice. */
function applyGameFilters(
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
function rankGames(
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
function countMatches<T>(
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

const RANDOM_KEYWORDS = ["random", "roll", "surprise", "picker"];
const STATS_KEYWORDS = ["stats", "summary", "kpi", "analytics"];

export function useCommandPaletteItems(params: UseCommandPaletteItemsParams) {
  const {
    rawQuery,
    cleanQuery,
    scope,
    parsedFilters,
    calcResult,
    randomGame,
    setRandomGameKey,
    libraryStats,
    runningGame,
    runningGameIds,
    games,
    systemActions,
    navRoutes,
    downloads = [],
    igdbResults,
    wishlistItems,
    isWishlisted,
    toggleWishlist,
    achievementsCache,
    t,
    onClose,
    navigate,
    launchGame,
    forceCloseGame,
    showToast,
    updateGame,
    isGameUntracked,
    setDownloadTarget,
    setRawQuery,
    resumeDownload,
    pauseDownload,
    recentVersion,
    setRecentVersion,
  } = params;

  const q = cleanQuery;
  const lowerRaw = rawQuery.toLowerCase().trim();
  const isBlank = q === "" && Object.keys(parsedFilters).length <= 1;

  const wishlistNames = useMemo(
    () => new Set(wishlistItems.map((w) => w.name.toLowerCase())),
    [wishlistItems]
  );

  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = [];

    // 0. Instant Calculator / Unit Converter / Estimator
    if (calcResult) {
      result.push({
        id: `calc-${calcResult.expression}`,
        category: "utility",
        title: calcResult.result,
        subtitle: calcResult.expression,
        badge: calcResult.calcType?.toUpperCase() || "CALC",
        badgeType: "accent",
        icon: <Calculator size={14} />,
        actionText: t("commandPalette.copyResult"),
        shortcut: "↵",
        calcData: calcResult,
        onSelect: () => {
          navigator.clipboard.writeText(calcResult.result);
          showToast(t("commandPalette.copiedToClipboard"), "info");
          onClose();
        },
      });
    }

    // 0b. Random Game Picker ("Surprise Me")
    if (
      randomGame &&
      (RANDOM_KEYWORDS.some((k) => lowerRaw.includes(k)) || scope === "utility")
    ) {
      result.push({
        id: `random-game-${randomGame.id}`,
        category: "utility",
        title: `${t("commandPalette.surpriseMe")}: ${gameDisplayName(randomGame)}`,
        subtitle: `${randomGame.platform || "PC"} · ${randomGame.playTime || "0h"} · ${t("commandPalette.rerollHint")}`,
        badge: "SURPRISE",
        badgeType: "accent",
        thumb: randomGame.coverArtUrl,
        icon: <Dices size={14} />,
        actionText: randomGame.installed ? t("commandPalette.launch") : t("commandPalette.open"),
        shortcut: "↵",
        randomGameData: {
          game: randomGame,
          onReroll: () => setRandomGameKey((k) => k + 1),
        },
        quickActions: [
          {
            id: "reroll",
            icon: <Dices size={12} />,
            title: t("commandPalette.reroll"),
            onClick: (e) => {
              e.stopPropagation();
              playActionSound();
              setRandomGameKey((k) => k + 1);
            },
          },
        ],
        onSelect: () => {
          playLaunchSound();
          saveRecentItem(randomGame.id, gameDisplayName(randomGame), "games");
          onClose();
          if (randomGame.installed) launchGame(randomGame);
          else navigate(`/library/${randomGame.id}`);
        },
      });
    }

    // 0c. Library Analytics & Statistics Snapshot
    if (
      STATS_KEYWORDS.some((k) => lowerRaw.includes(k)) ||
      lowerRaw === "storage"
    ) {
      result.push({
        id: "util-library-stats",
        category: "utility",
        title: t("commandPalette.libraryStats"),
        subtitle: `${libraryStats.totalGames} ${t("commandPalette.scopeGames")} · ${libraryStats.installedGames} ${t("commandPalette.badgeInstalled")} · ${libraryStats.totalPlaytimeHours}h ${t("commandPalette.totalPlaytime")}`,
        badge: "STATS",
        badgeType: "accent",
        icon: <BarChart3 size={14} />,
        actionText: t("commandPalette.viewLibraryPage"),
        shortcut: "↵",
        statsData: libraryStats,
        onSelect: () => {
          onClose();
          navigate("/library");
        },
      });
    }

    // 1. Running Game (promoted to top if active)
    if (runningGame && (scope === "all" || scope === "games")) {
      const runningAch = achievementsCache?.[runningGame.id];
      const achStats =
        runningAch && runningAch.total > 0
          ? {
              unlocked: runningAch.unlocked,
              total: runningAch.total,
              percentage: Math.round((runningAch.unlocked / runningAch.total) * 100),
            }
          : undefined;

      result.push({
        id: `running-${runningGame.id}`,
        category: "games",
        title: gameDisplayName(runningGame),
        subtitle: `${t("commandPalette.badgeRunning")} · ${runningGame.platform || "PC"} · ${runningGame.playTime || "0h"}`,
        badge: t("commandPalette.badgeRunning"),
        badgeType: "success",
        thumb: runningGame.coverArtUrl,
        icon: <Play size={14} />,
        actionText: t("commandPalette.focusOrLaunch"),
        shortcut: "↵",
        gameData: runningGame,
        achievementStats: achStats,
        quickActions: [
          {
            id: "stop",
            icon: <Square size={12} fill="currentColor" />,
            title: t("commandPalette.stop"),
            onClick: (e) => {
              e.stopPropagation();
              playActionSound();
              onClose();
              forceCloseGame(runningGame);
            },
          },
          {
            id: "page",
            icon: <ExternalLink size={12} />,
            title: t("commandPalette.quickActionPage"),
            onClick: (e) => {
              e.stopPropagation();
              playActionSound();
              onClose();
              navigate(`/library/${runningGame.id}`);
            },
          },
        ],
        onSelect: () => {
          playLaunchSound();
          saveRecentItem(runningGame.id, gameDisplayName(runningGame), "games");
          onClose();
          launchGame(runningGame);
        },
      });
    }

    // 2. Recent Items (blank query, or the dedicated Recent scope)
    if (scope === "recent" || (isBlank && scope === "all")) {
      let recents = sortRecentItems(getRecentItems());
      if (!isBlank) {
        recents = recents.filter((rec) => scoreMatch(q, rec.title) > 0);
      }
      if (recents.length > 0) {
        recents.slice(0, scope === "recent" ? 12 : 6).forEach((rec: PaletteRecentItem) => {
          const matchedGame = games.find((g) => g.id === rec.id || String(g.steamAppId) === rec.id);

          result.push({
            id: `recent-${rec.id}`,
            category: "recent",
            title: rec.title,
            subtitle: t("commandPalette.recentSearch"),
            badge: (rec.frequency || 1) > 1 ? `${rec.frequency}×` : rec.category.toUpperCase(),
            badgeType: "neutral",
            icon: <History size={14} />,
            thumb: matchedGame?.coverArtUrl,
            actionText: t("commandPalette.open"),
            isRecent: true,
            frequency: rec.frequency,
            gameData: matchedGame,
            quickActions: [
              {
                id: "delete-recent",
                icon: <X size={12} />,
                title: t("commandPalette.removeRecent"),
                onClick: (e) => {
                  e.stopPropagation();
                  deleteRecentItem(rec.id);
                  setRecentVersion((v) => v + 1);
                },
              },
            ],
            onDeleteRecent: () => {
              deleteRecentItem(rec.id);
              setRecentVersion((v) => v + 1);
            },
            onSelect: () => {
              if (matchedGame) {
                playLaunchSound();
                saveRecentItem(matchedGame.id, gameDisplayName(matchedGame), "games");
                onClose();
                if (matchedGame.installed) launchGame(matchedGame);
                else navigate(`/library/${matchedGame.id}`);
              } else if (rec.category === "navigation" && rec.id.startsWith("nav-")) {
                const path = rec.id.replace("nav-", "");
                onClose();
                navigate(path);
              } else {
                setRawQuery(rec.title);
              }
            },
          });
        });
      }
    }

    // 3. Library Games & Modded Games
    if (scope === "all" || scope === "games" || scope === "mods") {
      let candidateGames = games.filter((g) => g.id !== runningGame?.id);
      if (scope === "mods") {
        candidateGames = candidateGames.filter(
          (g) => g.mo2LaunchEnabled || !!g.mo2Profile || !!g.mo2InstancePath
        );
      }
      const filteredGames = applyGameFilters(
        candidateGames,
        parsedFilters,
        { isGameUntracked, runningGameIds, wishlistNames }
      );

      const matchedGames = rankGames(filteredGames, q, isBlank, parsedFilters.sort).slice(
        0,
        isBlank
          ? scope === "games" || scope === "mods"
            ? 40
            : 8
          : scope === "games" || scope === "mods"
            ? 50
            : 15
      );

      matchedGames.forEach((game) => {
        const ach = achievementsCache?.[game.id];
        const achStats =
          ach && ach.total > 0
            ? {
                unlocked: ach.unlocked,
                total: ach.total,
                percentage: Math.round((ach.unlocked / ach.total) * 100),
              }
            : undefined;

        const isMo2Configured = game.mo2LaunchEnabled || !!game.mo2Profile;
        const subParts = [
          isMo2Configured && game.mo2Profile ? `MO2: ${game.mo2Profile}` : null,
          game.platform || "PC",
          game.playTime || "0h",
        ]
          .filter(Boolean)
          .join(" · ");

        result.push({
          id: `game-${game.id}`,
          category: scope === "mods" ? "mods" : "games",
          title: gameDisplayName(game),
          subtitle: subParts,
          thumb: game.coverArtUrl,
          badge: game.installed ? t("commandPalette.badgeInstalled") : undefined,
          badgeType: "neutral",
          icon: isMo2Configured ? <Puzzle size={14} /> : <Gamepad2 size={14} />,
          actionText: game.installed ? t("commandPalette.launch") : t("commandPalette.open"),
          shortcut: "↵",
          secondaryActionText: t("commandPalette.open"),
          gameData: game,
          achievementStats: achStats,
          quickActions: [
            ...(game.installed
              ? [
                  {
                    id: "launch",
                    icon: <Play size={12} fill="currentColor" />,
                    title: t("commandPalette.quickActionLaunch"),
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      playLaunchSound();
                      saveRecentItem(game.id, gameDisplayName(game), "games");
                      onClose();
                      launchGame(game);
                    },
                  },
                ]
              : []),
            ...(isMo2Configured
              ? [
                  {
                    id: "mods",
                    icon: <Puzzle size={12} />,
                    title: t("commandPalette.manageMods"),
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      playActionSound();
                      onClose();
                      navigate(`/library/${game.id}?tab=mods`);
                    },
                  },
                ]
              : []),
            {
              id: "favorite",
              icon: <Heart size={12} fill={game.favorite ? "currentColor" : "none"} />,
              title: game.favorite
                ? t("commandPalette.unmarkFavorite")
                : t("commandPalette.markFavorite"),
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                playActionSound();
                updateGame(game.id, { favorite: !game.favorite });
                showToast(
                  game.favorite
                    ? t("commandPalette.removedFromFavorites")
                    : t("commandPalette.addedToFavorites"),
                  "info"
                );
              },
            },
            {
              id: "page",
              icon: <ExternalLink size={12} />,
              title: t("commandPalette.quickActionPage"),
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                playActionSound();
                saveRecentItem(game.id, gameDisplayName(game), "games");
                onClose();
                navigate(`/library/${game.id}`);
              },
            },
            ...(game.path
              ? [
                  {
                    id: "folder",
                    icon: <Folder size={12} />,
                    title: t("commandPalette.openFolder"),
                    onClick: (e: React.MouseEvent) => {
                      e.stopPropagation();
                      playActionSound();
                      invoke("open_folder", { path: game.path }).catch(() => {
                        showToast(t("commandPalette.folderNotFound"), "error");
                      });
                    },
                  },
                ]
              : []),
          ],
          onSelect: () => {
            playLaunchSound();
            saveRecentItem(game.id, gameDisplayName(game), "games");
            onClose();
            if (game.installed) {
              launchGame(game);
            } else {
              navigate(`/library/${game.id}`);
            }
          },
          onSecondarySelect: () => {
            playActionSound();
            saveRecentItem(game.id, gameDisplayName(game), "games");
            onClose();
            navigate(`/library/${game.id}`);
          },
        });
      });
    }

    // 4. Wishlist Items
    if (scope === "all" || scope === "wishlist") {
      if (wishlistItems.length > 0) {
        const matchedWishlist = wishlistItems
          .filter((w) => {
            if (isBlank) return true;
            return scoreMatch(q, w.name, [w.genres?.join(" "), w.summary || undefined]) > 0;
          })
          .slice(0, scope === "wishlist" ? 25 : 5);

        matchedWishlist.forEach((w) => {
          result.push({
            id: `wishlist-${w.id || w.slug}`,
            category: "wishlist",
            title: w.name,
            subtitle: `${t("nav.wishlist")}${w.genres && w.genres.length > 0 ? ` · ${w.genres[0]}` : ""}`,
            thumb: w.coverUrl || undefined,
            badge: "WISHLIST",
            badgeType: "accent",
            icon: <Heart size={14} fill="currentColor" />,
            actionText: t("commandPalette.open"),
            shortcut: "↵",
            storeData: w,
            quickActions: [
              {
                id: "download",
                icon: <Download size={12} />,
                title: t("commandPalette.quickActionDownload"),
                onClick: (e) => {
                  e.stopPropagation();
                  playActionSound();
                  setDownloadTarget({
                    name: w.name,
                    id: String(w.id),
                    poster: w.coverUrl ?? undefined,
                  });
                },
              },
              {
                id: "page",
                icon: <ExternalLink size={12} />,
                title: t("commandPalette.quickActionPage"),
                onClick: (e) => {
                  e.stopPropagation();
                  playActionSound();
                  onClose();
                  navigate(`/store/${w.slug || w.id}`);
                },
              },
            ],
            onSelect: () => {
              playActionSound();
              onClose();
              navigate(`/store/${w.slug || w.id}`);
            },
          });
        });
      }
    }

    // 5. Quick Actions
    if (scope === "all" || scope === "actions") {
      let matchedActions: PaletteItem[] = [];

      if (isBlank) {
        matchedActions = systemActions.filter((a) => a.category === "actions").slice(0, 8);
      } else {
        matchedActions = systemActions
          .filter((a) => a.category === "actions")
          .map((a) => ({
            action: a,
            score: scoreMatch(q, a.title, [a.subtitle, a.description]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.action);
      }

      result.push(...matchedActions);
    }

    // 6. Navigation Routes
    if (scope === "all" || scope === "navigation") {
      let matchedNav: PaletteItem[] = [];

      if (isBlank) {
        matchedNav = navRoutes.slice(0, scope === "navigation" ? 16 : 4);
      } else {
        matchedNav = navRoutes
          .map((r) => ({
            route: r,
            score: scoreMatch(q, r.title, [r.subtitle, r.description]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.route);
      }

      result.push(...matchedNav);
    }

    // 7. Themes
    if (scope === "all" || scope === "themes") {
      const themeItems = systemActions.filter((a) => a.category === "themes");
      let matchedThemes: PaletteItem[] = [];

      if (isBlank) {
        if (scope === "themes") {
          matchedThemes = themeItems;
        }
      } else {
        matchedThemes = themeItems
          .map((th) => ({
            theme: th,
            score: scoreMatch(q, th.title, [th.subtitle, th.badge]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.theme);
      }

      result.push(...matchedThemes);
    }

    // 8. Downloads Queue
    if (scope === "all" || scope === "downloads") {
      if (downloads.length > 0) {
        downloads
          .filter((d) => {
            if (isBlank) return true;
            return (
              d.name.toLowerCase().includes(q.toLowerCase()) ||
              d.status.kind.toLowerCase().includes(q.toLowerCase())
            );
          })
          .slice(0, 6)
          .forEach((d) => {
            const isPaused = d.status.kind === "paused";
            const percent = Math.round((d.progress ?? 0) * 100);
            result.push({
              id: `dl-${d.id}`,
              category: "downloads",
              title: d.name || t("nav.downloads"),
              subtitle: `${d.status.kind} · ${percent}%`,
              badge: d.status.kind.toUpperCase(),
              badgeType: isPaused ? "neutral" : "info",
              icon: <Download size={14} />,
              actionText: isPaused ? t("commandPalette.resume") : t("commandPalette.pause"),
              downloadData: d,
              quickActions: [
                {
                  id: "toggle",
                  icon: isPaused ? <Play size={12} /> : <Pause size={12} />,
                  title: isPaused ? t("commandPalette.resume") : t("commandPalette.pause"),
                  onClick: (e) => {
                    e.stopPropagation();
                    if (isPaused) resumeDownload?.(d.id);
                    else pauseDownload?.(d.id);
                  },
                },
              ],
              onSelect: () => {
                onClose();
                navigate("/downloads");
              },
            });
          });
      }
    }

    // 9. IGDB Online Catalog Games
    if ((scope === "all" || scope === "store") && igdbResults.length > 0) {
      igdbResults.forEach((igdbGame) => {
        const year = igdbGame.firstReleaseDate
          ? new Date(igdbGame.firstReleaseDate).getFullYear()
          : null;
        const rating = igdbGame.rating ? `★ ${Math.round(igdbGame.rating)}%` : null;
        const genre = igdbGame.genres?.[0] || null;
        const subParts = [year, rating, genre].filter(Boolean).join(" · ");
        const wishlisted = isWishlisted(igdbGame.slug || String(igdbGame.id));

        result.push({
          id: `igdb-${igdbGame.id}`,
          category: "store",
          title: igdbGame.name,
          subtitle: subParts || "IGDB Catalog",
          badge: "STORE",
          badgeType: "accent",
          thumb: igdbGame.coverUrl ?? undefined,
          actionText: t("commandPalette.open"),
          icon: <Store size={14} />,
          storeData: igdbGame,
          quickActions: [
            {
              id: "page",
              icon: <ExternalLink size={12} />,
              title: t("commandPalette.quickActionPage"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                onClose();
                navigate(`/store/${igdbGame.slug || igdbGame.id}`);
              },
            },
            {
              id: "wishlist",
              icon: <Heart size={12} fill={wishlisted ? "currentColor" : "none"} />,
              title: wishlisted ? t("store.inWishlist") : t("store.addToWishlist"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                toggleWishlist?.(igdbGame);
                showToast(
                  wishlisted
                    ? `${igdbGame.name}: ${t("commandPalette.removedFromWishlist")}`
                    : `${igdbGame.name}: ${t("commandPalette.addedToWishlist")}`,
                  "info"
                );
              },
            },
            {
              id: "download",
              icon: <Download size={12} />,
              title: t("commandPalette.quickActionDownload"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                setDownloadTarget({
                  name: igdbGame.name,
                  id: String(igdbGame.id),
                  poster: igdbGame.coverUrl ?? undefined,
                });
              },
            },
          ],
          onSelect: () => {
            playActionSound();
            saveRecentItem(String(igdbGame.id), igdbGame.name, "store");
            onClose();
            navigate(`/store/${igdbGame.slug || igdbGame.id}`);
          },
        });
      });
    }

    return result;
  }, [
    cleanQuery,
    q,
    lowerRaw,
    isBlank,
    scope,
    parsedFilters,
    calcResult,
    randomGame,
    libraryStats,
    runningGame,
    runningGameIds,
    games,
    systemActions,
    navRoutes,
    downloads,
    igdbResults,
    wishlistItems,
    wishlistNames,
    isWishlisted,
    toggleWishlist,
    achievementsCache,
    t,
    onClose,
    navigate,
    launchGame,
    forceCloseGame,
    showToast,
    updateGame,
    isGameUntracked,
    recentVersion,
    setRecentVersion,
    setDownloadTarget,
    setRawQuery,
    setRandomGameKey,
    resumeDownload,
    pauseDownload,
  ]);

  // Scope counters are computed independently of the active scope so the scope
  // dropdown can advertise how many results each category would yield.
  const scopeCounts = useMemo<Record<PaletteCategory, number>>(() => {
    const actionItems = systemActions.filter((a) => a.category === "actions");
    const themeItems = systemActions.filter((a) => a.category === "themes");
    const allRecents = getRecentItems();

    const filteredGames = applyGameFilters(
      games.filter((g) => g.id !== runningGame?.id),
      parsedFilters,
      { isGameUntracked, runningGameIds, wishlistNames }
    );
    const gameMatches = rankGames(filteredGames, q, isBlank, parsedFilters.sort).length;

    const counts: Record<PaletteCategory, number> = {
      all: 0,
      recent: isBlank
        ? allRecents.length
        : allRecents.filter((r) => scoreMatch(q, r.title) > 0).length,
      games: (runningGame ? 1 : 0) + gameMatches,
      mods: countMatches(
        games.filter((g) => g.mo2LaunchEnabled || !!g.mo2Profile || !!g.mo2InstancePath),
        q,
        isBlank,
        (g) => g.name,
        (g) => [g.mo2Profile, g.platform]
      ),
      wishlist: countMatches(wishlistItems, q, isBlank, (w) => w.name, (w) => [
        w.genres?.join(" "),
        w.summary || undefined,
      ]),
      actions: countMatches(actionItems, q, isBlank, (a) => a.title, (a) => [
        a.subtitle,
        a.description,
      ]),
      navigation: countMatches(navRoutes, q, isBlank, (r) => r.title, (r) => [
        r.subtitle,
        r.description,
      ]),
      themes: isBlank
        ? themeItems.length
        : countMatches(themeItems, q, false, (th) => th.title, (th) => [th.subtitle, th.badge]),
      downloads: countMatches(downloads, q, isBlank, (d) => d.name, (d) => [d.status.kind]),
      store: igdbResults.length,
      utility:
        (calcResult ? 1 : 0) +
        (randomGame && RANDOM_KEYWORDS.some((k) => lowerRaw.includes(k)) ? 1 : 0) +
        (STATS_KEYWORDS.some((k) => lowerRaw.includes(k)) || lowerRaw === "storage" ? 1 : 0),
    };

    counts.all =
      counts.utility +
      counts.games +
      counts.mods +
      counts.recent +
      counts.wishlist +
      counts.actions +
      counts.navigation +
      counts.themes +
      counts.downloads +
      counts.store;

    return counts;
  }, [
    q,
    lowerRaw,
    isBlank,
    parsedFilters,
    calcResult,
    randomGame,
    runningGame,
    runningGameIds,
    games,
    systemActions,
    navRoutes,
    downloads,
    igdbResults,
    wishlistItems,
    wishlistNames,
    isGameUntracked,
    recentVersion,
  ]);

  return { items, scopeCounts };
}
