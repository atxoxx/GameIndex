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
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Game, StoreGameSummary } from "../../types/game";
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
  games: Game[];
  systemActions: PaletteItem[];
  navRoutes: PaletteItem[];
  downloads?: TorrentDownload[];
  igdbResults: StoreGameSummary[];
  wishlistItems: StoreGameSummary[];
  isWishlisted: (slug: string) => boolean;
  toggleWishlist?: (game: StoreGameSummary) => void;
  achievementsCache?: Record<string, any>;
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

  const items = useMemo<PaletteItem[]>(() => {
    const q = cleanQuery;
    const lowerRaw = rawQuery.toLowerCase().trim();
    const isBlank = q === "" && Object.keys(parsedFilters).length <= 1;
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
      (lowerRaw.includes("random") ||
        lowerRaw.includes("roll") ||
        lowerRaw.includes("surprise") ||
        lowerRaw.includes("picker") ||
        scope === "utility")
    ) {
      result.push({
        id: `random-game-${randomGame.id}`,
        category: "utility",
        title: `${t("commandPalette.surpriseMe")}: ${randomGame.name}`,
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
          saveRecentItem(randomGame.id, randomGame.name, "games");
          onClose();
          if (randomGame.installed) launchGame(randomGame);
          else navigate(`/library/${randomGame.id}`);
        },
      });
    }

    // 0c. Library Analytics & Statistics Snapshot
    if (
      lowerRaw.includes("stats") ||
      lowerRaw.includes("summary") ||
      lowerRaw.includes("kpi") ||
      lowerRaw === "storage" ||
      lowerRaw === "analytics"
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
      const runningAch =
        achievementsCache?.[runningGame.id] ||
        (runningGame.steamAppId ? achievementsCache?.[String(runningGame.steamAppId)] : undefined);
      const achStats =
        runningAch?.totalCount && runningAch.totalCount > 0
          ? {
              unlocked: runningAch.unlockedCount,
              total: runningAch.totalCount,
              percentage: Math.round((runningAch.unlockedCount / runningAch.totalCount) * 100),
            }
          : undefined;

      result.push({
        id: `running-${runningGame.id}`,
        category: "games",
        title: runningGame.name,
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
          saveRecentItem(runningGame.id, runningGame.name, "games");
          onClose();
          launchGame(runningGame);
        },
      });
    }

    // 2. Recent Items (When Query is Blank)
    if (isBlank && (scope === "all" || scope === "recent")) {
      const recents = getRecentItems();
      if (recents.length > 0) {
        recents.slice(0, 6).forEach((rec: PaletteRecentItem) => {
          const matchedGame = games.find((g) => g.id === rec.id || String(g.steamAppId) === rec.id);

          result.push({
            id: `recent-${rec.id}`,
            category: "recent",
            title: rec.title,
            subtitle: t("commandPalette.recentSearch"),
            badge: rec.category.toUpperCase(),
            badgeType: "neutral",
            icon: <History size={14} />,
            thumb: matchedGame?.coverArtUrl,
            actionText: t("commandPalette.open"),
            isRecent: true,
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
                saveRecentItem(matchedGame.id, matchedGame.name, "games");
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

    // 3. Library Games
    if (scope === "all" || scope === "games") {
      let filteredGames = games.filter((g) => g.id !== runningGame?.id);

      if (parsedFilters.isInstalled) {
        filteredGames = filteredGames.filter((g) => g.installed);
      }
      if (parsedFilters.isCloud) {
        filteredGames = filteredGames.filter((g) => !g.installed);
      }
      if (parsedFilters.isFavorite) {
        filteredGames = filteredGames.filter((g) => g.favorite);
      }
      if (parsedFilters.isUnplayed) {
        filteredGames = filteredGames.filter(
          (g) => (!g.playTime || g.playTime === "0h") && !g.lastPlayed
        );
      }
      if (parsedFilters.isUntracked) {
        filteredGames = filteredGames.filter((g) => isGameUntracked(g.id));
      }
      if (parsedFilters.source) {
        const src = parsedFilters.source.toLowerCase();
        filteredGames = filteredGames.filter((g) => {
          if (src === "steam") return !!g.steamAppId || g.platform?.toLowerCase().includes("steam");
          if (src === "gog") return !!g.gogGameId || g.platform?.toLowerCase().includes("gog");
          if (src === "epic") return !!g.epicNamespace || g.platform?.toLowerCase().includes("epic");
          if (src === "rockstar") return !!g.rockstarTitleId || g.platform?.toLowerCase().includes("rockstar");
          if (src === "ubisoft" || src === "uplay")
            return !!g.uplayGameId || g.platform?.toLowerCase().includes("ubisoft");
          if (src === "emulated" || src === "emulator")
            return !!g.emulatorId || g.platform?.toLowerCase().includes("emulator");
          return g.platform?.toLowerCase().includes(src) || g.metadataSource?.toLowerCase().includes(src);
        });
      }
      if (parsedFilters.genre) {
        const gen = parsedFilters.genre.toLowerCase();
        filteredGames = filteredGames.filter((g) =>
          g.genres?.some((gn) => gn.toLowerCase().includes(gen))
        );
      }
      if (parsedFilters.tag) {
        const tg = parsedFilters.tag.toLowerCase();
        filteredGames = filteredGames.filter(
          (g) =>
            g.genres?.some((gn) => gn.toLowerCase().includes(tg)) ||
            g.themes?.some((th) => th.toLowerCase().includes(tg))
        );
      }
      if (parsedFilters.developer) {
        const dev = parsedFilters.developer.toLowerCase();
        filteredGames = filteredGames.filter((g) => g.developer?.toLowerCase().includes(dev));
      }
      if (parsedFilters.publisher) {
        const pub = parsedFilters.publisher.toLowerCase();
        filteredGames = filteredGames.filter((g) => g.publisher?.toLowerCase().includes(pub));
      }
      if (parsedFilters.year && parsedFilters.yearOp) {
        filteredGames = filteredGames.filter((g) => {
          if (!g.releaseDate) return false;
          const matchYear = parseInt(g.releaseDate.match(/\b\d{4}\b/)?.[0] || "0", 10);
          if (!matchYear) return false;
          if (parsedFilters.yearOp === ">") return matchYear > (parsedFilters.year || 0);
          if (parsedFilters.yearOp === "<") return matchYear < (parsedFilters.year || 0);
          return matchYear === parsedFilters.year;
        });
      }
      if (parsedFilters.rating && parsedFilters.ratingOp) {
        filteredGames = filteredGames.filter((g) => {
          const r = g.rating || 0;
          if (parsedFilters.ratingOp === ">") return r > (parsedFilters.rating || 0);
          if (parsedFilters.ratingOp === "<") return r < (parsedFilters.rating || 0);
          return r === parsedFilters.rating;
        });
      }
      if (parsedFilters.playtimeHours !== undefined && parsedFilters.playtimeOp) {
        filteredGames = filteredGames.filter((g) => {
          const hours = parseInt((g.playTime || "").match(/\d+/)?.[0] || "0", 10);
          if (parsedFilters.playtimeOp === ">") return hours > (parsedFilters.playtimeHours || 0);
          if (parsedFilters.playtimeOp === "<") return hours < (parsedFilters.playtimeHours || 0);
          return hours === parsedFilters.playtimeHours;
        });
      }
      if (parsedFilters.sizeBytes !== undefined && parsedFilters.sizeOp) {
        filteredGames = filteredGames.filter((g) => {
          const sz = g.sizeBytes || 0;
          if (parsedFilters.sizeOp === ">") return sz > (parsedFilters.sizeBytes || 0);
          if (parsedFilters.sizeOp === "<") return sz < (parsedFilters.sizeBytes || 0);
          return sz === parsedFilters.sizeBytes;
        });
      }

      if (parsedFilters.sort) {
        if (parsedFilters.sort === "recent") {
          filteredGames.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        } else if (parsedFilters.sort === "playtime") {
          filteredGames.sort((a, b) => {
            const ha = parseInt((a.playTime || "").match(/\d+/)?.[0] || "0", 10);
            const hb = parseInt((b.playTime || "").match(/\d+/)?.[0] || "0", 10);
            return hb - ha;
          });
        } else if (parsedFilters.sort === "rating") {
          filteredGames.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        } else if (parsedFilters.sort === "size") {
          filteredGames.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        } else if (parsedFilters.sort === "name") {
          filteredGames.sort((a, b) => a.name.localeCompare(b.name));
        }
      }

      let matchedGames: { game: Game; score: number }[] = [];

      if (isBlank) {
        matchedGames = [...filteredGames]
          .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
          .slice(0, scope === "games" ? 40 : 8)
          .map((g) => ({ game: g, score: 100 }));
      } else {
        matchedGames = filteredGames
          .map((g) => {
            const score = scoreMatch(q, g.name, [
              g.developer,
              g.publisher,
              g.platform,
              ...(g.genres || []),
              ...(g.themes || []),
            ]);
            return { game: g, score };
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, scope === "games" ? 50 : 15);
      }

      matchedGames.forEach(({ game }) => {
        const ach =
          achievementsCache?.[game.id] ||
          (game.steamAppId ? achievementsCache?.[String(game.steamAppId)] : undefined);
        const achStats =
          ach?.totalCount && ach.totalCount > 0
            ? {
                unlocked: ach.unlockedCount,
                total: ach.totalCount,
                percentage: Math.round((ach.unlockedCount / ach.totalCount) * 100),
              }
            : undefined;

        result.push({
          id: `game-${game.id}`,
          category: "games",
          title: game.name,
          subtitle: `${game.platform || "PC"} · ${game.playTime || "0h"}`,
          thumb: game.coverArtUrl,
          badge: game.installed ? t("commandPalette.badgeInstalled") : undefined,
          badgeType: "neutral",
          icon: <Gamepad2 size={14} />,
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
                      saveRecentItem(game.id, game.name, "games");
                      onClose();
                      launchGame(game);
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
                saveRecentItem(game.id, game.name, "games");
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
            saveRecentItem(game.id, game.name, "games");
            onClose();
            if (game.installed) {
              launchGame(game);
            } else {
              navigate(`/library/${game.id}`);
            }
          },
          onSecondarySelect: () => {
            playActionSound();
            saveRecentItem(game.id, game.name, "games");
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
    rawQuery,
    scope,
    parsedFilters,
    calcResult,
    randomGame,
    libraryStats,
    runningGame,
    games,
    systemActions,
    navRoutes,
    downloads,
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
    recentVersion,
    setRecentVersion,
    setDownloadTarget,
    setRawQuery,
    setRandomGameKey,
    resumeDownload,
    pauseDownload,
  ]);

  // Dynamic scope counters calculation
  const scopeCounts = useMemo(() => {
    const counts: Record<PaletteCategory, number> = {
      all: 0,
      recent: 0,
      games: 0,
      wishlist: 0,
      actions: 0,
      navigation: 0,
      themes: 0,
      downloads: 0,
      store: 0,
      utility: 0,
    };

    items.forEach((item) => {
      counts.all++;
      if (item.category in counts) {
        counts[item.category]++;
      }
    });

    return counts;
  }, [items]);

  return { items, scopeCounts };
}
