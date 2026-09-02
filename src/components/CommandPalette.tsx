import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  BarChart3,
  Calculator,
  Compass,
  Dices,
  Download,
  ExternalLink,
  Folder,
  Gamepad2,
  Heart,
  HelpCircle,
  History,
  Layers,
  Loader2,
  Palette,
  Pause,
  Play,
  Search,
  Sparkles,
  Square,
  Store,
  X,
} from "lucide-react";
import { useGames } from "../context/GameContext";
import { useTheme } from "../context/ThemeContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../context/ToastContext";
import { useDownloads } from "../context/DownloadContext";
import { useUpdate } from "../context/UpdateContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useDensityContext } from "../context/DensityContext";
import { useAchievements } from "../context/AchievementContext";
import { SidebarCollapseContext } from "../context/SidebarCollapseContext";
import type { Game, StoreGameSummary } from "../types/game";
import DownloadModal from "./DownloadModal";
import { playActionSound, playLaunchSound, playTabSound } from "../utils/soundEffects";
import type {
  PaletteCategory,
  PaletteItem,
  PaletteRecentItem,
} from "./command-palette/commandPaletteTypes";
import {
  calculateLibraryStats,
  deleteRecentItem,
  evaluateExpression,
  getMatchRanges,
  getRecentItems,
  parseQueryFilters,
  saveRecentItem,
  scoreMatch,
} from "./command-palette/commandPaletteUtils";
import {
  createNavigationItems,
  createSystemActions,
} from "./command-palette/commandPaletteActions";
import CommandPaletteInspector from "./command-palette/CommandPaletteInspector";
import CommandPaletteActionDrawer from "./command-palette/CommandPaletteActionDrawer";
import CommandPaletteCheatSheet from "./command-palette/CommandPaletteCheatSheet";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Renders text with matched query characters highlighted
 */
