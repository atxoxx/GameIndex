import {
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Search, Loader2 } from "lucide-react";
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
import type { StoreGameSummary } from "../types/game";
import DownloadModal from "./DownloadModal";
import { playLaunchSound, playTabSound } from "../utils/soundEffects";
import type { PaletteCategory } from "./command-palette/commandPaletteTypes";
import {
  calculateLibraryStats,
  evaluateExpression,
  parseQueryFilters,
  saveRecentItem,
} from "./command-palette/commandPaletteUtils";
import {
  createNavigationItems,
  createSystemActions,
} from "./command-palette/commandPaletteActions";
import CommandPaletteHeader from "./command-palette/CommandPaletteHeader";
import CommandPaletteScopeBar from "./command-palette/CommandPaletteScopeBar";
import CommandPaletteFilterPills from "./command-palette/CommandPaletteFilterPills";
import CommandPaletteItemRow from "./command-palette/CommandPaletteItemRow";
import CommandPaletteFooter from "./command-palette/CommandPaletteFooter";
import CommandPaletteInspector from "./command-palette/CommandPaletteInspector";
import CommandPaletteActionDrawer from "./command-palette/CommandPaletteActionDrawer";
import CommandPaletteCheatSheet from "./command-palette/CommandPaletteCheatSheet";
import { useCommandPaletteItems } from "./command-palette/useCommandPaletteItems";
import { useCommandPaletteKeyboard } from "./command-palette/useCommandPaletteKeyboard";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const {
    games,
    launchGame,
    forceCloseGame,
    runningGameIds,
    isGameUntracked,
    toggleGameTracking,
    updateGame,
  } = useGames();
  const { themes, currentTheme, setTheme } = useTheme();
  const { isBigScreen, setBigScreen } = useBigScreen();
  const {
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    commandPaletteMode,
    isSimpleUi,
  } = useSettings();
  const { showToast } = useToast();
  const { t, language, setLanguage, languages } = useLanguage();

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

  const [recentVersion, setRecentVersion] = useState(0);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [randomGameKey, setRandomGameKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // Active running game (if any)
  const runningGame = useMemo(() => {
    if (runningGameIds.length === 0) return null;
    return games.find((g) => runningGameIds.includes(g.id)) ?? null;
  }, [games, runningGameIds]);

  // Selected random game for Roll / Surprise Me
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

  // Instant calculator / converter / estimator expression
  const calcResult = useMemo(() => evaluateExpression(rawQuery), [rawQuery]);

  // Handle query change and prefix triggers
  const handleQueryChange = (val: string) => {
    if (val.startsWith("@") && scope !== "games") setScope("games");
    else if (val.startsWith(">") && scope !== "actions") setScope("actions");
    else if (val.startsWith("/") && scope !== "navigation") setScope("navigation");
    else if (val.startsWith("#") && scope !== "themes") setScope("themes");
    else if (val.startsWith("$") && scope !== "downloads") setScope("downloads");
    else if (val.startsWith("?") && scope !== "store") setScope("store");
    else if (val.startsWith("!") && scope !== "wishlist") setScope("wishlist");
    else if ((val.startsWith("~") || val.startsWith("=")) && scope !== "utility")
      setScope("utility");
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
      showToast: (msg: string, type: "success" | "error" | "info" | "warning" = "info") =>
        showToast(msg, type),
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

  // Items filtering and generation hook
  const { items, scopeCounts } = useCommandPaletteItems({
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
    downloads: downloadsCtx?.downloads,
    igdbResults,
    wishlistItems: wishlistCtx?.wishlist || [],
    isWishlisted: (slug) => wishlistCtx?.isWishlisted(slug) ?? false,
    toggleWishlist: (g) => wishlistCtx?.toggle(g),
    achievementsCache: achievementsCtx?.cache as Record<string, any> | undefined,
    t,
    onClose,
    navigate,
    launchGame,
    forceCloseGame,
    showToast: (msg, type) => showToast(msg, type ?? "info"),
    updateGame,
    isGameUntracked,
    setDownloadTarget,
    setRawQuery,
    resumeDownload: downloadsCtx?.resumeDownload,
    pauseDownload: downloadsCtx?.pauseDownload,
    recentVersion,
    setRecentVersion,
  });

  // Keyboard navigation hook
  const { handleInputKeyDown } = useCommandPaletteKeyboard({
    items,
    selectedIndex,
    setSelectedIndex,
    scope,
    setScope,
    rawQuery,
    setRawQuery,
    isSimpleMode,
    setShowInspector,
    setActionDrawerOpen,
    setCheatSheetOpen,
    setRandomGameKey,
    showToast: (msg, type) => showToast(msg, type ?? "info"),
    t,
    listRef,
  });

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
          className={`command-palette-panel${effectiveShowInspector ? " with-inspector" : ""}${
            isSimpleMode ? " is-simple-palette" : ""
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Main List Column */}
          <div className="cmd-main-column">
            {/* Header & Search Bar */}
            <CommandPaletteHeader
              inputId={inputId}
              inputRef={inputRef}
              rawQuery={rawQuery}
              onQueryChange={handleQueryChange}
              onKeyDown={handleInputKeyDown}
              scope={scope}
              onClearScope={() => setScope("all")}
              onClearQuery={() => {
                setRawQuery("");
                inputRef.current?.focus();
              }}
              isSearchingIgdb={isSearchingIgdb}
              isSimpleMode={isSimpleMode}
              showInspector={showInspector}
              onToggleInspector={() => setShowInspector((prev) => !prev)}
              onOpenCheatSheet={() => setCheatSheetOpen(true)}
              t={t}
            />

            {/* Scope Filter Ribbon */}
            {!isSimpleMode && (
              <CommandPaletteScopeBar
                scope={scope}
                onSelectScope={(s) => {
                  setScope(s);
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                scopeCounts={scopeCounts}
                t={t}
              />
            )}

            {/* Interactive Filter Pills / Prompt Chips */}
            <CommandPaletteFilterPills
              rawQuery={rawQuery}
              parsedFilters={parsedFilters}
              onSetRawQuery={setRawQuery}
              onRollRandomGame={() => {
                setRandomGameKey((k) => k + 1);
                setRawQuery("roll");
              }}
              onOpenCheatSheet={() => setCheatSheetOpen(true)}
              t={t}
            />

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

                      <CommandPaletteItemRow
                        item={item}
                        isSelected={isSelected}
                        cleanQuery={cleanQuery}
                        onSelect={item.onSelect}
                        onMouseEnter={() => setSelectedIndex(idx)}
                      />
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Keyboard Hints */}
            <CommandPaletteFooter
              selectedItem={currentSelectedItem}
              itemCount={items.length}
              isSimpleMode={isSimpleMode}
              t={t}
            />
          </div>

          {/* Right Inspector Column */}
          {effectiveShowInspector && (
            <div className="cmd-inspector-column">
              <CommandPaletteInspector
                item={currentSelectedItem}
                t={t}
                locale={language}
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

      {/* Direct Download Modal */}
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
