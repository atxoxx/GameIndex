import { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Search } from "lucide-react";
import { useGames } from "../context/GameContext";
import { useTheme } from "../context/ThemeContext";
import { useBigScreen } from "../context/BigScreenContext";
import { useHandheldMode } from "../hooks/useHandheldMode";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { useToast } from "../context/ToastContext";
import { useDownloads } from "../context/DownloadContext";
import { useUpdate } from "../context/UpdateContext";
import { useWishlistContext } from "../context/WishlistContext";
import { useDensityContext } from "../context/DensityContext";
import { useAchievements } from "../context/AchievementContext";
import { SidebarCollapseContext } from "../context/SidebarCollapseContext";
import { gameDisplayName, type StoreGameSummary } from "../types/game";
import DownloadModal from "./DownloadModal";
import { playTabSound } from "../utils/soundEffects";
import type { PaletteCategory, PaletteGroup } from "./command-palette/commandPaletteTypes";
import {
  calculateLibraryStats,
  evaluateExpression,
  getPinnedItems,
  itemHasDrawerActions,
  parseQueryFilters,
  saveRecentQuery,
} from "./command-palette/commandPaletteUtils";
import {
  createNavigationItems,
  createSystemActions,
} from "./command-palette/commandPaletteActions";
import { SCOPE_PREFIXES } from "./command-palette/commandPaletteScopes";
import {
  buildSettingsEntries,
  useDocsPaletteEntries,
} from "./command-palette/commandPaletteSources";
import CommandPaletteHeader from "./command-palette/CommandPaletteHeader";
import CommandPaletteScopeBar from "./command-palette/CommandPaletteScopeBar";
import CommandPaletteFilterPills from "./command-palette/CommandPaletteFilterPills";
import CommandPaletteItemRow from "./command-palette/CommandPaletteItemRow";
import CommandPaletteFooter from "./command-palette/CommandPaletteFooter";
import CommandPalettePreview from "./command-palette/CommandPalettePreview";
import CommandPaletteActionDrawer from "./command-palette/CommandPaletteActionDrawer";
import CommandPaletteCheatSheet from "./command-palette/CommandPaletteCheatSheet";
import { useCommandPaletteItems } from "./command-palette/useCommandPaletteItems";
import { useCommandPaletteKeyboard } from "./command-palette/useCommandPaletteKeyboard";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const GROUP_TITLE_KEYS: Record<PaletteGroup, string> = {
  pinned: "commandPalette.sectionPinned",
  queries: "commandPalette.sectionRecentQueries",
  recent: "commandPalette.sectionRecent",
  recentGames: "commandPalette.sectionRecentGames",
  suggested: "commandPalette.sectionSuggested",
  games: "commandPalette.sectionGames",
  mods: "commandPalette.sectionMods",
  wishlist: "commandPalette.sectionWishlist",
  actions: "commandPalette.sectionActions",
  navigation: "commandPalette.sectionNav",
  themes: "commandPalette.sectionThemes",
  downloads: "commandPalette.sectionDownloads",
  store: "commandPalette.sectionIgdb",
  docs: "commandPalette.sectionDocs",
  settings: "commandPalette.sectionSettings",
  utility: "commandPalette.sectionUtility",
};

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
  const { enabled: handheldEnabled, toggle: toggleHandheld } = useHandheldMode();
  const {
    uiSoundEnabled,
    setUiSoundEnabled,
    uiSoundVolume,
    setUiSoundVolume,
    commandPaletteMode,
    isSimpleUi,
    showFullLinuxUi,
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
  const [peekOpen, setPeekOpen] = useState(false);
  const [isWide, setIsWide] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1200
  );

  const isCompact = commandPaletteMode === "simple" || isSimpleUi;

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 1200);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [igdbResults, setIgdbResults] = useState<StoreGameSummary[]>([]);
  const [isSearchingIgdb, setIsSearchingIgdb] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<{
    name: string;
    id?: string;
    poster?: string;
  } | null>(null);

  const [recentVersion, setRecentVersion] = useState(0);
  const [pinVersion, setPinVersion] = useState(0);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [randomGameKey, setRandomGameKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listId = useId();

  // Active running game (if any).
  const runningGame = useMemo(() => {
    if (runningGameIds.length === 0) return null;
    return games.find((g) => runningGameIds.includes(g.id)) ?? null;
  }, [games, runningGameIds]);

  // Random pick keyed to library length + roll counter only, so renaming or
  // favoriting a game never re-rolls the picker under the user.
  const randomGame = useMemo(() => {
    if (games.length === 0) return null;
    const installed = games.filter((g) => g.installed);
    const pool = installed.length > 0 ? installed : games;
    const idx = Math.floor(Math.random() * pool.length);
    return pool[idx] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length, randomGameKey]);

  // Reset transient state on open.
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
      setPeekOpen(false);
      playTabSound();
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Escape backs out one layer: sub-modals, then a peeked preview, then the
  // palette. On wide screens the preview is part of the frame, so Escape closes
  // the palette directly.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (actionDrawerOpen || cheatSheetOpen) return;
      if (peekOpen && !isWide) {
        e.preventDefault();
        setPeekOpen(false);
        return;
      }
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, actionDrawerOpen, cheatSheetOpen, peekOpen, isWide, onClose]);

  const parsedFilters = useMemo(() => parseQueryFilters(rawQuery), [rawQuery]);
  const cleanQuery = parsedFilters.cleanQuery;
  const calcResult = useMemo(() => evaluateExpression(cleanQuery), [cleanQuery]);

  const handleQueryChange = (val: string) => {
    const prefixScope = SCOPE_PREFIXES[val.charAt(0)];
    const isNegationToken = /^!(?:fav|installed|unplayed|running)\b/i.test(val);
    if (prefixScope && !isNegationToken && scope !== prefixScope) {
      setScope(prefixScope);
    }
    setRawQuery(val);
    setSelectedIndex(0);
  };

  // Debounced IGDB catalog search (All + Store keep their live remote results).
  useEffect(() => {
    const q = cleanQuery;
    if (q.length < 2 || (scope !== "all" && scope !== "store")) {
      setIgdbResults([]);
      setIsSearchingIgdb(false);
      return;
    }

    let cancelled = false;
    setIsSearchingIgdb(true);
    const timer = setTimeout(() => {
      invoke<StoreGameSummary[]>("search_store_games", {
        query: q,
        offset: 0,
        limit: 12,
      })
        .then((res) => {
          if (!cancelled) setIgdbResults(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          if (!cancelled) setIgdbResults([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearchingIgdb(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleanQuery, scope]);

  const systemActions = useMemo(() => {
    return createSystemActions({
      navigate,
      onClose,
      showToast: (msg: string, type: "success" | "error" | "info" | "warning" = "info") =>
        showToast(msg, type),
      t,
      isBigScreen,
      setBigScreen,
      isHandheld: handheldEnabled,
      toggleHandheldMode: toggleHandheld,
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
      runningGame: runningGame ? { id: runningGame.id, name: gameDisplayName(runningGame) } : null,
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
    handheldEnabled,
    toggleHandheld,
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

  const navRoutes = useMemo(() => createNavigationItems(navigate, onClose, t), [navigate, onClose, t]);
  const settingsEntries = useMemo(
    () => buildSettingsEntries(t, showFullLinuxUi),
    [t, showFullLinuxUi]
  );
  const docsEnabled = useMemo(
    () =>
      scope === "docs" ||
      (scope === "all" && cleanQuery.trim().length >= 3) ||
      getPinnedItems().some((pin) => pin.id.startsWith("doc-")),
    [scope, cleanQuery, pinVersion]
  );
  const docsEntries = useDocsPaletteEntries(t, language, docsEnabled);
  const libraryStats = useMemo(() => calculateLibraryStats(games), [games]);

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
    runningGameIds,
    games,
    systemActions,
    navRoutes,
    settingsEntries,
    docsEntries,
    downloads: downloadsCtx?.downloads,
    igdbResults,
    wishlistItems: wishlistCtx?.wishlist || [],
    isWishlisted: (slug) => wishlistCtx?.isWishlisted(slug) ?? false,
    toggleWishlist: (game) => wishlistCtx?.toggle(game),
    achievementsCache: achievementsCtx?.summaries,
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
    pinVersion,
    setPinVersion,
  });

  const executeItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (cleanQuery.trim().length >= 2 && !item.recentQuery) {
      saveRecentQuery(cleanQuery);
    }
    item.onSelect();
  };

  const { handleInputKeyDown, handleListKeyDown } = useCommandPaletteKeyboard({
    items,
    selectedIndex,
    setSelectedIndex,
    scope,
    setScope,
    rawQuery,
    setPeekOpen,
    setActionDrawerOpen,
    setCheatSheetOpen,
    setRandomGameKey,
    showToast: (msg, type) => showToast(msg, type ?? "info"),
    t,
    listRef,
    inputRef,
    onExecute: executeItem,
  });

  if (!isOpen) return null;

  const currentSelectedItem = items[selectedIndex] || null;
  const activeDescendantId = currentSelectedItem ? `${listId}-opt-${selectedIndex}` : undefined;
  const showPreview = !isCompact && (isWide || peekOpen);
  const canPeek = !isCompact && !isWide;
  const isSearching = rawQuery.trim().length > 0;
  let currentGroup: string | null = null;

  return createPortal(
    <>
      <div
        className="cp-backdrop"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette.title")}
      >
        <div
          className={`cp-panel${showPreview ? " with-preview" : ""}${isCompact ? " is-compact" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cp-main">
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
              onOpenCheatSheet={() => setCheatSheetOpen(true)}
              t={t}
              listId={listId}
              activeDescendantId={activeDescendantId}
              itemCount={items.length}
              compact={isCompact}
            />

            {!isCompact && (
              <CommandPaletteScopeBar
                scope={scope}
                onSelectScope={(next) => {
                  setScope(next);
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                scopeCounts={scopeCounts}
                t={t}
              />
            )}

            <CommandPaletteFilterPills
              rawQuery={rawQuery}
              parsedFilters={parsedFilters}
              onSetRawQuery={(next) => {
                setRawQuery(next);
                setSelectedIndex(0);
              }}
              t={t}
            />

            <div
              ref={listRef}
              id={listId}
              className="cp-list"
              role="listbox"
              aria-label={t("commandPalette.resultsLabel")}
              tabIndex={0}
              onKeyDown={handleListKeyDown}
            >
              {items.length === 0 ? (
                <div className="cp-empty">
                  {isSearchingIgdb ? (
                    <Loader2 size={22} className="cp-spinner" aria-hidden="true" />
                  ) : (
                    <Search size={22} aria-hidden="true" />
                  )}
                  <span className="cp-empty-title">
                    {isSearching ? t("commandPalette.noResults") : t("commandPalette.emptyScopeTitle")}
                  </span>
                  <span className="cp-empty-hint">
                    {isSearching ? t("commandPalette.noResultsHint") : t("commandPalette.emptyScopeHint")}
                  </span>
                  <div className="cp-empty-actions">
                    {scope !== "games" && (
                      <button
                        type="button"
                        className="cp-empty-action"
                        onClick={() => {
                          setScope("games");
                          setSelectedIndex(0);
                        }}
                      >
                        {t("commandPalette.emptySuggestGames")}
                      </button>
                    )}
                    {scope !== "store" && (
                      <button
                        type="button"
                        className="cp-empty-action"
                        onClick={() => {
                          setScope("store");
                          setSelectedIndex(0);
                        }}
                      >
                        {t("commandPalette.emptySuggestStore")}
                      </button>
                    )}
                    {scope !== "docs" && (
                      <button
                        type="button"
                        className="cp-empty-action"
                        onClick={() => {
                          setScope("docs");
                          setSelectedIndex(0);
                        }}
                      >
                        {t("commandPalette.emptySuggestDocs")}
                      </button>
                    )}
                    {rawQuery.length > 0 && (
                      <button
                        type="button"
                        className="cp-empty-action"
                        onClick={() => {
                          setRawQuery("");
                          setScope("all");
                          setSelectedIndex(0);
                          inputRef.current?.focus();
                        }}
                      >
                        {t("commandPalette.emptySuggestClear")}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                items.map((item, index) => {
                  const group: PaletteGroup =
                    item.group ?? (item.category === "all" ? "utility" : item.category);
                  const showGroup = group !== currentGroup;
                  currentGroup = group;
                  const isSelected = index === selectedIndex;

                  return (
                    <div key={item.id} className="cp-group-block">
                      {showGroup && (
                        <div className="cp-group">
                          <span>{t(GROUP_TITLE_KEYS[group])}</span>
                          {group === "store" && isSearchingIgdb && (
                            <span className="cp-group-status">
                              <Loader2 size={11} className="cp-spinner" aria-hidden="true" />
                              {t("commandPalette.searchingIgdb")}
                            </span>
                          )}
                        </div>
                      )}

                      <CommandPaletteItemRow
                        item={item}
                        isSelected={isSelected}
                        cleanQuery={cleanQuery}
                        optionId={`${listId}-opt-${index}`}
                        onSelect={() => {
                          setSelectedIndex(index);
                          executeItem(index);
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                      />
                    </div>
                  );
                })
              )}
            </div>

            <CommandPaletteFooter
              selectedItem={currentSelectedItem}
              itemCount={items.length}
              canPeek={canPeek}
              t={t}
            />
          </div>

          {showPreview && (
            <CommandPalettePreview
              item={currentSelectedItem}
              t={t}
              locale={language}
              isWishlisted={(slug) => wishlistCtx?.isWishlisted(slug) ?? false}
              toggleWishlist={(game) => wishlistCtx?.toggle(game)}
              onOpenDownloadModal={(target) => setDownloadTarget(target)}
              onOpenActionDrawer={() => setActionDrawerOpen(true)}
              onClose={onClose}
              navigate={navigate}
              canClosePeek={!isWide}
            />
          )}
        </div>
      </div>

      <CommandPaletteActionDrawer
        item={currentSelectedItem}
        isOpen={actionDrawerOpen && itemHasDrawerActions(currentSelectedItem)}
        onClose={() => {
          setActionDrawerOpen(false);
          inputRef.current?.focus();
        }}
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

      <CommandPaletteCheatSheet
        isOpen={cheatSheetOpen}
        onClose={() => {
          setCheatSheetOpen(false);
          inputRef.current?.focus();
        }}
        onApplyQuery={(query) => {
          handleQueryChange(query);
          inputRef.current?.focus();
        }}
        t={t}
      />

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
