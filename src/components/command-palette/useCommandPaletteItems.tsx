import { useCallback, useMemo } from "react";
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
  Pin,
  Play,
  Puzzle,
  Search,
  Square,
  Store,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  gameDisplayName,
  type AchievementSummary,
  type Game,
  type StoreGameSummary,
} from "../../types/game";
import type { TorrentDownload } from "../../types/download";
import type {
  CalculationResult,
  LibraryStatsData,
  PaletteCategory,
  PaletteGroup,
  PaletteItem,
  PaletteRecentItem,
  ParsedQueryFilters,
} from "./commandPaletteTypes";
import {
  deleteRecentItem,
  deleteRecentQuery,
  getPinnedItems,
  getRecentItems,
  getRecentQueries,
  saveRecentItem,
  scoreMatch,
  sortRecentItems,
  togglePinnedItem,
} from "./commandPaletteUtils";
import { applyGameFilters, countMatches, rankGames } from "./commandPaletteScoring";
import {
  buildDocsPaletteItems,
  buildSettingsPaletteItems,
  scoreDocsEntry,
  scoreSettingsEntry,
  type DocsPaletteEntry,
  type SettingsPaletteEntry,
} from "./commandPaletteSources";
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
  settingsEntries: SettingsPaletteEntry[];
  docsEntries: DocsPaletteEntry[];
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
  pinVersion: number;
  setPinVersion: React.Dispatch<React.SetStateAction<number>>;
}

const RANDOM_KEYWORDS = ["random", "roll", "surprise", "picker"];
const STATS_KEYWORDS = ["stats", "summary", "kpi", "analytics"];

const PINNABLE_CATEGORIES = new Set<PaletteCategory>([
  "games",
  "navigation",
  "actions",
  "themes",
  "settings",
  "docs",
]);

