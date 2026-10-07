// Main "Mods" page — dual-pane: a moddable-games rail on the left
// (installed games + per-game mod counts from mods.db), global cockpit stats,
// collapsible rail toggle, and the modular ModManager / Discover workspace on the right.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePresence } from "../../context/PresenceContext";
import { useToast } from "../../context/ToastContext";
import {
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Layers,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button, PageHeader } from "../../components/ui";
import ModManager from "../../components/mods/ModManager";
import ModsDiscoverView from "../../components/mods/discover/ModsDiscoverView";
import { getGamePresets } from "../../components/mods/ModPresetsModal";
import PageWidget from "../../components/PageWidget";
import { ENGINE_LABELS, type ModEngine, type ModsOverviewEntry } from "../../types/mods";
import { gameDisplayName, type Game } from "../../types/game";
import "../../styles/page-mods.css";
import "../../components/mods/discover/mods-discover.css";

type RailFilter = "all" | "modded" | "updates";
type RailSort = "mods" | "name" | "size";

function formatStorage(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function ModsPage() {
  const { games, updateGame } = useGames();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>("all");
  const [railSort, setRailSort] = useState<RailSort>("mods");
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"installed" | "discover">("installed");
  const { setModsGameName } = usePresence();

  // Installed games we can scan or that already have mods. Steam titles
  // are included via `steamAppId` even when `path` is empty — native
  // Linux games have no .exe for the resolver to find, and the backend
  // locates them from the appmanifest instead.
  const candidates = useMemo(
    () =>
      games
        .filter(
          (g) =>
            (g.installed !== false &&
              (!!g.path || g.steamAppId != null)) ||
            (overview.get(g.id)?.total ?? 0) > 0
        )
        .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b))),
    [games, overview]
  );

  const refreshOverview = () => {
    setRefreshing(true);
    invoke<ModsOverviewEntry[]>("mods_overview")
      .then((rows) => setOverview(new Map(rows.map((r) => [r.gameId, r]))))
      .catch(() => setOverview(new Map()))
      .finally(() => setRefreshing(false));
  };

  useEffect(refreshOverview, []);

  // Global Statistics calculations
  const globalStats = useMemo(() => {
    let moddedGames = 0;
    let totalMods = 0;
    let enabledMods = 0;
    let totalUpdates = 0;
    let totalStorageBytes = 0;

    for (const g of candidates) {
      const entry = overview.get(g.id);
      if (entry && entry.total > 0) {
        moddedGames++;
        totalMods += entry.total;
        enabledMods += entry.enabled;
        totalUpdates += entry.updates;
      }
      totalStorageBytes += entry?.totalSizeBytes ?? g.modsSizeBytes ?? 0;
    }

    const activeRatio = totalMods > 0 ? Math.round((enabledMods / totalMods) * 100) : 0;

    return {
      moddedGames,
      totalMods,
      enabledMods,
      activeRatio,
      totalUpdates,
      totalStorageBytes,
    };
  }, [candidates, overview]);

  // Filtered & ordered games list for the rail
  const ordered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? games : candidates;

    if (railFilter === "modded") {
      list = list.filter((g) => (overview.get(g.id)?.total ?? 0) > 0);
    } else if (railFilter === "updates") {
      list = list.filter((g) => (overview.get(g.id)?.updates ?? 0) > 0);
    }

    if (q) {
      list = list.filter((g) => {
        if (
          gameDisplayName(g).toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q)
        )
          return true;
        if (g.platform.toLowerCase().includes(q)) return true;
        const engines = overview.get(g.id)?.engines ?? [];
        return engines.some((e) => e.toLowerCase().includes(q));
      });
    }

    return [...list].sort((a, b) => {
      const aEntry = overview.get(a.id);
      const bEntry = overview.get(b.id);
      const aMods = aEntry?.total ?? 0;
      const bMods = bEntry?.total ?? 0;

      if (railSort === "mods") {
        if (aMods !== bMods) return bMods - aMods;
      } else if (railSort === "size") {
        const aSize = aEntry?.totalSizeBytes ?? a.modsSizeBytes ?? 0;
        const bSize = bEntry?.totalSizeBytes ?? b.modsSizeBytes ?? 0;
        if (aSize !== bSize) return bSize - aSize;
      }

      if ((aMods > 0) !== (bMods > 0)) return aMods > 0 ? -1 : 1;
      const ai = a.installed !== false && (!!a.path || a.steamAppId != null);
      const bi = b.installed !== false && (!!b.path || b.steamAppId != null);
      if (ai !== bi) return ai ? -1 : 1;
      return gameDisplayName(a).localeCompare(gameDisplayName(b));
    });
  }, [candidates, games, overview, search, railFilter, railSort]);

  // Default selection: first game with mods, else first candidate or library game
  useEffect(() => {
    if (selectedGameId && games.some((g) => g.id === selectedGameId)) return;
    const withMods = candidates.find((g) => (overview.get(g.id)?.total ?? 0) > 0);
    setSelectedGameId((withMods ?? candidates[0] ?? games[0])?.id ?? null);
  }, [candidates, games, overview, selectedGameId]);

  const selectedGame: Game | null =
    games.find((g) => g.id === selectedGameId) ?? null;

  useEffect(() => {
    setModsGameName(selectedGame ? gameDisplayName(selectedGame) : null);
  }, [selectedGame, setModsGameName]);

  const selectedOverview = selectedGame ? overview.get(selectedGame.id) : undefined;
  const selectedPresets = useMemo(
    () => (selectedGame ? getGamePresets(selectedGame.id) : []),
    [selectedGame],
  );

  const handleOpenFolder = () => {
    if (!selectedGame?.modsFolder) return;
    invoke("open_folder", { path: selectedGame.modsFolder })
      .then(() => showToast(t("mods.openFolder"), "info"))
      .catch((e) => showToast(String(e), "error"));
  };

  return (
    <div className="mods-page">
      <PageWidget page="mods" widget="modsHeader">
        <div className="ui-item-modsHeader">
          <PageHeader
            eyebrow={t("mods.eyebrow")}
            title={t("mods.title")}
            description={t("mods.subtitle")}
          />
        </div>
      </PageWidget>

      {/* Global Cockpit Statistics Banner */}
      {candidates.length > 0 && (
        <PageWidget page="mods" widget="dashboard">
          <PageWidget page="mods" widget="modsCockpit">
            <div
              className="mods-global-cockpit ui-complete-only ui-item-dashboard ui-item-modsCockpit"
              role="region"
              aria-label={t("mods.eyebrow")}
            >
              {/* 1. Modded Games KPI */}
              <div
                className={`mods-global-kpi is-interactive ${railFilter === "modded" ? "is-filter-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setRailFilter((prev) => (prev === "modded" ? "all" : "modded"))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    setRailFilter((prev) => (prev === "modded" ? "all" : "modded"));
                  }
                }}
                title={railFilter === "modded" ? t("mods.rail.all") : t("mods.rail.modded")}
              >
                <span className="mods-global-kpi-icon">
                  <Gamepad2 size={20} />
                </span>
                <div className="mods-global-kpi-info">
                  <span className="mods-global-kpi-label">{t("mods.global.moddedGames")}</span>
                  <span className="mods-global-kpi-value">
                    {globalStats.moddedGames}{" "}
                    <span className="mods-global-kpi-sub">/ {candidates.length}</span>
                  </span>
                </div>
              </div>

              {/* 2. Total Mods KPI */}
              <div
                className="mods-global-kpi is-interactive"
                role="button"
                tabIndex={0}
                onClick={() => setRailFilter("all")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setRailFilter("all");
                }}
                title={t("mods.rail.all")}
              >
                <span className="mods-global-kpi-icon">
                  <Layers size={20} />
                </span>
                <div className="mods-global-kpi-info">
                  <span className="mods-global-kpi-label">{t("mods.global.totalMods")}</span>
                  <span className="mods-global-kpi-value">{globalStats.totalMods}</span>
                </div>
              </div>

              {/* 3. Active Ratio KPI */}
              <div className="mods-global-kpi accent-active">
                <span className="mods-global-kpi-icon">
                  <CheckCircle2 size={20} />
                </span>
                <div className="mods-global-kpi-info">
                  <span className="mods-global-kpi-label">{t("mods.global.activeRate")}</span>
                  <span className="mods-global-kpi-value">
                    {globalStats.activeRatio}%
                    <span className="mods-global-kpi-sub">
                      ({globalStats.enabledMods}/{globalStats.totalMods})
                    </span>
                  </span>
                </div>
              </div>

              {/* 4. Total Storage Footprint KPI */}
              <div className="mods-global-kpi">
                <span className="mods-global-kpi-icon">
                  <HardDrive size={20} />
                </span>
                <div className="mods-global-kpi-info">
                  <span className="mods-global-kpi-label">{t("mods.global.totalStorage")}</span>
                  <span className="mods-global-kpi-value">
                    {formatStorage(globalStats.totalStorageBytes)}
                  </span>
                </div>
              </div>

              {/* 5. Pending Updates KPI */}
              {globalStats.totalUpdates > 0 && (
                <div
                  className={`mods-global-kpi accent-update is-interactive ${railFilter === "updates" ? "is-filter-active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setRailFilter((prev) => (prev === "updates" ? "all" : "updates"))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setRailFilter((prev) => (prev === "updates" ? "all" : "updates"));
                    }
                  }}
                  title={railFilter === "updates" ? t("mods.rail.all") : t("mods.rail.updates")}
                >
                  <span className="mods-global-kpi-icon">
                    <ArrowUpCircle size={20} />
                  </span>
                  <div className="mods-global-kpi-info">
                    <span className="mods-global-kpi-label">{t("mods.global.pendingUpdates")}</span>
                    <span className="mods-global-kpi-value">
                      {globalStats.totalUpdates}
                      <span className="mods-stat-pulse-dot" />
                    </span>
                  </div>
                </div>
              )}
            </div>
          </PageWidget>
        </PageWidget>
      )}

      {candidates.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">
            <Boxes size={44} strokeWidth={1.5} />
          </div>
          <h3>{t("mods.noGames")}</h3>
          <p>{t("mods.noGamesHint")}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/library")}
          >
            {t("nav.library")}
          </Button>
        </div>
      ) : (
        <div className={`mods-page-split ${isRailCollapsed ? "rail-collapsed" : ""}`}>
          {/* ── Left Pane: Games Rail ─────────────────────────────── */}
          <PageWidget page="mods" widget="modsRail">
            <div className={`mods-games-pane ui-item-modsRail ${isRailCollapsed ? "collapsed" : ""}`}>
              {/* Rail Header */}
              <div className="mods-games-pane-header">
                <span className="mods-games-pane-title">
                  <Boxes size={14} />
                  {!isRailCollapsed && t("mods.gamesLibrary")}
                </span>
                <div className="mods-games-pane-header-actions">
                  {!isRailCollapsed && (
                    <span className="mods-games-pane-count">{candidates.length}</span>
                  )}
                  <button
                    type="button"
                    className={`mods-rail-toggle-btn${refreshing ? " spinning" : ""}`}
                    onClick={refreshOverview}
                    title={t("common.refresh")}
                    aria-label={t("common.refresh")}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <button
                    type="button"
                    className="mods-rail-toggle-btn"
                    onClick={() => setIsRailCollapsed(!isRailCollapsed)}
                    title={isRailCollapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
                    aria-label={isRailCollapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
                  >
                    {isRailCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                  </button>
                </div>
              </div>

              {/* Rail Filters & Search (Visible when expanded) */}
              {!isRailCollapsed && (
                <>
                  <div className="mods-search-input-wrapper">
                    <Search size={14} className="mods-search-icon" />
                    <input
                      type="text"
                      placeholder={t("mods.searchPlaceholder")}
                      aria-label={t("mods.searchPlaceholder")}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button
                        type="button"
                        className="mods-search-clear"
                        onClick={() => setSearch("")}
                        title={t("common.clearSearch")}
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Filter Pills & Sort Row */}
                  <div className="mods-rail-controls-row">
                    <div className="mods-rail-filter-pills" role="tablist">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={railFilter === "all"}
                        className={`mods-rail-filter-pill${railFilter === "all" ? " active" : ""}`}
                        onClick={() => setRailFilter("all")}
                      >
                        {t("mods.rail.all")}
                        <span className="mods-rail-filter-badge">{candidates.length}</span>
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={railFilter === "modded"}
                        className={`mods-rail-filter-pill${railFilter === "modded" ? " active" : ""}`}
                        onClick={() => setRailFilter("modded")}
                      >
                        {t("mods.rail.modded")}
                        <span className="mods-rail-filter-badge">{globalStats.moddedGames}</span>
                      </button>
                      {globalStats.totalUpdates > 0 && (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={railFilter === "updates"}
                          className={`mods-rail-filter-pill mods-rail-filter-pill--updates${railFilter === "updates" ? " active" : ""}`}
                          onClick={() => setRailFilter("updates")}
                        >
                          <span className="mods-stat-pulse-dot" />
                          {t("mods.rail.updates")}
                          <span className="mods-rail-filter-badge">{globalStats.totalUpdates}</span>
                        </button>
                      )}
                    </div>

                    <div className="mods-rail-sort-control">
                      <select
                        className="mods-rail-sort-select"
                        value={railSort}
                        onChange={(e) => setRailSort(e.target.value as RailSort)}
                        aria-label={t("mods.rail.sortMods")}
                      >
                        <option value="mods">{t("mods.rail.sortMods")}</option>
                        <option value="name">{t("mods.rail.sortName")}</option>
                        <option value="size">{t("mods.rail.sortSize")}</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {ordered.length === 0 && (
                <div className="mods-games-empty">
                  <p>{t("mods.noGamesMatch")}</p>
                  {(search || railFilter !== "all") && (
                    <button
                      type="button"
                      className="mods-games-empty-reset"
                      onClick={() => {
                        setSearch("");
                        setRailFilter("all");
                      }}
                    >
                      {t("common.clearSearch")}
                    </button>
                  )}
                </div>
              )}

              {/* Games List */}
              <div className="mods-games-list">
                {ordered.map((g) => {
                  const entry = overview.get(g.id);
                  const hasMods = entry && entry.total > 0;
                  const isSelected = g.id === selectedGameId;
                  const activePercentage =
                    hasMods && entry.total > 0
                      ? Math.round((entry.enabled / entry.total) * 100)
                      : 0;

                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`mods-game-row ${isSelected ? "selected" : ""} ${
                        hasMods ? "has-mods" : ""
                      } ${isRailCollapsed ? "compact" : ""}`}
                      onClick={() => setSelectedGameId(g.id)}
                      title={gameDisplayName(g)}
                    >
                      <div className="mods-game-cover">
                        {g.coverArtUrl ? (
                          <img src={g.coverArtUrl} alt="" loading="lazy" />
                        ) : (
                          <span>{gameDisplayName(g).slice(0, 2).toUpperCase()}</span>
                        )}
                        {isSelected && <span className="mods-game-selected-indicator" />}
                      </div>

                      {!isRailCollapsed && (
                        <div className="mods-game-info">
                          <div className="mods-game-header-line">
                            <span className="mods-game-name" title={gameDisplayName(g)}>
                              {gameDisplayName(g)}
                            </span>
                            <span className="mods-game-platform-pill">{g.platform}</span>
                          </div>

                          <div className="mods-game-meta">
                            {entry && entry.total > 0 ? (
                              <>
                                <span className="mods-game-count-badge">
                                  {entry.enabled > 0
                                    ? t("mods.enabledCount", {
                                        enabled: String(entry.enabled),
                                        total: String(entry.total),
                                      })
                                    : t("mods.modsCount", { count: String(entry.total) })}
                                </span>
                                {(entry.totalSizeBytes ?? 0) > 0 && (
                                  <span className="mods-game-size-text">
                                    {formatStorage(entry.totalSizeBytes ?? 0)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="mods-game-nomod">{t("mods.noModsYet")}</span>
                            )}
                          </div>

                          {/* Mini Progress Track */}
                          {hasMods && (
                            <div className="mods-game-progress-track">
                              <div
                                className="mods-game-progress-fill"
                                style={{ width: `${activePercentage}%` }}
                              />
                            </div>
                          )}

                          {entry && entry.engines.length > 0 && (
                            <div className="mods-game-engines-list">
                              {entry.engines.slice(0, 2).map((e) => (
                                <span key={e} className={`mods-engine-chip mods-engine-${e}`}>
                                  {ENGINE_LABELS[e as ModEngine] ?? e}
                                </span>
                              ))}
                              {entry.engines.length > 2 && (
                                <span className="mods-game-engines">
                                  +{entry.engines.length - 2}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!isRailCollapsed && entry && entry.updates > 0 && (
                        <span
                          className="mods-badge mods-badge-update"
                          title={t("mods.updatesAvailable", { count: String(entry.updates) })}
                        >
                          ↑ {entry.updates}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </PageWidget>

          {/* ── Right Pane: Manager Workspace ─────────────────────── */}
          <PageWidget page="mods" widget="modsWorkspace">
            <div className="mods-page-manager ui-item-modsWorkspace">
              {selectedGame ? (
                <>
                  {/* Game Command Banner */}
                  <div className="mods-workspace-banner">
                    <div className="mods-workspace-banner-main">
                      <div className="mods-workspace-cover">
                        {selectedGame.coverArtUrl ? (
                          <img src={selectedGame.coverArtUrl} alt="" loading="lazy" />
                        ) : (
                          <span>{gameDisplayName(selectedGame).slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>

                      <div className="mods-workspace-meta">
                        <div className="mods-workspace-tagline">
                          <span className="mods-workspace-platform">{selectedGame.platform}</span>
                          {selectedPresets.length > 0 && (
                            <span className="mods-tab-preset-pill">
                              {selectedPresets.length} {t("mods.presets")}
                            </span>
                          )}
                          {selectedOverview && selectedOverview.total > 0 && (
                            <span className="mods-workspace-stat-pill">
                              {t("mods.modsCount", { count: String(selectedOverview.total) })}
                            </span>
                          )}
                          {selectedGame.modsFolder && (
                            <button
                              type="button"
                              className="mods-workspace-folder-chip"
                              onClick={handleOpenFolder}
                              title={`${t("mods.openLocation")}: ${selectedGame.modsFolder}`}
                            >
                              <FolderOpen size={12} />
                              <span className="mods-workspace-folder-text">
                                {selectedGame.modsFolder}
                              </span>
                            </button>
                          )}
                        </div>

                        <h2 className="mods-workspace-title">{gameDisplayName(selectedGame)}</h2>
                      </div>
                    </div>

                    <div className="mods-workspace-controls">
                      {/* Subtab Segmented Switcher */}
                      <div className="mods-tab-nav-switcher" role="tablist">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={workspaceTab === "installed"}
                          className={`mods-tab-nav-btn${workspaceTab === "installed" ? " active" : ""}`}
                          onClick={() => setWorkspaceTab("installed")}
                        >
                          <Boxes size={14} />
                          <span>{t("mods.tab.installedMods")}</span>
                          {selectedOverview && selectedOverview.total > 0 && (
                            <span className="mods-tab-nav-count">{selectedOverview.total}</span>
                          )}
                        </button>

                        <button
                          type="button"
                          role="tab"
                          aria-selected={workspaceTab === "discover"}
                          className={`mods-tab-nav-btn${workspaceTab === "discover" ? " active" : ""}`}
                          onClick={() => setWorkspaceTab("discover")}
                        >
                          <Compass size={14} />
                          <span>{t("mods.discover.cta")}</span>
                        </button>
                      </div>

                      {/* Header Actions */}
                      <div className="mods-workspace-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/library/${selectedGame.id}`)}
                          leftIcon={<ExternalLink size={13} />}
                        >
                          {t("mods.viewGamePage")}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Active Subtab View */}
                  <div className="mods-workspace-view-wrap" key={workspaceTab}>
                    {workspaceTab === "installed" ? (
                      <ModManager
                        key={selectedGame.id}
                        game={selectedGame}
                        onChanged={refreshOverview}
                        onModsSized={(info) =>
                          updateGame(selectedGame.id, {
                            modsSizeBytes: info.totalBytes > 0 ? info.totalBytes : undefined,
                            modsFolder: info.folder,
                            modsDetectedAt:
                              info.totalBytes > 0 ? new Date().toISOString() : undefined,
                          })
                        }
                      />
                    ) : (
                      <ModsDiscoverView
                        key={selectedGame.id}
                        game={selectedGame}
                        variant="subtab"
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="mods-detail-empty">{t("mods.selectGame")}</div>
              )}
            </div>
          </PageWidget>
        </div>
      )}
    </div>
  );
}