function HighlightedText({
  text,
  query,
  className = "",
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const ranges = useMemo(() => getMatchRanges(text, query), [text, query]);

  if (ranges.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  ranges.forEach((r, i) => {
    if (r.start > lastIndex) {
      parts.push(text.slice(lastIndex, r.start));
    }
    parts.push(
      <mark key={i} className="cmd-match-highlight">
        {text.slice(r.start, r.end)}
      </mark>
    );
    lastIndex = r.end;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}

const SCOPE_DEFINITIONS: {
  id: PaletteCategory;
  labelKey: string;
  prefix?: string;
  icon: typeof Search;
}[] = [
  { id: "all", labelKey: "commandPalette.scopeAll", icon: Search },
  { id: "games", labelKey: "commandPalette.scopeGames", prefix: "@", icon: Gamepad2 },
  { id: "wishlist", labelKey: "commandPalette.scopeWishlist", prefix: "!", icon: Heart },
  { id: "actions", labelKey: "commandPalette.scopeActions", prefix: ">", icon: Sparkles },
  { id: "navigation", labelKey: "commandPalette.scopeNavigation", prefix: "/", icon: Compass },
  { id: "themes", labelKey: "commandPalette.scopeThemes", prefix: "#", icon: Palette },
  { id: "downloads", labelKey: "commandPalette.scopeDownloads", prefix: "$", icon: Download },
  { id: "store", labelKey: "commandPalette.scopeStore", prefix: "?", icon: Store },
  { id: "utility", labelKey: "commandPalette.scopeUtility", prefix: "~", icon: Calculator },
];

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { games, launchGame, forceCloseGame, runningGameIds, isGameUntracked, toggleGameTracking, updateGame } = useGames();
  const { themes, currentTheme, setTheme } = useTheme();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const { uiSoundEnabled, setUiSoundEnabled, uiSoundVolume, setUiSoundVolume, commandPaletteMode, isSimpleUi } = useSettings();
  const { showToast } = useToast();
  const { t, language, setLanguage, languages } = useLanguage();

  // Safely consume contexts
  const downloadsCtx = useDownloads();
  const updateCtx = useUpdate();
  const wishlistCtx = useWishlistContext();
  const densityCtx = useDensityContext();
  const sidebarCtx = useContext(SidebarCollapseContext);
  const achievementsCtx = useAchievements();

  const [rawQuery, setRawQuery] = useState("");
  const [scope, setScope] = useState<PaletteCategory>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isSimpleMode = commandPaletteMode === "simple" || isSimpleUi;
  const [showInspector, setShowInspector] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 860;
  });
  const effectiveShowInspector = !isSimpleMode && showInspector;
  const [igdbResults, setIgdbResults] = useState<StoreGameSummary[]>([]);
  const [isSearchingIgdb, setIsSearchingIgdb] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{
    name: string;
    id?: string;
    poster?: string;
  } | null>(null);

  // Recents version state to trigger re-renders on recent delete/clear
  const [recentVersion, setRecentVersion] = useState(0);

  // Secondary Action Drawer
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);

  // Built-in Interactive Cheat Sheet Modal
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  // Random Game Picker Roll State
  const [randomGameKey, setRandomGameKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Active running game (if any)
  const runningGame = useMemo(() => {
    if (runningGameIds.length === 0) return null;
    return games.find((g) => runningGameIds.includes(g.id)) ?? null;
  }, [games, runningGameIds]);

  // Selected random game
  const randomGame = useMemo(() => {
    if (games.length === 0) return null;
    const installed = games.filter((g) => g.installed);
    const pool = installed.length > 0 ? installed : games;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, randomGameKey]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setRawQuery("");
      setScope("all");
      setSelectedIndex(0);
      setIgdbResults([]);
      setIsSearchingIgdb(false);
      setDownloadTarget(null);
      setActionDrawerOpen(false);
      setCheatSheetOpen(false);
      playTabSound();
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Parse structured filters & query
  const parsedFilters = useMemo(() => parseQueryFilters(rawQuery), [rawQuery]);
  const cleanQuery = parsedFilters.cleanQuery;

  // Evaluate instant calculator / converter / estimator expression
  const calcResult = useMemo(() => evaluateExpression(rawQuery), [rawQuery]);

  // Handle prefix typing
  const handleQueryChange = (val: string) => {
    if (val.startsWith("@") && scope !== "games") setScope("games");
    else if (val.startsWith(">") && scope !== "actions") setScope("actions");
    else if (val.startsWith("/") && scope !== "navigation") setScope("navigation");
    else if (val.startsWith("#") && scope !== "themes") setScope("themes");
    else if (val.startsWith("$") && scope !== "downloads") setScope("downloads");
    else if (val.startsWith("?") && scope !== "store") setScope("store");
    else if (val.startsWith("!") && scope !== "wishlist") setScope("wishlist");
    else if ((val.startsWith("~") || val.startsWith("=")) && scope !== "utility") setScope("utility");
    setRawQuery(val);
    setSelectedIndex(0);
  };

  // Debounced IGDB online catalog search
  useEffect(() => {
    const q = cleanQuery;
    if (q.length < 2 || (scope !== "all" && scope !== "store")) {
      setIgdbResults([]);
      setIsSearchingIgdb(false);
      return;
    }

    setIsSearchingIgdb(true);
    const timer = setTimeout(() => {
      invoke<StoreGameSummary[]>("search_store_games", {
        query: q,
        offset: 0,
        limit: 8,
      })
        .then((res) => {
          setIgdbResults(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          setIgdbResults([]);
        })
        .finally(() => {
          setIsSearchingIgdb(false);
        });
    }, 280);

    return () => clearTimeout(timer);
  }, [cleanQuery, scope]);

  // System Actions & Routes factory
  const systemActions = useMemo(() => {
    return createSystemActions({
      navigate,
      onClose,
      showToast: (msg: string, type: "success" | "error" | "info" | "warning" = "info") => showToast(msg, type),
      t,
      isBigScreen,
      setBigScreen,
      uiSoundEnabled,
      setUiSoundEnabled,
      uiSoundVolume,
      setUiSoundVolume,
      isSidebarRail: sidebarCtx?.isIconRail,
      toggleSidebarRail: sidebarCtx?.toggle,
      currentDensity: densityCtx?.density,
      setDensity: densityCtx?.setDensity,
      currentLanguage: language,
      setLanguage,
      languages,
      themes,
      currentTheme,
      setTheme,
      pauseAllDownloads: downloadsCtx?.pauseAll,
      resumeAllDownloads: downloadsCtx?.resumeAll,
      checkForUpdates: updateCtx?.checkForUpdates,
      activeDownloadsCount: downloadsCtx?.activeCount || 0,
      runningGame: runningGame ? { id: runningGame.id, name: runningGame.name } : null,
      forceCloseGame: runningGame ? () => forceCloseGame(runningGame) : undefined,
      onHistoryCleared: () => setRecentVersion((v) => v + 1),
      onOpenCheatSheet: () => setCheatSheetOpen(true),
      onPickRandomGame: () => {
        setRandomGameKey((k) => k + 1);
        setRawQuery("roll");
      },
      onShowStats: () => {
        setRawQuery("stats");
      },
    });
  }, [
    navigate,
    onClose,
    showToast,
    t,
    isBigScreen,
    setBigScreen,
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    sidebarCtx,
    densityCtx,
    language,
    setLanguage,
    languages,
    themes,
    currentTheme,
    setTheme,
    downloadsCtx,
    updateCtx,
    runningGame,
    forceCloseGame,
  ]);

  const navRoutes = useMemo(() => {
    return createNavigationItems(navigate, onClose, t);
  }, [navigate, onClose, t]);

  // Aggregate library stats
  const libraryStats = useMemo(() => calculateLibraryStats(games), [games]);

  // Build items list
  const items = useMemo<PaletteItem[]>(() => {
    const q = cleanQuery;
    const lowerRaw = rawQuery.toLowerCase().trim();
    const isBlank = q === "" && Object.keys(parsedFilters).length <= 1;
    const result: PaletteItem[] = [];

    // ── 0. Instant Calculator / Unit Converter / Estimator ────────────────
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

    // ── 0b. Random Game Picker ("Surprise Me") ──────────────────────────────
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

    // ── 0c. Library Analytics & Statistics Snapshot ────────────────────────
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

    // ── 1. Running Game (promoted to top if active) ──────────────────────────
    if (runningGame && (scope === "all" || scope === "games")) {
      const achCache = achievementsCtx?.cache as Record<string, any> | undefined;
      const runningAch = achCache?.[runningGame.id] || (runningGame.steamAppId ? achCache?.[String(runningGame.steamAppId)] : undefined);
      const achStats = runningAch?.totalCount && runningAch.totalCount > 0 ? {
        unlocked: runningAch.unlockedCount,
        total: runningAch.totalCount,
        percentage: Math.round((runningAch.unlockedCount / runningAch.totalCount) * 100),
      } : undefined;

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

    // ── 2. Recent Items (When Query is Blank) ───────────────────────────────
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

    // ── 3. Library Games ───────────────────────────────────────────────────
    if (scope === "all" || scope === "games") {
      let filteredGames = games.filter((g) => g.id !== runningGame?.id);

      // Apply structured power filters
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
        filteredGames = filteredGames.filter((g) => (!g.playTime || g.playTime === "0h") && !g.lastPlayed);
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
          if (src === "ubisoft" || src === "uplay") return !!g.uplayGameId || g.platform?.toLowerCase().includes("ubisoft");
          if (src === "emulated" || src === "emulator") return !!g.emulatorId || g.platform?.toLowerCase().includes("emulator");
          return g.platform?.toLowerCase().includes(src) || g.metadataSource?.toLowerCase().includes(src);
        });
      }
      if (parsedFilters.genre) {
        const gen = parsedFilters.genre.toLowerCase();
        filteredGames = filteredGames.filter((g) => g.genres?.some((gn) => gn.toLowerCase().includes(gen)));
      }
      if (parsedFilters.tag) {
        const tg = parsedFilters.tag.toLowerCase();
        filteredGames = filteredGames.filter((g) =>
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

      // Sort overrides if specified
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
          .slice(0, scope === "games" ? 35 : 7)
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
          .slice(0, scope === "games" ? 45 : 12);
      }

      matchedGames.forEach(({ game }) => {
        const achCache = achievementsCtx?.cache as Record<string, any> | undefined;
        const ach = achCache?.[game.id] || (game.steamAppId ? achCache?.[String(game.steamAppId)] : undefined);
        const achStats = ach?.totalCount && ach.totalCount > 0 ? {
          unlocked: ach.unlockedCount,
          total: ach.totalCount,
          percentage: Math.round((ach.unlockedCount / ach.totalCount) * 100),
        } : undefined;

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
              title: game.favorite ? t("commandPalette.unmarkFavorite") : t("commandPalette.markFavorite"),
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                playActionSound();
                updateGame(game.id, { favorite: !game.favorite });
                showToast(game.favorite ? t("commandPalette.removedFromFavorites") : t("commandPalette.addedToFavorites"), "info");
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

    // ── 4. Wishlist Items ──────────────────────────────────────────────────
    if (scope === "all" || scope === "wishlist") {
      const wishlistItems = wishlistCtx?.wishlist || [];
      if (wishlistItems.length > 0) {
        const matchedWishlist = wishlistItems
          .filter((w) => {
            if (isBlank) return true;
            return scoreMatch(q, w.name, [w.genres?.join(" "), w.summary || undefined]) > 0;
          })
          .slice(0, scope === "wishlist" ? 25 : 4);

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

    // ── 5. Quick Actions ───────────────────────────────────────────────────
    if (scope === "all" || scope === "actions") {
      let matchedActions: PaletteItem[] = [];

      if (isBlank) {
        matchedActions = systemActions.filter((a) => a.category === "actions").slice(0, 7);
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

    // ── 6. Navigation Routes ───────────────────────────────────────────────
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

    // ── 7. Themes ─────────────────────────────────────────────────────────
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

    // ── 8. Downloads Queue ────────────────────────────────────────────────
    if (scope === "all" || scope === "downloads") {
      const activeDownloads = downloadsCtx?.downloads || [];
      if (activeDownloads.length > 0) {
        activeDownloads
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
                    if (isPaused) downloadsCtx?.resumeDownload(d.id);
                    else downloadsCtx?.pauseDownload(d.id);
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

    // ── 9. IGDB Online Catalog Games ───────────────────────────────────────
    if ((scope === "all" || scope === "store") && igdbResults.length > 0) {
      igdbResults.forEach((igdbGame) => {
        const year = igdbGame.firstReleaseDate
          ? new Date(igdbGame.firstReleaseDate).getFullYear()
          : null;
        const rating = igdbGame.rating ? `★ ${Math.round(igdbGame.rating)}%` : null;
        const genre = igdbGame.genres?.[0] || null;
        const subParts = [year, rating, genre].filter(Boolean).join(" · ");
        const isWishlisted = wishlistCtx?.isWishlisted(igdbGame.slug || String(igdbGame.id));

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
              icon: <Heart size={12} fill={isWishlisted ? "currentColor" : "none"} />,
              title: isWishlisted ? t("store.inWishlist") : t("store.addToWishlist"),
              onClick: (e) => {
                e.stopPropagation();
                playActionSound();
                wishlistCtx?.toggle(igdbGame);
                showToast(
                  isWishlisted
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
    downloadsCtx,
    igdbResults,
    wishlistCtx,
    achievementsCtx,
    t,
    onClose,
    navigate,
    launchGame,
    forceCloseGame,
    showToast,
    updateGame,
    isGameUntracked,
    recentVersion,
    randomGameKey,
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

  // Keep selected index within bounds
  useEffect(() => {
    setSelectedIndex((prev) => (items.length === 0 ? 0 : Math.min(prev, items.length - 1)));
  }, [items.length]);

  // Keyboard navigation through items
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(items.length - 1, prev + 5));
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSelectedIndex(Math.max(0, items.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const currentItem = items[selectedIndex];
      if (currentItem) {
        if ((e.ctrlKey || e.metaKey) && currentItem.onSecondarySelect) {
          currentItem.onSecondarySelect();
        } else {
          currentItem.onSelect();
        }
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Cycle through scopes
      const scopes: PaletteCategory[] = [
        "all",
        "games",
        "wishlist",
        "actions",
        "navigation",
        "themes",
        "downloads",
        "store",
        "utility",
      ];
      const currIdx = scopes.indexOf(scope);
      const nextIdx = e.shiftKey
        ? (currIdx - 1 + scopes.length) % scopes.length
        : (currIdx + 1) % scopes.length;
      setScope(scopes[nextIdx]);
      setSelectedIndex(0);
    } else if (e.key === "Delete" && e.shiftKey) {
      const currentItem = items[selectedIndex];
      if (currentItem?.isRecent && currentItem.onDeleteRecent) {
        e.preventDefault();
        currentItem.onDeleteRecent();
      }
    } else if (e.key === "Backspace" && rawQuery === "" && scope !== "all") {
      e.preventDefault();
      setScope("all");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setCheatSheetOpen((prev) => !prev);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      setRandomGameKey((k) => k + 1);
      showToast(t("commandPalette.rerolledGameToast"), "info");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData || currentItem?.storeData || currentItem?.calcData) {
        e.preventDefault();
        setActionDrawerOpen(true);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      if (!isSimpleMode) {
        e.preventDefault();
        setShowInspector((prev) => !prev);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData?.path) {
        e.preventDefault();
        invoke("open_folder", { path: currentItem.gameData.path }).catch(() => {
          showToast(t("commandPalette.folderNotFound"), "error");
        });
      }
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      const currentItem = items[selectedIndex];
      if (currentItem?.gameData?.name) {
        e.preventDefault();
        navigator.clipboard.writeText(currentItem.gameData.name);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      const currentItem = items[selectedIndex];
      if (currentItem) {
        e.preventDefault();
        const textToCopy = currentItem.calcData?.result || currentItem.gameData?.path || currentItem.title;
        navigator.clipboard.writeText(textToCopy);
        showToast(t("commandPalette.copiedToClipboard"), "info");
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const activeEl = list.querySelector<HTMLElement>(".cmd-item.is-selected");
    activeEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  const currentSelectedItem = items[selectedIndex] || null;
  let currentCategory = "";

  return createPortal(
    <>
      <div
        className="command-palette-backdrop"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !actionDrawerOpen && !cheatSheetOpen) {
            e.preventDefault();
            onClose();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
      >
        <div
          className={`command-palette-panel${effectiveShowInspector ? " with-inspector" : ""}${isSimpleMode ? " is-simple-palette" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Main List Column */}
          <div className="cmd-main-column">
            {/* Header & Search Bar */}
            <div className="command-palette-header">
              <Search className="command-palette-icon" aria-hidden="true" />

              {/* Active Scope Badge (if filtered) */}
              {scope !== "all" && (
                <div className="cmd-active-scope-pill">
                  <span>{t(`commandPalette.scope${scope.charAt(0).toUpperCase() + scope.slice(1)}`)}</span>
                  <button
                    type="button"
                    className="cmd-clear-scope-btn"
                    onClick={() => setScope("all")}
                    title={t("commandPalette.clearScope")}
                  >
                    <X size={11} />
                  </button>
                </div>
              )}

              <input
                id={inputId}
                ref={inputRef}
                type="text"
                className="command-palette-input"
                placeholder={t("commandPalette.placeholder")}
                value={rawQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleInputKeyDown}
                autoComplete="off"
                spellCheck={false}
              />

              {rawQuery.length > 0 && (
                <button
                  type="button"
                  className="cmd-clear-query-btn"
                  onClick={() => {
                    setRawQuery("");
                    inputRef.current?.focus();
                  }}
                  title={t("commandPalette.clear")}
                >
                  <X size={13} />
                </button>
              )}

              {isSearchingIgdb && (
                <Loader2
                  size={15}
                  className="command-palette-spinner"
                  style={{ color: "var(--color-accent)" }}
                />
              )}

              <button
                type="button"
                className="cmd-cheatsheet-toggle-btn"
                onClick={() => setCheatSheetOpen(true)}
                title={`${t("commandPalette.cheatSheet")} (Ctrl+H)`}
                aria-label={t("commandPalette.cheatSheet")}
              >
                <HelpCircle size={14} />
              </button>

              {!isSimpleMode && (
                <button
                  type="button"
                  className={`cmd-inspector-toggle-btn${showInspector ? " active" : ""}`}
                  onClick={() => setShowInspector((prev) => !prev)}
                  title={`${t("commandPalette.toggleInspector")} (Ctrl+P)`}
                  aria-label={t("commandPalette.toggleInspector")}
                >
                  <Layers size={14} />
                </button>
              )}

              <kbd className="command-palette-esc">Esc</kbd>
            </div>

            {/* Scope Filter Chips Row with Dynamic Counters */}
            {!isSimpleMode && (
              <div className="cmd-scope-bar">
                {SCOPE_DEFINITIONS.map((def) => {
                  const isActive = scope === def.id;
                  const Icon = def.icon;
                  const count = scopeCounts[def.id] || 0;
                  return (
                    <button
                      key={def.id}
                      type="button"
                      className={`cmd-scope-chip${isActive ? " active" : ""}`}
                      onClick={() => {
                        setScope(def.id);
                        setSelectedIndex(0);
                        inputRef.current?.focus();
                      }}
                    >
                      <Icon size={12} />
                      <span>{t(def.labelKey)}</span>
                      {count > 0 && <span className="cmd-scope-count">{count}</span>}
                      {def.prefix && (
                        <kbd className="cmd-chip-prefix">{def.prefix}</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Quick Interactive Prompt Chips (When Search Input is Empty) */}
            {rawQuery === "" && (
              <div className="cmd-prompt-chips-bar">
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => {
                    setRandomGameKey((k) => k + 1);
                    setRawQuery("roll");
                  }}
                >
                  <Dices size={12} />
                  <span>{t("commandPalette.promptRoll")}</span>
                </button>
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => setRawQuery("is:fav ")}
                >
                  <Heart size={12} />
                  <span>{t("commandPalette.promptFavorites")}</span>
                </button>
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => setRawQuery("is:installed ")}
                >
                  <Gamepad2 size={12} />
                  <span>{t("commandPalette.promptInstalled")}</span>
                </button>
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => setRawQuery("is:unplayed ")}
                >
                  <History size={12} />
                  <span>{t("commandPalette.promptUnplayed")}</span>
                </button>
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => setRawQuery("stats")}
                >
                  <BarChart3 size={12} />
                  <span>{t("commandPalette.promptStats")}</span>
                </button>
                <button
                  type="button"
                  className="cmd-prompt-chip"
                  onClick={() => setCheatSheetOpen(true)}
                >
                  <HelpCircle size={12} />
                  <span>{t("commandPalette.promptHelp")}</span>
                </button>
              </div>
            )}

            {/* Results List */}
            <div ref={listRef} className="command-palette-list" role="listbox">
              {items.length === 0 ? (
                <div className="command-palette-empty">
                  <Search className="command-palette-empty-icon" />
                  <span className="cmd-empty-title">{t("commandPalette.noResults")}</span>
                  <span className="cmd-empty-hint">{t("commandPalette.noResultsHint")}</span>
                </div>
              ) : (
                items.map((item, idx) => {
                  const showCategory = item.category !== currentCategory;
                  currentCategory = item.category;

                  const categoryTitle =
                    item.category === "recent"
                      ? t("commandPalette.sectionRecent")
                      : item.category === "utility"
                        ? t("commandPalette.sectionUtility")
                        : item.category === "games"
                          ? t("commandPalette.sectionGames")
                          : item.category === "wishlist"
                            ? t("commandPalette.sectionWishlist")
                            : item.category === "store"
                              ? t("commandPalette.sectionIgdb")
                              : item.category === "navigation"
                                ? t("commandPalette.sectionNav")
                                : item.category === "themes"
                                  ? t("commandPalette.sectionThemes")
                                  : item.category === "downloads"
                                    ? t("commandPalette.sectionDownloads")
                                    : t("commandPalette.sectionActions");

                  const isSelected = idx === selectedIndex;

                  return (
                    <div key={item.id}>
                      {showCategory && (
                        <div className="command-palette-group-title">
                          <span>{categoryTitle}</span>
                          {item.category === "store" && isSearchingIgdb && (
                            <span className="cmd-searching-badge">
                              <Loader2 size={11} className="command-palette-spinner" />
                              {t("commandPalette.searchingIgdb")}
                            </span>
                          )}
                        </div>
                      )}
                      <div
                        role="option"
                        aria-selected={isSelected}
                        className={`command-palette-item cmd-item${isSelected ? " is-selected" : ""}`}
                        onClick={item.onSelect}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      >
                        {/* Thumbnail or Icon or Swatch */}
                        {item.thumb ? (
                          <img
                            src={item.thumb}
                            alt=""
                            className="command-palette-item-thumb"
                            loading="lazy"
                          />
                        ) : item.swatchColors ? (
                          <div
                            className="cmd-theme-swatch-badge"
                            style={{
                              backgroundColor: item.swatchColors.bg,
                              borderColor: item.swatchColors.accent,
                            }}
                          >
                            <span
                              className="cmd-theme-swatch-dot"
                              style={{ backgroundColor: item.swatchColors.accent }}
                            />
                          </div>
                        ) : item.icon ? (
                          <div className="command-palette-item-icon">{item.icon}</div>
                        ) : null}

                        {/* Title & Subtitle with Highlight Range */}
                        <div className="command-palette-item-body">
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <HighlightedText
                              text={item.title}
                              query={cleanQuery}
                              className="command-palette-item-title"
                            />
                            {item.badge && (
                              <span
                                className={`command-palette-badge${
                                  item.badgeType ? ` badge--${item.badgeType}` : ""
                                }`}
                              >
                                {item.badgeType === "success" && (
                                  <span className="cmd-pulse-dot" />
                                )}
                                {item.badge}
                              </span>
                            )}
                          </div>
                          {item.subtitle && (
                            <HighlightedText
                              text={item.subtitle}
                              query={cleanQuery}
                              className="command-palette-item-subtitle"
                            />
                          )}
                        </div>

                        {/* Action buttons & key pill */}
                        <div className="command-palette-item-actions">
                          {item.quickActions && item.quickActions.length > 0 && (
                            <div className="command-palette-quick-btns">
                              {item.quickActions.map((qa) => (
                                <button
                                  key={qa.id}
                                  type="button"
                                  className="command-palette-quick-btn"
                                  title={qa.title}
                                  aria-label={qa.title}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    qa.onClick(e);
                                  }}
                                >
                                  {qa.icon}
                                </button>
                              ))}
                            </div>
                          )}
                          {item.actionText && (
                            <span className="command-palette-item-action">
                              <span>{item.actionText}</span>
                              {isSelected && (
                                <kbd className="command-palette-key-pill">
                                  {item.shortcut || "↵"}
                                </kbd>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Keyboard Hints */}
            <div className="command-palette-footer">
              <div className="command-palette-hints">
                <span className="command-palette-hint">
                  <kbd className="command-palette-key-pill">↑↓</kbd>
                  <span>{t("commandPalette.hintNavigate")}</span>
                </span>
                <span className="command-palette-hint">
                  <kbd className="command-palette-key-pill">↵</kbd>
                  <span>{t("commandPalette.hintSelect")}</span>
                </span>
                {currentSelectedItem?.gameData && (
                  <>
                    <span className="command-palette-hint">
                      <kbd className="command-palette-key-pill">Ctrl+↵</kbd>
                      <span>{t("commandPalette.hintDetails")}</span>
                    </span>
                    <span className="command-palette-hint">
                      <kbd className="command-palette-key-pill">Ctrl+K</kbd>
                      <span>{t("commandPalette.actionsMenu")}</span>
                    </span>
                  </>
                )}
                {!isSimpleMode && (
                  <span className="command-palette-hint">
                    <kbd className="command-palette-key-pill">Tab</kbd>
                    <span>{t("commandPalette.hintScope")}</span>
                  </span>
                )}
                <span className="command-palette-hint">
                  <kbd className="command-palette-key-pill">Ctrl+H</kbd>
                  <span>{t("commandPalette.hintHelp")}</span>
                </span>
                <span className="command-palette-hint">
                  <kbd className="command-palette-key-pill">Esc</kbd>
                  <span>{t("commandPalette.hintClose")}</span>
                </span>
              </div>
              <span className="cmd-footer-brand">GameIndex HUD</span>
            </div>
          </div>

          {/* Right Inspector Column */}
          {effectiveShowInspector && (
            <div className="cmd-inspector-column">
              <CommandPaletteInspector
                item={currentSelectedItem}
                t={t}
                onOpenActionDrawer={() => setActionDrawerOpen(true)}
                onOpenDownloadModal={(target) => setDownloadTarget(target)}
                isWishlisted={(slug) => wishlistCtx?.isWishlisted(slug) ?? false}
                toggleWishlist={(game) => wishlistCtx?.toggle(game)}
                onLaunchGame={(game) => {
                  playLaunchSound();
                  saveRecentItem(game.id, game.name, "games");
                  onClose();
                  launchGame(game);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Secondary Actions Drawer Modal */}
      <CommandPaletteActionDrawer
        item={currentSelectedItem}
        isOpen={actionDrawerOpen}
        onClose={() => setActionDrawerOpen(false)}
        t={t}
        showToast={(msg, type) => showToast(msg, type ?? "info")}
        navigate={navigate}
        launchGame={launchGame}
        isGameUntracked={isGameUntracked}
        toggleGameTracking={toggleGameTracking}
        toggleFavorite={(id) => {
          const g = games.find((x) => x.id === id);
          if (g) updateGame(g.id, { favorite: !g.favorite });
        }}
        isWishlisted={(slug) => wishlistCtx?.isWishlisted(slug) ?? false}
        toggleWishlist={(game) => wishlistCtx?.toggle(game)}
        onOpenDownloadModal={(target) => setDownloadTarget(target)}
      />

      {/* Interactive Cheat Sheet Modal */}
      <CommandPaletteCheatSheet
        isOpen={cheatSheetOpen}
        onClose={() => setCheatSheetOpen(false)}
        onApplyQuery={(q) => {
          setRawQuery(q);
          inputRef.current?.focus();
        }}
        t={t}
      />

      {/* Download Modal Triggered Directly from Command Palette */}
      {downloadTarget && (
        <DownloadModal
          gameName={downloadTarget.name}
          gameId={downloadTarget.id}
          gamePoster={downloadTarget.poster}
          onClose={() => setDownloadTarget(null)}
        />
      )}
    </>,
    document.body
  );
}