/** How many rows each group contributes in the mixed "All" view. */
const ALL_LIMITS = {
  pinned: 8,
  queries: 3,
  suggested: 6,
  games: 6,
  wishlist: 3,
  actions: 4,
  navigation: 4,
  settings: 4,
  docs: 3,
  themes: 3,
  downloads: 3,
  store: 4,
} as const;

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
    settingsEntries,
    docsEntries,
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
    pinVersion,
    setPinVersion,
  } = params;

  const q = cleanQuery;
  const lowerRaw = rawQuery.toLowerCase().trim();
  const isBlank = q === "" && Object.keys(parsedFilters).length <= 1;

  const wishlistNames = useMemo(
    () => new Set(wishlistItems.map((w) => w.name.toLowerCase())),
    [wishlistItems]
  );

  const pins = useMemo(() => getPinnedItems(), [pinVersion]);
  const pinnedIds = useMemo(() => new Set(pins.map((pin) => pin.id)), [pins]);

  const settingsItems = useMemo(
    () => buildSettingsPaletteItems(settingsEntries, navigate, onClose, t),
    [settingsEntries, navigate, onClose, t]
  );
  const docsItems = useMemo(
    () => buildDocsPaletteItems(docsEntries, navigate, onClose, t),
    [docsEntries, navigate, onClose, t]
  );

  const togglePin = useCallback(
    (item: PaletteItem) => {
      if (!item.pinnable) return;
      playActionSound();
      const nowPinned = togglePinnedItem({
        id: item.id,
        category: item.category,
        title: item.title,
      });
      setPinVersion((version) => version + 1);
      showToast(
        nowPinned
          ? t("commandPalette.pinnedToast", { title: item.title })
          : t("commandPalette.unpinnedToast", { title: item.title }),
        "info"
      );
    },
    [setPinVersion, showToast, t]
  );

  /** Adds pin support and the pin toggle to every eligible row. */
  const decorate = useCallback(
    (item: PaletteItem): PaletteItem => {
      if (!PINNABLE_CATEGORIES.has(item.category)) return item;
      const pinned = pinnedIds.has(item.id);
      const pinAction = {
        id: "pin",
        icon: <Pin size={12} fill={pinned ? "currentColor" : "none"} />,
        title: pinned ? t("commandPalette.unpin") : t("commandPalette.pin"),
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          togglePin({ ...item, pinned, pinnable: true });
        },
      };
      return {
        ...item,
        pinnable: true,
        pinned,
        onTogglePin: () => togglePin({ ...item, pinned, pinnable: true }),
        quickActions:
          item.category === "games"
            ? [...(item.quickActions ?? []), pinAction]
            : [pinAction, ...(item.quickActions ?? [])],
      };
    },
    [pinnedIds, t, togglePin]
  );

  const makeGameItem = useCallback(
    (
      game: Game,
      options: {
        group?: PaletteGroup;
        category?: PaletteCategory;
        badge?: string;
        badgeType?: PaletteItem["badgeType"];
        actionText?: string;
      } = {}
    ): PaletteItem => {
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

      return {
        id: `game-${game.id}`,
        category: options.category ?? "games",
        group: options.group ?? "games",
        title: gameDisplayName(game),
        subtitle: subParts,
        thumb: game.coverArtUrl,
        badge: options.badge ?? (game.installed ? t("commandPalette.badgeInstalled") : undefined),
        badgeType: options.badgeType ?? "neutral",
        icon: isMo2Configured ? <Puzzle size={14} /> : <Gamepad2 size={14} />,
        actionText:
          options.actionText ??
          (game.installed ? t("commandPalette.launch") : t("commandPalette.open")),
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
      };
    },
    [
      achievementsCache,
      launchGame,
      navigate,
      onClose,
      showToast,
      t,
      updateGame,
    ]
  );

  const makeRecentGameItem = useCallback(
    (game: Game): PaletteItem =>
      makeGameItem(game, {
        group: "suggested",
        actionText: game.installed ? t("commandPalette.launch") : t("commandPalette.open"),
      }),
    [makeGameItem, t]
  );

  /** Resolve stored pins against the live item graph. */
  const pinnedItems = useMemo(() => {
    const resolve = (pinId: string): PaletteItem | undefined => {
      if (pinId.startsWith("game-")) {
        const game = games.find((candidate) => `game-${candidate.id}` === pinId);
        if (!game) return undefined;
        return { ...makeGameItem(game), group: "pinned" };
      }
      if (pinId.startsWith("nav-")) {
        const route = navRoutes.find((candidate) => candidate.id === pinId);
        return route ? { ...route, group: "pinned" } : undefined;
      }
      if (pinId.startsWith("settings-")) {
        const entry = settingsItems.find((candidate) => candidate.id === pinId);
        return entry ? { ...entry, group: "pinned" } : undefined;
      }
      if (pinId.startsWith("doc-")) {
        const entry = docsItems.find((candidate) => candidate.id === pinId);
        return entry ? { ...entry, group: "pinned" } : undefined;
      }
      const action = systemActions.find((candidate) => candidate.id === pinId);
      return action ? { ...action, group: "pinned" } : undefined;
    };

    return pins
      .map((pin) => resolve(pin.id))
      .filter((item): item is PaletteItem => !!item);
  }, [pins, games, navRoutes, settingsItems, docsItems, systemActions, makeGameItem]);

  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = [];
    const pushedIds = new Set<string>();
    const push = (item: PaletteItem) => {
      if (pushedIds.has(item.id)) return;
      pushedIds.add(item.id);
      result.push(item);
    };

    // 0. Instant calculator / unit converter / estimator.
    if (calcResult) {
      push({
        id: `calc-${calcResult.expression}`,
        category: "utility",
        group: "utility",
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

    // 0b. Random game picker ("Surprise me").
    if (
      randomGame &&
      (RANDOM_KEYWORDS.some((k) => lowerRaw.includes(k)) || scope === "utility")
    ) {
      push({
        id: `random-game-${randomGame.id}`,
        category: "utility",
        group: "utility",
        title: `${t("commandPalette.surpriseMe")}: ${gameDisplayName(randomGame)}`,
        subtitle: `${randomGame.platform || "PC"} · ${randomGame.playTime || "0h"} · ${t("commandPalette.rerollHint")}`,
        badge: t("commandPalette.badgeSurprise"),
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

    // 0c. Library analytics snapshot.
    if (
      STATS_KEYWORDS.some((k) => lowerRaw.includes(k)) ||
      lowerRaw === "storage" ||
      scope === "utility"
    ) {
      push({
        id: "util-library-stats",
        category: "utility",
        group: "utility",
        title: t("commandPalette.libraryStats"),
        subtitle: `${libraryStats.totalGames} ${t("commandPalette.scopeGames")} · ${libraryStats.installedGames} ${t("commandPalette.badgeInstalled")} · ${libraryStats.totalPlaytimeHours}h ${t("commandPalette.totalPlaytime")}`,
        badge: t("commandPalette.badgeStats"),
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

    // 0d. Running game is always reachable, even mid-search.
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

      push({
        id: `running-${runningGame.id}`,
        category: "games",
        group: isBlank ? "suggested" : "games",
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

    const recentItems = sortRecentItems(getRecentItems());
    const recentQueries = getRecentQueries();

    // 0e. Pinned rows that match the active query lead their categories, while
    // the calculator and a running game keep the very top slots.
    if (!isBlank && scope === "all") {
      pinnedItems
        .filter((item) => scoreMatch(q, item.title, [item.subtitle]) > 0)
        .slice(0, ALL_LIMITS.pinned)
        .forEach((item) => push({ ...item, group: "pinned" }));
    }

    // 1. Launcher surfaces for a blank query.
    if (isBlank && (scope === "all" || scope === "recent")) {
      if (scope === "all") {
        pinnedItems.forEach(push);
      }

      const queryLimit = scope === "recent" ? 5 : ALL_LIMITS.queries;
      recentQueries.slice(0, queryLimit).forEach((query) => {
        push({
          id: `query-${query}`,
          category: "recent",
          group: "queries",
          title: query,
          subtitle: t("commandPalette.recentQueryHint"),
          icon: <Search size={14} />,
          actionText: t("commandPalette.runQuery"),
          recentQuery: query,
          quickActions: [
            {
              id: "delete-query",
              icon: <X size={12} />,
              title: t("commandPalette.removeRecent"),
              onClick: (e) => {
                e.stopPropagation();
                deleteRecentQuery(query);
                setRecentVersion((v) => v + 1);
              },
            },
          ],
          onSelect: () => {
            setRawQuery(query);
          },
        });
      });
    }

    if (isBlank && scope === "all") {
      // Suggested: the games you touched last, plus the commands you actually
      // repeat. A flat frecency-ranked group reads as one calm list instead of
      // a wall of categories. A fresh library with no history falls back to
      // installed favourites so the launcher never opens game-less.
      let suggestedGames = games
        .filter(
          (game) =>
            game.id !== runningGame?.id &&
            !!game.lastPlayed &&
            !pinnedIds.has(`game-${game.id}`)
        )
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
        .slice(0, 4);

      if (suggestedGames.length === 0) {
        suggestedGames = games
          .filter(
            (game) =>
              game.id !== runningGame?.id &&
              game.installed &&
              !pinnedIds.has(`game-${game.id}`)
          )
          .sort(
            (a, b) =>
              Number(!!b.favorite) - Number(!!a.favorite) ||
              (b.rating || 0) - (a.rating || 0) ||
              a.name.localeCompare(b.name)
          )
          .slice(0, 3);
      }

      suggestedGames.forEach((game) => push(makeRecentGameItem(game)));

      const frequentCommands = recentItems
        .filter((recent) => recent.category !== "games")
        .map((recent) => {
          const nav = navRoutes.find((route) => route.id === `nav-${recent.id}`);
          if (nav) return nav;
          const action = systemActions.find((item) => item.id === recent.id);
          if (action) return action;
          return undefined;
        })
        .filter((item): item is PaletteItem => !!item)
        .slice(0, 3);

      const suggestedCommands = frequentCommands.length
        ? frequentCommands
        : systemActions.filter((item) => item.category === "actions").slice(0, 3);

      suggestedCommands.forEach((item) => push({ ...item, group: "suggested" }));
    }

    // 2. Recent commands.
    if (scope === "recent" || (isBlank && scope === "all")) {
      let recents = recentItems;
      if (!isBlank) {
        recents = recents.filter((rec) => scoreMatch(q, rec.title) > 0);
      }
      const limit = scope === "recent" ? 12 : 0;
      if (limit > 0) {
        recents.slice(0, limit).forEach((rec: PaletteRecentItem) => {          const matchedGame = games.find((g) => g.id === rec.id || String(g.steamAppId) === rec.id);

          push({
            id: `recent-${rec.id}`,
            category: "recent",
            group: "recent",
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

    // 2b. Recently played games round out the Recent scope.
    if (isBlank && scope === "recent") {
      games
        .filter((game) => !!game.lastPlayed)
        .sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0))
        .slice(0, 6)
        .forEach((game) => push(makeGameItem(game, { group: "recentGames" })));
    }

    // 3. Library games / modded games.
    if (scope === "all" || scope === "games" || scope === "mods") {
      if (!(isBlank && scope === "all")) {
        let candidateGames = games.filter((g) => g.id !== runningGame?.id);
        if (scope === "mods") {
          candidateGames = candidateGames.filter(
            (g) => g.mo2LaunchEnabled || !!g.mo2Profile || !!g.mo2InstancePath
          );
        }
        const filteredGames = applyGameFilters(candidateGames, parsedFilters, {
          isGameUntracked,
          runningGameIds,
          wishlistNames,
        });
        const focused = scope === "games" || scope === "mods";
        const limit = isBlank ? (focused ? 40 : 0) : focused ? 50 : ALL_LIMITS.games;

        rankGames(filteredGames, q, isBlank, parsedFilters.sort)
          .slice(0, limit)
          .forEach((game) => push(makeGameItem(game, {
            category: scope === "mods" ? "mods" : "games",
            group: scope === "mods" ? "mods" : "games",
          })));
      }
    }

    // 4. Wishlist.
    if (scope === "all" || scope === "wishlist") {
      if (wishlistItems.length > 0 && !(isBlank && scope === "all")) {
        const matchedWishlist = wishlistItems
          .filter((w) => {
            if (isBlank) return true;
            return scoreMatch(q, w.name, [w.genres?.join(" "), w.summary || undefined]) > 0;
          })
          .slice(0, scope === "wishlist" ? 25 : ALL_LIMITS.wishlist);

        matchedWishlist.forEach((w) => {
          push({
            id: `wishlist-${w.id || w.slug}`,
            category: "wishlist",
            group: "wishlist",
            title: w.name,
            subtitle: `${t("nav.wishlist")}${w.genres && w.genres.length > 0 ? ` · ${w.genres[0]}` : ""}`,
            thumb: w.coverUrl || undefined,
            badge: t("commandPalette.badgeWishlist"),
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

    // 5. Actions.
    if (scope === "all" || scope === "actions") {
      let matchedActions: PaletteItem[] = [];
      const actionItems = systemActions.filter((a) => a.category === "actions");

      if (isBlank) {
        matchedActions = scope === "actions" ? actionItems : [];
      } else {
        matchedActions = actionItems
          .map((a) => ({
            action: a,
            score: scoreMatch(q, a.title, [a.subtitle, a.description]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.action)
          .slice(0, scope === "actions" ? actionItems.length : ALL_LIMITS.actions);
      }

      matchedActions.forEach((action) => push({ ...action, group: "actions" }));
    }

    // 6. Navigation.
    if (scope === "all" || scope === "navigation") {
      let matchedNav: PaletteItem[] = [];

      if (isBlank) {
        matchedNav =
          scope === "navigation"
            ? navRoutes.slice(0, 16)
            : navRoutes.slice(0, scope === "all" ? 3 : 0);
      } else {
        matchedNav = navRoutes
          .map((r) => ({
            route: r,
            score: scoreMatch(q, r.title, [r.subtitle, r.description]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, scope === "navigation" ? navRoutes.length : ALL_LIMITS.navigation)
          .map((item) => item.route);
      }

      matchedNav.forEach((route) => push({ ...route, group: "navigation" }));
    }

    // 7. Themes.
    if (scope === "all" || scope === "themes") {
      const themeItems = systemActions.filter((a) => a.category === "themes");
      let matchedThemes: PaletteItem[] = [];

      if (isBlank) {
        matchedThemes = scope === "themes" ? themeItems : [];
      } else {
        matchedThemes = themeItems
          .map((th) => ({
            theme: th,
            score: scoreMatch(q, th.title, [th.subtitle, th.badge]),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, scope === "themes" ? themeItems.length : ALL_LIMITS.themes)
          .map((item) => item.theme);
      }

      matchedThemes.forEach((theme) => push({ ...theme, group: "themes" }));
    }

    // 8. Downloads.
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
          .slice(0, scope === "downloads" ? downloads.length : ALL_LIMITS.downloads)
          .forEach((d) => {
            const isPaused = d.status.kind === "paused";
            const percent = Math.round((d.progress ?? 0) * 100);
            push({
              id: `dl-${d.id}`,
              category: "downloads",
              group: "downloads",
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

    // 9. IGDB online catalog results.
    if ((scope === "all" || scope === "store") && igdbResults.length > 0) {
      igdbResults.slice(0, scope === "store" ? igdbResults.length : ALL_LIMITS.store).forEach((igdbGame) => {
        const year = igdbGame.firstReleaseDate
          ? new Date(igdbGame.firstReleaseDate).getFullYear()
          : null;
        const rating = igdbGame.rating ? `★ ${Math.round(igdbGame.rating)}%` : null;
        const genre = igdbGame.genres?.[0] || null;
        const subParts = [year, rating, genre].filter(Boolean).join(" · ");
        const wishlisted = isWishlisted(igdbGame.slug || String(igdbGame.id));

        push({
          id: `igdb-${igdbGame.id}`,
          category: "store",
          group: "store",
          title: igdbGame.name,
          subtitle: subParts || t("commandPalette.sectionIgdb"),
          badge: t("commandPalette.badgeStore"),
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

    // 10. Settings destinations.
    if (scope === "all" || scope === "settings") {
      let matchedSettings: PaletteItem[];
      if (isBlank) {
        matchedSettings =
          scope === "settings"
            ? settingsItems.filter((item) => item.settingsData?.sectionId === undefined)
            : [];
      } else {
        const scored = settingsEntries
          .map((entry) => ({ entry, score: scoreSettingsEntry(entry, q) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, scope === "settings" ? 24 : ALL_LIMITS.settings);

        const byId = new Map(settingsItems.map((item) => [item.id, item]));
        matchedSettings = scored
          .map(({ entry }) => byId.get(`settings-${entry.id}`))
          .filter((item): item is PaletteItem => !!item);
      }
      matchedSettings.forEach((item) => push({ ...item, group: "settings" }));
    }

    // 11. Documentation articles.
    if (scope === "all" || scope === "docs") {
      let matchedDocs: PaletteItem[];
      if (isBlank) {
        matchedDocs = scope === "docs" ? docsItems.slice(0, 12) : [];
      } else {
        const scored = docsEntries
          .map((entry) => ({ entry, score: scoreDocsEntry(entry, q) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, scope === "docs" ? 24 : ALL_LIMITS.docs);

        const byId = new Map(docsItems.map((item) => [item.id, item]));
        matchedDocs = scored
          .map(({ entry }) => byId.get(`doc-${entry.id}`))
          .filter((item): item is PaletteItem => !!item);
      }
      matchedDocs.forEach((item) => push({ ...item, group: "docs" }));
    }

    // 12. Decorate every row with pin support.
    return result.map(decorate);
  }, [
    calcResult,
    lowerRaw,
    scope,
    randomGame,
    libraryStats,
    runningGame,
    achievementsCache,
    isBlank,
    pinnedItems,
    pinnedIds,
    recentVersion,
    games,
    navRoutes,
    systemActions,
    makeGameItem,
    makeRecentGameItem,
    parsedFilters,
    isGameUntracked,
    runningGameIds,
    wishlistNames,
    q,
    wishlistItems,
    downloads,
    igdbResults,
    isWishlisted,
    toggleWishlist,
    setDownloadTarget,
    settingsEntries,
    settingsItems,
    docsEntries,
    docsItems,
    decorate,
    navigate,
    onClose,
    launchGame,
    forceCloseGame,
    resumeDownload,
    pauseDownload,
    showToast,
    setRawQuery,
    setRecentVersion,
    setRandomGameKey,
    t,
  ]);

  // Scope counters are computed independently of the active scope so the scope
  // bar can advertise how many results each category would yield.
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
      recent:
        (isBlank
          ? allRecents.length
          : allRecents.filter((r) => scoreMatch(q, r.title) > 0).length) +
        (isBlank
          ? getRecentQueries().length
          : getRecentQueries().filter((query) => scoreMatch(q, query) > 0).length),
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
      docs: isBlank
        ? docsItems.length
        : docsEntries.filter((entry) => scoreDocsEntry(entry, q) > 0).length,
      settings: isBlank
        ? settingsEntries.filter((entry) => entry.kind === "tab").length
        : settingsEntries.filter((entry) => scoreSettingsEntry(entry, q) > 0).length,
      utility:
        (calcResult ? 1 : 0) +
        (randomGame && (RANDOM_KEYWORDS.some((k) => lowerRaw.includes(k)) || scope === "utility")
          ? 1
          : 0) +
        (STATS_KEYWORDS.some((k) => lowerRaw.includes(k)) ||
        lowerRaw === "storage" ||
        scope === "utility"
          ? 1
          : 0),
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
      counts.store +
      counts.docs +
      counts.settings;

    return counts;
  }, [
    q,
    lowerRaw,
    isBlank,
    scope,
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
    docsEntries,
    docsItems,
    settingsEntries,
  ]);

  return { items, scopeCounts, pinnedItems, togglePin };
}
