// Main "Mods" page — dual-pane: a moddable-games rail on the left
// (installed games + per-game mod counts from mods.db), global cockpit stats,
// collapsible rail toggle, and the modular ModManager on the right.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { usePresence } from "../../context/PresenceContext";
import { Button, PageHeader } from "../../components/ui";
import ModManager from "../../components/mods/ModManager";
import { ENGINE_LABELS, type ModEngine, type ModsOverviewEntry } from "../../types/mods";
import type { Game } from "../../types/game";
import "../../styles/page-mods.css";

type RailFilter = "all" | "modded" | "updates";

function formatStorage(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export default function ModsPage() {
  const { games, updateGame } = useGames();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Map<string, ModsOverviewEntry>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [railFilter, setRailFilter] = useState<RailFilter>("all");
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const { setModsGameName } = usePresence();

  // Installed games with a real on-disk path are moddable candidates.
  const candidates = useMemo(
    () =>
      games
        .filter((g) => g.installed !== false && !!g.path)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [games]
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
      // Prefer the aggregate from mods_overview (accurate without visiting
      // each game); fall back to the game's cached on-disk footprint.
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
    let list = candidates;

    // Filter by rail status
    if (railFilter === "modded") {
      list = list.filter((g) => (overview.get(g.id)?.total ?? 0) > 0);
    } else if (railFilter === "updates") {
      list = list.filter((g) => (overview.get(g.id)?.updates ?? 0) > 0);
    }

    // Filter by search query (name, platform, or detected engine)
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((g) => {
        if (g.name.toLowerCase().includes(q)) return true;
        if (g.platform.toLowerCase().includes(q)) return true;
        const engines = overview.get(g.id)?.engines ?? [];
        return engines.some((e) => e.toLowerCase().includes(q));
      });
    }

    // Games with known mods float to top, then alphabetical
    return [...list].sort((a, b) => {
      const am = overview.get(a.id)?.total ?? 0;
      const bm = overview.get(b.id)?.total ?? 0;
      if ((am > 0) !== (bm > 0)) return am > 0 ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [candidates, overview, search, railFilter]);

  // Default selection: first game with mods, else first candidate
  useEffect(() => {
    if (selectedGameId && candidates.some((g) => g.id === selectedGameId)) return;
    const withMods = candidates.find((g) => (overview.get(g.id)?.total ?? 0) > 0);
    setSelectedGameId((withMods ?? candidates[0])?.id ?? null);
  }, [candidates, overview, selectedGameId]);

  const selectedGame: Game | null =
    candidates.find((g) => g.id === selectedGameId) ?? null;

  useEffect(() => {
    setModsGameName(selectedGame?.name ?? null);
  }, [selectedGame, setModsGameName]);

  return (
    <div className="mods-page">
      <PageHeader
        eyebrow={t("mods.eyebrow")}
        title={t("mods.title")}
        description={t("mods.subtitle")}
      />

      {/* Global Cockpit Statistics Banner */}
      {candidates.length > 0 && (
        <div className="mods-global-cockpit ui-complete-only" role="region" aria-label={t("mods.eyebrow")}>
          <div className="mods-global-kpi">
            <span className="mods-global-kpi-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M6 12h4m-2-2v4" />
                <circle cx="17" cy="10" r="1" fill="currentColor" />
                <circle cx="15" cy="13" r="1" fill="currentColor" />
              </svg>
            </span>
            <div className="mods-global-kpi-info">
              <span className="mods-global-kpi-label">{t("mods.global.moddedGames")}</span>
              <span className="mods-global-kpi-value">
                {globalStats.moddedGames}{" "}
                <span className="mods-global-kpi-sub">/ {candidates.length}</span>
              </span>
            </div>
          </div>

          <div className="mods-global-kpi">
            <span className="mods-global-kpi-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </span>
            <div className="mods-global-kpi-info">
              <span className="mods-global-kpi-label">{t("mods.global.totalMods")}</span>
              <span className="mods-global-kpi-value">{globalStats.totalMods}</span>
            </div>
          </div>

          <div className="mods-global-kpi accent-active">
            <span className="mods-global-kpi-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
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

          <div className="mods-global-kpi">
            <span className="mods-global-kpi-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            <div className="mods-global-kpi-info">
              <span className="mods-global-kpi-label">{t("mods.global.totalStorage")}</span>
              <span className="mods-global-kpi-value">
                {formatStorage(globalStats.totalStorageBytes)}
              </span>
            </div>
          </div>

          {globalStats.totalUpdates > 0 && (
            <div className="mods-global-kpi accent-update">
              <span className="mods-global-kpi-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15" />
                  <path d="M12 9v12" />
                </svg>
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
      )}

      {candidates.length === 0 ? (
        <div className="mods-empty">
          <div className="mods-empty-glyph">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 12h4m-2-2v4" />
              <circle cx="17" cy="10" r="1" fill="currentColor" />
              <circle cx="15" cy="13" r="1" fill="currentColor" />
            </svg>
          </div>
          <h3>{t("mods.noGames")}</h3>
          <p>{t("mods.noGamesHint")}</p>
        </div>
      ) : (
        <div className={`mods-page-split ${isRailCollapsed ? "rail-collapsed" : ""}`}>
          {/* ── Left Pane: Games Rail ─────────────────────────────── */}
          <div className={`mods-games-pane ${isRailCollapsed ? "collapsed" : ""}`}>
            {/* Rail Header */}
            <div className="mods-games-pane-header">
              <span className="mods-games-pane-title">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" />
                  <path d="M6 12h4m-2-2v4" />
                  <circle cx="17" cy="10" r="1" fill="currentColor" />
                  <circle cx="15" cy="13" r="1" fill="currentColor" />
                </svg>
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
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="mods-rail-toggle-btn"
                  onClick={() => setIsRailCollapsed(!isRailCollapsed)}
                  title={isRailCollapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
                  aria-label={isRailCollapsed ? t("mods.rail.expand") : t("mods.rail.collapse")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {isRailCollapsed ? (
                      <polyline points="9 18 15 12 9 6" />
                    ) : (
                      <polyline points="15 18 9 12 15 6" />
                    )}
                  </svg>
                </button>
              </div>
            </div>

            {/* Rail Filters & Search (Visible when expanded) */}
            {!isRailCollapsed && (
              <>
                <div className="mods-search-input-wrapper">
                  <svg className="mods-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
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
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Rail Filter Dropdown */}
                <div className="mods-rail-filters-row">
                  <select
                    className="mods-sort-select"
                    style={{ width: "100%" }}
                    value={railFilter}
                    onChange={(e) => setRailFilter(e.target.value as any)}
                    aria-label={t("mods.rail.all")}
                  >
                    <option value="all">{t("mods.rail.all")}</option>
                    <option value="modded">{t("mods.rail.modded")} ({globalStats.moddedGames})</option>
                    {globalStats.totalUpdates > 0 && (
                      <option value="updates">{t("mods.rail.updates")} ({globalStats.totalUpdates})</option>
                    )}
                  </select>
                </div>
              </>
            )}

            {ordered.length === 0 && (
              <div className="mods-games-empty">{t("mods.noGamesMatch")}</div>
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
                    title={g.name}
                  >
                    <div className="mods-game-cover">
                      {g.coverArtUrl ? (
                        <img src={g.coverArtUrl} alt="" loading="lazy" />
                      ) : (
                        <span>{g.name.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>

                    {!isRailCollapsed && (
                      <div className="mods-game-info">
                        <span className="mods-game-name" title={g.name}>
                          {g.name}
                        </span>
                        <div className="mods-game-meta">
                          {entry ? (
                            <>
                              <span
                                className="mods-game-count"
                                title={t("mods.modsCount", { count: String(entry.total) })}
                              >
                                {t("mods.modsCount", { count: String(entry.total) })}
                              </span>
                              {entry.enabled > 0 && (
                                <span className="mods-game-count-sub">
                                  {t("mods.enabledCount", {
                                    enabled: String(entry.enabled),
                                    total: String(entry.total),
                                  })}
                                </span>
                              )}
                              <span className="mods-game-platform">{g.platform}</span>
                            </>
                          ) : (
                            <>
                              <span className="mods-game-platform">{g.platform}</span>
                              <span className="mods-game-nomod">{t("mods.noModsYet")}</span>
                            </>
                          )}
                        </div>

                        {/* Visual mini progress track */}
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

          {/* ── Right Pane: Manager Workspace ─────────────────────── */}
          <div className="mods-page-manager">
            {selectedGame ? (
              <>
                <div className="mods-manager-game-bar">
                  <div className="mods-manager-game-bar-info">
                    <span className="mods-manager-game-bar-name">{selectedGame.name}</span>
                    <span className="mods-manager-game-bar-platform">{selectedGame.platform}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/library/${selectedGame.id}`)}
                    leftIcon={
                      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    }
                  >
                    {t("mods.viewGamePage")}
                  </Button>
                </div>
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
              </>
            ) : (
              <div className="mods-detail-empty">{t("mods.selectGame")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
