import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLibraryFilters } from "../../hooks/useLibraryFilters";
import { useSidebarCollapse } from "../../context/SidebarCollapseContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  gameNameFromPath,
  PLAY_STATUS_DETAILS,
  type Game,
  type GameMetadataResult,
  type PlayStatus,
} from "../../types/game";
import ImportModal, { type ExeInfo } from "../ImportModal";
import SidebarFilterPopover from "../SidebarFilterPopover";
import { SidebarHoverPreview } from "../SidebarHoverPreview";
import SidebarHeader from "./SidebarHeader";
import SidebarActiveFilters from "./SidebarActiveFilters";
import SidebarSectionHeader from "./SidebarSectionHeader";
import SidebarGameItem from "./SidebarGameItem";
import SidebarContextMenu from "./SidebarContextMenu";
import SidebarBulkActionBar from "./SidebarBulkActionBar";
import SidebarEmptyState from "./SidebarEmptyState";
import {
  RECENTLY_PLAYED_COUNT,
  loadPinnedIds,
  savePinnedIds,
  loadCollapsedSections,
  saveCollapsedSections,
  buildSidebarAnchorSelector,
} from "./utils";
import type { SectionCollapseMap } from "./types";

/**
 * Sidebar
 * ───────
 * Main left sidebar game list component.
 * Modular, accessible, and high-performance container coordinating
 * search, filters, pinned/recent sections, context menus, and bulk operations.
 */
export default function Sidebar() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const {
    games,
    selectedGameId,
    setSelectedGameId,
    removeGame,
    runningGameIds,
    launchGame,
    importLocalGames,
    updateGame,
  } = useGames();
  const { showToast } = useToast();

  // Full filter system for the sidebar game list.
  const {
    filters: filterState,
    filteredGames,
    availableGenres,
    availablePlatforms,
    setSearch,
    setGenres,
    setPlatforms,
    setYearRange,
    setRatingMin,
    setStatus,
    setPlayStatus,
    setSort,
    removeGenre,
    removePlatform,
    removeYear,
    removeRating,
    removeStatus,
    removePlayStatus,
    removeSource,
    reset,
  } = useLibraryFilters(games);

  const advancedFilterCount =
    (filterState.status !== "all" ? 1 : 0) +
    (filterState.genres.length > 0 ? 1 : 0) +
    (filterState.platforms.length > 0 ? 1 : 0) +
    (filterState.yearMin != null || filterState.yearMax != null ? 1 : 0) +
    (filterState.ratingMin != null ? 1 : 0) +
    (filterState.playStatus !== "all" ? 1 : 0);

  const isFilteringActive =
    filterState.search.trim() !== "" || advancedFilterCount > 0;

  // ── UI state ─────────────────────────────────────────────────────
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [importMenuAnchor, setImportMenuAnchor] = useState<HTMLElement | null>(null);
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ game: Game; x: number; y: number } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [scannedExes, setScannedExes] = useState<ExeInfo[]>([]);
  const [importRootPath, setImportRootPath] = useState<string>("");

  const importBtnRef = useRef<HTMLButtonElement>(null);
  const filterBtnRef = useRef<HTMLButtonElement>(null);

  // ── Icon-rail collapse state ─────────────────────────────────────
  const { isIconRail, toggle: toggleIconRail } = useSidebarCollapse();

  // ── Section collapse state ───────────────────────────────────────
  const [collapsedSections, setCollapsedSections] = useState<SectionCollapseMap>(() =>
    loadCollapsedSections()
  );

  const toggleSectionCollapse = useCallback((sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      saveCollapsedSections(next);
      return next;
    });
  }, []);

  // ── Pinned games state ───────────────────────────────────────────
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());

  useEffect(() => {
    savePinnedIds(pinnedIds);
  }, [pinnedIds]);

  // ── Multi-select state ───────────────────────────────────────────
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  useEffect(() => {
    if (bulkSelectedIds.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBulkSelectedIds(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulkSelectedIds.size]);

  // ── Auto-scroll selected row into view ───────────────────────────
  useEffect(() => {
    if (!selectedGameId) return;
    const handle = setTimeout(() => {
      try {
        const el = document.querySelector<HTMLElement>(
          `[data-sidebar-game-id="${CSS.escape(selectedGameId)}"]`
        );
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        /* CSS.escape unavailable — skip */
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [selectedGameId]);

  // ── Hover preview ────────────────────────────────────────────────
  const [hoveredGameId, setHoveredGameId] = useState<string | null>(null);
  const hoveredGame = useMemo(
    () => (hoveredGameId ? (games.find((g) => g.id === hoveredGameId) ?? null) : null),
    [hoveredGameId, games]
  );

  const hoverPreviewAnchor = useMemo(
    () => buildSidebarAnchorSelector(hoveredGameId),
    [hoveredGameId]
  );

  const handlePointerEnter = useCallback((g: Game) => {
    setHoveredGameId(g.id);
  }, []);

  const handlePointerLeave = useCallback((g: Game) => {
    setHoveredGameId((id) => (id === g.id ? null : id));
  }, []);

  // ── Derived lists for rendering ──────────────────────────────────
  const pinnedGames = useMemo(() => {
    return Array.from(pinnedIds)
      .map((id) => games.find((g) => g.id === id))
      .filter((g): g is Game => !!g);
  }, [pinnedIds, games]);

  const filteredNonPinned = useMemo(() => {
    if (pinnedIds.size === 0) return filteredGames;
    return filteredGames.filter((g) => !pinnedIds.has(g.id));
  }, [filteredGames, pinnedIds]);

  const recentlyPlayedGames = useMemo(() => {
    return filteredGames
      .filter(
        (g): g is Game & { lastPlayed: number } =>
          typeof g.lastPlayed === "number" && !pinnedIds.has(g.id)
      )
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .slice(0, RECENTLY_PLAYED_COUNT);
  }, [filteredGames, pinnedIds]);

  const mainListGames = useMemo(() => {
    if (recentlyPlayedGames.length === 0) return filteredNonPinned;
    const recentIds = new Set(recentlyPlayedGames.map((g) => g.id));
    return filteredNonPinned.filter((g) => !recentIds.has(g.id));
  }, [filteredNonPinned, recentlyPlayedGames]);

  // Dismiss dropdowns / menus on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (target && target.closest("[data-sidebar-context-menu]")) {
        return;
      }
      setShowImportMenu(false);
      setContextMenu(null);
    }
    if (showImportMenu || contextMenu) {
      document.addEventListener("click", handleClick);
    }
    return () => document.removeEventListener("click", handleClick);
  }, [showImportMenu, contextMenu]);

  // ── Import handlers ──────────────────────────────────────────────
  async function handleImportExe() {
    setShowImportMenu(false);
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("sidebar.selectGameExe"),
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        const existing = games.find(
          (g) => g.path.toLowerCase().trim() === filePath.toLowerCase().trim()
        );
        if (existing) {
          showToast(
            t("sidebar.alreadyInLibrary", { name: gameNameFromPath(filePath) }),
            "info"
          );
          return;
        }
        setScannedExes([{ path: filePath, size: 0, modifiedAt: Math.round(Date.now() / 1000) }]);
        setImportRootPath(filePath.replace(/[\\/][^\\/]*$/, ""));
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import exe:", err);
    }
  }

  async function handleImportFolder() {
    setShowImportMenu(false);
    try {
      const folderPath = await open({
        multiple: false,
        directory: true,
        title: t("sidebar.selectFolderScan"),
      });
      if (folderPath && typeof folderPath === "string") {
        const exes: ExeInfo[] = await invoke("scan_folder_for_exes", { folderPath });
        if (exes.length === 0) {
          showToast(t("sidebar.noExesFound"), "info");
          return;
        }
        const existingPaths = new Set(games.map((g) => g.path.toLowerCase()));
        const newExes = exes.filter(
          (exe) => !existingPaths.has(exe.path.toLowerCase())
        );
        if (newExes.length === 0) {
          showToast(t("sidebar.allExesInLibrary"), "info");
          return;
        }
        setScannedExes(newExes);
        setImportRootPath(folderPath);
        setShowImportModal(true);
      }
    } catch (err) {
      console.error("Failed to import folder:", err);
    }
  }

  async function handleConfirmImport(
    imports: { path: string; metadata: GameMetadataResult | null }[],
    errors?: { name: string; message: string }[]
  ) {
    setShowImportModal(false);
    await importLocalGames(imports);
    if (errors && errors.length > 0) {
      showToast(
        t("import.importPartial", { ok: imports.length, failed: errors.length }),
        "error"
      );
    }
  }

  // ── Context menu handlers ────────────────────────────────────────
  const handleGameContextMenu = useCallback((e: React.MouseEvent, game: Game) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ game, x: e.clientX, y: e.clientY });
  }, []);

  function handleLaunchFromContextMenu(game: Game) {
    setContextMenu(null);
    launchGame(game);
  }

  function handleViewDetailsFromContextMenu(game: Game) {
    setContextMenu(null);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  function handleRemoveFromContextMenu(game: Game) {
    removeGame(game.id);
    setContextMenu(null);
    showToast(t("gamePage.removed", { name: game.name }), "info");
  }

  async function handleShowInFolder(game: Game) {
    setContextMenu(null);
    if (!game.path) {
      showToast(t("sidebar.noLocalPath", { name: game.name }), "info");
      return;
    }
    try {
      const parent = game.path.replace(/[\\/][^\\/]+$/, "");
      await openPath(parent);
    } catch (err) {
      showToast(t("sidebar.couldNotOpenFolder", { error: String(err) }), "error");
    }
  }

  function handleOpenStore(game: Game) {
    setContextMenu(null);
    if (game.metadataUrl) {
      openUrl(game.metadataUrl).catch(() => undefined);
      return;
    }
    navigate(`/store?q=${encodeURIComponent(game.name)}`);
  }

  async function handleCopyPath(game: Game) {
    setContextMenu(null);
    const text = game.path || game.name;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      /* clipboard unavailable */
    }
    showToast(
      copied ? t("sidebar.copiedToClipboard") : t("sidebar.copyFailed"),
      copied ? "success" : "error"
    );
  }

  function handleSetPlayStatus(game: Game, status: PlayStatus) {
    updateGame(game.id, { playStatus: status });
    setContextMenu(null);
    const meta = PLAY_STATUS_DETAILS[status];
    showToast(
      t("sidebar.statusSet", { name: game.name, status: meta ? t(meta.labelKey) : status }),
      "success"
    );
  }

  // ── Row click & multi-select logic ───────────────────────────────
  const combinedVisibleGames = useMemo<Game[]>(() => {
    return [...pinnedGames, ...recentlyPlayedGames, ...mainListGames];
  }, [pinnedGames, recentlyPlayedGames, mainListGames]);

  const handleRowClick = useCallback(
    (game: Game, e: React.MouseEvent | React.KeyboardEvent) => {
      if (e.shiftKey && lastClickedId) {
        e.preventDefault();
        e.stopPropagation();
        const ids = combinedVisibleGames.map((g) => g.id);
        const fromIdx = ids.indexOf(lastClickedId);
        const toIdx = ids.indexOf(game.id);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          setBulkSelectedIds((prev) => {
            const next = new Set(prev);
            for (let i = lo; i <= hi; i++) next.add(ids[i]);
            return next;
          });
        }
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        setLastClickedId(game.id);
        setBulkSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(game.id)) next.delete(game.id);
          else next.add(game.id);
          return next;
        });
        return;
      }
      setLastClickedId(game.id);
      if (bulkSelectedIds.size > 0) setBulkSelectedIds(new Set());
      setSelectedGameId(game.id);
      navigate(`/library/${game.id}`);
    },
    [lastClickedId, combinedVisibleGames, bulkSelectedIds, setSelectedGameId, navigate]
  );

  const gameById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) map.set(g.id, g);
    return map;
  }, [games]);

  const handleListClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const rowEl = target.closest<HTMLElement>("[data-sidebar-game-id]");
      if (!rowEl) return;
      const id = rowEl.dataset.sidebarGameId;
      const game = id ? gameById.get(id) : undefined;
      if (!game) return;
      handleRowClick(game, e);
    },
    [handleRowClick, gameById]
  );

  const handleListContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const rowEl = target.closest<HTMLElement>("[data-sidebar-game-id]");
      if (!rowEl) return;
      const id = rowEl.dataset.sidebarGameId;
      const game = id ? gameById.get(id) : undefined;
      if (!game) return;
      handleGameContextMenu(e, game);
    },
    [handleGameContextMenu, gameById]
  );

  const launchGameRef = useRef(launchGame);
  useEffect(() => {
    launchGameRef.current = launchGame;
  }, [launchGame]);

  const handleQuickPlay = useCallback((game: Game) => {
    launchGameRef.current(game);
  }, []);

  // Keyboard navigation: Enter/Space to select, Up/Down to navigate list items
  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.hasAttribute("data-sidebar-game-id")) return;

      if (e.key === "Enter" || e.key === " ") {
        const id = target.dataset.sidebarGameId;
        const game = id ? gameById.get(id) : undefined;
        if (!game) return;
        e.preventDefault();
        handleRowClick(game, e);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = target.nextElementSibling as HTMLElement | null;
        if (next && next.hasAttribute("data-sidebar-game-id")) {
          next.focus();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = target.previousElementSibling as HTMLElement | null;
        if (prev && prev.hasAttribute("data-sidebar-game-id")) {
          prev.focus();
        }
      }
    },
    [handleRowClick, gameById]
  );

  const togglePin = useCallback((game: Game) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(game.id)) next.delete(game.id);
      else next.add(game.id);
      return next;
    });
  }, []);

  // ── Bulk actions ─────────────────────────────────────────────────
  const bulkPin = useCallback(() => {
    const ids = Array.from(bulkSelectedIds);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setBulkSelectedIds(new Set());
  }, [bulkSelectedIds]);

  const bulkUnpin = useCallback(() => {
    const ids = Array.from(bulkSelectedIds);
    setPinnedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    setBulkSelectedIds(new Set());
  }, [bulkSelectedIds]);

  const bulkRemove = useCallback(() => {
    const count = bulkSelectedIds.size;
    if (count === 0) return;
    bulkSelectedIds.forEach((id) => removeGame(id));
    setBulkSelectedIds(new Set());
    showToast(
      t("sidebar.removedCount", { count, plural: count !== 1 ? "s" : "" }),
      "info"
    );
  }, [bulkSelectedIds, removeGame, showToast, t]);

  const bulkSetPlayStatus = useCallback(
    (status: PlayStatus) => {
      const count = bulkSelectedIds.size;
      if (count === 0) return;
      bulkSelectedIds.forEach((id) => updateGame(id, { playStatus: status }));
      setBulkSelectedIds(new Set());
      const meta = PLAY_STATUS_DETAILS[status];
      showToast(
        t("sidebar.markedCount", {
          count,
          plural: count !== 1 ? "s" : "",
          status: meta ? t(meta.labelKey) : status,
        }),
        "success"
      );
    },
    [bulkSelectedIds, updateGame, showToast, t]
  );

  return (
    <aside className="sidebar">
      <SidebarHeader
        isIconRail={isIconRail}
        onToggleIconRail={toggleIconRail}
        searchQuery={filterState.search}
        onSearchChange={setSearch}
        onClearSearch={() => setSearch("")}
        advancedFilterCount={advancedFilterCount}
        showFilterPopover={showFilterPopover}
        onToggleFilterPopover={() => setShowFilterPopover((v) => !v)}
        filterButtonRef={filterBtnRef}
        importButtonRef={importBtnRef}
        showImportMenu={showImportMenu}
        importMenuAnchor={importMenuAnchor}
        onToggleImportMenu={(anchor) => {
          setImportMenuAnchor(anchor);
          setShowImportMenu((v) => !v);
        }}
        onImportExe={handleImportExe}
        onImportFolder={handleImportFolder}
      />

      <SidebarActiveFilters
        filterState={filterState}
        onRemoveStatus={removeStatus}
        onRemoveSource={removeSource}
        onRemovePlayStatus={removePlayStatus}
        onRemoveGenre={removeGenre}
        onRemovePlatform={removePlatform}
        onRemoveYear={removeYear}
        onRemoveRating={removeRating}
        onReset={reset}
      />

      <hr className="sidebar-divider" />

      {/* Pinned section */}
      {pinnedGames.length > 0 && (
        <>
          <SidebarSectionHeader
            title={t("friendsPage.pinned")}
            count={pinnedGames.length}
            collapsible
            isCollapsed={!!collapsedSections.pinned}
            onToggleCollapse={() => toggleSectionCollapse("pinned")}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
                style={{ width: 14, height: 14, display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}
              >
                <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
              </svg>
            }
          />
          {!collapsedSections.pinned && (
            <div
              className="sidebar-pinned-list"
              onClick={handleListClick}
              onContextMenu={handleListContextMenu}
              onKeyDown={handleListKeyDown}
              role="listbox"
              aria-label={t("friendsPage.pinned")}
            >
              {pinnedGames.map((game) => (
                <SidebarGameItem
                  key={`pinned-${game.id}`}
                  game={game}
                  isSelected={selectedGameId === game.id}
                  isRunning={runningGameIds.includes(game.id)}
                  bulkSelected={bulkSelectedIds.has(game.id)}
                  searchQuery={filterState.search}
                  prefersCover={isIconRail}
                  onPointerEnter={handlePointerEnter}
                  onPointerLeave={handlePointerLeave}
                  onQuickPlay={handleQuickPlay}
                />
              ))}
            </div>
          )}
          <hr className="sidebar-divider sidebar-divider--thin" />
        </>
      )}

      {/* Scrollable list container */}
      <div
        className="sidebar-list"
        onClick={handleListClick}
        onContextMenu={handleListContextMenu}
        onKeyDown={handleListKeyDown}
        role="listbox"
        aria-label={t("bigscreen.friends.games")}
      >
        {/* Recently played section */}
        {recentlyPlayedGames.length > 0 && (
          <>
            <SidebarSectionHeader
              title={t("community.recentlyPlayed")}
              count={recentlyPlayedGames.length}
              collapsible
              isCollapsed={!!collapsedSections.recent}
              onToggleCollapse={() => toggleSectionCollapse("recent")}
              icon={
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  style={{ width: 14, height: 14, display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              }
            />
            {!collapsedSections.recent && (
              <div className="sidebar-recent-list">
                {recentlyPlayedGames.map((game) => (
                  <SidebarGameItem
                    key={`recent-${game.id}`}
                    game={game}
                    isSelected={selectedGameId === game.id}
                    isRunning={runningGameIds.includes(game.id)}
                    bulkSelected={bulkSelectedIds.has(game.id)}
                    searchQuery={filterState.search}
                    prefersCover={isIconRail}
                    onPointerEnter={handlePointerEnter}
                    onPointerLeave={handlePointerLeave}
                    onQuickPlay={handleQuickPlay}
                  />
                ))}
              </div>
            )}
            <hr className="sidebar-divider sidebar-divider--thin" />
          </>
        )}

        {/* Main games section */}
        <SidebarSectionHeader
          title={t("bigscreen.friends.games")}
          count={mainListGames.length}
          resultLabel={
            isFilteringActive
              ? t("sidebar.resultOfTotal", {
                  count: filteredGames.length,
                  total: games.length,
                })
              : undefined
          }
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ width: 14, height: 14, display: "inline-block", verticalAlign: "-2px", marginRight: 4 }}
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 12h4m-2-2v4m7-2h.01m3 0h.01" />
            </svg>
          }
        />

        {mainListGames.length === 0 ? (
          filteredNonPinned.length === 0 ? (
            <SidebarEmptyState
              hasZeroLibraryGames={games.length === 0}
              isFilteringActive={isFilteringActive}
              onImportClick={(e) => {
                e.stopPropagation();
                setImportMenuAnchor(e.currentTarget);
                setShowImportMenu(true);
              }}
              onClearFilters={reset}
            />
          ) : null
        ) : (
          <>
            {mainListGames.map((game) => (
              <SidebarGameItem
                key={game.id}
                game={game}
                isSelected={selectedGameId === game.id}
                isRunning={runningGameIds.includes(game.id)}
                bulkSelected={bulkSelectedIds.has(game.id)}
                searchQuery={filterState.search}
                prefersCover={isIconRail}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onQuickPlay={handleQuickPlay}
              />
            ))}

            {bulkSelectedIds.size > 0 && (
              <SidebarBulkActionBar
                count={bulkSelectedIds.size}
                allPinned={
                  pinnedIds.size > 0 &&
                  Array.from(bulkSelectedIds).every((id) => pinnedIds.has(id))
                }
                onPin={bulkPin}
                onUnpin={bulkUnpin}
                onSetStatus={bulkSetPlayStatus}
                onRemove={bulkRemove}
                onCancel={() => setBulkSelectedIds(new Set())}
              />
            )}
          </>
        )}
      </div>

      {/* Context menu portal */}
      {contextMenu &&
        createPortal(
          <SidebarContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            game={contextMenu.game}
            isRunning={runningGameIds.includes(contextMenu.game.id)}
            isPinned={pinnedIds.has(contextMenu.game.id)}
            onLaunch={() => handleLaunchFromContextMenu(contextMenu.game)}
            onViewDetails={() => handleViewDetailsFromContextMenu(contextMenu.game)}
            onRemove={() => handleRemoveFromContextMenu(contextMenu.game)}
            onTogglePin={() => {
              togglePin(contextMenu.game);
              setContextMenu(null);
            }}
            onSetStatus={(s) => handleSetPlayStatus(contextMenu.game, s)}
            onShowInFolder={() => handleShowInFolder(contextMenu.game)}
            onOpenStore={() => handleOpenStore(contextMenu.game)}
            onCopyPath={() => handleCopyPath(contextMenu.game)}
          />,
          document.body
        )}

      {/* Modals & Popovers */}
      {showImportModal && (
        <ImportModal
          exeInfos={scannedExes}
          rootPath={importRootPath}
          existingPaths={games.map((g) => g.path)}
          onConfirm={handleConfirmImport}
          onCancel={() => setShowImportModal(false)}
        />
      )}

      {showFilterPopover && (
        <SidebarFilterPopover
          anchorRef={filterBtnRef}
          status={filterState.status}
          playStatus={filterState.playStatus}
          selectedGenres={filterState.genres}
          selectedPlatforms={filterState.platforms}
          yearMin={filterState.yearMin}
          yearMax={filterState.yearMax}
          ratingMin={filterState.ratingMin}
          sort={filterState.sort}
          availableGenres={availableGenres}
          availablePlatforms={availablePlatforms}
          totalGames={games.length}
          filteredCount={filteredGames.length}
          onStatusChange={setStatus}
          onPlayStatusChange={setPlayStatus}
          onGenresChange={setGenres}
          onPlatformsChange={setPlatforms}
          onYearRangeChange={setYearRange}
          onRatingMinChange={setRatingMin}
          onSortChange={setSort}
          onReset={reset}
          onClose={() => setShowFilterPopover(false)}
        />
      )}

      {/* Hover preview */}
      <SidebarHoverPreview
        game={hoveredGame}
        anchorSelector={hoverPreviewAnchor}
        active={hoveredGameId !== null}
      />
    </aside>
  );
}
